import frappe
from frappe import _, throw
from contextlib import contextmanager
from datetime import timedelta
from threading import local

from frappe.utils import (
    add_days,
    flt,
    formatdate,
    get_first_day,
    get_first_day_of_week,
    get_last_day,
    get_last_day_of_week,
    get_datetime,
    getdate,
    now_datetime,
    nowdate,
    strip_html_tags,
    time_diff_in_hours,
    time_diff_in_seconds,
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


_day_lock_held = local()


@contextmanager
def _employee_day_lock(employee: str, date):
    """Serialize time-entry writes for one employee on one day (reentrant).

    Parallel Add Time autosaves / double-clicks otherwise create two Timesheet
    parents with the same from/to, and ERPNext then blocks every later save
    with OverlapError.
    """
    from frappe.utils.synchronization import filelock

    key = f"{employee}:{getdate(date)}"
    held = getattr(_day_lock_held, "keys", None)
    if held is None:
        held = set()
        _day_lock_held.keys = held
    if key in held:
        yield
        return
    held.add(key)
    try:
        with filelock(f"next_pms_ts_day_{employee}_{getdate(date)}", timeout=30):
            yield
    finally:
        held.discard(key)


def _get_running_timer_key(employee: str):
    return f"{EMP_TIMESHEET}::running_timer::{employee}"


def _get_running_timer_user_key(user: str | None = None):
    return f"{EMP_TIMESHEET}::running_timer_user::{user or frappe.session.user}"


def _find_open_timesheet_name(employee: str, date, project: str | None = None):
    filters = {
        "employee": employee,
        "start_date": [">=", getdate(date)],
        "end_date": ["<=", getdate(date)],
        "docstatus": ["!=", 2],
    }
    if project:
        filters["parent_project"] = project
        return frappe.db.get_value("Timesheet", filters, "name")

    rows = frappe.get_all(
        "Timesheet", filters=filters, fields=["name", "parent_project"], limit_page_length=20
    )
    return next((row.name for row in rows if not row.parent_project), None)


def _get_open_timesheet(employee: str, date, project: str | None = None):
    """Return draft/open timesheet for employee+day, creating one if needed.

    Callers must hold `_employee_day_lock` so two requests cannot both miss
    the existing parent and insert duplicates.
    """
    parent = _find_open_timesheet_name(employee, date, project)
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


def _find_autosave_match(candidates, description: str, input_mode: str, max_age_seconds: int = 120):
    """Match only the same in-progress autosave, never a distinct intentional entry.

    Distinct Meetings/Admin rows on the same day must stay separate. We only reuse
    a row when remarks are identical, or still being typed, and the row was created
    very recently (the Add Time dialog autosaves every ~800ms).
    """
    from frappe.utils import get_datetime, now_datetime, time_diff_in_seconds
    from next_pms.timesheet.utils.time_log import strip_input_mode_marker

    if not candidates:
        return None

    desc_plain = (strip_input_mode_marker(description) or "").strip()
    now = now_datetime()

    def _is_recent(log) -> bool:
        created = get_datetime(log.creation) if log.creation else None
        if not created:
            return False
        return abs(time_diff_in_seconds(now, created)) <= max_age_seconds

    def _sort_key(log):
        return get_datetime(log.creation) if log.creation else get_datetime(log.from_time)

    recent = [log for log in candidates if _is_recent(log)]
    if not recent:
        return None

    if desc_plain:
        exact = next(
            (
                log
                for log in sorted(recent, key=_sort_key, reverse=True)
                if get_input_mode_from_description(log.description) == input_mode
                and (strip_input_mode_marker(log.description) or "").strip() == desc_plain
            ),
            None,
        )
        if exact:
            return exact

        # Remarks still being typed ("Hand" → "Handling tickets…")
        for log in sorted(recent, key=_sort_key, reverse=True):
            if get_input_mode_from_description(log.description) != input_mode:
                continue
            prev = (strip_input_mode_marker(log.description) or "").strip()
            if prev and (desc_plain.startswith(prev) or prev.startswith(desc_plain)):
                return log

    return None


def _append_time_log(
    employee: str,
    task: str | None,
    description: str,
    from_time,
    to_time,
    hours: float,
    is_billable=None,
    billable_override_reason: str | None = None,
    require_override_reason: bool = False,
    activity_type: str | None = None,
    force_new: bool = False,
    project: str | None = None,
    name: str | None = None,
):
    from next_pms.timesheet.utils.settings import is_project_required_on_timesheet

    task = (task or "").strip() or None
    project = (project or "").strip() or None
    name = (name or "").strip() or None
    if task:
        project = frappe.get_value("Task", task, "project") or project
    if not project and is_project_required_on_timesheet():
        throw(_("Project is required when no task is selected."), frappe.MandatoryError)

    resolved_billable, override_reason, _default = resolve_entry_billable(
        task,
        is_billable,
        billable_override_reason,
        require_override_reason=require_override_reason,
        project=project,
    )
    timesheet = _get_open_timesheet(employee, getdate(from_time), project)
    if project:
        timesheet.update({"parent_project": project})
    _normalize_invalid_duration_logs(timesheet, from_time)
    input_mode = get_input_mode_from_description(description)
    existing_log = None

    # Prefer an explicit child-row name from the Add Time autosave loop.
    if name:
        existing_log = next((log for log in timesheet.time_logs if log.name == name), None)
        if not existing_log:
            throw(_("Time entry {0} was not found.").format(name), frappe.DoesNotExistError)
    elif not force_new and task:
        candidates = [
            log
            for log in timesheet.time_logs
            if log.task == task and getdate(log.from_time) == getdate(from_time)
        ]
        existing_log = _find_autosave_match(candidates, description, input_mode)
    elif not force_new and activity_type:
        # Activity-only logs (Meeting/Admin/…) — never merge solely on work type.
        # Two Meetings on the same day are two entries; only collapse an in-flight
        # autosave of the same row. Always scope by project so distinct projects
        # stay on separate grid rows.
        activity_type = activity_type.strip()
        day = getdate(from_time)
        project_key = project or ""
        candidates = [
            log
            for log in timesheet.time_logs
            if not log.task
            and (log.activity_type or "").strip() == activity_type
            and (log.project or "") == project_key
            and getdate(log.from_time) == day
        ]
        existing_log = _find_autosave_match(candidates, description, input_mode)

    if existing_log:
        existing_log.hours = hours
        existing_log.description = description
        existing_log.from_time = from_time
        existing_log.to_time = to_time
        existing_log.project = project
        existing_log.is_billable = resolved_billable
        existing_log.custom_billable_override_reason = override_reason
        if activity_type:
            existing_log.activity_type = activity_type
        _mark_draft_save(timesheet)
        ignore_permissions = employee_has_higher_access(employee, ptype="write")
        return timesheet, ignore_permissions, existing_log

    log_row = {
        "task": task,
        "hours": hours,
        "description": description,
        "from_time": from_time,
        "to_time": to_time,
        "project": project,
        "is_billable": resolved_billable,
        "custom_billable_override_reason": override_reason,
    }
    if activity_type:
        log_row["activity_type"] = activity_type
    row = timesheet.append("time_logs", log_row)
    _mark_draft_save(timesheet)
    ignore_permissions = employee_has_higher_access(employee, ptype="write")
    return timesheet, ignore_permissions, row


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
            if not log.activity_type:
                violations.append(_("Time entry {0} is missing a work type.").format(log.name))
            from next_pms.timesheet.utils.settings import is_project_required_on_timesheet

            if is_project_required_on_timesheet() and not log.project:
                violations.append(_("Time entry {0} is missing a project.").format(log.name))
            if not is_meaningful_description(log.description):
                violations.append(
                    _("Time entry {0} requires remarks / description.").format(log.name)
                )
            description_settings = get_project_description_settings(log.project)
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

    locked_statuses = {"Approval Pending", "Pending HR Approval", "Processing Timesheet", "Approved"}
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

    locked_statuses = {
        "Approval Pending",
        "Pending HR Approval",
        "Processing Timesheet",
        "Approved",
        "Partially Approved",
    }
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
                throw(
                    _("There is not enough free time on {0} to add {1} hours. The day is already fully booked.").format(
                        date, hours
                    )
                )
            clipped_hours = time_diff_in_hours(clipped_end, candidate_start)
            if flt(clipped_hours, 3) <= 0:
                throw(
                    _("There is not enough free time on {0} to add {1} hours without overlap.").format(date, hours)
                )
            return candidate_start, clipped_end, flt(clipped_hours, 3)
        throw(_("There is not enough free time on {0} to add {1} hours without overlap.").format(date, hours))
    return candidate_start, candidate_end, float(hours)


def _get_timesheet_view_min_date():
    """Regular employees only see the current calendar month on their timesheet."""
    if has_write_access():
        return None
    return get_first_day(getdate())


def _get_current_month_bounds():
    today = getdate()
    return get_first_day(today), get_last_day(today)


@frappe.whitelist()
@error_logger
def get_timesheet_data(
    employee: str,
    start_date: str | None = None,
    max_week: int = 4,
    current_month_only: int | bool = 0,
):
    """Get timesheet data for the given employee for the given number of weeks."""
    if not employee:
        employee = get_employee_from_user(throw_exception=frappe.session.user != "Administrator")
    if not start_date:
        start_date = nowdate()
    apply_role_permission_for_doctype(["Timesheet User", "Timesheet Manager"], "Employee", "read", employee)
    current_month_only = frappe.utils.cint(current_month_only)
    if current_month_only:
        min_view_date, max_view_date = _get_current_month_bounds()
    else:
        min_view_date = _get_timesheet_view_min_date()
        max_view_date = None

    def generate_week_data(
        start_date, max_week, employee=None, leaves=None, holidays=None, min_date=None, max_date=None
    ):
        data = {}
        daily_norm = get_employee_daily_working_norm(employee)

        cache_key = f"{EMP_TIMESHEET}::{employee}"
        for i in range(max_week):
            week_dates = get_week_dates(start_date)
            if min_date and getdate(week_dates["end_date"]) < getdate(min_date):
                break

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
            expected_hours = 0
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

                # Hours the employee is actually expected to log this week, so the
                # UI can flag an incomplete week without mistaking leave for a gap.
                working_dates = [date for date in week_dates["dates"] if date not in holiday_dates]
                expected_hours = max(daily_norm * len(working_dates) - leave_total, 0)
            tasks = _enrich_tasks_with_period_locks(tasks, week_dates["start_date"], week_dates["end_date"])
            data[week_key] = {
                **week_dates,
                "total_hours": total_hours,
                "expected_hours": expected_hours,
                "tasks": tasks,
                "status": status,
            }
            frappe.cache().hset(cache_key, week_cache_key, data[week_key])
            start_date = add_days(getdate(week_dates["start_date"]), -1)

        if min_date or max_date:
            data = {
                week_key: week_data
                for week_key, week_data in data.items()
                if (not min_date or getdate(week_data["end_date"]) >= getdate(min_date))
                and (not max_date or getdate(week_data["start_date"]) <= getdate(max_date))
            }
        return data

    hour_detail = get_employee_working_hours(employee)
    res = {**hour_detail}

    if not employee and frappe.session.user == "Administrator":
        res["data"] = generate_week_data(
            start_date, max_week, min_date=min_view_date, max_date=max_view_date
        )
        res["holidays"] = []
        res["leaves"] = []
        from next_pms.timesheet.utils.period_lock import get_active_locks_between

        range_start = min_view_date or add_days(start_date, -max_week * 7)
        range_end = add_days(start_date, max_week * 7)
        res["period_locks"] = get_active_locks_between(range_start, range_end)
        return res

    range_start = min_view_date or add_days(start_date, -max_week * 7)
    range_end = add_days(start_date, max_week * 7)

    holidays = get_holidays(
        employee,
        range_start,
        range_end,
    )

    leaves = get_employee_leaves(
        start_date=range_start,
        end_date=range_end,
        employee=employee,
    )
    res["leaves"] = leaves
    res["holidays"] = holidays
    res["data"] = generate_week_data(
        start_date,
        max_week,
        employee,
        leaves,
        holidays,
        min_date=min_view_date,
        max_date=max_view_date,
    )

    from next_pms.timesheet.utils.period_lock import get_active_locks_between

    res["period_locks"] = get_active_locks_between(range_start, range_end)
    return res


@frappe.whitelist()
@error_logger
def save(
    date: str,
    description: str,
    task: str = None,
    hours: float = 0,
    employee: str = None,
    from_time: str = None,
    to_time: str = None,
    input_mode: str = "duration",
    is_billable: bool | None = None,
    billable_override_reason: str | None = None,
    activity_type: str | None = None,
    force_new: bool = False,
    project: str | None = None,
    name: str | None = None,
):
    """create time entry in Timesheet Detail child table."""
    from next_pms.timesheet.utils.description import is_meaningful_description
    from next_pms.timesheet.utils.settings import is_project_required_on_timesheet

    if not employee:
        employee = get_employee_from_user()
    task = (task or "").strip() or None
    project = (project or "").strip() or None
    activity_type = (activity_type or "").strip() or None
    name = (name or "").strip() or None
    if not activity_type:
        throw(_("Work Type is mandatory for creating time entry."), frappe.MandatoryError)
    if not is_meaningful_description(description):
        throw(_("Remarks are required for creating time entry."), frappe.MandatoryError)
    if is_project_required_on_timesheet() and not task and not project:
        throw(_("Select a project (or a task) for the time entry."), frappe.MandatoryError)
    _assert_week_editable(employee, date)

    with _employee_day_lock(employee, date):
        return _save_time_entry(
            date=date,
            description=description,
            task=task,
            hours=hours,
            employee=employee,
            from_time=from_time,
            to_time=to_time,
            input_mode=input_mode,
            is_billable=is_billable,
            billable_override_reason=billable_override_reason,
            activity_type=activity_type,
            force_new=force_new,
            project=project,
            name=name,
        )


def _save_time_entry(
    date: str,
    description: str,
    task: str | None,
    hours: float,
    employee: str,
    from_time: str | None,
    to_time: str | None,
    input_mode: str,
    is_billable: bool | None,
    billable_override_reason: str | None,
    activity_type: str | None,
    force_new: bool,
    project: str | None,
    name: str | None,
):
    from erpnext.projects.doctype.timesheet.timesheet import OverlapError

    preferred_from = None
    if name:
        preferred_from = frappe.db.get_value("Timesheet Detail", name, "from_time")

    if input_mode == "duration":
        resolved_from, resolved_to, resolved_hours = _resolve_duration_time_slot(
            employee,
            date,
            hours,
            exclude_detail_name=name,
            preferred_from=preferred_from,
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
    timesheet, ignore_permissions, row = _append_time_log(
        employee=employee,
        task=task,
        description=set_input_mode_marker(description, input_mode),
        from_time=resolved_from,
        to_time=resolved_to,
        hours=resolved_hours,
        is_billable=is_billable,
        billable_override_reason=billable_override_reason,
        require_override_reason=is_billable is not None,
        activity_type=activity_type,
        force_new=force_new,
        project=project,
        name=name,
    )
    try:
        timesheet.save(ignore_permissions=ignore_permissions)
    except OverlapError:
        if input_mode != "duration":
            raise
        resolved_from, resolved_to, resolved_hours = _resolve_duration_time_slot(
            employee,
            date,
            hours,
            exclude_detail_name=name or getattr(row, "name", None),
            preferred_from=None,
            draft_mode=True,
        )
        row.from_time = resolved_from
        row.to_time = resolved_to
        row.hours = resolved_hours
        timesheet.save(ignore_permissions=ignore_permissions)
    detail_name = getattr(row, "name", None) or name
    if not detail_name:
        timesheet.reload()
        detail_name = timesheet.time_logs[-1].name if timesheet.time_logs else None
    return {
        "message": _("Timesheet entry saved successfully."),
        "name": detail_name,
        "parent": timesheet.name,
    }


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
def start_timer(
    task: str = None,
    description: str = "",
    employee: str = None,
    activity_type: str = None,
    project: str = None,
):
    """Start one running timer for the employee."""
    from next_pms.timesheet.utils.description import is_meaningful_description
    from next_pms.timesheet.utils.settings import is_project_required_on_timesheet

    if not employee:
        employee = get_employee_from_user()
    task = (task or "").strip() or None
    project = (project or "").strip() or None
    activity_type = (activity_type or "").strip() or None
    if not activity_type:
        throw(_("Work Type is mandatory for starting timer."), frappe.MandatoryError)
    if not is_meaningful_description(description):
        throw(_("Remarks are required for starting timer."), frappe.MandatoryError)
    if task:
        project = frappe.get_value("Task", task, "project") or project
    if is_project_required_on_timesheet() and not project:
        throw(_("Select a project (or a task) before starting the timer."), frappe.MandatoryError)
    _assert_week_editable(employee, nowdate())

    timer_key = _get_running_timer_key(employee)
    if frappe.cache().get_value(timer_key):
        throw(_("A timer is already running. Stop it before starting another one."))

    task_subject = ""
    project_name = frappe.db.get_value("Project", project, "project_name") if project else ""
    if task:
        task_details = frappe.get_value("Task", task, ["subject", "project", "project.project_name"], as_dict=True)
        if not task_details:
            throw(_("Task does not exist."), frappe.DoesNotExistError)
        task_subject = task_details.subject
        project = task_details.project or project
        project_name = task_details.project_name or project_name

    timer = {
        "employee": employee,
        "user": frappe.session.user,
        "task": task,
        "task_subject": task_subject,
        "project": project,
        "project_name": project_name,
        "activity_type": activity_type,
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

    with _employee_day_lock(employee, nowdate()):
        timesheet, ignore_permissions, _row = _append_time_log(
            employee=employee,
            task=timer.get("task"),
            description=timer.get("description"),
            from_time=started_at,
            to_time=stopped_at,
            hours=hours,
            activity_type=timer.get("activity_type"),
            project=timer.get("project"),
            force_new=True,
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
    manager = frappe.db.get_value(
        "Employee",
        reporting_manager,
        ["employee_name", "user_id", "company", "status"],
        as_dict=True,
    )
    employee_company = frappe.db.get_value("Employee", employee, "company")
    if not manager or manager.status != "Active" or not manager.user_id:
        throw(_("The selected Line Manager is not an active system user."))
    if manager.company != employee_company:
        throw(_("The Line Manager must belong to the employee's company."))
    if "Timesheet Approver" not in frappe.get_roles(manager.user_id):
        throw(_("The selected Line Manager must have the Timesheet Approver role."))
    reporting_manager_name = manager.employee_name

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
        frappe.db.set_value(
            "Timesheet",
            timesheet.name,
            {
                "custom_approval_status": "Approval Pending",
                "custom_approval_stage": "Pending Line Manager",
                "custom_timesheet_approver": reporting_manager,
                "custom_line_manager_approved_by": None,
                "custom_hr_approved_by": None,
            },
        )

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
    activity_type: str | None = None,
    project: str | None = None,
):
    parent_doc = frappe.get_doc("Timesheet", parent)
    _assert_week_editable(parent_doc.employee, parent_doc.start_date)
    ignore_permissions = employee_has_higher_access(parent_doc.employee, ptype="write")
    logs_to_remove = []
    new_logs = []
    task = (task or "").strip() or None
    activity_type = (activity_type or "").strip() or None
    project = (project or "").strip() or None
    task_project = frappe.get_value("Task", task, "project") if task else None
    resolved_project = task_project or project
    existing_log = next((log for log in parent_doc.time_logs if name and log.name == name), None)
    if not activity_type and existing_log:
        activity_type = (existing_log.activity_type or "").strip() or None
    if not resolved_project and existing_log:
        resolved_project = (existing_log.project or "").strip() or None
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
            "project": resolved_project,
        }
        if activity_type:
            payload["activity_type"] = activity_type
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
        if resolved_project:
            log.project = resolved_project
        if activity_type:
            log.activity_type = activity_type
        if is_billable is not None:
            resolved_billable, override_reason, _default = resolve_entry_billable(
                task,
                is_billable,
                billable_override_reason,
                require_override_reason=True,
                project=resolved_project,
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
                "project": resolved_project,
            }
            if activity_type:
                log["activity_type"] = activity_type
            if is_billable is not None:
                resolved_billable, override_reason, _default = resolve_entry_billable(
                    task,
                    is_billable,
                    billable_override_reason,
                    require_override_reason=True,
                    project=resolved_project,
                )
                log["is_billable"] = resolved_billable
                log["custom_billable_override_reason"] = override_reason
            else:
                default_billable, _billable_default, _override_reason = resolve_entry_billable(
                    task, project=resolved_project
                )
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
    from next_pms.timesheet.utils.constant import ALLOWED_TIMESHET_DETAIL_FIELDS, activity_row_key

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

    Logs without a Task but with an Activity Type (Admin, Dev, …) are returned under
    synthetic keys ``activity::<Activity Type>::<Project>`` so the Next PMS grid can
    show one row per work type + project combination.
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
    ) if task_ids else []
    task_details_dict = {task["name"]: task for task in task_details}

    def _append_log_to_row(row_key: str, row_meta: dict, log, project_for_desc: str | None, task_for_billable: str | None):
        nonlocal total_hours
        total_hours += log.hours
        if row_key not in data:
            data[row_key] = {**row_meta, "data": []}

        log_data = {field: log.get(field) for field in ALLOWED_TIMESHET_DETAIL_FIELDS}
        marked_input_mode = get_input_mode_from_description(log.description)
        log_data["input_mode"] = marked_input_mode or "range"
        log_data["description"] = strip_input_mode_marker(log.description)
        # Keep task empty for activity-only rows so the UI does not treat the synthetic key as a Task ID
        if row_meta.get("is_activity_row"):
            log_data["task"] = ""
            log_data["activity_type"] = row_meta.get("activity_type") or log.get("activity_type")
        enrich_log_billable_fields(log_data, task_for_billable)
        enrich_log_description_fields(log_data, project_for_desc)
        from next_pms.timesheet.utils.rejection import enrich_entry_rejection_fields

        enrich_entry_rejection_fields(log_data)
        from next_pms.timesheet.utils.period_lock import enrich_entry_period_lock_fields

        enrich_entry_period_lock_fields(log_data, locks)
        data[row_key]["data"].append(log_data)

    for log in timesheet_logs:
        if log.task:
            task = task_details_dict.get(log.task)
            if not task:
                # Orphan task reference — still count hours under activity if present
                activity = (log.activity_type or "").strip()
                if activity:
                    project = log.project or ""
                    row_key = activity_row_key(activity, project)
                    _append_log_to_row(
                        row_key,
                        {
                            "name": row_key,
                            "subject": activity,
                            "data": [],
                            "is_billable": 0,
                            "project_default_is_billable": 0,
                            "description_required": False,
                            "show_description_in_approval": False,
                            "include_description_on_invoice": False,
                            "project_name": frappe.db.get_value("Project", project, "project_name") if project else None,
                            "project": project,
                            "expected_time": 0,
                            "actual_time": 0,
                            "status": "Open",
                            "_liked_by": None,
                            "is_activity_row": True,
                            "activity_type": activity,
                        },
                        log,
                        project or None,
                        None,
                    )
                else:
                    total_hours += log.hours
                continue

            task_name = task["name"]
            project_default = get_project_default_is_billable(task["project"])
            description_settings = get_project_description_settings(task["project"])
            _append_log_to_row(
                task_name,
                {
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
                    "is_activity_row": False,
                    "activity_type": log.activity_type,
                },
                log,
                task.get("project"),
                task_name,
            )
            continue

        # No task — group by activity type + project (Admin, Dev, …)
        activity = (log.activity_type or "").strip()
        if not activity:
            total_hours += log.hours
            continue

        project = log.project or ""
        row_key = activity_row_key(activity, project)
        project_default = get_project_default_is_billable(project) if project else 0
        description_settings = get_project_description_settings(project) if project else {
            "required": False,
            "show_in_approval": False,
            "include_on_invoice": False,
        }
        _append_log_to_row(
            row_key,
            {
                "name": row_key,
                "subject": activity,
                "data": [],
                "is_billable": project_default,
                "project_default_is_billable": project_default,
                "description_required": description_settings["required"],
                "show_description_in_approval": description_settings["show_in_approval"],
                "include_description_on_invoice": description_settings["include_on_invoice"],
                "project_name": frappe.db.get_value("Project", project, "project_name") if project else None,
                "project": project,
                "expected_time": 0,
                "actual_time": 0,
                "status": "Open",
                "_liked_by": None,
                "is_activity_row": True,
                "activity_type": activity,
            },
            log,
            project or None,
            None,
        )

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


def _get_logged_hours_for_day(employee: str, date) -> float:
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
    total_hours = 0.0
    for timesheet_name in timesheets:
        doc = frappe.get_doc("Timesheet", timesheet_name)
        for log in doc.time_logs:
            if log.from_time and getdate(log.from_time) == day:
                total_hours += flt(log.hours)
    return total_hours


@frappe.whitelist()
@validate_current_employee(ptype="write")
def get_remaining_hour_for_employee(employee: str, date: str):
    """Return remaining working hours for the given employee on the given date."""
    date = getdate(date)
    daily_norm = flt(get_employee_daily_working_norm(employee))

    holidays = get_holidays(employee, date, date)
    holiday = next((item for item in holidays if getdate(item.holiday_date) == date), None)
    if holiday and holiday.get("weekly_off"):
        return flt(0 - _get_logged_hours_for_day(employee, date), 2)

    total_hours = _get_logged_hours_for_day(employee, date)

    leaves = get_employee_leaves(
        start_date=add_days(date, -4 * 7),
        end_date=add_days(date, 4 * 7),
        employee=employee,
    )
    data = [leave for leave in leaves if leave.get("from_date") <= date <= leave.get("to_date")]

    if data:
        for d in data:
            if d.get("half_day") and d.get("half_day_date") == date:
                total_hours += daily_norm / 2
            else:
                total_hours += daily_norm
    return flt(daily_norm - total_hours, 2)


@frappe.whitelist()
@validate_current_employee(ptype="read")
def get_timesheet_details(
    date: str,
    task: str = None,
    employee: str = None,
    activity_type: str = None,
    project: str = None,
):
    from next_pms.timesheet.utils.constant import ACTIVITY_ROW_PREFIX, parse_activity_row_key

    task = (task or "").strip()
    activity_type = (activity_type or "").strip() or None
    # Only filter by project when the client explicitly sent it (new UI).
    # Older builds omit the arg — do not treat that as "no project" or the dialog goes empty.
    filter_by_project = "project" in (frappe.form_dict or {})
    if filter_by_project:
        project = (frappe.form_dict.get("project") or "").strip()
    else:
        project = (project or "").strip() if project is not None else None
        filter_by_project = project is not None

    if task.startswith(ACTIVITY_ROW_PREFIX):
        parsed_activity, parsed_project = parse_activity_row_key(task)
        activity_type = activity_type or parsed_activity
        # Keys look like activity::<type>::<project>; empty project segment is still explicit.
        rest = task[len(ACTIVITY_ROW_PREFIX) :]
        if "::" in rest and not filter_by_project:
            filter_by_project = True
            project = parsed_project or ""
        task = ""

    logs = frappe.get_list(
        "Timesheet",
        fields=[
            "time_logs.name",
            "time_logs.hours",
            "time_logs.description",
            "time_logs.task",
            "time_logs.activity_type",
            "time_logs.project",
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

    if task:
        logs = [log for log in logs if log.get("task") == task]
        task_project = frappe.get_value("Task", task, ["subject", "project.project_name", "project"], as_dict=True)
        project_default = get_project_default_is_billable(task_project.project if task_project else None)
        description_settings = get_project_description_settings(task_project.project if task_project else None)
        title = task_project.subject if task_project else task
        project_name = task_project.project_name if task_project else ""
        project_id = task_project.project if task_project else None
        is_activity_row = False
    else:
        # Activity-only rows (Admin / Dev / …) — no Task on the time log.
        logs = [
            log
            for log in logs
            if not log.get("task")
            and (log.get("activity_type") or "").strip() == (activity_type or "")
        ]
        if filter_by_project:
            project_key = project or ""
            logs = [log for log in logs if (log.get("project") or "") == project_key]
            project_id = project or None
        else:
            project_id = next((log.get("project") for log in logs if log.get("project")), None)
        project_name = frappe.db.get_value("Project", project_id, "project_name") if project_id else ""
        project_default = get_project_default_is_billable(project_id)
        description_settings = get_project_description_settings(project_id)
        title = activity_type or "Work type"
        is_activity_row = True

    for log in logs:
        marked_input_mode = get_input_mode_from_description(log.get("description"))
        log["input_mode"] = marked_input_mode or "range"
        log["description"] = strip_input_mode_marker(log.get("description"))
        enrich_log_billable_fields(log, task or None)
        enrich_log_description_fields(log, project_id)
        log["billable_override_reason"] = log.pop("custom_billable_override_reason", None)
        if is_activity_row:
            log["task"] = ""
            log["activity_type"] = activity_type
            log["project"] = log.get("project") or project_id or ""

    return {
        "task": title,
        "project": project_name or "",
        "project_id": project_id or "",
        "project_default_is_billable": project_default,
        "description_required": description_settings["required"],
        "show_description_in_approval": description_settings["show_in_approval"],
        "include_description_on_invoice": description_settings["include_on_invoice"],
        "is_activity_row": is_activity_row,
        "activity_type": activity_type,
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

    Each entry supports: date, description, task, hours, employee, from_time,
    to_time, input_mode, activity_type.
    """
    if isinstance(timesheet_entries, str):
        timesheet_entries = frappe.parse_json(timesheet_entries)
    if not isinstance(timesheet_entries, list):
        throw(_("Input must be a list of timesheet entries."), frappe.ValidationError)

    for entry in timesheet_entries:
        save(
            date=entry.get("date"),
            description=entry.get("description") or "-",
            task=entry.get("task"),
            hours=entry.get("hours", 0),
            employee=entry.get("employee"),
            from_time=entry.get("from_time"),
            to_time=entry.get("to_time"),
            input_mode=entry.get("input_mode") or "duration",
            activity_type=entry.get("activity_type"),
            is_billable=entry.get("is_billable"),
            billable_override_reason=entry.get("billable_override_reason"),
            project=entry.get("project"),
        )

    return _("Event Timesheet created successfully.")


GRID_ACTIVITY_TYPES = [
    "Meeting",
    "Admin",
    "Bug",
    "Development",
    "Issue",
    "Research",
    "Support",
    "Training",
]


def _ensure_grid_activity_types():
    for name in GRID_ACTIVITY_TYPES:
        if frappe.db.exists("Activity Type", name):
            continue
        frappe.get_doc({"doctype": "Activity Type", "activity_type": name}).insert(
            ignore_permissions=True
        )


@frappe.whitelist()
@error_logger
def get_timesheet_grid_meta():
    """Options for the spreadsheet-style timesheet grid."""
    _ensure_grid_activity_types()
    db_types = frappe.get_all("Activity Type", pluck="name", order_by="name asc")
    activity_types = list(dict.fromkeys([*GRID_ACTIVITY_TYPES, *db_types]))
    return {"activity_types": activity_types, "row_count": 15}


def _format_grid_row_error(exc: Exception, entry: dict, row: int) -> str:
    """Return a plain-language row error for the timesheet grid UI."""
    raw = strip_html_tags(str(exc)).strip()
    task_id = entry.get("task")
    task_label = frappe.db.get_value("Task", task_id, "subject") if task_id else None
    task_label = task_label or task_id or _("the selected task")
    entry_date = getdate(entry.get("date")) if entry.get("date") else None
    date_label = formatdate(entry_date) if entry_date else _("the selected date")
    project = frappe.db.get_value("Task", task_id, "project") if task_id else None
    project_label = frappe.db.get_value("Project", project, "project_name") if project else project
    project_end = (
        frappe.db.get_value("Project", project, "expected_end_date") if project else None
    )
    lower = raw.lower()

    if "expected end date" in lower and "cannot be after" in lower:
        project_hint = (
            _(' Project "{0}" ends on {1}.').format(project_label, formatdate(project_end))
            if project_label and project_end
            else ""
        )
        return _(
            'Row {0}: You cannot log time on {1} for "{2}". That date is after the project end date.{3} Use an earlier date or ask your project manager to extend the project.'
        ).format(row, date_label, task_label, project_hint)

    if "expected start date" in lower and "cannot be after" in lower:
        return _(
            'Row {0}: The date {1} for "{2}" is outside the project schedule. Check the task and project dates, then try again.'
        ).format(row, date_label, task_label)

    if "period lock" in lower or "locked" in lower:
        return _("Row {0}: This date is locked for timesheet entry. {1}").format(row, raw)

    return _("Row {0}: Could not save this row. {1}").format(row, raw)


@frappe.whitelist()
@error_logger
def bulk_save_grid(timesheet_entries: list):
    """Save grid rows; returns per-row errors without stopping the whole batch."""
    if isinstance(timesheet_entries, str):
        timesheet_entries = frappe.parse_json(timesheet_entries)
    if not isinstance(timesheet_entries, list):
        throw(_("Input must be a list of timesheet entries."), frappe.ValidationError)

    created = 0
    errors = []
    saved_dates = []
    for idx, entry in enumerate(timesheet_entries, start=1):
        if isinstance(entry, str):
            entry = frappe.parse_json(entry)
        if not entry or not entry.get("date"):
            continue
        if not entry.get("task") and not entry.get("project"):
            continue
        try:
            save(
                date=entry.get("date"),
                description=entry.get("description") or entry.get("remarks") or "",
                task=entry.get("task"),
                hours=entry.get("hours", 0),
                employee=entry.get("employee"),
                from_time=entry.get("from_time"),
                to_time=entry.get("to_time"),
                input_mode=entry.get("input_mode") or ("range" if entry.get("from_time") and entry.get("to_time") else "duration"),
                activity_type=entry.get("activity_type") or entry.get("type"),
                is_billable=entry.get("is_billable"),
                billable_override_reason=entry.get("billable_override_reason"),
                force_new=True,
                project=entry.get("project"),
            )
            created += 1
            if entry.get("date"):
                saved_dates.append(entry.get("date"))
        except Exception as exc:
            errors.append({"row": idx, "message": _format_grid_row_error(exc, entry, idx)})

    if created == 0 and errors:
        throw(errors[0]["message"])

    summary = _("{0} time entry row(s) saved.").format(created)
    if errors:
        summary = _("{0} row(s) saved, {1} row(s) failed.").format(created, len(errors))

    return {
        "created": created,
        "errors": errors,
        "saved_dates": list(dict.fromkeys(saved_dates)),
        "message": summary,
    }


def repair_duplicate_timesheets(employee: str) -> dict:
    """Remove exact-clone Timesheet parents and re-pack overlapping duration slots.

    Used to unblock an employee after a double-save race created two documents
    with the same from/to times.
    """
    rows = frappe.get_all(
        "Timesheet",
        filters={"employee": employee, "docstatus": 0},
        fields=["name", "start_date", "parent_project", "creation"],
        order_by="creation asc",
        limit_page_length=0,
    )
    deleted = []
    from collections import defaultdict

    groups = defaultdict(list)
    for row in rows:
        groups[(str(row.start_date), row.parent_project or "")].append(row)

    def _fingerprint(log, include_times=True):
        base = (
            round(flt(log.hours), 4),
            (strip_input_mode_marker(log.description) or "").strip(),
            (log.activity_type or "").strip(),
            (log.project or "").strip(),
            (log.task or "").strip(),
        )
        if not include_times:
            return base
        return (
            str(get_datetime(log.from_time)),
            str(get_datetime(log.to_time)),
            *base,
        )

    for _key, docs in groups.items():
        if len(docs) < 2:
            continue
        loaded = [frappe.get_doc("Timesheet", row.name) for row in docs]
        loaded.sort(key=lambda doc: (-len(doc.time_logs), -flt(doc.total_hours), str(doc.creation)))
        keep = loaded[0]
        seen = {_fingerprint(log) for log in keep.time_logs}
        seen_notime = {_fingerprint(log, include_times=False) for log in keep.time_logs}
        for extra in loaded[1:]:
            extra_prints = [_fingerprint(log) for log in extra.time_logs]
            extra_notime = [_fingerprint(log, include_times=False) for log in extra.time_logs]
            created_gap = abs(
                time_diff_in_seconds(get_datetime(extra.creation), get_datetime(keep.creation))
            )
            is_exact = extra_prints and all(fp in seen for fp in extra_prints)
            is_near_duplicate = (
                created_gap <= 5
                and extra_notime
                and all(fp in seen_notime for fp in extra_notime)
            )
            if is_exact or is_near_duplicate:
                extra.delete(ignore_permissions=True)
                deleted.append(extra.name)

    packed_days = _repack_overlapping_duration_days(employee)
    from next_pms.timesheet.doc_events.timesheet import flush_cache

    for day in {str(row.start_date) for row in rows if row.start_date}:
        flush_cache(frappe._dict({"employee": employee, "start_date": day}))
    frappe.db.commit()
    return {"deleted": deleted, "packed_days": packed_days}


def _repack_overlapping_duration_days(employee: str) -> list[str]:
    """Shift duration-mode logs on a day so they no longer overlap across parents."""
    from collections import defaultdict

    parent_names = frappe.get_all(
        "Timesheet",
        filters={"employee": employee, "docstatus": 0},
        pluck="name",
        limit_page_length=0,
    )
    if not parent_names:
        return []

    details = frappe.get_all(
        "Timesheet Detail",
        filters={"parenttype": "Timesheet", "parent": ["in", parent_names]},
        fields=["name", "parent", "from_time", "to_time", "hours", "description", "creation"],
        order_by="creation asc",
        limit_page_length=0,
    )
    parent_set = set(parent_names)
    by_day = defaultdict(list)

    for row in details:
        if row.parent not in parent_set:
            continue
        by_day[str(getdate(row.from_time))].append(row)

    packed = []
    for day, logs in by_day.items():
        intervals = []
        for log in logs:
            start, end = _get_effective_log_interval(log)
            if start and end and end > start:
                intervals.append((start, end, log))
        if not _day_has_overlap(intervals):
            continue
        cursor = get_datetime(getdate(day)).replace(hour=0, minute=0, second=0, microsecond=0)
        parents_to_save = {}
        for _start, _end, log in sorted(intervals, key=lambda item: item[2].creation or item[0]):
            duration = timedelta(hours=float(log.hours or 0))
            if duration.total_seconds() <= 0:
                continue
            parent = parents_to_save.get(log.parent) or frappe.get_doc("Timesheet", log.parent)
            parents_to_save[log.parent] = parent
            child = next((row for row in parent.time_logs if row.name == log.name), None)
            if not child:
                continue
            child.from_time = cursor
            child.to_time = cursor + duration
            cursor = child.to_time
        for parent in parents_to_save.values():
            parent.flags.skip_overlap_validation = True
            parent.flags.skip_submission_validation = True
            parent.save(ignore_permissions=True)
        packed.append(day)
    return packed


def _day_has_overlap(intervals) -> bool:
    ordered = sorted(intervals, key=lambda item: item[0])
    last_end = None
    for start, end, _log in ordered:
        if last_end and start < last_end:
            return True
        last_end = end if last_end is None else max(last_end, end)
    return False
