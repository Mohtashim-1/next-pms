from __future__ import annotations

import csv
import io
import json

import frappe
from frappe.utils import add_days, flt, getdate, today

from next_pms.api.utils import error_logger

REQUIRED_CSV_COLUMNS = [
    "project_name",
    "customer",
    "project_type",
    "expected_start_date",
    "expected_end_date",
    "custom_project_manager",
]


def _ensure_project_permission():
    if frappe.session.user == "Administrator":
        return
    frappe.only_for(["Projects Manager", "Projects User", "System Manager"], message=True)


def _apply_tags(project_name: str, tags: list[str] | str | None):
    if not tags:
        return

    from frappe.desk.doctype.tag.tag import add_tag

    tag_values = tags if isinstance(tags, list) else [tag.strip() for tag in str(tags).split(",")]
    for tag in tag_values:
        if tag and tag.strip():
            add_tag(tag.strip(), "Project", project_name)


def _build_project_doc(data: dict):
    doc = frappe.new_doc("Project")
    doc.naming_series = data.get("naming_series")
    doc.project_name = data.get("project_name")
    doc.customer = data.get("customer")
    doc.project_type = data.get("project_type")
    doc.expected_start_date = data.get("expected_start_date")
    doc.expected_end_date = data.get("expected_end_date")
    doc.company = data.get("company")

    if data.get("project_template"):
        doc.project_template = data.get("project_template")

    if data.get("custom_project_manager"):
        doc.custom_project_manager = data.get("custom_project_manager")

    if data.get("estimated_costing") is not None:
        doc.estimated_costing = flt(data.get("estimated_costing"))

    if data.get("custom_project_team") and frappe.db.has_column("Project", "custom_project_team"):
        doc.custom_project_team = data.get("custom_project_team")

    return doc


@frappe.whitelist()
@error_logger
def get_project_template_defaults(template_name: str, start_date: str | None = None):
    _ensure_project_permission()
    if not template_name or not frappe.db.exists("Project Template", template_name):
        frappe.throw("Project Template not found.")

    template = frappe.get_doc("Project Template", template_name)
    start = getdate(start_date or today())
    max_offset = 0

    for row in template.tasks:
        task = frappe.get_doc("Task", row.task)
        offset = flt(task.start) + flt(task.duration)
        max_offset = max(max_offset, offset)

    end_date = add_days(start, int(max_offset))

    return {
        "project_template": template.name,
        "project_type": template.project_type,
        "expected_start_date": str(start),
        "expected_end_date": str(end_date),
        "task_count": len(template.tasks),
    }


@frappe.whitelist()
@error_logger
def create_project(project: dict | str):
    _ensure_project_permission()

    if isinstance(project, str):
        project = json.loads(project)

    project = frappe._dict(project or {})
    _validate_project_payload(project)

    doc = _build_project_doc(project)
    doc.insert()

    _apply_tags(doc.name, project.get("tags"))

    return {
        "name": doc.name,
        "project_name": doc.project_name,
        "project_template": doc.project_template,
    }


@frappe.whitelist()
@error_logger
def bulk_import_projects(csv_content: str, company: str | None = None, naming_series: str | None = None):
    _ensure_project_permission()

    if not csv_content:
        frappe.throw("CSV content is required.")

    reader = csv.DictReader(io.StringIO(csv_content))
    if not reader.fieldnames:
        frappe.throw("CSV file must include a header row.")

    missing_columns = [column for column in REQUIRED_CSV_COLUMNS if column not in reader.fieldnames]
    if missing_columns:
        frappe.throw(f"Missing required CSV columns: {', '.join(missing_columns)}")

    default_company = company or frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
        "Global Defaults", "default_company"
    )
    if not default_company:
        frappe.throw("Company is required for bulk import.")

    created = []
    errors = []

    for index, row in enumerate(reader, start=2):
        if not any((value or "").strip() for value in row.values()):
            continue

        try:
            payload = _normalize_csv_row(row, default_company, naming_series)
            _validate_project_payload(payload)
            doc = _build_project_doc(payload)
            doc.insert()
            _apply_tags(doc.name, payload.get("tags"))
            created.append({"row": index, "name": doc.name, "project_name": doc.project_name})
        except Exception as exc:
            errors.append({"row": index, "project_name": row.get("project_name"), "error": str(exc)})

    return {
        "created_count": len(created),
        "error_count": len(errors),
        "created": created,
        "errors": errors,
    }


def _normalize_csv_row(row: dict, default_company: str, default_naming_series: str | None):
    tags = row.get("tags")
    return {
        "naming_series": (row.get("naming_series") or default_naming_series or "").strip(),
        "project_name": (row.get("project_name") or "").strip(),
        "customer": (row.get("customer") or "").strip(),
        "project_type": (row.get("project_type") or "").strip(),
        "expected_start_date": (row.get("expected_start_date") or "").strip(),
        "expected_end_date": (row.get("expected_end_date") or "").strip(),
        "custom_project_manager": (row.get("custom_project_manager") or "").strip(),
        "project_template": (row.get("project_template") or "").strip() or None,
        "estimated_costing": flt(row.get("estimated_costing") or 0) or None,
        "custom_project_team": (row.get("custom_project_team") or "").strip() or None,
        "company": (row.get("company") or default_company).strip(),
        "tags": [tag.strip() for tag in tags.split(",")] if tags else [],
    }


def _get_default_naming_series() -> str | None:
    field = frappe.get_meta("Project").get_field("naming_series")
    if field and field.options:
        return field.options.split("\n")[0].strip() or None
    return None


def _validate_project_payload(project: dict):
    if not project.get("naming_series"):
        project["naming_series"] = _get_default_naming_series()

    required = {
        "project_name": "Project name",
        "customer": "Client",
        "project_type": "Project type",
        "expected_start_date": "Start date",
        "expected_end_date": "End date",
        "custom_project_manager": "Project manager",
        "company": "Company",
        "naming_series": "Naming series",
    }

    for field, label in required.items():
        if not project.get(field):
            frappe.throw(f"{label} is required.")

    if getdate(project.expected_start_date) > getdate(project.expected_end_date):
        frappe.throw("End date must be on or after start date.")

    if not frappe.db.exists("Customer", project.customer):
        frappe.throw(f"Client '{project.customer}' was not found.")

    if not frappe.db.exists("Project Type", project.project_type):
        frappe.throw(f"Project type '{project.project_type}' was not found.")

    if not frappe.db.exists("User", project.custom_project_manager):
        frappe.throw(f"Project manager '{project.custom_project_manager}' was not found.")

    if project.get("project_template") and not frappe.db.exists("Project Template", project.project_template):
        frappe.throw(f"Project template '{project.project_template}' was not found.")

    if project.get("custom_project_team") and frappe.db.has_column("Project", "custom_project_team"):
        if not frappe.db.exists("User Group", project.custom_project_team):
            frappe.throw(f"Team '{project.custom_project_team}' was not found.")
