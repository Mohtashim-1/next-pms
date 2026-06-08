from __future__ import annotations

from collections import defaultdict

import frappe
from erpnext import get_default_company
from frappe.utils import flt, getdate

from next_pms.utils.employee import convert_currency

GROUP_BY_OPTIONS = ("customer", "project_type", "department", "project")


def _reporting_currency(company: str | None = None) -> str:
    company = company or get_default_company()
    return frappe.db.get_value("Company", company, "default_currency") or "USD"


def _to_reporting(amount: float, currency: str | None, reporting_currency: str, transaction_date=None) -> float:
    if not amount:
        return 0.0
    if not currency or currency == reporting_currency:
        return flt(amount)
    return flt(convert_currency(amount, currency, reporting_currency, transaction_date))


def _get_project_filters(filters: dict) -> dict:
    project_filters = {"status": ["!=", "Cancelled"]}
    if filters.get("customer"):
        project_filters["customer"] = filters["customer"]
    if filters.get("project_type"):
        project_filters["project_type"] = filters["project_type"]
    if filters.get("department"):
        project_filters["department"] = filters["department"]
    if filters.get("project"):
        project_filters["name"] = filters["project"]
    return project_filters


def _get_projects(filters: dict) -> list[dict]:
    return frappe.get_all(
        "Project",
        filters=_get_project_filters(filters),
        fields=[
            "name",
            "project_name",
            "customer",
            "project_type",
            "department",
            "company",
            "estimated_costing",
            "total_sales_amount",
            "total_billed_amount",
            "total_costing_amount",
            "total_purchase_cost",
            "gross_margin",
            "per_gross_margin",
        ],
        order_by="project_name asc",
    )


def _planned_metrics(project: dict) -> dict:
    planned_revenue = flt(project.total_sales_amount) or flt(project.estimated_costing)
    planned_cost = flt(project.estimated_costing) if flt(project.total_sales_amount) else flt(planned_revenue) * 0.65
    if flt(project.total_sales_amount) and flt(project.estimated_costing):
        planned_cost = flt(project.estimated_costing)

    planned_margin = planned_revenue - planned_cost
    planned_margin_pct = (planned_margin / planned_revenue * 100) if planned_revenue else 0
    return {
        "planned_revenue": flt(planned_revenue, 2),
        "planned_cost": flt(planned_cost, 2),
        "planned_margin": flt(planned_margin, 2),
        "planned_margin_pct": flt(planned_margin_pct, 1),
    }


def get_period_recognized_revenue(project: str, from_date, to_date, reporting_currency: str) -> float:
    rows = frappe.db.sql(
        """
        SELECT grand_total, currency, posting_date
        FROM `tabSales Invoice`
        WHERE project = %s
          AND docstatus = 1
          AND posting_date BETWEEN %s AND %s
        """,
        (project, getdate(from_date), getdate(to_date)),
        as_dict=True,
    )
    return sum(_to_reporting(row.grand_total, row.currency, reporting_currency, row.posting_date) for row in rows)


def get_period_labor_cost(project: str, from_date, to_date, reporting_currency: str) -> float:
    rows = frappe.db.sql(
        """
        SELECT
            COALESCE(SUM(td.costing_amount), 0) AS amount,
            ts.currency,
            MAX(DATE(td.from_time)) AS txn_date
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        WHERE td.project = %s
          AND ts.docstatus < 2
          AND DATE(td.from_time) BETWEEN %s AND %s
        GROUP BY ts.currency
        """,
        (project, getdate(from_date), getdate(to_date)),
        as_dict=True,
    )
    return sum(_to_reporting(row.amount, row.currency, reporting_currency, row.txn_date) for row in rows)


def get_period_purchase_cost(project: str, from_date, to_date, reporting_currency: str) -> float:
    rows = frappe.get_all(
        "Purchase Invoice",
        filters={
            "project": project,
            "docstatus": 1,
            "posting_date": ["between", [getdate(from_date), getdate(to_date)]],
        },
        fields=["net_total", "currency", "posting_date"],
    )
    return sum(_to_reporting(row.net_total, row.currency, reporting_currency, row.posting_date) for row in rows)


def get_period_expense_cost(project: str, from_date, to_date, reporting_currency: str) -> float:
    rows = frappe.get_all(
        "Expense Claim",
        filters={
            "project": project,
            "docstatus": 1,
            "posting_date": ["between", [getdate(from_date), getdate(to_date)]],
        },
        fields=["total_sanctioned_amount", "company", "posting_date"],
    )
    total = 0.0
    for row in rows:
        currency = frappe.db.get_value("Company", row.company, "default_currency") if row.company else reporting_currency
        total += _to_reporting(row.total_sanctioned_amount, currency, reporting_currency, row.posting_date)
    return total


def get_period_actual_metrics(project: str, from_date, to_date, reporting_currency: str) -> dict:
    labor_cost = get_period_labor_cost(project, from_date, to_date, reporting_currency)
    purchase_cost = get_period_purchase_cost(project, from_date, to_date, reporting_currency)
    expense_cost = get_period_expense_cost(project, from_date, to_date, reporting_currency)
    incurred_cost = labor_cost + purchase_cost + expense_cost
    recognized_revenue = get_period_recognized_revenue(project, from_date, to_date, reporting_currency)
    actual_margin = recognized_revenue - incurred_cost
    actual_margin_pct = (actual_margin / recognized_revenue * 100) if recognized_revenue else 0

    return {
        "recognized_revenue": flt(recognized_revenue, 2),
        "labor_cost": flt(labor_cost, 2),
        "purchase_cost": flt(purchase_cost, 2),
        "expense_cost": flt(expense_cost, 2),
        "incurred_cost": flt(incurred_cost, 2),
        "actual_margin": flt(actual_margin, 2),
        "actual_margin_pct": flt(actual_margin_pct, 1),
    }


def get_project_margin_snapshot(project: str, from_date, to_date, reporting_currency: str | None = None) -> dict:
    project_doc = frappe.get_doc("Project", project)
    reporting_currency = reporting_currency or _reporting_currency(project_doc.company)
    planned = _planned_metrics(project_doc.as_dict())
    actual = get_period_actual_metrics(project, from_date, to_date, reporting_currency)

    margin_variance = actual["actual_margin"] - planned["planned_margin"]
    margin_variance_pct = actual["actual_margin_pct"] - planned["planned_margin_pct"]

    return {
        "project": project,
        "project_name": project_doc.project_name,
        "customer": project_doc.customer,
        "project_type": project_doc.project_type,
        "department": project_doc.department,
        "currency": reporting_currency,
        "from_date": str(getdate(from_date)),
        "to_date": str(getdate(to_date)),
        **planned,
        **actual,
        "margin_variance": flt(margin_variance, 2),
        "margin_variance_pct": flt(margin_variance_pct, 1),
    }


def _group_key(project: dict, group_by: str) -> tuple[str, str]:
    if group_by == "customer":
        return project.get("customer") or "Unassigned", project.get("customer") or "Unassigned"
    if group_by == "project_type":
        return project.get("project_type") or "Unassigned", project.get("project_type") or "Unassigned"
    if group_by == "department":
        return project.get("department") or "Unassigned", project.get("department") or "Unassigned"
    return project["name"], project.get("project_name") or project["name"]


def get_portfolio_margin_view(filters: dict | None = None) -> dict:
    filters = frappe._dict(filters or {})
    from_date = filters.get("from_date")
    to_date = filters.get("to_date")
    if not from_date or not to_date:
        frappe.throw("From date and to date are required.")

    group_by = filters.get("group_by") or "customer"
    if group_by not in GROUP_BY_OPTIONS:
        frappe.throw(f"Invalid group_by. Choose one of: {', '.join(GROUP_BY_OPTIONS)}")

    reporting_currency = _reporting_currency(filters.get("company"))
    projects = _get_projects(filters)
    grouped: dict[str, dict] = {}

    for project in projects:
        snapshot = get_project_margin_snapshot(project.name, from_date, to_date, reporting_currency)
        key, label = _group_key({**project, **snapshot}, group_by)

        if key not in grouped:
            grouped[key] = {
                "key": key,
                "label": label,
                "group_by": group_by,
                "project_count": 0,
                "currency": reporting_currency,
                "planned_revenue": 0.0,
                "planned_cost": 0.0,
                "planned_margin": 0.0,
                "recognized_revenue": 0.0,
                "incurred_cost": 0.0,
                "labor_cost": 0.0,
                "purchase_cost": 0.0,
                "expense_cost": 0.0,
                "actual_margin": 0.0,
                "projects": [],
            }

        row = grouped[key]
        row["project_count"] += 1
        for field in (
            "planned_revenue",
            "planned_cost",
            "planned_margin",
            "recognized_revenue",
            "incurred_cost",
            "labor_cost",
            "purchase_cost",
            "expense_cost",
            "actual_margin",
        ):
            row[field] += flt(snapshot.get(field))

        row["projects"].append(
            {
                "project": snapshot["project"],
                "project_name": snapshot["project_name"],
                "planned_margin_pct": snapshot["planned_margin_pct"],
                "actual_margin_pct": snapshot["actual_margin_pct"],
                "margin_variance": snapshot["margin_variance"],
                "recognized_revenue": snapshot["recognized_revenue"],
                "incurred_cost": snapshot["incurred_cost"],
                "actual_margin": snapshot["actual_margin"],
            }
        )

    rows = []
    for row in grouped.values():
        row["planned_margin_pct"] = (
            flt((row["planned_margin"] / row["planned_revenue"]) * 100, 1) if row["planned_revenue"] else 0
        )
        row["actual_margin_pct"] = (
            flt((row["actual_margin"] / row["recognized_revenue"]) * 100, 1) if row["recognized_revenue"] else 0
        )
        row["margin_variance"] = flt(row["actual_margin"] - row["planned_margin"], 2)
        row["margin_variance_pct"] = flt(row["actual_margin_pct"] - row["planned_margin_pct"], 1)
        for field in (
            "planned_revenue",
            "planned_cost",
            "planned_margin",
            "recognized_revenue",
            "incurred_cost",
            "labor_cost",
            "purchase_cost",
            "expense_cost",
            "actual_margin",
        ):
            row[field] = flt(row[field], 2)
        rows.append(row)

    rows.sort(key=lambda item: item["actual_margin"], reverse=True)

    totals = {
        "project_count": sum(row["project_count"] for row in rows),
        "planned_revenue": flt(sum(row["planned_revenue"] for row in rows), 2),
        "planned_cost": flt(sum(row["planned_cost"] for row in rows), 2),
        "planned_margin": flt(sum(row["planned_margin"] for row in rows), 2),
        "recognized_revenue": flt(sum(row["recognized_revenue"] for row in rows), 2),
        "incurred_cost": flt(sum(row["incurred_cost"] for row in rows), 2),
        "actual_margin": flt(sum(row["actual_margin"] for row in rows), 2),
        "currency": reporting_currency,
    }
    totals["planned_margin_pct"] = (
        flt((totals["planned_margin"] / totals["planned_revenue"]) * 100, 1) if totals["planned_revenue"] else 0
    )
    totals["actual_margin_pct"] = (
        flt((totals["actual_margin"] / totals["recognized_revenue"]) * 100, 1) if totals["recognized_revenue"] else 0
    )
    totals["margin_variance"] = flt(totals["actual_margin"] - totals["planned_margin"], 2)

    return {
        "from_date": str(getdate(from_date)),
        "to_date": str(getdate(to_date)),
        "group_by": group_by,
        "currency": reporting_currency,
        "summary": totals,
        "rows": rows,
    }


MARGIN_DRILL_COLUMNS = [
    {"key": "label", "label": "Record"},
    {"key": "date", "label": "Date"},
    {"key": "amount", "label": "Amount"},
    {"key": "meta", "label": "Details"},
    {"key": "description", "label": "Description"},
    {"key": "reference_doctype", "label": "Source DocType"},
    {"key": "reference_name", "label": "Source Document"},
]


def get_margin_drilldown(
    project: str,
    from_date,
    to_date,
    driver: str | None = None,
    driver_key: str | None = None,
    portfolio_filters: dict | None = None,
) -> dict:
    from next_pms.next_pms.utils.analytics_drilldown import build_drilldown_payload

    if not frappe.db.exists("Project", project):
        frappe.throw("Project not found.")

    project_doc = frappe.get_doc("Project", project)
    reporting_currency = _reporting_currency(project_doc.company)
    summary = get_project_margin_snapshot(project, from_date, to_date, reporting_currency)

    drivers = _build_margin_drivers(project, from_date, to_date, reporting_currency)
    details = []
    if driver and driver_key:
        details = _get_driver_details(project, from_date, to_date, reporting_currency, driver, driver_key)

    portfolio_filters = portfolio_filters or {}
    filter_payload = {
        "from_date": str(getdate(from_date)),
        "to_date": str(getdate(to_date)),
        "project": project,
        "project_name": project_doc.project_name or project,
        "driver": driver,
        "driver_key": driver_key,
        "group_by": portfolio_filters.get("group_by"),
        "customer": portfolio_filters.get("customer"),
        "project_type": portfolio_filters.get("project_type"),
        "department": portfolio_filters.get("department"),
        "company": portfolio_filters.get("company"),
        "portfolio_group_key": portfolio_filters.get("portfolio_group_key"),
        "portfolio_group_label": portfolio_filters.get("portfolio_group_label"),
    }

    payload = build_drilldown_payload(
        view="margin_analytics",
        filters=filter_payload,
        filter_labels={
            "from_date": "From",
            "to_date": "To",
            "project": "Project",
            "project_name": "Project",
            "driver": "Driver Type",
            "driver_key": "Driver",
            "group_by": "Group By",
            "customer": "Client",
            "project_type": "Project Type",
            "department": "Department",
            "company": "Company",
            "portfolio_group_key": "Portfolio Group",
            "portfolio_group_label": "Portfolio Group",
        },
        context={
            "project": project,
            "project_name": project_doc.project_name or project,
            "driver": driver,
            "driver_key": driver_key,
            "currency": reporting_currency,
        },
        records=details,
        columns=MARGIN_DRILL_COLUMNS,
        summary={
            "recognized_revenue": summary.get("recognized_revenue"),
            "incurred_cost": summary.get("incurred_cost"),
            "actual_margin": summary.get("actual_margin"),
        },
    )
    payload["summary"] = {
        **payload.get("summary", {}),
        **summary,
    }
    payload["drivers"] = drivers
    payload["driver"] = driver
    payload["driver_key"] = driver_key
    payload["details"] = payload["records"]
    return payload


def _build_margin_drivers(project: str, from_date, to_date, reporting_currency: str) -> list[dict]:
    drivers: list[dict] = []

    labor_cost = get_period_labor_cost(project, from_date, to_date, reporting_currency)
    purchase_cost = get_period_purchase_cost(project, from_date, to_date, reporting_currency)
    expense_cost = get_period_expense_cost(project, from_date, to_date, reporting_currency)
    recognized_revenue = get_period_recognized_revenue(project, from_date, to_date, reporting_currency)

    drivers.extend(
        [
            {
                "driver": "Recognized Revenue",
                "driver_type": "revenue",
                "driver_key": "recognized_revenue",
                "amount": recognized_revenue,
                "impact": "positive",
            },
            {
                "driver": "Labor Cost",
                "driver_type": "cost_category",
                "driver_key": "labor",
                "amount": labor_cost,
                "impact": "negative",
            },
            {
                "driver": "Purchase Cost",
                "driver_type": "cost_category",
                "driver_key": "purchase",
                "amount": purchase_cost,
                "impact": "negative",
            },
            {
                "driver": "Expense Claims",
                "driver_type": "cost_category",
                "driver_key": "expense",
                "amount": expense_cost,
                "impact": "negative",
            },
        ]
    )

    employee_costs = _employee_cost_breakdown(project, from_date, to_date, reporting_currency)
    for employee, amount in sorted(employee_costs.items(), key=lambda item: item[1], reverse=True):
        drivers.append(
            {
                "driver": employee,
                "driver_type": "employee",
                "driver_key": employee,
                "amount": amount,
                "impact": "negative",
            }
        )

    task_costs = _task_cost_breakdown(project, from_date, to_date, reporting_currency)
    for task, amount in sorted(task_costs.items(), key=lambda item: item[1], reverse=True)[:10]:
        drivers.append(
            {
                "driver": task,
                "driver_type": "task",
                "driver_key": task,
                "amount": amount,
                "impact": "negative",
            }
        )

    return drivers


def _employee_cost_breakdown(project: str, from_date, to_date, reporting_currency: str) -> dict[str, float]:
    rows = frappe.db.sql(
        """
        SELECT
            COALESCE(e.employee_name, ts.employee) AS employee_name,
            COALESCE(SUM(td.costing_amount), 0) AS amount,
            ts.currency,
            MAX(DATE(td.from_time)) AS txn_date
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        LEFT JOIN `tabEmployee` e ON e.name = ts.employee
        WHERE td.project = %s
          AND ts.docstatus < 2
          AND DATE(td.from_time) BETWEEN %s AND %s
        GROUP BY COALESCE(e.employee_name, ts.employee), ts.currency
        """,
        (project, getdate(from_date), getdate(to_date)),
        as_dict=True,
    )
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        totals[row.employee_name] += _to_reporting(row.amount, row.currency, reporting_currency, row.txn_date)
    return {name: flt(amount, 2) for name, amount in totals.items()}


def _task_cost_breakdown(project: str, from_date, to_date, reporting_currency: str) -> dict[str, float]:
    rows = frappe.db.sql(
        """
        SELECT
            COALESCE(t.subject, td.task, td.activity_type, 'Unassigned') AS task_label,
            COALESCE(SUM(td.costing_amount), 0) AS amount,
            ts.currency,
            MAX(DATE(td.from_time)) AS txn_date
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        LEFT JOIN `tabTask` t ON t.name = td.task
        WHERE td.project = %s
          AND ts.docstatus < 2
          AND DATE(td.from_time) BETWEEN %s AND %s
        GROUP BY COALESCE(t.subject, td.task, td.activity_type, 'Unassigned'), ts.currency
        """,
        (project, getdate(from_date), getdate(to_date)),
        as_dict=True,
    )
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        totals[row.task_label] += _to_reporting(row.amount, row.currency, reporting_currency, row.txn_date)
    return {name: flt(amount, 2) for name, amount in totals.items()}


def _get_driver_details(
    project: str,
    from_date,
    to_date,
    reporting_currency: str,
    driver: str,
    driver_key: str,
) -> list[dict]:
    if driver == "revenue" or driver_key == "recognized_revenue":
        rows = frappe.get_all(
            "Sales Invoice",
            filters={
                "project": project,
                "docstatus": 1,
                "posting_date": ["between", [getdate(from_date), getdate(to_date)]],
            },
            fields=["name", "posting_date", "grand_total", "currency", "customer"],
            order_by="posting_date desc",
        )
        return [
            {
                "label": row.name,
                "date": str(row.posting_date),
                "amount": _to_reporting(row.grand_total, row.currency, reporting_currency, row.posting_date),
                "reference_doctype": "Sales Invoice",
                "reference_name": row.name,
                "meta": row.customer,
            }
            for row in rows
        ]

    if driver == "cost_category" and driver_key == "purchase":
        rows = frappe.get_all(
            "Purchase Invoice",
            filters={
                "project": project,
                "docstatus": 1,
                "posting_date": ["between", [getdate(from_date), getdate(to_date)]],
            },
            fields=["name", "posting_date", "net_total", "currency", "supplier"],
            order_by="posting_date desc",
        )
        return [
            {
                "label": row.name,
                "date": str(row.posting_date),
                "amount": _to_reporting(row.net_total, row.currency, reporting_currency, row.posting_date),
                "reference_doctype": "Purchase Invoice",
                "reference_name": row.name,
                "meta": row.supplier,
            }
            for row in rows
        ]

    if driver == "cost_category" and driver_key == "expense":
        rows = frappe.get_all(
            "Expense Claim",
            filters={
                "project": project,
                "docstatus": 1,
                "posting_date": ["between", [getdate(from_date), getdate(to_date)]],
            },
            fields=["name", "posting_date", "total_sanctioned_amount", "company", "employee_name"],
            order_by="posting_date desc",
        )
        details = []
        for row in rows:
            currency = frappe.db.get_value("Company", row.company, "default_currency") if row.company else reporting_currency
            details.append(
                {
                    "label": row.name,
                    "date": str(row.posting_date),
                    "amount": _to_reporting(row.total_sanctioned_amount, currency, reporting_currency, row.posting_date),
                    "reference_doctype": "Expense Claim",
                    "reference_name": row.name,
                    "meta": row.employee_name,
                }
            )
        return details

    if driver in ("employee", "task", "cost_category"):
        conditions = [
            "td.project = %(project)s",
            "ts.docstatus < 2",
            "DATE(td.from_time) BETWEEN %(from_date)s AND %(to_date)s",
        ]
        values = {
            "project": project,
            "from_date": getdate(from_date),
            "to_date": getdate(to_date),
        }

        if driver == "employee":
            conditions.append("COALESCE(e.employee_name, ts.employee) = %(driver_key)s")
            values["driver_key"] = driver_key
        elif driver == "task":
            conditions.append("COALESCE(t.subject, td.task, td.activity_type, 'Unassigned') = %(driver_key)s")
            values["driver_key"] = driver_key

        # nosemgrep
        rows = frappe.db.sql(
            f"""
            SELECT
                td.name,
                td.parent AS timesheet,
                DATE(td.from_time) AS entry_date,
                td.hours,
                td.costing_amount,
                ts.currency,
                COALESCE(e.employee_name, ts.employee) AS employee_name,
                COALESCE(t.subject, td.task, td.activity_type) AS task_label,
                td.description
            FROM `tabTimesheet Detail` td
            INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
            LEFT JOIN `tabEmployee` e ON e.name = ts.employee
            LEFT JOIN `tabTask` t ON t.name = td.task
            WHERE {" AND ".join(conditions)}
            ORDER BY td.from_time DESC
            LIMIT 100
            """,
            values,
            as_dict=True,
        )
        return [
            {
                "label": row.name,
                "date": str(row.entry_date),
                "amount": _to_reporting(row.costing_amount, row.currency, reporting_currency, row.entry_date),
                "reference_doctype": "Timesheet",
                "reference_name": row.timesheet,
                "meta": f"{row.employee_name} · {row.task_label or ''} · {flt(row.hours, 2)}h",
                "description": row.description,
            }
            for row in rows
        ]

    return []
