from __future__ import annotations

import frappe
from frappe.utils import add_days, flt, getdate

from next_pms.resource_management.api.utils.helpers import get_employees_by_skills
from next_pms.resource_management.api.utils.query import get_allocation_list_for_employee_for_given_range
from next_pms.resource_management.report.utils import calculate_employee_available_hours
from next_pms.timesheet.api.employee import get_employee_daily_working_norm
from next_pms.utils.employee import get_employee_leaves_and_holidays


ALLOCATION_FIELDS = [
    "name",
    "employee",
    "allocation_start_date",
    "allocation_end_date",
    "hours_allocated_per_day",
    "is_billable",
]


def _meets_proficiency(actual: float, required: dict) -> bool:
    operator = required.get("operator") or ">="
    threshold = flt(required.get("proficiency") or 0)
    actual = flt(actual)
    if operator == ">":
        return actual > threshold
    if operator == "<":
        return actual < threshold
    if operator == "<=":
        return actual <= threshold
    if operator == "=":
        return abs(actual - threshold) < 0.01
    return actual >= threshold


def get_employees_for_skill_group(skills: list[dict], group_operator: str = "OR") -> list[str]:
    if not skills:
        return []

    if group_operator == "AND":
        return get_employees_by_skills(skills)

    employee_ids: set[str] = set()
    for skill in skills:
        matches = get_employees_by_skills([skill])
        employee_ids.update(matches)
    return list(employee_ids)


def evaluate_skill_query(skill_query: dict | None) -> list[str] | None:
    if not skill_query:
        return None

    groups = skill_query.get("groups") or []
    if not groups:
        return None

    group_results: list[set[str]] = []
    for group in groups:
        skills = group.get("skills") or []
        if not skills:
            continue
        group_operator = group.get("operator") or "AND"
        group_results.append(set(get_employees_for_skill_group(skills, group_operator)))

    if not group_results:
        return None

    top_operator = skill_query.get("operator") or "AND"
    if top_operator == "OR":
        return list(set.union(*group_results))
    return list(set.intersection(*group_results))


def get_employee_skill_map(employee_ids: list[str]) -> dict[str, dict[str, float]]:
    if not employee_ids:
        return {}

    rows = frappe.get_all(
        "Employee Skill",
        filters={"parent": ["in", employee_ids]},
        fields=["parent", "skill", "proficiency"],
    )
    skill_map: dict[str, dict[str, float]] = {}
    for row in rows:
        skill_map.setdefault(row.parent, {})[row.skill] = flt(row.proficiency)
    return skill_map


def get_employee_user_metadata(employee_ids: list[str]) -> dict[str, dict]:
    if not employee_ids:
        return {}

    employees = frappe.get_all(
        "Employee",
        filters={"name": ["in", employee_ids]},
        fields=["name", "user_id", "branch"],
    )
    user_ids = [row.user_id for row in employees if row.get("user_id")]
    user_map = {}
    if user_ids:
        for row in frappe.get_all(
            "User",
            filters={"name": ["in", user_ids]},
            fields=["name", "language", "time_zone"],
        ):
            user_map[row.name] = row

    metadata = {}
    for employee in employees:
        user = user_map.get(employee.get("user_id")) or {}
        metadata[employee.name] = {
            "branch": employee.get("branch") or "",
            "language": user.get("language") or "",
            "time_zone": user.get("time_zone") or "",
        }
    return metadata


def get_employee_bill_rates(employee_ids: list[str]) -> dict[str, float]:
    if not employee_ids:
        return {}

    rows = frappe.get_all(
        "Project Billing Team",
        filters={"employee": ["in", employee_ids]},
        fields=["employee", "hourly_billing_rate"],
    )
    totals: dict[str, list[float]] = {}
    for row in rows:
        rate = flt(row.hourly_billing_rate)
        if rate <= 0:
            continue
        totals.setdefault(row.employee, []).append(rate)

    return {employee: flt(sum(rates) / len(rates), 2) for employee, rates in totals.items()}


def compute_skill_fit_score(employee_id: str, skill_query: dict | None, skill_map: dict[str, dict[str, float]]) -> float:
    if not skill_query or not skill_query.get("groups"):
        return 100.0

    required_skills: list[dict] = []
    for group in skill_query.get("groups") or []:
        required_skills.extend(group.get("skills") or [])

    if not required_skills:
        return 100.0

    employee_skills = skill_map.get(employee_id) or {}
    total = 0.0
    for required in required_skills:
        actual = employee_skills.get(required.get("name"))
        if actual is None:
            continue
        if _meets_proficiency(actual, required):
            excess = max(0.0, flt(actual) - flt(required.get("proficiency") or 0))
            total += min(100.0, 80.0 + excess * 100.0)
        else:
            required_level = flt(required.get("proficiency") or 0.01)
            total += max(0.0, (flt(actual) / required_level) * 60.0)

    return flt(total / len(required_skills), 1)


def compute_availability_fit_score(
    available_hours: float,
    capacity_hours: float,
    min_available_hours: float | None = None,
) -> float:
    if capacity_hours <= 0:
        return 0.0

    availability_pct = min(100.0, (available_hours / capacity_hours) * 100.0)
    score = availability_pct

    if min_available_hours and min_available_hours > 0:
        if available_hours >= min_available_hours:
            score = min(100.0, score + 10.0)
        else:
            score = max(0.0, score * (available_hours / min_available_hours))

    return flt(score, 1)


def compute_filter_fit_score(
    employee_meta: dict,
    bill_rate: float,
    filters: dict,
) -> float:
    dimensions = 0
    score = 0.0

    branches = filters.get("branch") or []
    if branches:
        dimensions += 1
        if employee_meta.get("branch") in branches:
            score += 100.0

    languages = filters.get("languages") or []
    if languages:
        dimensions += 1
        if employee_meta.get("language") in languages:
            score += 100.0

    timezones = filters.get("timezones") or []
    if timezones:
        dimensions += 1
        if employee_meta.get("time_zone") in timezones:
            score += 100.0

    min_rate = flt(filters.get("min_bill_rate") or 0)
    max_rate = flt(filters.get("max_bill_rate") or 0)
    if min_rate > 0 or max_rate > 0:
        dimensions += 1
        if bill_rate > 0:
            if min_rate > 0 and bill_rate < min_rate:
                pass
            elif max_rate > 0 and bill_rate > max_rate:
                pass
            else:
                score += 100.0

    if dimensions == 0:
        return 100.0

    return flt(score / dimensions, 1)


def compute_fit_score(
    employee_id: str,
    skill_query: dict | None,
    skill_map: dict[str, dict[str, float]],
    availability: dict,
    employee_meta: dict,
    bill_rate: float,
    filters: dict,
) -> float:
    skill_score = compute_skill_fit_score(employee_id, skill_query, skill_map)
    availability_score = compute_availability_fit_score(
        flt(availability.get("available_hours")),
        flt(availability.get("capacity_hours")),
        flt(filters.get("min_available_hours")) or None,
    )
    filter_score = compute_filter_fit_score(employee_meta, bill_rate, filters)

    return flt(0.5 * skill_score + 0.3 * availability_score + 0.2 * filter_score, 1)


def get_employee_availability(
    employee_id: str,
    start_date,
    end_date,
) -> dict:
    start = getdate(start_date)
    end = getdate(end_date)
    daily_hours = get_employee_daily_working_norm(employee_id)
    leave_bundle = get_employee_leaves_and_holidays(employee_id, start, end)
    allocations = get_allocation_list_for_employee_for_given_range(
        ALLOCATION_FIELDS,
        "employee",
        [employee_id],
        start,
        end,
    )

    capacity_hours = 0.0
    date = start
    while date <= end:
        from next_pms.resource_management.api.utils.helpers import is_on_leave

        leave_data = is_on_leave(date, daily_hours, leave_bundle.get("leaves") or [], leave_bundle.get("holidays") or [])
        if not leave_data.get("on_leave"):
            capacity_hours += daily_hours
        elif leave_data.get("leave_work_hours"):
            capacity_hours += flt(leave_data.get("leave_work_hours"))
        date = add_days(date, 1)

    allocated_hours = calculate_employee_available_hours(
        daily_hours,
        start,
        end,
        allocations,
        leave_bundle.get("holidays") or [],
        leave_bundle.get("leaves") or [],
    )
    # calculate_employee_available_hours returns free hours; derive allocated from capacity - free
    available_hours = flt(allocated_hours)
    demand_hours = max(0.0, capacity_hours - available_hours)

    return {
        "capacity_hours": flt(capacity_hours, 2),
        "allocated_hours": flt(demand_hours, 2),
        "available_hours": flt(available_hours, 2),
        "availability_pct": flt((available_hours / capacity_hours) * 100, 1) if capacity_hours else 0.0,
    }
