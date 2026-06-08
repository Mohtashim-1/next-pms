import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate

from next_pms.resource_management.api.utils.helpers import is_on_leave
from next_pms.resource_management.api.utils.query import (
    get_allocation_list_for_employee_for_given_range,
    get_employee_leaves,
)
from next_pms.timesheet.api.employee import get_employee_working_hours
from next_pms.timesheet.api.team import get_holidays


def get_allocation_conflict_settings():
    action = frappe.db.get_single_value("Timesheet Settings", "allocation_conflict_action") or "Warn"
    return {"action": action}


def _get_employee_daily_norm(employee: str) -> float:
    working_hours = get_employee_working_hours(employee) or {}
    working_hour = flt(working_hours.get("working_hour") or 8)
    if working_hours.get("working_frequency") == "Per Week":
        return flt(working_hour / 5, 3)
    return flt(working_hour, 3)


def _allocation_active_on_date(allocation, date) -> bool:
    return getdate(allocation.allocation_start_date) <= date <= getdate(allocation.allocation_end_date)


def detect_allocation_conflicts(
    employee: str,
    start_date,
    end_date,
    hours_allocated_per_day: float,
    exclude_name: str | None = None,
):
    start_date = getdate(start_date)
    end_date = getdate(end_date)
    hours_allocated_per_day = flt(hours_allocated_per_day)

    if not employee or not start_date or not end_date:
        return {
            "has_conflicts": False,
            "action": get_allocation_conflict_settings()["action"],
            "conflicts": [],
        }

    daily_norm = _get_employee_daily_norm(employee)
    leaves = get_employee_leaves(employee=employee, start_date=start_date, end_date=end_date)
    holidays = get_holidays(employee, start_date, end_date)

    allocations = get_allocation_list_for_employee_for_given_range(
        [
            "name",
            "employee",
            "project",
            "project_name",
            "allocation_start_date",
            "allocation_end_date",
            "hours_allocated_per_day",
            "status",
        ],
        "employee",
        [employee],
        start_date,
        end_date,
    )

    conflicts = []
    date = start_date
    while date <= end_date:
        capacity = daily_norm
        leave_object = is_on_leave(date, daily_norm, leaves, holidays)
        if leave_object.get("on_leave") and not leave_object.get("leave_work_hours"):
            capacity = 0
        elif leave_object.get("leave_work_hours"):
            capacity = flt(leave_object.get("leave_work_hours"), 3)

        active_assignments = []
        existing_hours = 0

        for allocation in allocations:
            if exclude_name and allocation.name == exclude_name:
                continue
            if not _allocation_active_on_date(allocation, date):
                continue

            hours = flt(allocation.hours_allocated_per_day)
            existing_hours += hours
            active_assignments.append(
                {
                    "name": allocation.name,
                    "project": allocation.project,
                    "project_name": allocation.project_name,
                    "hours_allocated_per_day": hours,
                    "status": allocation.status,
                }
            )

        proposed_hours = hours_allocated_per_day
        total_hours = flt(existing_hours + proposed_hours, 3)

        if capacity > 0 and total_hours > capacity:
            conflicts.append(
                {
                    "date": str(date),
                    "capacity_hours": capacity,
                    "existing_hours": existing_hours,
                    "proposed_hours": proposed_hours,
                    "total_hours": total_hours,
                    "over_by": flt(total_hours - capacity, 3),
                    "assignments": active_assignments,
                }
            )
        elif capacity == 0 and proposed_hours > 0:
            conflicts.append(
                {
                    "date": str(date),
                    "capacity_hours": 0,
                    "existing_hours": existing_hours,
                    "proposed_hours": proposed_hours,
                    "total_hours": total_hours,
                    "over_by": proposed_hours,
                    "assignments": active_assignments,
                    "reason": _("Employee is on leave or holiday"),
                }
            )

        date = add_days(date, 1)

    settings = get_allocation_conflict_settings()
    return {
        "has_conflicts": bool(conflicts),
        "action": settings["action"],
        "conflicts": conflicts,
    }


def assert_allocation_conflicts_allowed(
    employee: str,
    start_date,
    end_date,
    hours_allocated_per_day: float,
    exclude_name: str | None = None,
):
    result = detect_allocation_conflicts(
        employee,
        start_date,
        end_date,
        hours_allocated_per_day,
        exclude_name=exclude_name,
    )
    if not result["has_conflicts"]:
        return result

    if result["action"] == "Block":
        sample = result["conflicts"][0]
        frappe.throw(
            _(
                "Allocation conflicts with existing assignments on {0}. Total {1}h exceeds capacity {2}h. Change Timesheet Settings to warn-only or adjust hours."
            ).format(sample["date"], sample["total_hours"], sample["capacity_hours"]),
            frappe.ValidationError,
        )

    return result
