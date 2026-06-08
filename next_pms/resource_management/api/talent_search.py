import json

import frappe
from frappe.utils import today

from next_pms.api.utils import error_logger
from next_pms.resource_management.api.team import _attach_employee_view_metadata, _attach_primary_skills
from next_pms.resource_management.api.utils.helpers import resource_api_permissions_check
from next_pms.resource_management.utils.talent_search import (
    compute_fit_score,
    evaluate_skill_query,
    get_employee_availability,
    get_employee_bill_rates,
    get_employee_skill_map,
    get_employee_user_metadata,
)
from next_pms.timesheet.api import filter_employees


@frappe.whitelist()
@error_logger
def search_talent(
    skill_query: dict | str | None = None,
    branch: str | None = None,
    languages: str | None = None,
    timezones: str | None = None,
    min_bill_rate: float | None = None,
    max_bill_rate: float | None = None,
    availability_from: str | None = None,
    availability_to: str | None = None,
    min_available_hours: float | None = None,
    min_availability_pct: float | None = None,
    department: str | None = None,
    designation: str | None = None,
    user_group: str | None = None,
    roles: str | None = None,
    employee_name: str | None = None,
    page_length: int = 50,
    start: int = 0,
):
    permissions = resource_api_permissions_check()
    if not permissions.get("read") and not permissions.get("write"):
        frappe.throw("You do not have permission to search talent.", frappe.PermissionError)

    if isinstance(skill_query, str):
        skill_query = json.loads(skill_query) if skill_query else None

    parsed_filters = _parse_filters(
        branch=branch,
        languages=languages,
        timezones=timezones,
        min_bill_rate=min_bill_rate,
        max_bill_rate=max_bill_rate,
        min_available_hours=min_available_hours,
        min_availability_pct=min_availability_pct,
        department=department,
        designation=designation,
        user_group=user_group,
        roles=roles,
    )

    availability_from = availability_from or today()
    availability_to = availability_to or availability_from

    skill_employee_ids = evaluate_skill_query(skill_query)
    if skill_employee_ids is not None and not skill_employee_ids:
        return {
            "results": [],
            "total_count": 0,
            "availability_from": availability_from,
            "availability_to": availability_to,
        }

    employees, _total = filter_employees(
        employee_name=employee_name,
        department=parsed_filters.get("department"),
        designation=parsed_filters.get("designation"),
        user_group=parsed_filters.get("user_group"),
        branch=parsed_filters.get("branch"),
        role_filter=parsed_filters.get("roles"),
        ids=skill_employee_ids,
        page_length=5000,
        start=0,
        ignore_default_filters=True,
    )

    if not employees:
        return {"results": [], "total_count": 0}

    employee_ids = [employee.name for employee in employees]
    skill_map = get_employee_skill_map(employee_ids)
    user_metadata = get_employee_user_metadata(employee_ids)
    bill_rates = get_employee_bill_rates(employee_ids)

    employees = _attach_employee_view_metadata(employees)
    employees = _attach_primary_skills(employees)

    results = []
    for employee in employees:
        employee_id = employee.name
        meta = user_metadata.get(employee_id, {})
        bill_rate = bill_rates.get(employee_id, 0.0)

        if not _passes_metadata_filters(meta, bill_rate, parsed_filters):
            continue

        availability = get_employee_availability(employee_id, availability_from, availability_to)
        if not _passes_availability_filters(availability, parsed_filters):
            continue

        fit_score = compute_fit_score(
            employee_id,
            skill_query,
            skill_map,
            availability,
            meta,
            bill_rate,
            parsed_filters,
        )

        matched_skills = [
            {
                "skill": skill_name,
                "proficiency": proficiency,
            }
            for skill_name, proficiency in (skill_map.get(employee_id) or {}).items()
        ]

        results.append(
            {
                "employee": employee_id,
                "employee_name": employee.get("employee_name"),
                "image": employee.get("image"),
                "department": employee.get("department"),
                "designation": employee.get("designation"),
                "branch": meta.get("branch") or employee.get("branch"),
                "language": meta.get("language"),
                "time_zone": meta.get("time_zone"),
                "bill_rate": bill_rate,
                "primary_skill": employee.get("primary_skill"),
                "primary_role": employee.get("primary_role"),
                "user_group": employee.get("user_group"),
                "fit_score": fit_score,
                "availability": availability,
                "skills": sorted(matched_skills, key=lambda row: row["proficiency"], reverse=True),
            }
        )

    results.sort(key=lambda row: row["fit_score"], reverse=True)
    total_count = len(results)
    start = int(start or 0)
    page_length = int(page_length or 50)
    paged = results[start : start + page_length]

    return {
        "results": paged,
        "total_count": total_count,
        "availability_from": availability_from,
        "availability_to": availability_to,
    }


def _parse_filters(**kwargs):
    parsed = {}
    json_fields = ("branch", "languages", "timezones", "department", "designation", "user_group", "roles")
    for key, value in kwargs.items():
        if key in json_fields and isinstance(value, str):
            value = json.loads(value) if value else []
        parsed[key] = value
    return parsed


def _passes_metadata_filters(meta: dict, bill_rate: float, filters: dict) -> bool:
    languages = filters.get("languages") or []
    if languages and meta.get("language") not in languages:
        return False

    timezones = filters.get("timezones") or []
    if timezones and meta.get("time_zone") not in timezones:
        return False

    min_rate = flt_safe(filters.get("min_bill_rate"))
    max_rate = flt_safe(filters.get("max_bill_rate"))
    if min_rate > 0 and bill_rate < min_rate:
        return False
    if max_rate > 0 and bill_rate > max_rate:
        return False

    return True


def _passes_availability_filters(availability: dict, filters: dict) -> bool:
    min_hours = flt_safe(filters.get("min_available_hours"))
    if min_hours > 0 and flt_safe(availability.get("available_hours")) < min_hours:
        return False

    min_pct = flt_safe(filters.get("min_availability_pct"))
    if min_pct > 0 and flt_safe(availability.get("availability_pct")) < min_pct:
        return False

    return True


def flt_safe(value):
    from frappe.utils import flt

    return flt(value or 0)


@frappe.whitelist()
@error_logger
def get_timezone_options():
    permissions = resource_api_permissions_check()
    if not permissions.get("read") and not permissions.get("write"):
        frappe.throw("You do not have permission to view talent filters.", frappe.PermissionError)

    rows = frappe.db.sql(
        """
        SELECT DISTINCT u.time_zone AS name
        FROM `tabEmployee` e
        INNER JOIN `tabUser` u ON u.name = e.user_id
        WHERE e.status = 'Active'
            AND IFNULL(u.time_zone, '') != ''
        ORDER BY u.time_zone
        """,
        as_dict=True,
    )
    return [{"name": row.name, "label": row.name} for row in rows]
