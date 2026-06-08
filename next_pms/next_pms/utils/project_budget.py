from __future__ import annotations

import json

import frappe
from frappe.utils import flt, now_datetime


ALLOCATION_FIELDS = [
    "name",
    "project",
    "scope_type",
    "project_phase",
    "task",
    "allocation_type",
    "metric_type",
    "budget_hours",
    "budget_amount",
    "consumed_hours",
    "consumed_amount",
    "remaining_hours",
    "remaining_amount",
    "notes",
]


def validate_allocation_payload(doc):
    if doc.scope_type == "Total":
        doc.project_phase = None
        doc.task = None
    elif doc.scope_type == "Phase":
        doc.task = None
        if not doc.project_phase:
            frappe.throw("Phase is required for phase-level budgets.")
        _validate_phase_belongs_to_project(doc.project, doc.project_phase)
    elif doc.scope_type == "Task":
        doc.project_phase = None
        if not doc.task:
            frappe.throw("Task is required for task-level budgets.")
        _validate_task_belongs_to_project(doc.project, doc.task)

    if doc.metric_type == "Hours" and flt(doc.budget_hours) <= 0:
        frappe.throw("Budget hours must be greater than zero.")
    elif doc.metric_type == "Dollars" and flt(doc.budget_amount) <= 0:
        frappe.throw("Budget amount must be greater than zero.")
    elif doc.metric_type == "Both":
        if flt(doc.budget_hours) <= 0 or flt(doc.budget_amount) <= 0:
            frappe.throw("Both budget hours and budget amount are required.")

    duplicate_filters = {
        "project": doc.project,
        "scope_type": doc.scope_type,
        "allocation_type": doc.allocation_type,
        "name": ["!=", doc.name or ""],
    }
    if doc.scope_type == "Phase":
        duplicate_filters["project_phase"] = doc.project_phase
    elif doc.scope_type == "Task":
        duplicate_filters["task"] = doc.task
    else:
        duplicate_filters["project_phase"] = ["is", "not set"]
        duplicate_filters["task"] = ["is", "not set"]

    if frappe.db.exists("Project Budget Allocation", duplicate_filters):
        frappe.throw("A budget limit already exists for this scope and limit type.")


def _validate_phase_belongs_to_project(project: str, phase: str):
    phase_project = frappe.db.get_value("Project Phase", phase, "project")
    if phase_project != project:
        frappe.throw("Selected phase does not belong to this project.")


def _validate_task_belongs_to_project(project: str, task: str):
    task_project = frappe.db.get_value("Task", task, "project")
    if task_project != project:
        frappe.throw("Selected task does not belong to this project.")


def _task_has_phase_field() -> bool:
    return frappe.db.has_column("Task", "custom_project_phase")


def _get_scope_tasks(project: str, scope_type: str, project_phase: str | None, task: str | None) -> list[str] | None:
    if scope_type == "Task" and task:
        return [task]
    if scope_type == "Phase" and project_phase and _task_has_phase_field():
        return frappe.get_all(
            "Task",
            filters={"project": project, "custom_project_phase": project_phase},
            pluck="name",
        )
    return None


def compute_consumption(
    project: str,
    allocation_type: str,
    scope_type: str = "Total",
    project_phase: str | None = None,
    task: str | None = None,
) -> dict:
    is_billable = 1 if allocation_type == "Billable" else 0
    task_names = _get_scope_tasks(project, scope_type, project_phase, task)

    conditions = ["td.project = %(project)s", "ts.docstatus < 2", "td.is_billable = %(is_billable)s"]
    values = {"project": project, "is_billable": is_billable}

    if task_names is not None:
        if not task_names:
            return {"consumed_hours": 0.0, "consumed_amount": 0.0}
        conditions.append("td.task IN %(task_names)s")
        values["task_names"] = tuple(task_names)

    # nosemgrep
    row = frappe.db.sql(
        f"""
        SELECT
            COALESCE(SUM(td.hours), 0) AS consumed_hours,
            COALESCE(SUM(CASE WHEN td.is_billable = 1 THEN td.billing_amount ELSE td.costing_amount END), 0)
                AS consumed_amount
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        WHERE {" AND ".join(conditions)}
        """,
        values,
        as_dict=True,
    )[0]

    return {
        "consumed_hours": flt(row.consumed_hours, 2),
        "consumed_amount": flt(row.consumed_amount, 2),
    }


def refresh_allocation_usage(doc):
    usage = compute_consumption(
        doc.project,
        doc.allocation_type,
        doc.scope_type,
        doc.project_phase,
        doc.task,
    )
    doc.consumed_hours = usage["consumed_hours"]
    doc.consumed_amount = usage["consumed_amount"]
    doc.remaining_hours = flt(flt(doc.budget_hours) - doc.consumed_hours, 2)
    doc.remaining_amount = flt(flt(doc.budget_amount) - doc.consumed_amount, 2)


def serialize_allocation(doc) -> dict:
    if isinstance(doc, str):
        doc = frappe.get_doc("Project Budget Allocation", doc)
    data = {field: doc.get(field) for field in ALLOCATION_FIELDS}
    if doc.scope_type == "Phase" and doc.project_phase:
        data["phase_name"] = frappe.db.get_value("Project Phase", doc.project_phase, "phase_name")
    if doc.scope_type == "Task" and doc.task:
        data["task_subject"] = frappe.db.get_value("Task", doc.task, "subject")
    data["utilization_hours_pct"] = (
        flt((data["consumed_hours"] / flt(data["budget_hours"])) * 100, 1) if flt(data["budget_hours"]) else 0
    )
    data["utilization_amount_pct"] = (
        flt((data["consumed_amount"] / flt(data["budget_amount"])) * 100, 1) if flt(data["budget_amount"]) else 0
    )
    return data


def get_project_budget_view(project: str) -> dict:
    allocations = frappe.get_all(
        "Project Budget Allocation",
        filters={"project": project},
        fields=ALLOCATION_FIELDS,
        order_by="scope_type asc, allocation_type asc, creation asc",
    )

    enriched = []
    for row in allocations:
        doc = frappe.get_doc("Project Budget Allocation", row.name)
        refresh_allocation_usage(doc)
        enriched.append(serialize_allocation(doc))

    audit_logs = frappe.get_all(
        "Project Budget Audit Log",
        filters={"project": project},
        fields=[
            "name",
            "budget_allocation",
            "action",
            "changed_by",
            "changed_on",
            "change_reason",
            "previous_values",
            "new_values",
        ],
        order_by="changed_on desc",
        limit_page_length=50,
    )

    return {
        "project": project,
        "allocations": enriched,
        "audit_logs": audit_logs,
        "summary": _build_summary(enriched),
    }


def _build_summary(allocations: list[dict]) -> dict:
    summary = {
        "billable_hours_budget": 0.0,
        "billable_hours_consumed": 0.0,
        "non_billable_hours_budget": 0.0,
        "non_billable_hours_consumed": 0.0,
        "billable_amount_budget": 0.0,
        "billable_amount_consumed": 0.0,
        "non_billable_amount_budget": 0.0,
        "non_billable_amount_consumed": 0.0,
    }

    for row in allocations:
        if row["scope_type"] != "Total":
            continue
        prefix = "billable" if row["allocation_type"] == "Billable" else "non_billable"
        if row["metric_type"] in ("Hours", "Both"):
            summary[f"{prefix}_hours_budget"] += flt(row["budget_hours"])
            summary[f"{prefix}_hours_consumed"] += flt(row["consumed_hours"])
        if row["metric_type"] in ("Dollars", "Both"):
            summary[f"{prefix}_amount_budget"] += flt(row["budget_amount"])
            summary[f"{prefix}_amount_consumed"] += flt(row["consumed_amount"])

    return summary


def log_budget_audit(
    project: str,
    action: str,
    budget_allocation: str | None,
    previous_values: dict | None,
    new_values: dict | None,
    change_reason: str | None = None,
):
    frappe.get_doc(
        {
            "doctype": "Project Budget Audit Log",
            "project": project,
            "budget_allocation": budget_allocation,
            "action": action,
            "changed_by": frappe.session.user,
            "changed_on": now_datetime(),
            "change_reason": change_reason,
            "previous_values": json.dumps(previous_values or {}, default=str),
            "new_values": json.dumps(new_values or {}, default=str),
        }
    ).insert(ignore_permissions=True)


def snapshot_allocation(doc) -> dict:
    return {field: doc.get(field) for field in ALLOCATION_FIELDS if field != "name"}
