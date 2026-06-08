import json

import frappe
from frappe import _, throw
from frappe.utils import flt, get_first_day_of_week, get_last_day_of_week, getdate, today

from next_pms.api.utils import error_logger
from next_pms.timesheet.utils.description import strip_description_content
from next_pms.timesheet.utils.rejection import (
    apply_entry_rejection,
    entry_is_rejected_draft,
    notify_employee_of_rejection,
    require_rejection_comment,
    return_timesheet_to_draft,
)
from next_pms.timesheet.utils.time_log import strip_input_mode_marker

from . import filter_employees
from .utils import employee_has_higher_access

PENDING_QUEUE_STATUSES = {"Approval Pending", "Partially Approved", "Processing Timesheet"}
ENTRY_PENDING_STATUSES = {"", None, "Pending"}


def _assert_approver():
    frappe.only_for(["Timesheet Manager", "Timesheet User", "Projects Manager"], message=True)


def _get_week_bounds(week_start: str | None = None):
    anchor = getdate(week_start) if week_start else getdate(today())
    week_start = get_first_day_of_week(anchor)
    week_end = get_last_day_of_week(week_start)
    return week_start, week_end


def _parse_json_list(value):
    if not value:
        return []
    if isinstance(value, str):
        return json.loads(value)
    return value


def _get_scoped_employees(
    employee: str | None = None,
    employee_name: str | None = None,
    project: list | str | None = None,
    reports_to: str | None = None,
):
    project = _parse_json_list(project)
    employees, _count = filter_employees(
        employee_name=employee_name,
        project=project,
        reports_to=reports_to,
        page_length=0,
        start=0,
        ids=[employee] if employee else None,
    )
    return employees


def _entry_status(log) -> str:
    status = log.get("custom_entry_approval_status") or "Pending"
    return status


def _entry_is_queue_pending(log) -> bool:
    if entry_is_rejected_draft(log):
        return False
    return _entry_status(log) in ENTRY_PENDING_STATUSES or _entry_status(log) == "Pending"


def _build_entry_row(log, task_meta: dict):
    task = task_meta.get(log.task, {})
    description = strip_description_content(strip_input_mode_marker(log.description))
    return {
        "name": log.name,
        "parent": log.parent,
        "task": log.task,
        "task_subject": task.get("subject") or log.task,
        "project": log.project,
        "project_name": task.get("project_name"),
        "date": str(getdate(log.from_time)),
        "hours": flt(log.hours, 2),
        "description": description,
        "is_billable": log.is_billable,
        "entry_status": _entry_status(log),
        "rejection_comment": log.get("custom_rejection_comment"),
    }


def _timesheet_entries(timesheet_name: str, project_filter: list | None = None):
    doc = frappe.get_doc("Timesheet", timesheet_name)
    task_ids = [log.task for log in doc.time_logs if log.task]
    task_meta = {}
    if task_ids:
        for task in frappe.get_all(
            "Task",
            filters={"name": ["in", task_ids]},
            fields=["name", "subject", "project.project_name as project_name"],
        ):
            task_meta[task.name] = task

    entries = []
    for log in doc.time_logs:
        if project_filter and log.project not in project_filter:
            continue
        if not _entry_is_queue_pending(log):
            continue
        entries.append(_build_entry_row(log, task_meta))
    return entries, doc


def _group_queue_items(timesheets: list, project_filter: list | None = None):
    grouped = {}
    for ts in timesheets:
        key = (ts.employee, str(get_first_day_of_week(ts.start_date)))
        if key not in grouped:
            grouped[key] = {
                "employee": ts.employee,
                "employee_name": ts.employee_name,
                "week_start": str(get_first_day_of_week(ts.start_date)),
                "week_end": str(get_last_day_of_week(ts.start_date)),
                "weekly_status": ts.custom_weekly_approval_status,
                "total_hours": 0,
                "pending_entry_count": 0,
                "timesheets": [],
            }

        entries, doc = _timesheet_entries(ts.name, project_filter)
        if project_filter and not entries:
            continue

        grouped[key]["total_hours"] += flt(ts.total_hours, 2)
        grouped[key]["pending_entry_count"] += len(entries)
        grouped[key]["timesheets"].append(
            {
                "name": ts.name,
                "date": str(ts.start_date),
                "status": ts.custom_approval_status,
                "total_hours": flt(ts.total_hours, 2),
                "entries": entries,
            }
        )

    items = [item for item in grouped.values() if item["pending_entry_count"] > 0]
    items.sort(key=lambda row: (row["employee_name"], row["week_start"]))
    return items


@frappe.whitelist()
@error_logger
def get_approval_queue_count(
    week_start: str | None = None,
    employee: str | None = None,
    employee_name: str | None = None,
    project: list | str | None = None,
    reports_to: str | None = None,
):
    _assert_approver()
    items = get_approval_queue(
        week_start=week_start,
        employee=employee,
        employee_name=employee_name,
        project=project,
        reports_to=reports_to,
        page_length=0,
        start=0,
    )
    return {"count": items.get("total_pending_entries", 0), "sheet_count": items.get("total_count", 0)}


@frappe.whitelist()
@error_logger
def get_approval_queue(
    week_start: str | None = None,
    employee: str | None = None,
    employee_name: str | None = None,
    project: list | str | None = None,
    reports_to: str | None = None,
    page_length: int = 20,
    start: int = 0,
):
    _assert_approver()
    week_start, week_end = _get_week_bounds(week_start)
    project_filter = _parse_json_list(project)
    employees = _get_scoped_employees(employee, employee_name, project_filter, reports_to)
    if not employees:
        return {
            "week_start": str(week_start),
            "week_end": str(week_end),
            "items": [],
            "total_count": 0,
            "total_pending_entries": 0,
            "has_more": False,
        }

    employee_ids = [emp.name for emp in employees]
    timesheets = frappe.get_all(
        "Timesheet",
        filters={
            "employee": ["in", employee_ids],
            "start_date": [">=", week_start],
            "end_date": ["<=", week_end],
            "docstatus": 0,
            "custom_weekly_approval_status": ["in", list(PENDING_QUEUE_STATUSES)],
        },
        fields=[
            "name",
            "employee",
            "employee_name",
            "start_date",
            "end_date",
            "total_hours",
            "custom_approval_status",
            "custom_weekly_approval_status",
        ],
        order_by="employee_name asc, start_date asc",
    )

    items = _group_queue_items(timesheets, project_filter or None)
    total_pending_entries = sum(item["pending_entry_count"] for item in items)
    total_count = len(items)
    page_length = int(page_length)
    start = int(start)

    if page_length:
        paged_items = items[start : start + page_length]
        has_more = start + page_length < total_count
    else:
        paged_items = items
        has_more = False

    return {
        "week_start": str(week_start),
        "week_end": str(week_end),
        "items": paged_items,
        "total_count": total_count,
        "total_pending_entries": total_pending_entries,
        "has_more": has_more,
    }


def _sync_timesheet_from_entries(timesheet_name: str):
    from next_pms.timesheet.api.utils import update_weekly_status_of_timesheet

    doc = frappe.get_doc("Timesheet", timesheet_name)
    doc.reload()
    statuses = [_entry_status(log) for log in doc.time_logs]
    pending = [status for status in statuses if status in ENTRY_PENDING_STATUSES or status == "Pending"]
    has_rejected_drafts = any(entry_is_rejected_draft(log) for log in doc.time_logs)

    if has_rejected_drafts:
        return_timesheet_to_draft(doc)
    elif pending and len(pending) < len(statuses):
        doc.custom_approval_status = "Partially Approved"
    elif all(status == "Approved" for status in statuses):
        doc.custom_approval_status = "Approved"
        if doc.docstatus == 0:
            has_permission = employee_has_higher_access(doc.employee, ptype="write")
            doc.save(ignore_permissions=has_permission)
            doc.submit()
            update_weekly_status_of_timesheet(doc.employee, getdate(doc.start_date))
            return
    elif any(status == "Rejected" for status in statuses):
        return_timesheet_to_draft(doc)
    else:
        doc.custom_approval_status = "Approval Pending"

    has_permission = employee_has_higher_access(doc.employee, ptype="write")
    doc.save(ignore_permissions=has_permission)
    update_weekly_status_of_timesheet(doc.employee, getdate(doc.start_date))


@frappe.whitelist(methods=["POST"])
@error_logger
def approve_or_reject_entry(name: str, status: str, note: str = ""):
    _assert_approver()
    require_rejection_comment(status, note)

    if status not in {"Approved", "Rejected"}:
        throw(_("Invalid approval status."))

    log = frappe.get_doc("Timesheet Detail", name)
    parent = frappe.get_doc("Timesheet", log.parent)
    if parent.custom_weekly_approval_status not in PENDING_QUEUE_STATUSES and parent.custom_approval_status not in {
        "Approval Pending",
        "Partially Approved",
    }:
        throw(_("This timesheet is no longer awaiting approval."))

    if status == "Rejected":
        apply_entry_rejection(log, note)
    else:
        log.custom_entry_approval_status = status
        log.custom_rejection_comment = None
        log.custom_rejected_by = None
        log.custom_rejected_on = None
    log.save(ignore_permissions=True)

    _sync_timesheet_from_entries(parent.name)

    from next_pms.timesheet.doc_events.timesheet import flush_cache, publish_timesheet_update

    flush_cache(parent)
    publish_timesheet_update(parent.employee, parent.start_date)

    if status == "Rejected":
        notify_employee_of_rejection(
            employee=parent.employee,
            dates=[str(getdate(log.from_time))],
            note=note.strip(),
        )

    return _("Entry {0} successfully.").format(status.lower())


@frappe.whitelist(methods=["POST"])
@error_logger
def approve_or_reject_sheet(
    employee: str,
    week_start: str,
    status: str,
    note: str = "",
    project: list | str | None = None,
):
    _assert_approver()
    require_rejection_comment(status, note)

    if status not in {"Approved", "Rejected"}:
        throw(_("Invalid approval status."))

    week_start, week_end = _get_week_bounds(week_start)
    project_filter = _parse_json_list(project)

    timesheets = frappe.get_all(
        "Timesheet",
        filters={
            "employee": employee,
            "start_date": [">=", week_start],
            "end_date": ["<=", week_end],
            "docstatus": 0,
            "custom_weekly_approval_status": ["in", list(PENDING_QUEUE_STATUSES)],
        },
        pluck="name",
    )
    if not timesheets:
        throw(_("No pending timesheet found for approval."), frappe.DoesNotExistError)

    affected_dates = []
    for timesheet_name in timesheets:
        doc = frappe.get_doc("Timesheet", timesheet_name)
        for log in doc.time_logs:
            if project_filter and log.project not in project_filter:
                continue
            if not _entry_is_queue_pending(log):
                continue
            if status == "Rejected":
                apply_entry_rejection(log, note)
            else:
                log.custom_entry_approval_status = status
                log.custom_rejection_comment = None
                log.custom_rejected_by = None
                log.custom_rejected_on = None
            log.save(ignore_permissions=True)
            affected_dates.append(str(getdate(log.from_time)))
        _sync_timesheet_from_entries(timesheet_name)

    from next_pms.timesheet.doc_events.timesheet import flush_cache, publish_timesheet_update

    if status == "Rejected":
        notify_employee_of_rejection(
            employee=employee,
            dates=sorted(set(affected_dates)),
            note=note.strip(),
        )
    else:
        from next_pms.timesheet.api.team import trigger_notification_for_approved_or_rejected_timesheet

        dates = frappe.get_all(
            "Timesheet",
            filters={"name": ["in", timesheets]},
            pluck="start_date",
        )
        trigger_notification_for_approved_or_rejected_timesheet(
            status=status,
            employee=employee,
            dates=[str(date) for date in dates],
            note=note,
        )

    flush_cache(frappe._dict({"employee": employee, "start_date": week_start}))
    publish_timesheet_update(employee=employee, start_date=week_start)

    return _("Timesheet sheet {0} successfully.").format(status.lower())
