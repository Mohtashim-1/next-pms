from __future__ import annotations

import json

import frappe
from frappe.utils import add_days, flt, getdate, nowdate

from next_pms.timesheet.utils.description import get_project_description_settings, strip_description_content

DRAFT_FIELDS = [
    "name",
    "customer",
    "customer_name",
    "project",
    "company",
    "currency",
    "period_start",
    "period_end",
    "posting_date",
    "due_date",
    "po_no",
    "sales_order",
    "template",
    "status",
    "sales_invoice",
    "invoice_title",
    "cover_message",
    "notes",
    "terms",
    "total_hours",
    "subtotal_amount",
    "modified",
]

LINE_FIELDS = [
    "name",
    "include",
    "timesheet_detail",
    "timesheet",
    "project",
    "employee",
    "employee_name",
    "task",
    "task_subject",
    "activity_type",
    "description",
    "entry_date",
    "hours",
    "rate",
    "amount",
]


def recalculate_draft_totals(doc):
    total_hours = 0.0
    subtotal_amount = 0.0
    for row in doc.get("lines", []):
        if not row.include:
            continue
        row.hours = flt(row.hours, 2)
        row.rate = flt(row.rate, 2)
        row.amount = flt(flt(row.hours) * flt(row.rate), 2) if row.hours and row.rate else flt(row.amount, 2)
        total_hours += row.hours
        subtotal_amount += row.amount
    doc.total_hours = flt(total_hours, 2)
    doc.subtotal_amount = flt(subtotal_amount, 2)


def get_default_company() -> str:
    return (
        frappe.defaults.get_user_default("Company")
        or frappe.db.get_single_value("Global Defaults", "default_company")
        or frappe.db.get_value("Company", {}, "name")
    )


def resolve_template(customer: str | None, template: str | None = None):
    if template and frappe.db.exists("Client Invoice Template", template):
        return frappe.get_doc("Client Invoice Template", template)

    if customer:
        customer_template = frappe.db.get_value(
            "Client Invoice Template",
            {"customer": customer},
            "name",
            order_by="is_default desc, modified desc",
        )
        if customer_template:
            return frappe.get_doc("Client Invoice Template", customer_template)

    default_template = frappe.db.get_value("Client Invoice Template", {"is_default": 1}, "name")
    if default_template:
        return frappe.get_doc("Client Invoice Template", default_template)

    return None


def get_template_options(customer: str | None = None) -> list[dict]:
    filters = None
    if customer:
        filters = [["customer", "in", [customer, ""]]]
    rows = frappe.get_all(
        "Client Invoice Template",
        filters=filters,
        fields=["name", "template_name", "customer", "is_default"],
        order_by="is_default desc, template_name asc",
    )
    return rows


def _project_names_for_po(customer: str, po_no: str | None, sales_order: str | None = None) -> list[str] | None:
    sales_orders: list[str] = []
    if sales_order:
        sales_orders = [sales_order]
    elif po_no:
        sales_orders = frappe.get_all(
            "Sales Order",
            filters={"customer": customer, "po_no": po_no, "docstatus": 1},
            pluck="name",
        )
        if not sales_orders:
            return []

    if not sales_orders:
        return None

    return frappe.get_all("Project", filters={"sales_order": ["in", sales_orders]}, pluck="name") or []


def search_billable_entries(
    customer: str,
    period_start: str,
    period_end: str,
    project: str | None = None,
    po_no: str | None = None,
    sales_order: str | None = None,
) -> list[dict]:
    if not customer:
        frappe.throw("Client is required.")

    start_date = getdate(period_start)
    end_date = getdate(period_end)
    if start_date > end_date:
        frappe.throw("Period start cannot be after period end.")

    conditions = [
        "ts.docstatus = 1",
        "td.is_billable = 1",
        "IFNULL(td.sales_invoice, '') = ''",
        "p.customer = %(customer)s",
        "DATE(td.from_time) BETWEEN %(start_date)s AND %(end_date)s",
    ]
    values = {"customer": customer, "start_date": start_date, "end_date": end_date}

    if project:
        conditions.append("td.project = %(project)s")
        values["project"] = project

    po_projects = _project_names_for_po(customer, po_no, sales_order)
    if po_projects is not None:
        if not po_projects:
            return []
        conditions.append("td.project IN %(po_projects)s")
        values["po_projects"] = tuple(po_projects)

    # nosemgrep
    rows = frappe.db.sql(
        f"""
        SELECT
            td.name AS timesheet_detail,
            td.parent AS timesheet,
            td.project,
            p.project_name,
            td.task,
            t.subject AS task_subject,
            td.activity_type,
            td.description,
            DATE(td.from_time) AS entry_date,
            COALESCE(NULLIF(td.billing_hours, 0), td.hours) AS hours,
            td.billing_rate AS rate,
            COALESCE(NULLIF(td.billing_amount, 0), td.base_billing_amount, 0) AS amount,
            ts.employee,
            e.employee_name,
            ts.company,
            p.sales_order
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        INNER JOIN `tabProject` p ON p.name = td.project
        LEFT JOIN `tabTask` t ON t.name = td.task
        LEFT JOIN `tabEmployee` e ON e.name = ts.employee
        WHERE {" AND ".join(conditions)}
        ORDER BY td.from_time ASC, td.creation ASC
        """,
        values,
        as_dict=True,
    )

    for row in rows:
        settings = get_project_description_settings(row.project)
        if settings["include_on_invoice"]:
            row.description = strip_description_content(row.description)
        else:
            row.description = ""
        row.rate = flt(row.rate, 2)
        row.hours = flt(row.hours, 2)
        if not row.amount and row.hours and row.rate:
            row.amount = flt(row.hours * row.rate, 2)
        row.amount = flt(row.amount, 2)

    return rows


def create_invoice_draft(payload: dict) -> dict:
    customer = payload.get("customer")
    if not customer:
        frappe.throw("Client is required.")

    period_start = payload.get("period_start")
    period_end = payload.get("period_end")
    entries = search_billable_entries(
        customer,
        period_start,
        period_end,
        project=payload.get("project"),
        po_no=payload.get("po_no"),
        sales_order=payload.get("sales_order"),
    )
    if not entries:
        frappe.throw("No unbilled billable entries found for the selected filters.")

    company = payload.get("company") or entries[0].company or get_default_company()
    currency = payload.get("currency") or frappe.db.get_value("Customer", customer, "default_currency") or frappe.db.get_value(
        "Company", company, "default_currency"
    )
    template_doc = resolve_template(customer, payload.get("template"))

    draft = frappe.get_doc(
        {
            "doctype": "Client Invoice Draft",
            "customer": customer,
            "project": payload.get("project"),
            "company": company,
            "currency": currency,
            "period_start": period_start,
            "period_end": period_end,
            "posting_date": payload.get("posting_date") or nowdate(),
            "due_date": payload.get("due_date") or add_days(nowdate(), 30),
            "po_no": payload.get("po_no"),
            "sales_order": payload.get("sales_order") or entries[0].sales_order,
            "template": template_doc.name if template_doc else None,
            "invoice_title": payload.get("invoice_title") or "Invoice",
            "cover_message": payload.get("cover_message") or (template_doc.cover_message if template_doc else None),
            "notes": payload.get("notes"),
            "terms": payload.get("terms"),
            "status": "Draft",
            "lines": [_entry_to_line(entry) for entry in entries],
        }
    )
    draft.insert(ignore_permissions=True)
    return serialize_draft(draft)


def _entry_to_line(entry: dict) -> dict:
    return {
        "include": 1,
        "timesheet_detail": entry.timesheet_detail,
        "timesheet": entry.timesheet,
        "project": entry.project,
        "employee": entry.employee,
        "employee_name": entry.employee_name,
        "task": entry.task,
        "task_subject": entry.task_subject,
        "activity_type": entry.activity_type,
        "description": entry.description,
        "entry_date": entry.entry_date,
        "hours": entry.hours,
        "rate": entry.rate,
        "amount": entry.amount,
    }


def update_invoice_draft(name: str, payload: dict, autosave: bool = False) -> dict:
    draft = frappe.get_doc("Client Invoice Draft", name)
    if draft.status != "Draft":
        frappe.throw("Only draft invoices can be edited.")

    for field in (
        "invoice_title",
        "cover_message",
        "notes",
        "terms",
        "posting_date",
        "due_date",
        "po_no",
        "sales_order",
        "template",
        "project",
    ):
        if field in payload:
            draft.set(field, payload.get(field))

    if payload.get("lines") is not None:
        lines = payload["lines"]
        if isinstance(lines, str):
            lines = json.loads(lines)
        draft.set("lines", [])
        for line in lines:
            line = frappe._dict(line)
            line.amount = flt(flt(line.hours) * flt(line.rate), 2) if line.hours and line.rate else flt(line.amount, 2)
            draft.append("lines", line)

    recalculate_draft_totals(draft)
    if autosave:
        draft.flags.ignore_validate = True
    draft.save(ignore_permissions=True)
    return serialize_draft(draft)


def abandon_invoice_draft(name: str) -> dict:
    draft = frappe.get_doc("Client Invoice Draft", name)
    if draft.status != "Draft":
        frappe.throw("Only open drafts can be abandoned.")
    draft.status = "Cancelled"
    draft.save(ignore_permissions=True)
    return {"name": draft.name, "status": draft.status}


def serialize_draft(doc, include_preview: bool = False) -> dict:
    if isinstance(doc, str):
        doc = frappe.get_doc("Client Invoice Draft", doc)

    data = {field: doc.get(field) for field in DRAFT_FIELDS}
    if doc.project:
        data["project_name"] = frappe.db.get_value("Project", doc.project, "project_name")

    data["lines"] = []
    for row in doc.lines:
        line = {field: row.get(field) for field in LINE_FIELDS}
        if row.project:
            line["project_name"] = frappe.db.get_value("Project", row.project, "project_name")
        data["lines"].append(line)

    if include_preview:
        data["preview_html"] = render_invoice_preview(doc.name)
    return data


def _branding_context(template_doc, company: str) -> dict:
    branding = {
        "primary_color": "#1f4b99",
        "accent_color": "#f4f7fb",
        "company_display_name": frappe.db.get_value("Company", company, "company_name"),
        "logo_url": None,
        "header_html": "",
        "footer_html": "",
        "cover_message": "",
        "custom_css": "",
        "show_line_descriptions": True,
    }
    if template_doc:
        branding.update(
            {
                "primary_color": template_doc.primary_color or branding["primary_color"],
                "accent_color": template_doc.accent_color or branding["accent_color"],
                "company_display_name": template_doc.company_display_name or branding["company_display_name"],
                "logo_url": template_doc.logo,
                "header_html": template_doc.header_html or "",
                "footer_html": template_doc.footer_html or "",
                "cover_message": template_doc.cover_message or "",
                "custom_css": template_doc.custom_css or "",
                "show_line_descriptions": bool(template_doc.show_line_descriptions),
            }
        )
        if branding["logo_url"]:
            branding["logo_url"] = frappe.utils.get_url(branding["logo_url"])
    return branding


def render_invoice_preview(draft_name: str) -> str:
    draft = frappe.get_doc("Client Invoice Draft", draft_name)
    template_doc = resolve_template(draft.customer, draft.template)
    included_lines = []
    for row in draft.lines:
        if not row.include:
            continue
        line = {field: row.get(field) for field in LINE_FIELDS}
        if row.project:
            line["project_name"] = frappe.db.get_value("Project", row.project, "project_name")
        included_lines.append(line)

    context = {
        "draft": {
            **{field: draft.get(field) for field in DRAFT_FIELDS},
            "project_name": frappe.db.get_value("Project", draft.project, "project_name") if draft.project else None,
        },
        "lines": included_lines,
        "branding": _branding_context(template_doc, draft.company),
        "company": frappe.get_doc("Company", draft.company),
    }
    return frappe.render_template("client_invoice_preview.html", context)


def _get_default_service_item(company: str) -> str | None:
    item = frappe.db.get_value("Item Default", {"company": company}, "parent")
    if item:
        return item
    return frappe.db.get_value("Item", {"is_sales_item": 1, "is_stock_item": 0, "disabled": 0}, "name")


def finalize_invoice_draft(name: str, submit: int = 0) -> dict:
    draft = frappe.get_doc("Client Invoice Draft", name)
    if draft.status != "Draft":
        frappe.throw("This invoice draft has already been finalized.")
    if not any(row.include for row in draft.lines):
        frappe.throw("At least one line must be included before finalizing.")

    invoice = frappe.new_doc("Sales Invoice")
    invoice.customer = draft.customer
    invoice.company = draft.company
    invoice.currency = draft.currency
    invoice.project = draft.project
    invoice.po_no = draft.po_no
    invoice.set_posting_time = 1
    invoice.posting_date = draft.posting_date or nowdate()
    invoice.due_date = draft.due_date
    if draft.sales_order:
        invoice.sales_order = draft.sales_order
    if draft.notes:
        invoice.remarks = frappe.utils.strip_html(draft.notes)

    for row in draft.lines:
        if not row.include:
            continue
        detail = frappe.db.get_value(
            "Timesheet Detail",
            row.timesheet_detail,
            ["from_time", "to_time", "project_name"],
            as_dict=True,
        )
        invoice.append(
            "timesheets",
            {
                "time_sheet": row.timesheet,
                "timesheet_detail": row.timesheet_detail,
                "billing_hours": row.hours,
                "billing_amount": row.amount,
                "activity_type": row.activity_type,
                "description": row.description,
                "project_name": detail.project_name if detail else None,
                "from_time": detail.from_time if detail else None,
                "to_time": detail.to_time if detail else None,
            },
        )

    invoice.run_method("calculate_billing_amount_for_timesheet")

    item_code = _get_default_service_item(draft.company)
    included_lines = [row for row in draft.lines if row.include]
    total_hours = sum(flt(row.hours) for row in included_lines)
    total_amount = sum(flt(row.amount) for row in included_lines)
    if item_code and total_amount:
        invoice.append(
            "items",
            {
                "item_code": item_code,
                "qty": total_hours or 1,
                "rate": flt(total_amount / (total_hours or 1), 2),
                "description": f"Professional services ({draft.period_start} to {draft.period_end})",
            },
        )

    invoice.run_method("set_missing_values")
    invoice.insert(ignore_permissions=True)

    if submit:
        invoice.submit()

    draft.status = "Finalized"
    draft.sales_invoice = invoice.name
    draft.save(ignore_permissions=True)

    result = serialize_draft(draft)
    result["sales_invoice"] = invoice.name
    result["sales_invoice_status"] = "Submitted" if submit else "Draft"
    return result


def list_invoice_drafts(
    customer: str | None = None,
    project: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[dict]:
    filters = {}
    if customer:
        filters["customer"] = customer
    if project:
        filters["project"] = project
    if status:
        filters["status"] = status

    rows = frappe.get_all(
        "Client Invoice Draft",
        filters=filters,
        fields=DRAFT_FIELDS,
        order_by="modified desc",
        limit_page_length=limit,
    )
    return rows


def save_invoice_template(payload: dict) -> dict:
    payload = frappe._dict(payload or {})
    if not payload.template_name:
        frappe.throw("Template name is required.")

    if payload.name and frappe.db.exists("Client Invoice Template", payload.name):
        doc = frappe.get_doc("Client Invoice Template", payload.name)
        doc.update(payload)
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc({"doctype": "Client Invoice Template", **payload})
        doc.insert(ignore_permissions=True)

    return {
        "name": doc.name,
        "template_name": doc.template_name,
        "customer": doc.customer,
        "is_default": doc.is_default,
    }
