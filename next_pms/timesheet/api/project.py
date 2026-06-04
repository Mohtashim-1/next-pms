import json

import frappe
from erpnext.accounts.report.utils import get_rate_as_at
from frappe import get_list, get_meta, whitelist
from frappe.utils import flt, get_datetime, getdate, now_datetime

from . import get_count


@whitelist()
def get_projects(
    limit: int = 20,
    currency: str | None = None,
    fields: list | str | None = None,
    filters: list | str | None = None,
    or_filters: list | str | None = None,
    start: int = 0,
    order_by: str = "modified desc",
):
    meta = get_meta("Project")
    if isinstance(fields, str):
        fields = json.loads(fields)
    if isinstance(filters, str):
        filters = json.loads(filters)

    if not fields:
        fields = meta.default_fields

    if "custom_currency" not in fields:
        fields.append("custom_currency")

    if not filters:
        filters = get_project_filter_for_contractor()
    else:
        filters += get_project_filter_for_contractor()
    project_lists = get_list(
        "Project",
        fields=fields,
        filters=filters,
        limit_start=start,
        limit=limit,
        order_by=order_by,
        or_filters=or_filters,
    )
    count = get_count("Project", filters=filters, or_filters=or_filters)
    has_more = int(start) + int(limit) < count

    if not limit:
        has_more = False
    if not currency or len(currency) == 0:
        return {
            "data": project_lists,
            "has_more": has_more,
            "total_count": count,
        }

    currency_fields = get_currency_fields(meta.fields)
    date = getdate()

    for project in project_lists:
        project_currency = project.custom_currency
        if project_currency == currency:
            continue
        rate = get_rate_as_at(date, project_currency, currency)
        for field in currency_fields:
            if field in project:
                project[field] = convert(project.get(field), rate)

    return {
        "data": project_lists,
        "has_more": has_more,
        "total_count": count,
    }


def get_currency_fields(meta_fields):
    currency_fields = []

    for field in meta_fields:
        if field.fieldtype == "Currency":
            currency_fields.append(field.fieldname)
    return currency_fields


def convert(value, rate):
    converted_value = flt(value) * (rate or 1)
    return converted_value


@whitelist()
def get_project_dashboard(project: str):
    if not project or not frappe.db.exists("Project", project):
        frappe.throw(frappe._("Project not found"))

    frappe.has_permission("Project", doc=project, throw=True)

    project_doc = frappe.get_doc("Project", project)
    project_meta = frappe.get_meta("Project")
    project_fields = {field.fieldname for field in project_meta.fields}

    percent_complete = flt(project_doc.get("percent_complete") or project_doc.get("percent_completed") or 0)
    status = project_doc.get("status") or "Not Set"

    task_filters = {"project": project}
    task_status = frappe.get_all(
        "Task",
        fields=["status", "count(name) as count"],
        filters=task_filters,
        group_by="status",
    )
    total_tasks = sum(row.count for row in task_status)
    completed_tasks = sum(row.count for row in task_status if row.status in ("Completed", "Closed"))
    overdue_tasks = 0
    if frappe.get_meta("Task").has_field("exp_end_date"):
        overdue_tasks = frappe.db.count(
            "Task",
            {
                "project": project,
                "status": ["not in", ["Completed", "Closed", "Cancelled"]],
                "exp_end_date": ["<", getdate()],
            },
        )

    task_completion = flt((completed_tasks / total_tasks) * 100, 2) if total_tasks else percent_complete

    users = []
    seen_users = set()
    for row in project_doc.get("users", []):
        user = row.get("user")
        if not user or user in seen_users:
            continue
        seen_users.add(user)
        users.append(
            {
                "id": user,
                "name": frappe.db.get_value("User", user, "full_name") or user,
                "type": "User",
            }
        )

    allocations = []
    if frappe.db.exists("DocType", "Resource Allocation"):
        allocations = frappe.get_all(
            "Resource Allocation",
            filters={"project": project},
            fields=[
                "name",
                "employee",
                "employee_name",
                "status",
                "total_allocated_hours",
                "hours_allocated_per_day",
                "allocation_start_date",
                "allocation_end_date",
                "is_billable",
            ],
            order_by="allocation_start_date desc",
            limit_page_length=20,
        )
        for row in allocations:
            key = f"employee:{row.employee}"
            if row.employee and key not in seen_users:
                seen_users.add(key)
                users.append(
                    {
                        "id": row.employee,
                        "name": row.employee_name or row.employee,
                        "type": "Allocation",
                    }
                )

    recent_updates = []
    if frappe.db.exists("DocType", "Project Status Update"):
        recent_updates = frappe.get_all(
            "Project Status Update",
            filters={"project": project},
            fields=["name", "title", "status", "owner", "creation", "modified"],
            order_by="modified desc",
            limit_page_length=5,
        )

    recent_tasks = frappe.get_all(
        "Task",
        filters=task_filters,
        fields=["name", "subject", "status", "modified", "modified_by"],
        order_by="modified desc",
        limit_page_length=5,
    )

    recent_activity = []
    for row in recent_updates:
        recent_activity.append(
            {
                "type": "Project Update",
                "title": row.title,
                "status": row.status,
                "user": frappe.db.get_value("User", row.owner, "full_name") or row.owner,
                "when": row.modified,
            }
        )
    for row in recent_tasks:
        recent_activity.append(
            {
                "type": "Task",
                "title": row.subject or row.name,
                "status": row.status,
                "user": frappe.db.get_value("User", row.modified_by, "full_name") or row.modified_by,
                "when": row.modified,
            }
        )

    recent_activity = sorted(
        recent_activity,
        key=lambda item: get_datetime(item.get("when") or now_datetime()),
        reverse=True,
    )[:8]

    timeline = {
        "start": project_doc.get("expected_start_date") or project_doc.get("actual_start_date"),
        "end": project_doc.get("expected_end_date") or project_doc.get("actual_end_date"),
    }

    project_info = {
        "name": project_doc.name,
        "project_name": project_doc.get("project_name") or project_doc.name,
        "status": status,
        "percent_complete": percent_complete,
        "customer": project_doc.get("customer"),
        "project_type": project_doc.get("project_type"),
        "billing_type": project_doc.get("custom_billing_type") if "custom_billing_type" in project_fields else None,
        "currency": project_doc.get("custom_currency") if "custom_currency" in project_fields else None,
    }

    return {
        "project": project_info,
        "timeline": timeline,
        "users": users,
        "allocations": allocations,
        "tasks": {
            "total": total_tasks,
            "completed": completed_tasks,
            "pending": max(total_tasks - completed_tasks, 0),
            "overdue": overdue_tasks,
            "completion": task_completion,
            "by_status": task_status,
        },
        "recent_activity": recent_activity,
    }


@whitelist()
def get_project_tasks(project: str, search: str | None = None, status: str | None = None, limit: int = 100):
    if not project or not frappe.db.exists("Project", project):
        frappe.throw(frappe._("Project not found"))

    frappe.has_permission("Project", doc=project, throw=True)

    task_meta = frappe.get_meta("Task")
    has_exp_end_date = task_meta.has_field("exp_end_date")
    today = getdate()

    task_filters = {"project": project}
    if status == "Overdue" and has_exp_end_date:
        task_filters.update(
            {
                "status": ["not in", ["Completed", "Closed", "Cancelled"]],
                "exp_end_date": ["<", today],
            }
        )
    elif status and status != "All":
        task_filters["status"] = status

    or_filters = None
    if search:
        or_filters = [
            ["Task", "name", "like", f"%{search}%"],
            ["Task", "subject", "like", f"%{search}%"],
        ]

    task_fields = [
        "name",
        "subject",
        "status",
        "priority",
        "expected_time",
        "actual_time",
        "exp_start_date",
        "exp_end_date",
        "owner",
        "modified",
        "modified_by",
        "_assign",
    ]
    if task_meta.has_field("progress"):
        task_fields.append("progress")

    tasks = frappe.get_all(
        "Task",
        filters=task_filters,
        or_filters=or_filters,
        fields=task_fields,
        order_by="modified desc",
        limit_page_length=limit,
    )

    user_ids = set()
    for task in tasks:
        if task.owner:
            user_ids.add(task.owner)
        if task.modified_by:
            user_ids.add(task.modified_by)
        try:
            assigned_users = json.loads(task.get("_assign") or "[]")
        except ValueError:
            assigned_users = []
        task.assigned_users = assigned_users
        user_ids.update(assigned_users)

    user_names = {}
    if user_ids:
        for row in frappe.get_all(
            "User",
            filters={"name": ["in", list(user_ids)]},
            fields=["name", "full_name"],
        ):
            user_names[row.name] = row.full_name or row.name

    for task in tasks:
        task.owner_name = user_names.get(task.owner, task.owner)
        task.modified_by_name = user_names.get(task.modified_by, task.modified_by)
        task.assigned_user_names = [user_names.get(user, user) for user in task.assigned_users]
        task.is_overdue = bool(
            has_exp_end_date
            and task.get("exp_end_date")
            and getdate(task.exp_end_date) < today
            and task.status not in ("Completed", "Closed", "Cancelled")
        )
        task.progress = flt(task.get("progress") or (100 if task.status in ("Completed", "Closed") else 0), 2)

    if status == "Overdue":
        tasks = [task for task in tasks if task.is_overdue]

    status_counts = frappe.get_all(
        "Task",
        filters={"project": project},
        fields=["status", "count(name) as count"],
        group_by="status",
    )
    total_count = sum(row.count for row in status_counts)
    completed_count = sum(row.count for row in status_counts if row.status in ("Completed", "Closed"))
    overdue_count = 0
    if has_exp_end_date:
        overdue_count = frappe.db.count(
            "Task",
            {
                "project": project,
                "status": ["not in", ["Completed", "Closed", "Cancelled"]],
                "exp_end_date": ["<", today],
            },
        )

    return {
        "tasks": tasks,
        "status_counts": status_counts,
        "summary": {
            "total": total_count,
            "completed": completed_count,
            "pending": max(total_count - completed_count, 0),
            "overdue": overdue_count,
            "visible": len(tasks),
        },
    }


def get_project_filter_for_contractor(only_list=False):
    if "Contractor" in frappe.get_roles() and frappe.session.user != "Administrator":
        names = frappe.share.get_shared("Project", frappe.session.user, filters=[["everyone", "=", False]])
        if only_list:
            return names
        return [["name", "in", names]]

    return []
