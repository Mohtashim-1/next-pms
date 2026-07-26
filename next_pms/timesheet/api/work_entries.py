import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_datetime, getdate, nowdate

from next_pms.api.utils import error_logger
from next_pms.timesheet.api.employee import get_employee_from_user
from next_pms.timesheet.api.utils import apply_role_permission_for_doctype


@frappe.whitelist()
@error_logger
def get_work_entries(
    employee: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    search: str | None = None,
    page_length: int = 50,
    start: int = 0,
):
    """List individual time log rows for the employee (newest first)."""
    from frappe.query_builder import DocType
    from frappe.query_builder.functions import Count
    from next_pms.timesheet.utils.time_log import strip_input_mode_marker

    if not employee:
        employee = get_employee_from_user(throw_exception=True)
    apply_role_permission_for_doctype(
        ["Timesheet User", "Timesheet Manager"], "Employee", "read", employee
    )

    range_start = getdate(start_date or add_days(nowdate(), -90))
    range_end = getdate(end_date or nowdate())
    if range_start > range_end:
        range_start, range_end = range_end, range_start

    page_length = min(cint(page_length) or 50, 5000)
    start = cint(start) or 0
    search = (search or "").strip()

    timesheet = DocType("Timesheet")
    detail = DocType("Timesheet Detail")
    task = DocType("Task")
    project = DocType("Project")

    filters = (
        (timesheet.employee == employee)
        & (timesheet.docstatus != 2)
        & (detail.from_time >= f"{range_start} 00:00:00")
        & (detail.from_time <= f"{range_end} 23:59:59")
    )

    def _apply_search(query):
        if not search:
            return query
        like = f"%{search}%"
        return query.where(
            (detail.description.like(like))
            | (task.subject.like(like))
            | (project.project_name.like(like))
            | (detail.task.like(like))
            | (detail.project.like(like))
            | (detail.activity_type.like(like))
        )

    count_query = (
        frappe.qb.from_(detail)
        .join(timesheet)
        .on(detail.parent == timesheet.name)
        .left_join(task)
        .on(detail.task == task.name)
        .left_join(project)
        .on(detail.project == project.name)
        .where(filters)
    )
    count_query = _apply_search(count_query)
    total_count = count_query.select(Count(detail.name)).run()[0][0]

    rows_query = (
        frappe.qb.from_(detail)
        .join(timesheet)
        .on(detail.parent == timesheet.name)
        .left_join(task)
        .on(detail.task == task.name)
        .left_join(project)
        .on(detail.project == project.name)
        .where(filters)
    )
    rows_query = _apply_search(rows_query)
    rows = (
        rows_query.select(
            detail.name,
            detail.parent,
            detail.hours,
            detail.from_time,
            detail.to_time,
            detail.description,
            detail.activity_type,
            detail.task,
            detail.project,
            detail.is_billable,
            detail.custom_entry_approval_status.as_("entry_approval_status"),
            timesheet.custom_approval_status.as_("timesheet_status"),
            task.subject.as_("task_subject"),
            project.project_name,
        )
        .orderby(detail.from_time, order=frappe.qb.desc)
        .limit(page_length)
        .offset(start)
    ).run(as_dict=True)

    data = []
    for row in rows:
        from_dt = get_datetime(row.get("from_time"))
        to_dt = get_datetime(row.get("to_time"))
        data.append(
            {
                "name": row.name,
                "parent": row.parent,
                "date": str(getdate(from_dt)) if from_dt else None,
                "from_time": from_dt,
                "to_time": to_dt,
                "hours": flt(row.hours),
                "activity_type": row.activity_type or "",
                "task": row.task,
                "task_subject": row.task_subject or row.task,
                "project": row.project,
                "project_name": row.project_name or row.project,
                "description": strip_input_mode_marker(row.description) or "-",
                "is_billable": bool(row.is_billable),
                "entry_approval_status": row.entry_approval_status or "Pending",
                "timesheet_status": row.timesheet_status or "Not Submitted",
            }
        )

    return {
        "data": data,
        "total_count": total_count,
        "start": start,
        "page_length": page_length,
        "has_more": start + len(data) < total_count,
    }
