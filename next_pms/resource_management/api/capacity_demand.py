import json

import frappe
from frappe.utils import add_months, today

from next_pms.api.utils import error_logger
from next_pms.resource_management.api.team import (
    _attach_employee_view_metadata,
    _attach_primary_skills,
)
from next_pms.resource_management.api.utils.helpers import (
    get_employees_by_skills,
    resource_api_permissions_check,
)
from next_pms.resource_management.api.utils.query import (
    get_allocation_list_for_employee_for_given_range,
)
from next_pms.resource_management.utils.capacity_demand import (
    build_capacity_demand_rows,
    build_period_buckets,
)
from next_pms.timesheet.api import filter_employees


ALLOCATION_FIELDS = [
    "name",
    "employee",
    "employee_name",
    "project",
    "project_name",
    "allocation_start_date",
    "allocation_end_date",
    "hours_allocated_per_day",
    "is_billable",
    "status",
]


@frappe.whitelist()
@error_logger
def get_capacity_demand_view(
    start_date: str | None = None,
    period: str = "week",
    horizon_months: int = 12,
    group_by: str = "employee",
    employee_name: str | None = None,
    business_unit: str | None = None,
    department: str | None = None,
    designation: str | None = None,
    reports_to: str | None = None,
    user_group: str | None = None,
    branch: str | None = None,
    roles: str | None = None,
    skills: list | str | None = None,
):
    permissions = resource_api_permissions_check()
    if not permissions.get("read") and not permissions.get("write"):
        frappe.throw("You do not have permission to view capacity planning.", frappe.PermissionError)

    start_date = start_date or today()
    period = period if period in {"week", "month"} else "week"
    horizon_months = min(max(int(horizon_months or 12), 1), 12)
    group_by = group_by or "employee"

    if isinstance(business_unit, str):
        business_unit = json.loads(business_unit)
    if isinstance(department, str):
        department = json.loads(department)
    if isinstance(designation, str):
        designation = json.loads(designation)
    if isinstance(user_group, str):
        user_group = json.loads(user_group)
    if isinstance(branch, str):
        branch = json.loads(branch)
    if isinstance(roles, str):
        roles = json.loads(roles)

    ids = None
    if skills:
        if isinstance(skills, str):
            skills = json.loads(skills)
        if skills:
            ids = get_employees_by_skills(skills)
            if not ids:
                periods = build_period_buckets(start_date, horizon_months, period)
                return {
                    "periods": periods,
                    "rows": [],
                    "summary": _empty_summary(periods),
                    "start_date": start_date,
                    "end_date": str(add_months(start_date, horizon_months)),
                    "period": period,
                    "horizon_months": horizon_months,
                    "group_by": group_by,
                }

    employees, _ = filter_employees(
        employee_name,
        business_unit=business_unit,
        department=department,
        designation=designation,
        user_group=user_group,
        branch=branch,
        role_filter=roles,
        reports_to=reports_to,
        page_length=5000,
        start=0,
        status=["Active"],
        ids=ids,
        ignore_permissions=True,
    )

    _attach_primary_skills(employees)
    _attach_employee_view_metadata(employees)

    periods = build_period_buckets(start_date, horizon_months, period)
    if not periods:
        return {
            "periods": [],
            "rows": [],
            "summary": {},
            "start_date": start_date,
            "end_date": str(add_months(start_date, horizon_months)),
            "period": period,
            "horizon_months": horizon_months,
            "group_by": group_by,
        }

    employee_names = [employee.name for employee in employees]
    allocations = get_allocation_list_for_employee_for_given_range(
        ALLOCATION_FIELDS,
        "employee",
        employee_names,
        periods[0]["start_date"],
        periods[-1]["end_date"],
    )

    allocation_map: dict[str, list] = {}
    for allocation in allocations:
        allocation_map.setdefault(allocation.employee, []).append(allocation)

    rows = build_capacity_demand_rows(employees, allocation_map, periods, group_by=group_by)
    summary = _build_summary(rows, periods)

    return {
        "periods": periods,
        "rows": rows,
        "summary": summary,
        "start_date": start_date,
        "end_date": str(add_months(start_date, horizon_months)),
        "period": period,
        "horizon_months": horizon_months,
        "group_by": group_by,
        "permissions": permissions,
    }


def _empty_summary(periods: list[dict]) -> dict:
    return {
        period["key"]: {
            "capacity_hours": 0,
            "demand_hours": 0,
            "gap_hours": 0,
            "status": "balanced",
        }
        for period in periods
    }


def _build_summary(rows: list[dict], periods: list[dict]) -> dict:
    summary = _empty_summary(periods)
    for row in rows:
        for period in periods:
            metrics = row.get("periods", {}).get(period["key"])
            if not metrics:
                continue
            summary[period["key"]]["capacity_hours"] = frappe.utils.flt(
                summary[period["key"]]["capacity_hours"] + metrics["capacity_hours"],
                2,
            )
            summary[period["key"]]["demand_hours"] = frappe.utils.flt(
                summary[period["key"]]["demand_hours"] + metrics["demand_hours"],
                2,
            )

    for period in periods:
        key = period["key"]
        gap = frappe.utils.flt(summary[key]["capacity_hours"] - summary[key]["demand_hours"], 2)
        summary[key]["gap_hours"] = gap
        if gap > 0.5:
            summary[key]["status"] = "surplus"
        elif gap < -0.5:
            summary[key]["status"] = "shortage"
        else:
            summary[key]["status"] = "balanced"

    return summary
