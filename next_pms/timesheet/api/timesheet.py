import frappe
from frappe import _, throw
from datetime import timedelta

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
from next_pms.timesheet.utils.billable import enrich_log_billable_fields, get_project_default_is_billable, resolve_entry_billable
from next_pms.timesheet.utils.description import (
    enrich_log_description_fields,
    get_project_description_settings,
    is_meaningful_description,
    strip_description_content,
    validate_entry_description,
)
from next_pms.timesheet.utils.constant import EMP_TIMESHEET
from next_pms.timesheet.utils.time_log import (
    get_input_mode_from_description,
    resolve_time_log_times,
    set_input_mode_marker,
    strip_input_mode_marker,
)

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


def _mark_draft_save(timesheet):
    timesheet.flags.skip_submission_validation = True


def _get_effective_log_interval(log):
    from_dt = get_datetime(log.from_time)
    to_dt = get_datetime(log.to_time)
    if from_dt and (not to_dt or to_dt <= from_dt) and flt(log.hours) > 0:
        to_dt = from_dt + timedelta(hours=flt(log.hours))
    return from_dt, to_dt


def _normalize_invalid_duration_logs(timesheet, date):
    changed = False
    for log in timesheet.time_logs:
        from_dt = get_datetime(log.from_time)
        to_dt = get_datetime(log.to_time)
        if not from_dt or getdate(from_dt) != getdate(date) or not flt(log.hours):
            continue
        if not to_dt or to_dt <= from_dt:
            log.to_time = from_dt + timedelta(hours=flt(log.hours))
            changed = True
    return changed


def _append_time_log(
    employee: str,
    task: str,
    description: str,
    from_time,
    to_time,
    hours: float,
    is_billable=None,
    billable_override_reason: str | None = None,
    require_override_reason: bool = False,
):
    project = frappe.get_value("Task", task, "project")
    resolved_billable, override_reason, _default = resolve_entry_billable(
        task,
        is_billable,
        billable_override_reason,
        require_override_reason=require_override_reason,
    )
    timesheet = _get_open_timesheet(employee, getdate(from_time), project)
    timesheet.update({"parent_project": project})
    _normalize_invalid_duration_logs(timesheet, from_time)
    input_mode = get_input_mode_from_description(description)
    existing_log = next(
        (
            log
            for log in timesheet.time_logs
            if log.task == task
            and getdate(log.from_time) == getdate(from_time)
            and get_input_mode_from_description(log.description) == input_mode
        ),
        None,
    )

    if existing_log:
        existing_log.hours = hours
        existing_log.description = description
        existing_log.from_time = from_time
        existing_log.to_time = to_time
        existing_log.project = project
        existing_log.is_billable = resolved_billable
        existing_log.custom_billable_override_reason = override_reason
        _mark_draft_save(timesheet)
        ignore_permissions = employee_has_higher_access(employee, ptype="write")
        return timesheet, ignore_permissions

    timesheet.append(
        "time_logs",
        {
            "task": task,
            "hours": hours,
            "description": description,
            "from_time": from_time,
            "to_time": to_time,
            "project": project,
            "is_billable": resolved_billable,
            "custom_billable_override_reason": override_reason,
        },
    )
    _mark_draft_save(timesheet)
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
    approval_descriptions = []

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
            description_settings = get_project_description_settings(log.project)
            if description_settings["required"] and not is_meaningful_description(log.description):
                violations.append(
                    _("Time entry {0} requires a description for project {1}.").format(
                        log.name, log.project or _("Unknown")
                    )
                )
            if description_settings["show_in_approval"] and is_meaningful_description(log.description):
                task_subject = frappe.db.get_value("Task", log.task, "subject") if log.task else ""
                project_name = frappe.db.get_value("Project", log.project, "project_name") if log.project else ""
                approval_descriptions.append(
                    {
                        "entry": log.name,
                        "task": log.task,
                        "task_subject": task_subject,
                        "project": log.project,
                        "project_name": project_name,
                        "date": str(getdate(log.from_time)),
                        "hours": flt(log.hours, 2),
                        "description": strip_description_content(log.description),
                    }
                )
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
        "approval_descriptions": approval_descriptions,
    }


def _enrich_tasks_with_period_locks(tasks: dict, start_date, end_date):
    from next_pms.timesheet.utils.period_lock import enrich_entry_period_lock_fields, get_active_locks_between

    if not tasks:
        return tasks

    locks = get_active_locks_between(start_date, end_date)
    for task_data in tasks.values():
        for log_data in task_data.get("data", []):
            enrich_entry_period_lock_fields(log_data, locks)
    return tasks


def _assert_week_editable(employee: str, date):
    from next_pms.timesheet.utils.period_lock import assert_date_not_period_locked

    assert_date_not_period_locked(date)

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


def _get_day_intervals(employee: str, date, exclude_detail_name: str | None = None):
    day = getdate(date)
    timesheets = frappe.get_all(
        "Timesheet",
        filters={
            "employee": employee,
            "start_date": ["<=", day],
            "end_date": [">=", day],
            "docstatus": ["!=", 2],
        },
        pluck="name",
        ignore_permissions=employee_has_higher_access(employee, ptype="read"),
    )
    intervals = []
    for timesheet_name in timesheets:
        timesheet = frappe.get_doc("Timesheet", timesheet_name)
        for log in timesheet.time_logs:
            if exclude_detail_name and log.name == exclude_detail_name:
                continue
            from_dt, to_dt = _get_effective_log_interval(log)
            if not from_dt or not to_dt or getdate(from_dt) != day or to_dt <= from_dt:
                continue
            intervals.append((from_dt, to_dt))
    return sorted(intervals, key=lambda item: item[0])


def _has_overlap(start, end, intervals):
    return any(start < interval_end and end > interval_start for interval_start, interval_end in intervals)


def _resolve_duration_time_slot(
    employee: str,
    date,
    hours: float,
    exclude_detail_name: str | None = None,
    preferred_from=None,
    draft_mode: bool = False,
):
    day_start = get_datetime(getdate(date)).replace(hour=0, minute=0, second=0, microsecond=0)
    duration = timedelta(hours=float(hours or 0))
    if duration.total_seconds() <= 0:
        return day_start, day_start, float(hours or 0)

    intervals = _get_day_intervals(employee, date, exclude_detail_name=exclude_detail_name)
    day_end = day_start + timedelta(days=1, seconds=-1)
    if preferred_from:
        preferred_start = get_datetime(preferred_from)
        if preferred_start and getdate(preferred_start) == getdate(date):
            preferred_end = preferred_start + duration
            if preferred_end <= day_end and not _has_overlap(preferred_start, preferred_end, intervals):
                return preferred_start, preferred_end, float(hours)

    candidate_start = day_start
    for interval_start, interval_end in intervals:
        candidate_end = candidate_start + duration
        if candidate_end <= interval_start:
            return candidate_start, candidate_end, float(hours)
        if candidate_start < interval_end:
            candidate_start = interval_end

    candidate_end = candidate_start + duration
    if candidate_end > day_end:
        if draft_mode:
            clipped_end = min(candidate_end, day_end)
            if clipped_end <= candidate_start:
                clipped_end = min(day_start + timedelta(minutes=1), day_end)
            clipped_hours = time_diff_in_hours(clipped_end, candidate_start)
            return candidate_start, clipped_end, flt(clipped_hours, 3)
        throw(_("There is not enough free time on {0} to add {1} hours without overlap.").format(date, hours))
    return candidate_start, candidate_end, float(hours)


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
                week_data["tasks"] = _enrich_tasks_with_period_locks(
                    week_data.get("tasks", {}),
                    week_dates["start_date"],
                    week_dates["end_date"],
                )
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
            tasks = _enrich_tasks_with_period_locks(tasks, week_dates["start_date"], week_dates["end_date"])
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
        from next_pms.timesheet.utils.period_lock import get_active_locks_between

        range_start = add_days(start_date, -max_week * 7)
        range_end = add_days(start_date, max_week * 7)
        res["period_locks"] = get_active_locks_between(range_start, range_end)
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

    from next_pms.timesheet.utils.period_lock import get_active_locks_between

    range_start = add_days(start_date, -max_week * 7)
    range_end = add_days(start_date, max_week * 7)
    res["period_locks"] = get_active_locks_between(range_start, range_end)
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
    is_billable: bool | None = None,
    billable_override_reason: str | None = None,
):
    """create time entry in Timesheet Detail child table."""
    if not employee:
        employee = get_employee_from_user()
    if not task:
        throw(_("Task is mandatory for creating time entry."), frappe.MandatoryError)
    _assert_week_editable(employee, date)
    description = description or "-"

    if input_mode == "duration":
        resolved_from, resolved_to, resolved_hours = _resolve_duration_time_slot(
            employee, date, hours, draft_mode=True
        )
    else:
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
        description=set_input_mode_marker(description, input_mode),
        from_time=resolved_from,
        to_time=resolved_to,
        hours=resolved_hours,
        is_billable=is_billable,
        billable_override_reason=billable_override_reason,
        require_override_reason=is_billable is not None,
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

    from next_pms.timesheet.utils.rejection import prepare_entries_for_resubmission

    draft_timesheets = [ts for ts in timesheets if ts.docstatus == 0]
    for timesheet in draft_timesheets:
        doc = frappe.get_doc("Timesheet", timesheet.name)
        prepare_entries_for_resubmission(doc)
        for log in doc.time_logs:
            log.save(ignore_permissions=True)
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
def abandon_draft(start_date: str, employee: str = None):
    """Discard all draft timesheet documents for the selected week."""
    from next_pms.timesheet.doc_events.timesheet import flush_cache, publish_timesheet_update

    if not employee:
        employee = get_employee_from_user()
    _assert_week_editable(employee, start_date)

    ignore_permissions = employee_has_higher_access(employee, ptype="write")
    if not ignore_permissions:
        frappe.has_permission("Timesheet", "write", throw=True)

    timesheets = _get_week_timesheets(employee, start_date)
    if not timesheets:
        return _("No draft timesheet found for the selected week.")

    deleted = 0
    for timesheet in timesheets:
        if timesheet.docstatus != 0:
            continue
        frappe.delete_doc("Timesheet", timesheet.name, ignore_permissions=ignore_permissions)
        deleted += 1

    if not deleted:
        throw(_("No draft timesheet found for the selected week."), frappe.DoesNotExistError)

    week_start, _week_end = _get_week_range(start_date)
    flush_cache(frappe._dict({"employee": employee, "start_date": week_start}))
    publish_timesheet_update(employee=employee, start_date=week_start)
    return _("Draft timesheet discarded.")


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
    billable_override_reason: str | None = None,
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
    existing_log = next((log for log in parent_doc.time_logs if name and log.name == name), None)
    if input_mode == "duration":
        resolved_from, resolved_to, resolved_hours = _resolve_duration_time_slot(
            employee=parent_doc.employee,
            date=date,
            hours=hours,
            exclude_detail_name=name,
            preferred_from=existing_log.from_time if existing_log else None,
            draft_mode=True,
        )
    else:
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
            "description": strip_input_mode_marker(description),
            "date": date,
            "employee": parent_doc.employee,
            "from_time": str(resolved_from),
            "to_time": str(resolved_to),
            "input_mode": input_mode,
        }
        if is_billable is not None:
            payload["is_billable"] = is_billable
            payload["billable_override_reason"] = billable_override_reason
        return payload

    for log in parent_doc.time_logs:
        if not name or log.name != name:
            continue

        if task_project and task_project != parent_doc.parent_project:
            logs_to_remove.append(log)
            new_logs.append(build_new_log_payload())
            continue

        log.hours = resolved_hours
        log.description = set_input_mode_marker(description, input_mode)
        log.task = task
        log.from_time = resolved_from
        log.to_time = resolved_to
        if is_billable is not None:
            resolved_billable, override_reason, _default = resolve_entry_billable(
                task,
                is_billable,
                billable_override_reason,
                require_override_reason=True,
            )
            log.is_billable = resolved_billable
            log.custom_billable_override_reason = override_reason
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
                "description": set_input_mode_marker(description, input_mode),
                "from_time": resolved_from,
                "to_time": resolved_to,
                "project": task_project,
            }
            if is_billable is not None:
                resolved_billable, override_reason, _default = resolve_entry_billable(
                    task,
                    is_billable,
                    billable_override_reason,
                    require_override_reason=True,
                )
                log["is_billable"] = resolved_billable
                log["custom_billable_override_reason"] = override_reason
            else:
                default_billable, _, _ = resolve_entry_billable(task)
                log["is_billable"] = default_billable

            parent_doc.append("time_logs", log)
        else:
            new_logs.append(build_new_log_payload())

    if not parent_doc.time_logs:
        parent_doc.delete(ignore_permissions=ignore_permissions)
    else:
        _mark_draft_save(parent_doc)
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
    from next_pms.timesheet.utils.period_lock import get_active_locks_between

    locks = get_active_locks_between(min(dates), max(dates)) if dates else []
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
        project_default = get_project_default_is_billable(task["project"])
        description_settings = get_project_description_settings(task["project"])
        if task_name not in data:
            data[task_name] = {
                "name": task_name,
                "subject": task["subject"],
                "data": [],
                "is_billable": project_default,
                "project_default_is_billable": project_default,
                "description_required": description_settings["required"],
                "show_description_in_approval": description_settings["show_in_approval"],
                "include_description_on_invoice": description_settings["include_on_invoice"],
                "project_name": task["project_name"],
                "project": task["project"],
                "expected_time": task["expected_time"],
                "actual_time": task["actual_time"],
                "status": task["status"],
                "_liked_by": task["_liked_by"],
            }

        log_data = {field: log.get(field) for field in ALLOWED_TIMESHET_DETAIL_FIELDS}
        marked_input_mode = get_input_mode_from_description(log.description)
        log_data["input_mode"] = marked_input_mode or "range"
        log_data["description"] = strip_input_mode_marker(log.description)
        enrich_log_billable_fields(log_data, task_name)
        enrich_log_description_fields(log_data, task.get("project"))
        from next_pms.timesheet.utils.rejection import enrich_entry_rejection_fields

        enrich_entry_rejection_fields(log_data)
        from next_pms.timesheet.utils.period_lock import enrich_entry_period_lock_fields

        enrich_entry_period_lock_fields(log_data, locks)
        data[task_name]["data"].append(log_data)

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
            "time_logs.custom_billable_override_reason",
        ],
        filters={
            "start_date": ["=", getdate(date)],
            "employee": employee,
            "docstatus": ["=", 0],
        },
        ignore_permissions=employee_has_higher_access(employee, ptype="read"),
    )
    logs = [log for log in logs if log["task"] == task]
    for log in logs:
        marked_input_mode = get_input_mode_from_description(log.get("description"))
        log["input_mode"] = marked_input_mode or "range"
        log["description"] = strip_input_mode_marker(log.get("description"))
    task_project = frappe.get_value("Task", task, ["subject", "project.project_name", "project"], as_dict=True)
    project_default = get_project_default_is_billable(task_project.project if task_project else None)
    description_settings = get_project_description_settings(task_project.project if task_project else None)
    for log in logs:
        enrich_log_billable_fields(log, task)
        enrich_log_description_fields(log, task_project.project if task_project else None)
        log["billable_override_reason"] = log.pop("custom_billable_override_reason", None)

    return {
        "task": task_project.subject if task_project else "",
        "project": task_project.project_name if task_project else "",
        "project_default_is_billable": project_default,
        "description_required": description_settings["required"],
        "show_description_in_approval": description_settings["show_in_approval"],
        "include_description_on_invoice": description_settings["include_on_invoice"],
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
