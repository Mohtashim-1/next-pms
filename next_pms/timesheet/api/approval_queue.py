import json

import frappe
from frappe import _, throw
from frappe.utils import escape_html, flt, get_datetime, get_first_day_of_week, get_last_day_of_week, getdate, today

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

PENDING_QUEUE_STATUSES = {
    "Approval Pending",
    "Pending HR Approval",
    "Partially Approved",
    "Processing Timesheet",
}
ENTRY_PENDING_STATUSES = {"", None, "Pending"}


def _assert_approver():
    frappe.only_for(["Timesheet Approver", "HR Manager", "HR User"], message=True)


def _session_employee():
    return frappe.db.get_value(
        "Employee",
        {"user_id": frappe.session.user, "status": "Active"},
        ["name", "company"],
        as_dict=True,
    )


def _assert_can_act(doc):
    """Enforce selected line manager first, then same-company HR."""
    actor = _session_employee()
    if not actor:
        throw(_("Your user is not linked to an active Employee."))
    employee_company = frappe.db.get_value("Employee", doc.employee, "company")
    if actor.company != employee_company:
        throw(_("You can only approve timesheets for your own company."))

    stage = doc.get("custom_approval_stage") or "Pending Line Manager"
    if stage not in {"Pending Line Manager", "Pending HR"}:
        # Legacy sheets without stage still behave as line-manager pending.
        if (doc.get("custom_approval_status") or "") == "Pending HR Approval":
            stage = "Pending HR"
        else:
            stage = "Pending Line Manager"

    roles = set(frappe.get_roles())
    if stage == "Pending HR":
        if not roles.intersection({"HR Manager", "HR User"}):
            throw(_("This timesheet is awaiting HR approval."))
    else:
        if "Timesheet Approver" not in roles:
            throw(_("Only a Timesheet Approver can complete Line Manager approval."))
        assigned = doc.get("custom_timesheet_approver")
        # Enforce the selected Line Manager when one was saved on submit.
        if assigned and assigned != actor.name:
            throw(_("This timesheet is assigned to another Line Manager."))
    return stage


def _notify_company_hr(doc, notes: str | None = None):
	"""Notify same-company HR after Line Manager approval (settings-driven)."""
	from next_pms.timesheet.tasks.hr_approval_reminder import notify_hr_for_approval

	notify_hr_for_approval(doc.name, notes=notes)


def _get_week_bounds(week_start: str | None = None):
    anchor = getdate(week_start) if week_start else getdate(today())
    week_start = get_first_day_of_week(anchor)
    week_end = get_last_day_of_week(week_start)
    return week_start, week_end


def _get_date_bounds(week_start: str | None = None, from_date: str | None = None, to_date: str | None = None):
    """An explicit from/to range wins; otherwise fall back to the anchored week."""
    if from_date and to_date:
        start, end = getdate(from_date), getdate(to_date)
        if start > end:
            start, end = end, start
        return start, end
    if from_date or to_date:
        anchor = from_date or to_date
        return _get_week_bounds(anchor)
    return _get_week_bounds(week_start)


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
    user_group: list | str | None = None,
    department: list | str | None = None,
):
    project = _parse_json_list(project)
    employees, _count = filter_employees(
        employee_name=employee_name,
        project=project,
        reports_to=reports_to,
        user_group=_parse_json_list(user_group),
        department=_parse_json_list(department),
        page_length=0,
        start=0,
        ids=[employee] if employee else None,
    )
    return employees


def _entry_status(log) -> str:
    status = log.get("custom_entry_approval_status") or "Pending"
    return status


def _entry_is_queue_pending(log, stage: str | None = None) -> bool:
    if entry_is_rejected_draft(log):
        return False
    if stage == "Pending HR":
        return _entry_status(log) == "Approved"
    return _entry_status(log) in ENTRY_PENDING_STATUSES or _entry_status(log) == "Pending"


def _build_entry_row(log, task_meta: dict):
    task = task_meta.get(log.task, {})
    description = strip_description_content(strip_input_mode_marker(log.description))
    activity_type = (log.get("activity_type") or "").strip()
    project_name = task.get("project_name")
    if not project_name and log.project:
        project_name = frappe.db.get_value("Project", log.project, "project_name", cache=True)
    return {
        "name": log.name,
        "parent": log.parent,
        "task": log.task,
        "task_subject": task.get("subject") or activity_type or log.task,
        "activity_type": activity_type,
        "project": log.project,
        "project_name": project_name,
        "date": str(getdate(log.from_time)),
        "from_time": str(log.from_time) if log.from_time else None,
        "to_time": str(log.to_time) if log.to_time else None,
        "hours": flt(log.hours, 2),
        "description": description,
        "is_billable": log.is_billable,
        "entry_status": _entry_status(log),
        "rejection_comment": log.get("custom_rejection_comment"),
    }


def _annotate_overlaps(items: list, range_start, range_end):
    """Mark queued entries that overlap any non-cancelled entry for the same employee."""
    queued_entries = {}
    employee_ids = []
    for item in items:
        employee_ids.append(item["employee"])
        for timesheet in item["timesheets"]:
            for entry in timesheet["entries"]:
                entry["has_overlap"] = False
                entry["overlaps_with"] = []
                queued_entries[entry["name"]] = entry

    if not queued_entries or not employee_ids:
        return

    placeholders = ", ".join(["%s"] * len(employee_ids))
    rows = frappe.db.sql(
        f"""
        SELECT
            detail.name,
            detail.parent,
            detail.from_time,
            detail.to_time,
            detail.task,
            detail.activity_type,
            sheet.employee
        FROM `tabTimesheet Detail` detail
        INNER JOIN `tabTimesheet` sheet ON sheet.name = detail.parent
        WHERE sheet.employee IN ({placeholders})
          AND sheet.docstatus != 2
          AND detail.from_time < %s
          AND detail.to_time > %s
        ORDER BY sheet.employee, detail.from_time, detail.to_time
        """,
        [*employee_ids, get_datetime(f"{range_end} 23:59:59"), get_datetime(f"{range_start} 00:00:00")],
        as_dict=True,
    )

    by_employee = {}
    for row in rows:
        if not row.from_time or not row.to_time:
            continue
        by_employee.setdefault(row.employee, []).append(row)

    for employee_rows in by_employee.values():
        for index, left in enumerate(employee_rows):
            left_end = get_datetime(left.to_time)
            for right in employee_rows[index + 1 :]:
                right_start = get_datetime(right.from_time)
                if right_start >= left_end:
                    break
                if left.name == right.name or get_datetime(right.to_time) <= get_datetime(left.from_time):
                    continue
                for source, conflict in ((left, right), (right, left)):
                    queued = queued_entries.get(source.name)
                    if not queued:
                        continue
                    queued["has_overlap"] = True
                    queued["overlaps_with"].append(
                        {
                            "name": conflict.name,
                            "parent": conflict.parent,
                            "label": conflict.task or conflict.activity_type or _("Time entry"),
                            "from_time": str(conflict.from_time),
                            "to_time": str(conflict.to_time),
                        }
                    )


def _get_overlap_conflicts(log, employee: str):
    if not log.from_time or not log.to_time:
        return []
    return frappe.db.sql(
        """
        SELECT detail.name
        FROM `tabTimesheet Detail` detail
        INNER JOIN `tabTimesheet` sheet ON sheet.name = detail.parent
        WHERE sheet.employee = %(employee)s
          AND sheet.docstatus != 2
          AND detail.name != %(name)s
          AND detail.from_time < %(to_time)s
          AND detail.to_time > %(from_time)s
        LIMIT 1
        """,
        {
            "employee": employee,
            "name": log.name,
            "from_time": log.from_time,
            "to_time": log.to_time,
        },
        as_dict=True,
    )


def _assert_entry_has_no_overlap(log, employee: str):
    if _get_overlap_conflicts(log, employee):
        throw(
            _("This entry overlaps another time entry. Correct the time range before approving it."),
            frappe.ValidationError,
        )


def _timesheet_entries(
    timesheet_name: str,
    project_filter: list | None = None,
    range_start=None,
    range_end=None,
):
    doc = frappe.get_doc("Timesheet", timesheet_name)
    stage = doc.get("custom_approval_stage") or "Pending Line Manager"
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
        if not _entry_is_queue_pending(log, stage):
            continue
        log_date = getdate(log.from_time)
        if range_start and log_date < range_start:
            continue
        if range_end and log_date > range_end:
            continue
        entries.append(_build_entry_row(log, task_meta))
    return entries, doc


def _group_queue_items(
    timesheets: list,
    project_filter: list | None = None,
    range_start=None,
    range_end=None,
):
    """One row per employee so a range spanning several weeks stays clubbed together."""
    grouped = {}
    for ts in timesheets:
        key = ts.employee
        if key not in grouped:
            employee_meta = (
                frappe.db.get_value(
                    "Employee",
                    ts.employee,
                    ["image", "designation", "department"],
                    as_dict=True,
                    cache=True,
                )
                or {}
            )
            grouped[key] = {
                "employee": ts.employee,
                "employee_name": ts.employee_name,
                "employee_image": employee_meta.get("image"),
                "designation": employee_meta.get("designation"),
                "department": employee_meta.get("department"),
                "week_start": str(ts.start_date),
                "week_end": str(ts.end_date),
                "weekly_status": ts.custom_weekly_approval_status,
                "statuses": [],
                "total_hours": 0,
                "pending_entry_count": 0,
                "pending_hours": 0,
                "timesheets": [],
            }

        entries, doc = _timesheet_entries(ts.name, project_filter, range_start, range_end)
        if not entries:
            continue

        item = grouped[key]
        item["week_start"] = min(item["week_start"], str(ts.start_date))
        item["week_end"] = max(item["week_end"], str(ts.end_date))
        if ts.custom_weekly_approval_status not in item["statuses"]:
            item["statuses"].append(ts.custom_weekly_approval_status)

        grouped[key]["total_hours"] += flt(ts.total_hours, 2)
        grouped[key]["pending_entry_count"] += len(entries)
        grouped[key]["pending_hours"] += flt(sum(entry["hours"] for entry in entries), 2)
        grouped[key]["timesheets"].append(
            {
                "name": ts.name,
                "date": str(ts.start_date),
                "status": ts.custom_approval_status,
                "total_hours": flt(ts.total_hours, 2),
                "pending_hours": flt(sum(entry["hours"] for entry in entries), 2),
                "entries": entries,
            }
        )

    items = [item for item in grouped.values() if item["pending_entry_count"] > 0]
    for item in items:
        # A single label for the card: HR stage wins when any sheet already cleared the Line Manager.
        statuses = item.pop("statuses", [])
        if "Pending HR Approval" in statuses and len(statuses) == 1:
            item["weekly_status"] = "Pending HR Approval"
        elif statuses:
            item["weekly_status"] = statuses[0] if len(statuses) == 1 else "Approval Pending"
        item["timesheets"].sort(key=lambda row: row["date"])
    items.sort(key=lambda row: row["employee_name"])
    _annotate_overlaps(items, range_start, range_end)
    return items


@frappe.whitelist()
@error_logger
def get_approval_queue_count(
    week_start: str | None = None,
    employee: str | None = None,
    employee_name: str | None = None,
    project: list | str | None = None,
    reports_to: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    user_group: list | str | None = None,
    department: list | str | None = None,
):
    _assert_approver()
    items = get_approval_queue(
        week_start=week_start,
        employee=employee,
        employee_name=employee_name,
        project=project,
        reports_to=reports_to,
        from_date=from_date,
        to_date=to_date,
        user_group=user_group,
        department=department,
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
    from_date: str | None = None,
    to_date: str | None = None,
    user_group: list | str | None = None,
    department: list | str | None = None,
    page_length: int = 20,
    start: int = 0,
):
    _assert_approver()
    week_start, week_end = _get_date_bounds(week_start, from_date, to_date)
    project_filter = _parse_json_list(project)
    employees = _get_scoped_employees(
        employee, employee_name, project_filter, reports_to, user_group=user_group, department=department
    )
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
    # Overlap, not containment, so sheets straddling the range edges are still picked up.
    # Entries outside the range are dropped later in _timesheet_entries.
    timesheets = frappe.get_all(
        "Timesheet",
        filters={
            "employee": ["in", employee_ids],
            "start_date": ["<=", week_end],
            "end_date": [">=", week_start],
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
            "custom_approval_stage",
            "custom_timesheet_approver",
        ],
        order_by="employee_name asc, start_date asc",
    )
    # Do not leak cross-company sheets. Line Managers see only assignments;
    # HR sees only sheets from their Employee company.
    scoped = []
    for row in timesheets:
        try:
            _assert_can_act(frappe._dict(row))
            scoped.append(row)
        except frappe.PermissionError:
            continue
        except frappe.ValidationError:
            continue
    timesheets = scoped

    items = _group_queue_items(timesheets, project_filter or None, week_start, week_end)
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


def _sync_timesheet_from_entries(timesheet_name: str, stage: str):
    from next_pms.timesheet.api.utils import update_weekly_status_of_timesheet

    doc = frappe.get_doc("Timesheet", timesheet_name)
    doc.reload()
    doc.flags.skip_date_window_validation = True
    statuses = [_entry_status(log) for log in doc.time_logs]
    pending = [status for status in statuses if status in ENTRY_PENDING_STATUSES or status == "Pending"]
    has_rejected_drafts = any(entry_is_rejected_draft(log) for log in doc.time_logs)

    if has_rejected_drafts:
        return_timesheet_to_draft(doc)
    elif pending and len(pending) < len(statuses):
        doc.custom_approval_status = "Partially Approved"
    elif all(status == "Approved" for status in statuses):
        if stage == "Pending Line Manager":
            doc.custom_approval_status = "Pending HR Approval"
            doc.custom_weekly_approval_status = "Pending HR Approval"
            doc.custom_approval_stage = "Pending HR"
            doc.custom_line_manager_approved_by = frappe.session.user
            _notify_company_hr(doc)
        else:
            doc.custom_approval_status = "Approved"
            doc.custom_approval_stage = "Approved"
            doc.custom_hr_approved_by = frappe.session.user
            if doc.docstatus == 0:
                doc.save(ignore_permissions=True)
                doc.submit()
                update_weekly_status_of_timesheet(doc.employee, getdate(doc.start_date))
                return
    elif any(status == "Rejected" for status in statuses):
        return_timesheet_to_draft(doc)
    else:
        doc.custom_approval_status = "Approval Pending"

    doc.save(ignore_permissions=True)
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
    stage = _assert_can_act(parent)
    if status == "Approved":
        _assert_entry_has_no_overlap(log, parent.employee)
    if parent.custom_weekly_approval_status not in PENDING_QUEUE_STATUSES and parent.custom_approval_status not in {
        "Approval Pending",
        "Pending HR Approval",
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

    _sync_timesheet_from_entries(parent.name, stage)

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
def update_entry_as_approver(
    name: str,
    from_time: str,
    to_time: str,
    edit_reason: str,
    description: str | None = None,
):
    """Allow the assigned Line Manager or same-company HR to correct a pending entry."""
    _assert_approver()
    edit_reason = (edit_reason or "").strip()
    if not edit_reason:
        throw(_("Please provide a reason for this correction."))

    log = frappe.get_doc("Timesheet Detail", name)
    parent = frappe.get_doc("Timesheet", log.parent)
    _assert_can_act(parent)
    if parent.custom_weekly_approval_status not in PENDING_QUEUE_STATUSES:
        throw(_("This timesheet is no longer awaiting approval."))

    resolved_from = get_datetime(from_time)
    resolved_to = get_datetime(to_time)
    if resolved_to <= resolved_from:
        throw(_("To Time must be later than From Time."))
    if getdate(resolved_from) != getdate(resolved_to):
        throw(_("A time entry must start and end on the same day."))
    if not (getdate(parent.start_date) <= getdate(resolved_from) <= getdate(parent.end_date)):
        throw(_("The corrected date must remain inside this timesheet period."))

    parent_log = next((row for row in parent.time_logs if row.name == name), None)
    if not parent_log:
        throw(_("Time entry not found in its parent timesheet."), frappe.DoesNotExistError)

    before = {
        "from_time": str(parent_log.from_time),
        "to_time": str(parent_log.to_time),
        "hours": flt(parent_log.hours, 2),
        "description": strip_description_content(strip_input_mode_marker(parent_log.description)),
    }
    parent_log.from_time = resolved_from
    parent_log.to_time = resolved_to
    parent_log.hours = flt((resolved_to - resolved_from).total_seconds() / 3600, 2)
    if description is not None:
        parent_log.description = description

    after = {
        "from_time": str(parent_log.from_time),
        "to_time": str(parent_log.to_time),
        "hours": flt(parent_log.hours, 2),
        "description": strip_description_content(strip_input_mode_marker(parent_log.description)),
    }
    changed_fields = [
        [field, before[field], after[field]]
        for field in before
        if before[field] != after[field]
    ]
    if not changed_fields:
        throw(_("No changes were made."))

    # Saving the parent runs the standard Timesheet validations, including overlap validation.
    parent.flags.skip_date_window_validation = True
    parent.save(ignore_permissions=True)

    changed = [
        f"<li><b>{escape_html(field.replace('_', ' ').title())}</b>: "
        f"{escape_html(str(before[field]))} &rarr; {escape_html(str(after[field]))}</li>"
        for field in before
        if before[field] != after[field]
    ]

    parent.add_comment(
        "Info",
        _(
            "<b>Time entry corrected during approval</b><br>"
            "Entry: {0}<br>Reason: {1}<ul>{2}</ul>"
        ).format(escape_html(name), escape_html(edit_reason), "".join(changed)),
    )
    # Timesheet does not enable automatic Track Changes on every site. Create
    # a standard Frappe Version explicitly so the child-row diff remains queryable.
    frappe.get_doc(
        {
            "doctype": "Version",
            "ref_doctype": "Timesheet",
            "docname": parent.name,
            "data": frappe.as_json(
                {
                    "changed": [],
                    "added": [],
                    "removed": [],
                    "row_changed": [["time_logs", parent_log.idx - 1, parent_log.name, changed_fields]],
                    "updater_reference": {
                        "label": _("Approval correction"),
                        "reason": edit_reason,
                    },
                },
                indent=None,
                separators=(",", ":"),
            ),
        }
    ).insert(ignore_permissions=True)

    from next_pms.timesheet.doc_events.timesheet import flush_cache, publish_timesheet_update

    flush_cache(parent)
    publish_timesheet_update(parent.employee, parent.start_date)
    return _("Time entry updated. The correction was added to the audit trail.")


@frappe.whitelist(methods=["POST"])
@error_logger
def approve_or_reject_entries(names: list | str, status: str, note: str = ""):
    """Act on several Timesheet Detail rows in one request, grouped per parent timesheet."""
    _assert_approver()
    require_rejection_comment(status, note)

    if status not in {"Approved", "Rejected"}:
        throw(_("Invalid approval status."))

    names = _parse_json_list(names)
    if not names:
        throw(_("No entries selected."))

    logs = [frappe.get_doc("Timesheet Detail", name) for name in names]
    parents = {}
    for log in logs:
        parents.setdefault(log.parent, []).append(log)

    affected_dates_by_employee = {}
    for parent_name, parent_logs in parents.items():
        parent = frappe.get_doc("Timesheet", parent_name)
        stage = _assert_can_act(parent)
        for log in parent_logs:
            if status == "Approved":
                _assert_entry_has_no_overlap(log, parent.employee)
            if status == "Rejected":
                apply_entry_rejection(log, note)
            else:
                log.custom_entry_approval_status = status
                log.custom_rejection_comment = None
                log.custom_rejected_by = None
                log.custom_rejected_on = None
            log.save(ignore_permissions=True)
            affected_dates_by_employee.setdefault(parent.employee, []).append(str(getdate(log.from_time)))

        _sync_timesheet_from_entries(parent_name, stage)

        from next_pms.timesheet.doc_events.timesheet import flush_cache, publish_timesheet_update

        flush_cache(parent)
        publish_timesheet_update(parent.employee, parent.start_date)

    if status == "Rejected":
        for employee, dates in affected_dates_by_employee.items():
            notify_employee_of_rejection(
                employee=employee,
                dates=sorted(set(dates)),
                note=note.strip(),
            )

    return _("{0} entries {1} successfully.").format(len(logs), status.lower())


@frappe.whitelist(methods=["POST"])
@error_logger
def approve_or_reject_sheet(
    employee: str,
    week_start: str,
    status: str,
    note: str = "",
    project: list | str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
):
    _assert_approver()
    require_rejection_comment(status, note)

    if status not in {"Approved", "Rejected"}:
        throw(_("Invalid approval status."))

    week_start, week_end = _get_date_bounds(week_start, from_date, to_date)
    project_filter = _parse_json_list(project)

    timesheets = frappe.get_all(
        "Timesheet",
        filters={
            "employee": employee,
            "start_date": ["<=", week_end],
            "end_date": [">=", week_start],
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
        stage = _assert_can_act(doc)
        for log in doc.time_logs:
            if project_filter and log.project not in project_filter:
                continue
            if not _entry_is_queue_pending(log, stage):
                continue
            log_date = getdate(log.from_time)
            if log_date < week_start or log_date > week_end:
                continue
            if status == "Approved":
                _assert_entry_has_no_overlap(log, doc.employee)
            if status == "Rejected":
                apply_entry_rejection(log, note)
            else:
                log.custom_entry_approval_status = status
                log.custom_rejection_comment = None
                log.custom_rejected_by = None
                log.custom_rejected_on = None
            log.save(ignore_permissions=True)
            affected_dates.append(str(getdate(log.from_time)))
        _sync_timesheet_from_entries(timesheet_name, stage)

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
