from __future__ import annotations

from collections import defaultdict

import frappe
from frappe.utils import add_days, add_months, flt, get_first_day, get_last_day, getdate

from next_pms.resource_management.api.utils.helpers import is_on_leave
from next_pms.resource_management.report.utils import (
    get_employee_allocations_for_date,
)
from next_pms.timesheet.api.employee import get_employee_daily_working_norm
from next_pms.timesheet.api.team import get_week_dates
from next_pms.utils.employee import get_employee_leaves_and_holidays


def build_period_buckets(start_date, horizon_months: int = 12, period_type: str = "week") -> list[dict]:
    start = getdate(start_date)
    horizon_months = int(horizon_months or 12)
    end = add_months(start, horizon_months)
    periods = []

    if period_type == "month":
        cursor = getdate(get_first_day(start))
        while cursor < end:
            period_end = getdate(get_last_day(cursor))
            if period_end > end:
                period_end = end
            periods.append(
                {
                    "key": cursor.strftime("%Y-%m"),
                    "label": cursor.strftime("%b %Y"),
                    "start_date": str(cursor),
                    "end_date": str(period_end),
                }
            )
            cursor = add_months(get_first_day(cursor), 1)
        return periods

    cursor = start
    seen_keys = set()
    while cursor < end:
        week = get_week_dates(date=cursor, ignore_weekend=True)
        period_start = getdate(week["start_date"])
        period_end = getdate(week["end_date"])
        if period_end > end:
            period_end = end
        if period_start >= end:
            break

        key = week.get("key") or f"{week['start_date']}::{week['end_date']}"
        if key in seen_keys:
            cursor = add_days(period_end, 1)
            continue
        seen_keys.add(key)

        label = key if key != "This Week" else key
        if key == "This Week" or "|" not in key:
            label = f"{period_start.strftime('%d %b')} – {period_end.strftime('%d %b %Y')}"
        periods.append(
            {
                "key": key,
                "label": label,
                "start_date": str(period_start),
                "end_date": str(period_end),
            }
        )
        cursor = add_days(period_end, 1)

    return periods


def get_employee_group_key(employee: dict, group_by: str) -> str:
    mapping = {
        "role": employee.get("primary_role") or "Unassigned",
        "skill": employee.get("primary_skill") or "Unassigned",
        "team": employee.get("user_group") or "Unassigned",
        "location": employee.get("branch") or "Unassigned",
        "department": employee.get("department") or "Unassigned",
        "designation": employee.get("designation") or "Unassigned",
        "business_unit": employee.get("business_unit") or employee.get("custom_business_unit") or "Unassigned",
    }
    if group_by in mapping:
        return mapping[group_by]
    return employee.get("employee_name") or employee.get("name")


def get_employee_row_id(employee: dict, group_by: str) -> str:
    if group_by == "employee":
        return employee.get("name")
    return f"{group_by}::{get_employee_group_key(employee, group_by)}"


def compute_period_metrics(
    daily_hours: float,
    allocations: list,
    leaves: list,
    holidays: list,
    period_start,
    period_end,
) -> dict:
    capacity = 0.0
    demand = 0.0
    project_demand: dict[str, float] = defaultdict(float)
    project_names: dict[str, str] = {}

    date = getdate(period_start)
    end = getdate(period_end)
    while date <= end:
        leave_data = is_on_leave(date, daily_hours, leaves, holidays)
        day_capacity = 0.0
        if leave_data.get("on_leave"):
            day_capacity = flt(leave_data.get("leave_work_hours") or 0)
        else:
            day_capacity = flt(daily_hours)

        capacity += day_capacity

        for allocation in get_employee_allocations_for_date(allocations, date):
            hours = flt(allocation.hours_allocated_per_day)
            demand += hours
            project = allocation.project or "Unassigned"
            project_demand[project] += hours
            project_names[project] = allocation.project_name or project

        date = add_days(date, 1)

    gap = capacity - demand
    if gap > 0.5:
        status = "surplus"
    elif gap < -0.5:
        status = "shortage"
    else:
        status = "balanced"

    return {
        "capacity_hours": flt(capacity, 2),
        "demand_hours": flt(demand, 2),
        "gap_hours": flt(gap, 2),
        "status": status,
        "projects": sorted(
            [
                {
                    "project": project,
                    "project_name": project_names.get(project, project),
                    "hours": flt(hours, 2),
                }
                for project, hours in project_demand.items()
            ],
            key=lambda row: row["hours"],
            reverse=True,
        ),
    }


def _merge_period_metrics(left: dict, right: dict) -> dict:
    merged_projects: dict[str, dict] = {}
    for bucket in (left, right):
        for project in bucket.get("projects", []):
            key = project["project"]
            if key not in merged_projects:
                merged_projects[key] = {**project}
            else:
                merged_projects[key]["hours"] = flt(merged_projects[key]["hours"] + project["hours"], 2)

    capacity = flt(left["capacity_hours"] + right["capacity_hours"], 2)
    demand = flt(left["demand_hours"] + right["demand_hours"], 2)
    gap = flt(capacity - demand, 2)
    if gap > 0.5:
        status = "surplus"
    elif gap < -0.5:
        status = "shortage"
    else:
        status = "balanced"

    return {
        "capacity_hours": capacity,
        "demand_hours": demand,
        "gap_hours": gap,
        "status": status,
        "projects": sorted(merged_projects.values(), key=lambda row: row["hours"], reverse=True),
    }


def build_capacity_demand_rows(
    employees: list[dict],
    allocation_map: dict[str, list],
    periods: list[dict],
    group_by: str = "employee",
) -> list[dict]:
    grouped_rows: dict[str, dict] = {}

    for employee in employees:
        employee_id = employee.get("name")
        row_id = get_employee_row_id(employee, group_by)
        row_label = (
            employee.get("employee_name") or employee_id
            if group_by == "employee"
            else get_employee_group_key(employee, group_by)
        )

        if row_id not in grouped_rows:
            grouped_rows[row_id] = {
                "id": row_id,
                "label": row_label,
                "group_by": group_by,
                "periods": {},
            }

        daily_hours = get_employee_daily_working_norm(employee_id)
        leave_bundle = get_employee_leaves_and_holidays(
            employee_id,
            getdate(periods[0]["start_date"]),
            getdate(periods[-1]["end_date"]),
        )
        leaves = leave_bundle.get("leaves") or []
        holidays = leave_bundle.get("holidays") or []
        allocations = allocation_map.get(employee_id, [])

        for period in periods:
            metrics = compute_period_metrics(
                daily_hours,
                allocations,
                leaves,
                holidays,
                period["start_date"],
                period["end_date"],
            )
            period_key = period["key"]
            if period_key in grouped_rows[row_id]["periods"]:
                grouped_rows[row_id]["periods"][period_key] = _merge_period_metrics(
                    grouped_rows[row_id]["periods"][period_key],
                    metrics,
                )
            else:
                grouped_rows[row_id]["periods"][period_key] = metrics

    rows = list(grouped_rows.values())
    rows.sort(key=lambda row: row["label"])
    return rows
