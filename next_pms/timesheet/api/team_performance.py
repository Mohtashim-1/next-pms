"""Team performance dashboard for a lead's direct reports."""

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, nowdate

from next_pms.api.utils import error_logger
from next_pms.timesheet.api.utils import get_week_dates, resolve_week_status

BROAD_TEAM_ROLES = {"System Manager", "Administrator", "Projects Manager", "Timesheet Manager"}
PENDING_STATUSES = {"Approval Pending", "Pending HR Approval", "Partially Approved", "Processing Timesheet"}


def _session_employee() -> str | None:
    return frappe.db.get_value("Employee", {"user_id": frappe.session.user, "status": "Active"}, "name")


def _can_switch_team() -> bool:
    if frappe.session.user == "Administrator":
        return True
    return bool(set(frappe.get_roles()).intersection(BROAD_TEAM_ROLES))


def _can_open_dashboard(session_employee: str | None) -> bool:
    if _can_switch_team():
        return True
    roles = set(frappe.get_roles())
    if "Team Lead" in roles:
        return True
    return bool(session_employee and frappe.db.exists("Employee", {"reports_to": session_employee, "status": "Active"}))


def _team_options() -> list[dict]:
    rows = frappe.db.sql(
        """
        SELECT reports_to AS employee, COUNT(*) AS member_count
        FROM `tabEmployee`
        WHERE status = 'Active' AND IFNULL(reports_to, '') != ''
        GROUP BY reports_to
        """,
        as_dict=True,
    )
    if not rows:
        return []
    leaders = frappe.get_all(
        "Employee",
        filters={"name": ["in", [row.employee for row in rows if row.employee]]},
        fields=["name", "employee_name", "department"],
        limit_page_length=0,
    )
    counts = {row.employee: int(row.member_count or 0) for row in rows}
    options = []
    for leader in leaders:
        options.append(
            {
                "employee": leader.name,
                "employee_name": leader.employee_name,
                "department": leader.department or "",
                "member_count": counts.get(leader.name, 0),
            }
        )
    options.sort(key=lambda item: (item["employee_name"] or "").lower())
    return options


def _daily_norm(employee: dict, standard_hours: float) -> float:
    hours = flt(employee.get("custom_working_hours")) or standard_hours or 8
    if (employee.get("custom_work_schedule") or "Per Day") != "Per Day":
        return flt(hours / 5, 2)
    return flt(hours, 2)


def _resolve_dates(start_date: str | None, end_date: str | None, date: str | None) -> list[str]:
    if start_date and end_date:
        start = getdate(start_date)
        end = getdate(end_date)
    else:
        week = get_week_dates(date=date or nowdate())
        start = getdate(week.get("start_date"))
        end = getdate(week.get("end_date"))
    if end < start:
        start, end = end, start
    if (end - start).days > 92:
        frappe.throw(_("Choose a date range of 92 days or less."))
    dates = []
    cursor = start
    while cursor <= end:
        dates.append(str(cursor))
        cursor = add_days(cursor, 1)
    return dates


def _assert_team_access(manager: str, session_employee: str | None):
    if _can_switch_team():
        return
    if manager and manager == session_employee:
        return
    frappe.throw(_("You can only review your own team."), frappe.PermissionError)


@frappe.whitelist()
@error_logger
def get_team_performance(
    date: str | None = None,
    reports_to: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
):
    """Performance for one lead's direct reports over a date range.

    Team Leads are limited to their own team. System Managers, Project Managers,
    and Timesheet Managers can switch the team.
    """
    session_employee = _session_employee()
    if not _can_open_dashboard(session_employee):
        frappe.throw(_("You do not have permission to view team performance."), frappe.PermissionError)

    can_switch = _can_switch_team()
    teams = _team_options() if can_switch else []
    requested = (reports_to or "").strip() or None
    manager_id = requested
    if not manager_id and session_employee and frappe.db.exists(
        "Employee", {"reports_to": session_employee, "status": "Active"}
    ):
        manager_id = session_employee
    if not manager_id and teams:
        manager_id = teams[0]["employee"]

    dates = _resolve_dates(start_date, end_date, date)
    span = len(dates)
    labels = [getdate(day).strftime("%a %d" if span <= 16 else "%d %b") for day in dates]
    weekday_flags = [getdate(day).weekday() < 5 for day in dates]
    range_label = (
        f"{getdate(dates[0]).strftime('%d %b %Y')} – {getdate(dates[-1]).strftime('%d %b %Y')}" if dates else ""
    )

    if not manager_id:
        return {
            "can_switch_team": can_switch,
            "teams": teams,
            "team": None,
            "week_label": range_label,
            "range_label": range_label,
            "dates": dates,
            "labels": labels,
            "kpis": {},
            "daily": [],
            "projects": [],
            "activities": [],
            "status_breakdown": [],
            "members": [],
            "message": _("No team is linked to your employee record."),
        }

    _assert_team_access(manager_id, session_employee)
    manager = frappe.db.get_value(
        "Employee",
        manager_id,
        ["name", "employee_name", "department", "designation"],
        as_dict=True,
    )
    if not manager:
        frappe.throw(_("Team lead {0} was not found.").format(manager_id), frappe.DoesNotExistError)

    members = frappe.get_all(
        "Employee",
        filters={"reports_to": manager_id, "status": "Active"},
        fields=[
            "name",
            "employee_name",
            "department",
            "designation",
            "image",
            "custom_working_hours",
            "custom_work_schedule",
        ],
        order_by="employee_name asc",
        limit_page_length=0,
    )
    standard_hours = flt(frappe.db.get_single_value("HR Settings", "standard_working_hours")) or 8
    employee_names = [member.name for member in members]
    logged = {name: [0.0] * len(dates) for name in employee_names}
    billable = {name: [0.0] * len(dates) for name in employee_names}
    statuses: dict[str, list[str]] = {name: [] for name in employee_names}
    top_project: dict[str, tuple[float, str]] = {}
    projects: list[dict] = []
    activities: list[dict] = []

    if employee_names and dates:
        hour_rows = frappe.db.sql(
            """
            SELECT
                t.employee AS employee,
                DATE(td.from_time) AS log_date,
                SUM(IFNULL(td.hours, 0)) AS hours,
                SUM(CASE WHEN IFNULL(td.is_billable, 0) = 1 THEN IFNULL(td.hours, 0) ELSE 0 END) AS billable
            FROM `tabTimesheet Detail` td
            INNER JOIN `tabTimesheet` t ON t.name = td.parent
            WHERE t.docstatus < 2
              AND t.employee IN %(employees)s
              AND DATE(td.from_time) BETWEEN %(start)s AND %(end)s
            GROUP BY t.employee, DATE(td.from_time)
            """,
            {"employees": employee_names, "start": dates[0], "end": dates[-1]},
            as_dict=True,
        )
        date_index = {day: index for index, day in enumerate(dates)}
        for row in hour_rows:
            index = date_index.get(str(getdate(row.log_date)))
            if index is None or row.employee not in logged:
                continue
            logged[row.employee][index] += flt(row.hours)
            billable[row.employee][index] += flt(row.billable)

        sheets = frappe.get_all(
            "Timesheet",
            filters={
                "employee": ["in", employee_names],
                "start_date": [">=", getdate(dates[0])],
                "end_date": ["<=", getdate(dates[-1])],
                "docstatus": ["!=", 2],
            },
            fields=["employee", "custom_weekly_approval_status"],
            limit_page_length=0,
        )
        for sheet in sheets:
            if sheet.employee in statuses and sheet.custom_weekly_approval_status:
                statuses[sheet.employee].append(sheet.custom_weekly_approval_status)

        project_rows = frappe.db.sql(
            """
            SELECT
                t.employee AS employee,
                IFNULL(NULLIF(td.project_name, ''), IFNULL(NULLIF(td.project, ''), 'No project')) AS project,
                SUM(IFNULL(td.hours, 0)) AS hours,
                SUM(CASE WHEN IFNULL(td.is_billable, 0) = 1 THEN IFNULL(td.hours, 0) ELSE 0 END) AS billable
            FROM `tabTimesheet Detail` td
            INNER JOIN `tabTimesheet` t ON t.name = td.parent
            WHERE t.docstatus < 2
              AND t.employee IN %(employees)s
              AND DATE(td.from_time) BETWEEN %(start)s AND %(end)s
            GROUP BY t.employee, project
            """,
            {"employees": employee_names, "start": dates[0], "end": dates[-1]},
            as_dict=True,
        )
        project_totals: dict[str, dict] = {}
        for row in project_rows:
            hours = flt(row.hours)
            bucket = project_totals.setdefault(row.project, {"project": row.project, "hours": 0.0, "billable": 0.0})
            bucket["hours"] += hours
            bucket["billable"] += flt(row.billable)
            current = top_project.get(row.employee)
            if not current or hours > current[0]:
                top_project[row.employee] = (hours, row.project)
        projects = sorted(project_totals.values(), key=lambda item: item["hours"], reverse=True)[:10]
        for project in projects:
            project["hours"] = round(project["hours"], 2)
            project["billable"] = round(project["billable"], 2)

        activity_rows = frappe.db.sql(
            """
            SELECT
                IFNULL(NULLIF(td.activity_type, ''), 'Unspecified') AS activity_type,
                SUM(IFNULL(td.hours, 0)) AS hours
            FROM `tabTimesheet Detail` td
            INNER JOIN `tabTimesheet` t ON t.name = td.parent
            WHERE t.docstatus < 2
              AND t.employee IN %(employees)s
              AND DATE(td.from_time) BETWEEN %(start)s AND %(end)s
            GROUP BY activity_type
            ORDER BY hours DESC
            LIMIT 8
            """,
            {"employees": employee_names, "start": dates[0], "end": dates[-1]},
            as_dict=True,
        )
        activities = [
            {"activity_type": row.activity_type, "hours": round(flt(row.hours), 2)} for row in activity_rows
        ]

    member_rows = []
    team_logged = [0.0] * len(dates)
    team_billable = [0.0] * len(dates)
    team_expected_daily = [0.0] * len(dates)
    pending = 0
    below_target = 0

    for member in members:
        norm = _daily_norm(member, standard_hours)
        daily_logged = [round(hour, 2) for hour in logged.get(member.name, [])]
        daily_billable = [round(hour, 2) for hour in billable.get(member.name, [])]
        expected_daily = [round(norm, 2) if is_weekday else 0 for is_weekday in weekday_flags]
        logged_hours = round(sum(daily_logged), 2)
        billable_hours = round(sum(daily_billable), 2)
        expected_hours = round(sum(expected_daily), 2)
        utilization = round((logged_hours / expected_hours) * 100, 1) if expected_hours else 0
        billable_pct = round((billable_hours / logged_hours) * 100, 1) if logged_hours else 0
        working_days = sum(1 for flag in weekday_flags if flag)
        days_logged = sum(1 for hour, is_weekday in zip(daily_logged, weekday_flags) if is_weekday and hour > 0)
        status = resolve_week_status(statuses.get(member.name, []))
        if status in PENDING_STATUSES:
            pending += 1
        if expected_hours and utilization < 80:
            below_target += 1
        for index, hour in enumerate(daily_logged):
            team_logged[index] += hour
            team_billable[index] += daily_billable[index]
            team_expected_daily[index] += expected_daily[index]
        member_rows.append(
            {
                "employee": member.name,
                "employee_name": member.employee_name,
                "department": member.department or "",
                "designation": member.designation or "",
                "image": member.image or "",
                "logged_hours": logged_hours,
                "billable_hours": billable_hours,
                "expected_hours": expected_hours,
                "utilization_pct": utilization,
                "billable_pct": billable_pct,
                "non_billable_hours": round(logged_hours - billable_hours, 2),
                "working_days": working_days,
                "days_logged": days_logged,
                "missing_days": max(working_days - days_logged, 0),
                "top_project": top_project.get(member.name, (0, ""))[1],
                "status": status,
                "daily": daily_logged,
                "billable_daily": daily_billable,
                "expected_daily": expected_daily,
            }
        )

    member_rows.sort(key=lambda row: (row["utilization_pct"], row["employee_name"] or ""))
    total_logged = round(sum(team_logged), 2)
    total_billable = round(sum(team_billable), 2)
    total_expected = round(sum(team_expected_daily), 2)
    working_day_count = sum(1 for flag in weekday_flags if flag)
    status_counts: dict[str, int] = {}
    for row in member_rows:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1
    status_breakdown = [{"status": status, "count": count} for status, count in status_counts.items()]
    daily = [
        {
            "date": dates[index],
            "label": labels[index],
            "logged": round(team_logged[index], 2),
            "billable": round(team_billable[index], 2),
            "expected": round(team_expected_daily[index], 2),
        }
        for index in range(len(dates))
    ]

    return {
        "can_switch_team": can_switch,
        "teams": teams,
        "team": {
            "employee": manager.name,
            "employee_name": manager.employee_name,
            "department": manager.department or "",
            "designation": manager.designation or "",
        },
        "week_label": range_label,
        "range_label": range_label,
        "start_date": dates[0] if dates else None,
        "end_date": dates[-1] if dates else None,
        "dates": dates,
        "labels": labels,
        "kpis": {
            "members": len(member_rows),
            "logged_hours": total_logged,
            "expected_hours": total_expected,
            "utilization_pct": round((total_logged / total_expected) * 100, 1) if total_expected else 0,
            "billable_hours": total_billable,
            "non_billable_hours": round(total_logged - total_billable, 2),
            "billable_pct": round((total_billable / total_logged) * 100, 1) if total_logged else 0,
            "below_target": below_target,
            "pending_approval": pending,
            "working_days": working_day_count,
            "missing_days": sum(row["missing_days"] for row in member_rows),
            "avg_daily_hours": round(total_logged / (len(member_rows) * working_day_count), 2)
            if member_rows and working_day_count
            else 0,
        },
        "daily": daily,
        "projects": projects,
        "activities": activities,
        "status_breakdown": status_breakdown,
        "members": member_rows,
        "message": "" if member_rows else _("This lead has no active direct reports."),
    }
