import frappe
from frappe import _, throw
from frappe.utils import (
    add_days,
    flt,
    get_first_day_of_week,
    get_last_day_of_week,
    get_datetime,
    getdate,
    now_datetime,
    nowdate,
    time_diff_in_hours,
)

from next_pms.api.utils import error_logger
from next_pms.resource_management.api.utils.query import get_employee_leaves
from next_pms.timesheet.utils.constant import EMP_TIMESHEET
from next_pms.timesheet.utils.time_log import resolve_time_log_times

from .employee import (
    get_employee_daily_working_norm,
    get_employee_from_user,
    get_employee_working_hours,
    validate_current_employee,
)
from .utils import (
    apply_role_permission_for_doctype,
    employee_has_higher_access,
    get_holidays,
    get_week_dates,
    has_write_access,
)


def _get_running_timer_key(employee: str):
    return f"{EMP_TIMESHEET}::running_timer::{employee}"


def _get_running_timer_user_key(user: str | None = None):
    return f"{EMP_TIMESHEET}::running_timer_user::{user or frappe.session.user}"


def _get_open_timesheet(employee: str, date, project: str):
    parent = frappe.db.get_value(
        "Timesheet",
        {
            "employee": employee,
            "start_date": [">=", getdate(date)],
            "end_date": ["<=", getdate(date)],
            "parent_project": project,
            "docstatus": ["!=", 2],
        },
        "name",
    )
    if parent:
        return frappe.get_doc("Timesheet", parent)

    return frappe.get_doc({"doctype": "Timesheet", "employee": employee})


def _append_time_log(employee: str, task: str, description: str, from_time, to_time, hours: float):
    project, custom_is_billable = frappe.get_value("Task", task, ["project", "custom_is_billable"])
    timesheet = _get_open_timesheet(employee, getdate(from_time), project)
    timesheet.update({"parent_project": project})
    timesheet.append(
        "time_logs",
        {
            "task": task,
            "hours": hours,
            "description": description,
            "from_time": from_time,
            "to_time": to_time,
            "project": project,
            "is_billable": custom_is_billable,
        },
    )
    ignore_permissions = employee_has_higher_access(employee, ptype="write")
    return timesheet, ignore_permissions


def _get_week_range(start_date: str):
    week_start = get_first_day_of_week(start_date)
    return week_start, get_last_day_of_week(week_start)


def _get_week_timesheets(employee: str, start_date: str, include_cancelled: bool = False):
    week_start, week_end = _get_week_range(start_date)
    filters = {
        "employee": employee,
        "start_date": [">=", week_start],
        "end_date": ["<=", week_end],
    }
    if not include_cancelled:
        filters["docstatus"] = ["!=", 2]

    return frappe.get_all(
        "Timesheet",
        filters=filters,
        fields=[
            "name",
            "docstatus",
            "start_date",
            "end_date",
            "total_hours",
            "custom_approval_status",
            "custom_weekly_approval_status",
        ],
        order_by="start_date asc, creation asc",
        ignore_permissions=employee_has_higher_access(employee, ptype="read"),
    )


def _get_timesheet_submission_summary(employee: str, start_date: str):
    week_start, week_end = _get_week_range(start_date)
    timesheets = _get_week_timesheets(employee, start_date)
    violations = []
    warnings = []
    task_names = set()
    project_names = set()
    entry_count = 0
    total_hours = 0
    day_totals = {}

    for timesheet in timesheets:
        total_hours += flt(timesheet.total_hours)
        doc = frappe.get_doc("Timesheet", timesheet.name)
        for log in doc.time_logs:
            entry_count += 1
            day = getdate(log.from_time)
            day_totals[day] = day_totals.get(day, 0) + flt(log.hours)
            if log.task:
                task_names.add(log.task)
            if log.project:
                project_names.add(log.project)
            if not log.task:
                violations.append(_("Time entry {0} is missing a task.").format(log.name))
            if not log.project:
                violations.append(_("Time entry {0} is missing a project.").format(log.name))
            if not log.description:
                violations.append(_("Time entry {0} is missing a description.").format(log.name))
            if flt(log.hours) <= 0:
                violations.append(_("Time entry {0} must be greater than zero hours.").format(log.name))

    if not timesheets:
        violations.append(_("No timesheet found for the selected week."))
    if any(timesheet.docstatus == 2 for timesheet in timesheets):
        violations.append(_("Cancelled timesheets cannot be submitted."))

    timer = frappe.cache().get_value(_get_running_timer_user_key())
    if not timer:
        timer = frappe.cache().get_value(_get_running_timer_key(employee))
    if timer and timer.get("employee") == employee:
        violations.append(_("Stop the running timer before submitting this week."))

    hour_detail = get_employee_working_hours(employee)
    expected_hours = hour_detail.get("working_hour") or 0
    if hour_detail.get("working_frequency") == "Per Day":
        expected_hours = expected_hours * 5

    if total_hours < expected_hours:
        warnings.append(
            _("Total hours are below the expected {0} hours for this week.").format(flt(expected_hours, 2))
        )
    for day, hours in day_totals.items():
        if hours > 24:
            violations.append(_("You cannot submit more than 24 hours on {0}.").format(day))

    locked_statuses = {"Approval Pending", "Processing Timesheet", "Approved"}
    if any(timesheet.custom_weekly_approval_status in locked_statuses for timesheet in timesheets):
        violations.append(_("This week is already submitted or approved. Recall it before submitting again."))

    return {
        "employee": employee,
        "start_date": week_start,
        "end_date": week_end,
        "period_type": "Weekly",
        "timesheet_count": len(timesheets),
        "entry_count": entry_count,
        "task_count": len(task_names),
        "project_count": len(project_names),
        "total_hours": flt(total_hours, 2),
        "expected_hours": flt(expected_hours, 2),
        "warnings": warnings,
        "violations": violations,
        "can_submit": not violations,
    }


def _assert_week_editable(employee: str, date):
    locked_statuses = {"Approval Pending", "Processing Timesheet", "Approved", "Partially Approved"}
    start_date, end_date = _get_week_range(date)
    statuses = frappe.get_all(
        "Timesheet",
        filters={
            "employee": employee,
            "start_date": [">=", start_date],
            "end_date": ["<=", end_date],
            "docstatus": ["!=", 2],
        },
        pluck="custom_weekly_approval_status",
        ignore_permissions=employee_has_higher_access(employee, ptype="read"),
    )
    if any(status in locked_statuses for status in statuses):
        throw(_("This week is submitted or approved. Recall it before editing time entries."))


@frappe.whitelist()
@error_logger
def get_timesheet_data(employee: str, start_date: str | None = None, max_week: int = 4):
    """Get timesheet data for the given employee for the given number of weeks."""
    if not employee:
        employee = get_employee_from_user(throw_exception=frappe.session.user != "Administrator")
    if not start_date:
        start_date = nowdate()
    apply_role_permission_for_doctype(["Timesheet User", "Timesheet Manager"], "Employee", "read", employee)

    def generate_week_data(start_date, max_week, employee=None, leaves=None, holidays=None):
        data = {}
        daily_norm = get_employee_daily_working_norm(employee)

        cache_key = f"{EMP_TIMESHEET}::{employee}"
        for i in range(max_week):
            week_dates = get_week_dates(start_date)
            week_key = week_dates["key"]

            week_cache_key = f"{week_dates['start_date']}::{week_dates['end_date']}"
            week_data = frappe.cache().hget(cache_key, week_cache_key)

            if week_data:
                start_date = add_days(getdate(week_dates["start_date"]), -1)
                data[week_key] = week_data
                continue

            tasks, total_hours, status = {}, 0, "Not Submitted"
            if employee:
                holiday_dates = [holiday["holiday_date"] for holiday in holidays] if holidays else []
                tasks, total_hours = get_timesheet(week_dates["dates"], employee)
                status = get_timesheet_state(
                    start_date=week_dates["dates"][0],
                    end_date=week_dates["dates"][-1],
                    employee=employee,
                )
                leave_total = 0
                week_leaves = [
                    leave
                    for leave in leaves
                    if leave["from_date"] <= week_dates["dates"][-1] and leave["to_date"] >= week_dates["dates"][0]
                ]
                for leave in week_leaves:
                    if leave["half_day"]:
                        leave_total += daily_norm / 2
                    else:
                        num_days = 0
                        for date in week_dates["dates"]:
                            if date not in holiday_dates and leave["from_date"] <= date <= leave["to_date"]:
                                num_days += 1
                        leave_total += daily_norm * num_days

                if daily_norm * 5 == leave_total:
                    status = "Approved"
            data[week_key] = {
                **week_dates,
                "total_hours": total_hours,
                "tasks": tasks,
                "status": status,
            }
            frappe.cache().hset(cache_key, week_cache_key, data[week_key])
            start_date = add_days(getdate(week_dates["start_date"]), -1)
        return data

    hour_detail = get_employee_working_hours(employee)
    res = {**hour_detail}

    if not employee and frappe.session.user == "Administrator":
        res["data"] = generate_week_data(start_date, max_week)
        res["holidays"] = []
        res["leaves"] = []
        return res

    holidays = get_holidays(
        employee,
        add_days(start_date, -max_week * 7),
        add_days(start_date, max_week * 7),
    )

    leaves = get_employee_leaves(
        start_date=add_days(start_date, -max_week * 7),
        end_date=add_days(start_date, max_week * 7),
        employee=employee,
    )
    res["leaves"] = leaves
    res["holidays"] = holidays
    res["data"] = generate_week_data(start_date, max_week, employee, leaves, holidays)
    return res


@frappe.whitelist()
@error_logger
def save(
    date: str,
    description: str,
    task: str,
    hours: float = 0,
    employee: str = None,
    from_time: str = None,
    to_time: str = None,
    input_mode: str = "duration",
):
    """create time entry in Timesheet Detail child table."""
    if not employee:
        employee = get_employee_from_user()
    if not task:
        throw(_("Task is mandatory for creating time entry."), frappe.MandatoryError)
    _assert_week_editable(employee, date)

    resolved_from, resolved_to, resolved_hours = resolve_time_log_times(
        date=date,
        hours=hours,
        from_time=from_time,
        to_time=to_time,
        input_mode=input_mode,
    )
    timesheet, ignore_permissions = _append_time_log(
        employee=employee,
        task=task,
        description=description,
        from_time=resolved_from,
        to_time=resolved_to,
        hours=resolved_hours,
    )
    timesheet.save(ignore_permissions=ignore_permissions)
    return _("New Timesheet created successfully.")


@frappe.whitelist()
@error_logger
def get_running_timer(employee: str = None):
    """Return the active timer for the employee, if one exists."""
    timer = frappe.cache().get_value(_get_running_timer_user_key())
    if timer:
        return timer

    if not employee:
        employee = get_employee_from_user()
    if not employee:
        timer = frappe.cache().get_value(_get_running_timer_key(employee))
        return timer or {}

    timer = frappe.cache().get_value(_get_running_timer_key(employee))
    return timer or {}


@frappe.whitelist()
@error_logger
def start_timer(task: str, description: str = "", employee: str = None):
    """Start one running timer for the employee."""
    if not employee:
        employee = get_employee_from_user()
    if not task:
        throw(_("Task is mandatory for starting timer."), frappe.MandatoryError)
    _assert_week_editable(employee, nowdate())

    timer_key = _get_running_timer_key(employee)
    if frappe.cache().get_value(timer_key):
        throw(_("A timer is already running. Stop it before starting another one."))

    task_details = frappe.get_value("Task", task, ["subject", "project", "project.project_name"], as_dict=True)
    if not task_details:
        throw(_("Task does not exist."), frappe.DoesNotExistError)

    timer = {
        "employee": employee,
        "user": frappe.session.user,
        "task": task,
        "task_subject": task_details.subject,
        "project": task_details.project,
        "project_name": task_details.project_name,
        "description": description or "",
        "started_at": now_datetime(),
    }
    frappe.cache().set_value(timer_key, timer)
    frappe.cache().set_value(_get_running_timer_user_key(), timer)
    return timer


@frappe.whitelist()
@error_logger
def stop_timer(employee: str = None):
    """Stop the active timer and write the elapsed time to Timesheet."""
    if not employee:
        employee = get_employee_from_user()
    _assert_week_editable(employee, nowdate())

    user_timer_key = _get_running_timer_user_key()
    timer = frappe.cache().get_value(user_timer_key)
    if timer and not employee:
        employee = timer.get("employee")

    timer_key = _get_running_timer_key(employee)
    if not timer and timer_key:
        timer = frappe.cache().get_value(timer_key)
    if not timer:
        throw(_("No timer is running."))

    started_at = get_datetime(timer.get("started_at"))
    stopped_at = now_datetime()
    hours = time_diff_in_hours(stopped_at, started_at)
    if hours <= 0:
        throw(_("Timer duration must be greater than zero."))

    timesheet, ignore_permissions = _append_time_log(
        employee=employee,
        task=timer.get("task"),
        description=timer.get("description"),
        from_time=started_at,
        to_time=stopped_at,
        hours=hours,
    )
    timesheet.flags.keep_actual_times = True
    timesheet.save(ignore_permissions=ignore_permissions)
    if timer_key:
        frappe.cache().delete_value(timer_key)
    frappe.cache().delete_value(_get_running_timer_user_key(timer.get("user")))

    return {
        "message": _("Timer stopped and time entry created successfully."),
        "hours": hours,
        "from_time": started_at,
        "to_time": stopped_at,
    }


@frappe.whitelist()
@error_logger
def delete(parent: str, name: str):
    """Delete single time entry from timesheet doctype."""
    employee = get_employee_from_user()
    ignore_permissions = employee_has_higher_access(employee, ptype="write")
    parent_doc = frappe.get_doc("Timesheet", parent)
    _assert_week_editable(parent_doc.employee, parent_doc.start_date)
    for log in parent_doc.time_logs:
        if log.name == name:
            parent_doc.remove(log)
    if not parent_doc.time_logs:
        parent_doc.delete(ignore_permissions=ignore_permissions)
    else:
        parent_doc.save(ignore_permissions=ignore_permissions)
    return _("Time entry deleted successfully.")


@frappe.whitelist()
@error_logger
def validate_submission(start_date: str, employee: str = None):
    if not employee:
        employee = get_employee_from_user()
    apply_role_permission_for_doctype(["Timesheet User", "Timesheet Manager"], "Employee", "read", employee)
    return _get_timesheet_submission_summary(employee=employee, start_date=start_date)


@frappe.whitelist()
@error_logger
def submit_for_approval(start_date: str, notes: str = None, employee: str = None, approver: str = None):
    from next_pms.timesheet.doc_events.timesheet import flush_cache, publish_timesheet_update
    from next_pms.timesheet.tasks.reminder_on_approval_request import (
        send_approval_reminder,
    )

    if not employee:
        employee = get_employee_from_user()
    summary = _get_timesheet_submission_summary(employee=employee, start_date=start_date)
    if summary.get("violations"):
        throw("<br>".join(summary.get("violations")))

    if not approver:
        reporting_manager = frappe.get_value("Employee", employee, "reports_to")
        if not reporting_manager:
            throw(_("Reporting Manager is not set for the employee."))
    else:
        reporting_manager = approver

    if not frappe.db.exists("Employee", reporting_manager):
        throw(_("Reporting Manager does not exist."), frappe.DoesNotExistError)
    reporting_manager_name = frappe.get_value("Employee", reporting_manager, "employee_name")

    start_date, end_date = _get_week_range(start_date)

    timesheets = frappe.get_list(
        "Timesheet",
        filters={
            "employee": employee,
            "start_date": [">=", start_date],
            "end_date": ["<=", end_date],
            "docstatus": ["!=", 2],
        },
        fields=["name", "docstatus"],
        ignore_permissions=employee_has_higher_access(employee, ptype="read"),
    )
    if not timesheets:
        throw(_("No timesheet found for the given week."), frappe.DoesNotExistError)

    draft_timesheets = [ts for ts in timesheets if ts.docstatus == 0]
    for timesheet in draft_timesheets:
        frappe.db.set_value("Timesheet", timesheet.name, "custom_approval_status", "Approval Pending")

    for timesheet in timesheets:
        frappe.db.set_value(
            "Timesheet",
            timesheet.name,
            "custom_weekly_approval_status",
            "Approval Pending",
        )
    frappe.db.commit()  # nosemgrep Need to do as we need to publish status changes.

    doc = frappe._dict({"employee": employee, "start_date": start_date, "end_date": end_date})
    flush_cache(doc)
    publish_timesheet_update(employee=employee, start_date=start_date)

    send_approval_reminder(employee, reporting_manager, start_date, end_date, notes)

    return _("Timesheet has been sent for Approval to {0}.").format(reporting_manager_name)


@frappe.whitelist()
@error_logger
def recall_timesheet(start_date: str, employee: str = None):
    """Recall a submitted/approved week so the employee can amend time entries."""
    from next_pms.timesheet.doc_events.timesheet import flush_cache, publish_timesheet_update

    if not employee:
        employee = get_employee_from_user()

    ignore_permissions = employee_has_higher_access(employee, ptype="write")
    if not ignore_permissions:
        frappe.has_permission("Timesheet", "write", throw=True)

    timesheets = _get_week_timesheets(employee, start_date)
    if not timesheets:
        throw(_("No timesheet found for the given week."), frappe.DoesNotExistError)

    recalled = 0
    amended = 0
    for timesheet in timesheets:
        doc = frappe.get_doc("Timesheet", timesheet.name)

        if doc.docstatus == 1:
            doc.flags.ignore_validate_update_after_submit = True
            doc.cancel()
            amended_doc = frappe.copy_doc(doc)
            amended_doc.docstatus = 0
            amended_doc.amended_from = doc.name
            amended_doc.custom_approval_status = "Not Submitted"
            amended_doc.custom_weekly_approval_status = "Not Submitted"
            for child in amended_doc.get_all_children():
                child.docstatus = 0
            amended_doc.insert(ignore_permissions=ignore_permissions)
            amended += 1
            continue

        if doc.docstatus == 0:
            doc.custom_approval_status = "Not Submitted"
            doc.custom_weekly_approval_status = "Not Submitted"
            doc.save(ignore_permissions=ignore_permissions)
            recalled += 1

    frappe.db.commit()  # nosemgrep Need to publish status after recall.
    week_start, _week_end = _get_week_range(start_date)
    flush_cache(frappe._dict({"employee": employee, "start_date": week_start}))
    publish_timesheet_update(employee=employee, start_date=week_start)

    if amended:
        return _("Timesheet recalled. {0} submitted document(s) were cancelled and amended.").format(amended)
    return _("Timesheet recalled. {0} draft document(s) are editable again.").format(recalled)


@frappe.whitelist()
def update_timesheet_detail(
    name: str,
    parent: str,
    hours: float,
    description: str,
    task: str,
    date: str | None = None,
    is_billable: bool | None = None,
    from_time: str | None = None,
    to_time: str | None = None,
    input_mode: str = "duration",
):
    parent_doc = frappe.get_doc("Timesheet", parent)
    _assert_week_editable(parent_doc.employee, parent_doc.start_date)
    ignore_permissions = employee_has_higher_access(parent_doc.employee, ptype="write")
    logs_to_remove = []
    new_logs = []
    task_project = frappe.get_value("Task", task, "project")
    resolved_from, resolved_to, resolved_hours = resolve_time_log_times(
        date=date,
        hours=hours,
        from_time=from_time,
        to_time=to_time,
        input_mode=input_mode,
    )

    def build_new_log_payload():
        payload = {
            "task": task,
            "hours": resolved_hours,
            "description": description,
            "date": date,
            "employee": parent_doc.employee,
            "from_time": str(resolved_from),
            "to_time": str(resolved_to),
            "input_mode": input_mode,
        }
        if has_write_access() and is_billable is not None:
            payload["is_billable"] = is_billable
        return payload

    for log in parent_doc.time_logs:
        if not name or log.name != name:
            continue

        if task_project and task_project != parent_doc.parent_project:
            logs_to_remove.append(log)
            new_logs.append(build_new_log_payload())
            continue

        log.hours = resolved_hours
        log.description = description
        log.task = task
        log.from_time = resolved_from
        log.to_time = resolved_to
        # Only update value of billable if user has write access
        if has_write_access() and is_billable is not None:
            log.is_billable = is_billable
        if getdate(log.from_time) != getdate(date):
            logs_to_remove.append(log)
            new_logs.append(build_new_log_payload())

    for log in logs_to_remove:
        parent_doc.time_logs.remove(log)

    if not name:
        if parent_doc.start_date <= getdate(date) <= parent_doc.end_date:
            log = {
                "task": task,
                "hours": resolved_hours,
                "description": description,
                "from_time": resolved_from,
                "to_time": resolved_to,
                "project": task_project,
            }
            if has_write_access() and is_billable is not None:
                log["is_billable"] = is_billable
            else:
                log["is_billable"] = frappe.get_value("Task", task, "custom_is_billable")

            parent_doc.append("time_logs", log)
        else:
            new_logs.append(build_new_log_payload())

    if not parent_doc.time_logs:
        parent_doc.delete(ignore_permissions=ignore_permissions)
    else:
        parent_doc.save(ignore_permissions=ignore_permissions)

    if new_logs:
        for log in new_logs:
            save(**log)
    return _("Time entry updated successfully.")


def get_timesheet(dates: list, employee: str):
    from next_pms.timesheet.utils.constant import ALLOWED_TIMESHET_DETAIL_FIELDS

    """Return the time entry from Timesheet Detail child table based on the list of dates and for the given employee.
    example:
        {
            "Task 1": {
                "name": "TS-00001",
                "data": [
                    {
                        "task": "Task 1",
                        "name": "TS-00001",
                        "hours": 8,
                        "description": "Task 1 description",
                        "from_time": "2021-08-01",
                        "to_time": "2021-08-01",
                    },
                    ...
                ]
            },
            ...
        }
    """
    data = {}
    total_hours = 0
    timesheet_logs = frappe.get_list(
        "Timesheet",
        filters={
            "employee": employee,
            "start_date": ["in", dates],
            "docstatus": ["!=", 2],
        },
        fields=["time_logs.name"],
        ignore_permissions=employee_has_higher_access(employee, ptype="read"),
    )
    if not timesheet_logs:
        return [data, total_hours]
    timesheet_logs = [frappe.get_doc("Timesheet Detail", ts.name) for ts in timesheet_logs]

    task_ids = [ts.task for ts in timesheet_logs if ts.task]
    task_details = frappe.get_all(
        "Task",
        filters={"name": ["in", task_ids]},
        fields=[
            "name",
            "subject",
            "project.project_name as project_name",
            "project",
            "custom_is_billable",
            "expected_time",
            "actual_time",
            "status",
            "_liked_by",
        ],
    )
    task_details_dict = {task["name"]: task for task in task_details}
    for log in timesheet_logs:
        total_hours += log.hours
        if not log.task:
            continue
        task = task_details_dict.get(log.task)
        if not task:
            continue
        task_name = task["name"]
        if task_name not in data:
            data[task_name] = {
                "name": task_name,
                "subject": task["subject"],
                "data": [],
                "is_billable": task["custom_is_billable"],
                "project_name": task["project_name"],
                "project": task["project"],
                "expected_time": task["expected_time"],
                "actual_time": task["actual_time"],
                "status": task["status"],
                "_liked_by": task["_liked_by"],
            }

        data[task_name]["data"].append({field: log.get(field) for field in ALLOWED_TIMESHET_DETAIL_FIELDS})

    return [data, total_hours]


@validate_current_employee(ptype="read")
def get_timesheet_state(employee: str, start_date: str, end_date: str):
    status = frappe.db.get_value(
        "Timesheet",
        {
            "employee": employee,
            "start_date": [">=", getdate(start_date)],
            "end_date": ["<=", getdate(end_date)],
            "docstatus": ["!=", 2],
        },
        "custom_weekly_approval_status",
    )
    if status:
        return status
    return "Not Submitted"


@frappe.whitelist()
@validate_current_employee(ptype="write")
def get_remaining_hour_for_employee(employee: str, date: str):
    """Return the working hours for the given employee on the given date."""
    from .employee import get_employee_working_hours

    working_hours = get_employee_working_hours(employee)
    if not working_hours.get("working_frequency") == "Per Day":
        working_hours.update({"working_hour": working_hours.get("working_hour") / 5})

    date = getdate(date)
    timesheet_hours = frappe.get_all(
        "Timesheet",
        filters={
            "employee": employee,
            "start_date": date,
            "end_date": date,
            "docstatus": ["!=", 2],
        },
        pluck="total_hours",
    )
    total_hours = sum(timesheet_hours)

    leaves = get_employee_leaves(
        start_date=add_days(date, -4 * 7),
        end_date=add_days(date, 4 * 7),
        employee=employee,
    )
    data = [leave for leave in leaves if leave.get("from_date") <= date <= leave.get("to_date")]

    if data:
        for d in data:
            if d.get("half_day") and d.get("half_day_date") == date:
                total_hours += working_hours.get("working_hour") / 2
            else:
                total_hours += working_hours.get("working_hour")
    return working_hours.get("working_hour") - total_hours


@frappe.whitelist()
@validate_current_employee(ptype="read")
def get_timesheet_details(date: str, task: str, employee: str):
    logs = frappe.get_list(
        "Timesheet",
        fields=[
            "time_logs.name",
            "time_logs.hours",
            "time_logs.description",
            "time_logs.task",
            "time_logs.from_time",
            "time_logs.to_time",
            "time_logs.from_time as date",
            "time_logs.parent",
            "time_logs.is_billable",
        ],
        filters={
            "start_date": ["=", getdate(date)],
            "employee": employee,
            "docstatus": ["=", 0],
        },
        ignore_permissions=employee_has_higher_access(employee, ptype="read"),
    )
    logs = [log for log in logs if log["task"] == task]
    subject, project_name = frappe.get_value("Task", task, ["subject", "project.project_name"])

    return {
        "task": subject,
        "project": project_name,
        "data": logs,
    }


@frappe.whitelist()
@error_logger
def bulk_update_timesheet_detail(data: list):
    for entry in data:
        if isinstance(entry, str):
            entry = frappe.parse_json(entry)
        update_timesheet_detail(**entry)
    return _("Time entries updated successfully.")


@frappe.whitelist()
def bulk_save(timesheet_entries: list):
    """
    Create multiple time entries in Timesheet Detail child table.

    :param timesheet_entries: List of dictionaries containing timesheet entry details
    Each dictionary should have keys:
    - date (str, mandatory)
    - description (str, mandatory)
    - task (str, mandatory)
    - hours (float, optional, default=0)
    - employee (str, optional)

    """
    if not isinstance(timesheet_entries, list):
        throw(_("Input must be a list of timesheet entries."), frappe.ValidationError)

    for entry in timesheet_entries:
        date = entry.get("date")
        description = entry.get("description")
        task = entry.get("task")
        hours = entry.get("hours", 0)
        employee = entry.get("employee")

        save(
            date=date,
            description=description,
            task=task,
            hours=hours,
            employee=employee,
        )

    return _("Event Timesheet created successfully.")
