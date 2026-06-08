from __future__ import annotations

from collections import defaultdict

import frappe
from frappe.utils import add_days, flt, getdate

from next_pms.resource_management.api.team import _attach_employee_view_metadata, _attach_primary_skills
from next_pms.resource_management.api.utils.query import (
    get_allocation_list_for_employee_for_given_range,
    get_employee_leaves,
)
from next_pms.resource_management.utils.capacity_demand import build_period_buckets
from next_pms.timesheet.api import filter_employees
from next_pms.timesheet.api.employee import get_employee_daily_working_norm
from next_pms.timesheet.api.team import get_holidays
from next_pms.resource_management.api.utils.helpers import is_on_leave

GROUP_BY_OPTIONS = ("team", "role", "person", "client", "department")
SPLIT_KEYS = ("billable", "non_billable", "pto", "holiday", "admin")
ADMIN_ACTIVITY_HINTS = ("admin", "internal", "overhead", "ops", "operations", "meeting")


def _empty_split() -> dict[str, float]:
    return {key: 0.0 for key in SPLIT_KEYS}


def _merge_split(left: dict, right: dict) -> dict:
    return {key: flt(left.get(key, 0) + right.get(key, 0), 2) for key in SPLIT_KEYS}


def _classify_timesheet_hours(row: dict) -> str:
    if row.get("is_billable"):
        return "billable"

    activity = (row.get("activity_type") or "").lower()
    project = row.get("project") or ""
    project_name = (row.get("project_name") or "").lower()

    if not project:
        return "admin"
    if any(hint in activity for hint in ADMIN_ACTIVITY_HINTS):
        return "admin"
    if any(hint in project_name for hint in ADMIN_ACTIVITY_HINTS):
        return "admin"
    return "non_billable"


def _get_group_key(employee: dict, group_by: str, customer: str | None = None) -> tuple[str, str]:
    if group_by in ("person", "employee"):
        return employee.get("name"), employee.get("employee_name") or employee.get("name")
    if group_by == "client":
        return customer or "No Client", customer or "No Client"
    if group_by == "team":
        return employee.get("user_group") or "Unassigned", employee.get("user_group") or "Unassigned"
    if group_by == "role":
        return employee.get("primary_role") or employee.get("designation") or "Unassigned", employee.get("primary_role") or employee.get("designation") or "Unassigned"
    if group_by == "department":
        return employee.get("department") or "Unassigned", employee.get("department") or "Unassigned"
    return employee.get("name"), employee.get("employee_name") or employee.get("name")


def _compute_leave_splits(employee: str, daily_hours: float, start_date, end_date) -> dict:
    holidays = get_holidays(employee=employee, start_date=start_date, end_date=end_date) or []
    leaves = get_employee_leaves(employee, start_date, end_date) or []
    splits = _empty_split()
    date = getdate(start_date)
    end = getdate(end_date)

    while date <= end:
        leave_data = is_on_leave(date, daily_hours, leaves, holidays)
        if leave_data.get("on_leave"):
            consumed = flt(daily_hours - flt(leave_data.get("leave_work_hours") or 0), 2)
            is_holiday = any(getdate(holiday.holiday_date) == date for holiday in holidays)
            if is_holiday:
                splits["holiday"] += consumed or daily_hours
            else:
                splits["pto"] += consumed or daily_hours
        date = add_days(date, 1)

    return {key: flt(value, 2) for key, value in splits.items()}


def _compute_capacity_hours(employee: str, daily_hours: float, start_date, end_date) -> float:
    holidays = get_holidays(employee=employee, start_date=start_date, end_date=end_date) or []
    leaves = get_employee_leaves(employee, start_date, end_date) or []
    capacity = 0.0
    date = getdate(start_date)
    end = getdate(end_date)
    while date <= end:
        leave_data = is_on_leave(date, daily_hours, leaves, holidays)
        if leave_data.get("on_leave"):
            capacity += flt(leave_data.get("leave_work_hours") or 0, 2)
        else:
            capacity += daily_hours
        date = add_days(date, 1)
    return flt(capacity, 2)


def _fetch_timesheet_hours(employee_names: list[str], start_date, end_date) -> list[dict]:
    if not employee_names:
        return []
    return frappe.db.sql(
        """
        SELECT
            ts.employee,
            td.project,
            p.project_name,
            p.customer,
            td.activity_type,
            td.is_billable,
            COALESCE(td.hours, 0) AS hours,
            DATE(td.from_time) AS entry_date
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        LEFT JOIN `tabProject` p ON p.name = td.project
        WHERE ts.employee IN %(employees)s
          AND ts.docstatus < 2
          AND DATE(td.from_time) BETWEEN %(start_date)s AND %(end_date)s
        """,
        {
            "employees": tuple(employee_names),
            "start_date": getdate(start_date),
            "end_date": getdate(end_date),
        },
        as_dict=True,
    )


def _fetch_target_hours(employee_names: list[str], start_date, end_date) -> list[dict]:
    if not employee_names:
        return []
    return get_allocation_list_for_employee_for_given_range(
        ["employee", "project", "project_name", "is_billable", "hours_allocated_per_day", "allocation_start_date", "allocation_end_date"],
        "employee",
        employee_names,
        start_date,
        end_date,
    )


def _allocation_hours_in_range(allocation, start_date, end_date) -> float:
    alloc_start = max(getdate(start_date), getdate(allocation.allocation_start_date))
    alloc_end = min(getdate(end_date), getdate(allocation.allocation_end_date))
    if alloc_start > alloc_end:
        return 0.0
    days = (alloc_end - alloc_start).days + 1
    return flt(flt(allocation.hours_allocated_per_day) * days, 2)


def _compute_targets(allocations: list, start_date, end_date) -> dict:
    targets = {
        "target_capacity_hours": 0.0,
        "target_billable_hours": 0.0,
        "target_non_billable_hours": 0.0,
    }
    for allocation in allocations:
        hours = _allocation_hours_in_range(allocation, start_date, end_date)
        targets["target_capacity_hours"] += hours
        if allocation.is_billable:
            targets["target_billable_hours"] += hours
        else:
            targets["target_non_billable_hours"] += hours
    return {key: flt(value, 2) for key, value in targets.items()}


def _compute_actuals(timesheet_rows: list[dict], employee: str, group_by: str) -> dict:
    splits = _empty_split()
    for row in timesheet_rows:
        if row.employee != employee:
            continue
        split_key = _classify_timesheet_hours(row)
        splits[split_key] += flt(row.hours, 2)
    return {key: flt(value, 2) for key, value in splits.items()}


def _build_row_metrics(
    employee: dict,
    timesheet_rows: list[dict],
    allocations: list,
    start_date,
    end_date,
    group_by: str,
) -> dict:
    daily_hours = get_employee_daily_working_norm(employee.get("name"))
    leave_splits = _compute_leave_splits(employee.get("name"), daily_hours, start_date, end_date)
    actual_work = _compute_actuals(timesheet_rows, employee.get("name"), group_by)
    splits = _merge_split(actual_work, leave_splits)

    employee_allocations = [row for row in allocations if row.employee == employee.get("name")]
    targets = _compute_targets(employee_allocations, start_date, end_date)
    capacity_hours = _compute_capacity_hours(employee.get("name"), daily_hours, start_date, end_date)

    actual_billable = splits["billable"]
    return {
        "splits": splits,
        "capacity_hours": capacity_hours,
        "targets": targets,
        "actual_billable_hours": actual_billable,
        "actual_total_logged_hours": flt(sum(actual_work.values()), 2),
        "target_billable_hours": targets["target_billable_hours"],
        "billable_variance": flt(actual_billable - targets["target_billable_hours"], 2),
        "billable_attainment_pct": flt(
            (actual_billable / targets["target_billable_hours"] * 100) if targets["target_billable_hours"] else 0,
            1,
        ),
    }


def _aggregate_client_rows(employees: list[dict], timesheet_rows: list[dict], allocations: list, start_date, end_date) -> list[dict]:
    grouped: dict[str, dict] = {}
    project_customers = {}

    for row in timesheet_rows:
        if row.project and row.project not in project_customers:
            project_customers[row.project] = row.customer or "No Client"

    for employee in employees:
        daily_hours = get_employee_daily_working_norm(employee.get("name"))
        leave_splits = _compute_leave_splits(employee.get("name"), daily_hours, start_date, end_date)
        employee_rows = [row for row in timesheet_rows if row.employee == employee.get("name")]

        billable_by_customer: dict[str, float] = defaultdict(float)
        non_billable_by_customer: dict[str, float] = defaultdict(float)
        admin_hours = 0.0

        for row in employee_rows:
            split_key = _classify_timesheet_hours(row)
            customer = row.customer or "No Client"
            if split_key == "billable":
                billable_by_customer[customer] += flt(row.hours, 2)
            elif split_key == "non_billable":
                non_billable_by_customer[customer] += flt(row.hours, 2)
            else:
                admin_hours += flt(row.hours, 2)

        employee_allocations = [row for row in allocations if row.employee == employee.get("name")]
        for allocation in employee_allocations:
            customer = project_customers.get(allocation.project, "No Client")
            hours = _allocation_hours_in_range(allocation, start_date, end_date)
            key, label = _get_group_key(employee, "client", customer)
            bucket = grouped.setdefault(
                key,
                {
                    "key": key,
                    "label": label,
                    "group_by": "client",
                    "splits": _empty_split(),
                    "capacity_hours": 0.0,
                    "targets": {
                        "target_capacity_hours": 0.0,
                        "target_billable_hours": 0.0,
                        "target_non_billable_hours": 0.0,
                    },
                    "actual_billable_hours": 0.0,
                    "actual_total_logged_hours": 0.0,
                    "target_billable_hours": 0.0,
                    "billable_variance": 0.0,
                    "billable_attainment_pct": 0.0,
                    "periods": {},
                },
            )
            if allocation.is_billable:
                bucket["targets"]["target_billable_hours"] += hours
            else:
                bucket["targets"]["target_non_billable_hours"] += hours
            bucket["targets"]["target_capacity_hours"] += hours

        if admin_hours:
            key, label = _get_group_key(employee, "client", "Internal / Admin")
            bucket = grouped.setdefault(
                key,
                {
                    "key": key,
                    "label": label,
                    "group_by": "client",
                    "splits": _empty_split(),
                    "capacity_hours": 0.0,
                    "targets": {
                        "target_capacity_hours": 0.0,
                        "target_billable_hours": 0.0,
                        "target_non_billable_hours": 0.0,
                    },
                    "actual_billable_hours": 0.0,
                    "actual_total_logged_hours": 0.0,
                    "target_billable_hours": 0.0,
                    "billable_variance": 0.0,
                    "billable_attainment_pct": 0.0,
                    "periods": {},
                },
            )
            bucket["splits"]["admin"] += admin_hours

        for customer, hours in billable_by_customer.items():
            key, label = _get_group_key(employee, "client", customer)
            bucket = grouped.setdefault(
                key,
                {
                    "key": key,
                    "label": label,
                    "group_by": "client",
                    "splits": _empty_split(),
                    "capacity_hours": 0.0,
                    "targets": {
                        "target_capacity_hours": 0.0,
                        "target_billable_hours": 0.0,
                        "target_non_billable_hours": 0.0,
                    },
                    "actual_billable_hours": 0.0,
                    "actual_total_logged_hours": 0.0,
                    "target_billable_hours": 0.0,
                    "billable_variance": 0.0,
                    "billable_attainment_pct": 0.0,
                    "periods": {},
                },
            )
            bucket["splits"]["billable"] += hours
            bucket["actual_billable_hours"] += hours
            bucket["actual_total_logged_hours"] += hours

        for customer, hours in non_billable_by_customer.items():
            key, label = _get_group_key(employee, "client", customer)
            bucket = grouped.setdefault(
                key,
                {
                    "key": key,
                    "label": label,
                    "group_by": "client",
                    "splits": _empty_split(),
                    "capacity_hours": 0.0,
                    "targets": {
                        "target_capacity_hours": 0.0,
                        "target_billable_hours": 0.0,
                        "target_non_billable_hours": 0.0,
                    },
                    "actual_billable_hours": 0.0,
                    "actual_total_logged_hours": 0.0,
                    "target_billable_hours": 0.0,
                    "billable_variance": 0.0,
                    "billable_attainment_pct": 0.0,
                    "periods": {},
                },
            )
            bucket["splits"]["non_billable"] += hours
            bucket["actual_total_logged_hours"] += hours

        total_capacity = _compute_capacity_hours(employee.get("name"), daily_hours, start_date, end_date)
        total_pto = leave_splits["pto"]
        total_holiday = leave_splits["holiday"]
        primary_customer = next(iter(billable_by_customer), "No Client")
        key, label = _get_group_key(employee, "client", primary_customer)
        if key in grouped:
            grouped[key]["capacity_hours"] += total_capacity
            grouped[key]["splits"]["pto"] += total_pto
            grouped[key]["splits"]["holiday"] += total_holiday
            grouped[key]["target_billable_hours"] = grouped[key]["targets"]["target_billable_hours"]
            grouped[key]["billable_variance"] = flt(
                grouped[key]["actual_billable_hours"] - grouped[key]["target_billable_hours"],
                2,
            )
            grouped[key]["billable_attainment_pct"] = flt(
                (
                    grouped[key]["actual_billable_hours"] / grouped[key]["target_billable_hours"] * 100
                )
                if grouped[key]["target_billable_hours"]
                else 0,
                1,
            )

    return list(grouped.values())


def get_time_allocation_view(filters: dict | None = None) -> dict:
    filters = frappe._dict(filters or {})
    start_date = filters.get("start_date") or filters.get("from_date")
    end_date = filters.get("end_date") or filters.get("to_date")
    if not start_date or not end_date:
        frappe.throw("Start date and end date are required.")

    group_by = filters.get("group_by") or "team"
    if group_by == "person":
        group_by = "employee"
    if group_by not in ("team", "role", "employee", "client", "department"):
        frappe.throw(f"Invalid group_by. Choose one of: {', '.join(GROUP_BY_OPTIONS)}")

    period_type = filters.get("period") if filters.get("period") in {"week", "month"} else "week"
    horizon_months = min(max(int(filters.get("horizon_months") or 3), 1), 12)

    employees, _ = filter_employees(
        employee_name=filters.get("employee_name"),
        department=filters.get("department"),
        user_group=filters.get("user_group"),
        business_unit=filters.get("business_unit"),
        designation=filters.get("designation"),
        branch=filters.get("branch"),
        role_filter=filters.get("roles"),
        page_length=5000,
        start=0,
        status=["Active"],
        ignore_permissions=True,
    )
    _attach_primary_skills(employees)
    _attach_employee_view_metadata(employees)

    employee_names = [employee.name for employee in employees]
    timesheet_rows = _fetch_timesheet_hours(employee_names, start_date, end_date)
    allocations = _fetch_target_hours(employee_names, start_date, end_date)
    periods = build_period_buckets(start_date, horizon_months=horizon_months, period_type=period_type)
    periods = [period for period in periods if getdate(period["end_date"]) >= getdate(start_date) and getdate(period["start_date"]) <= getdate(end_date)]

    rows: list[dict] = []
    if group_by == "client":
        rows = _aggregate_client_rows(employees, timesheet_rows, allocations, start_date, end_date)
    else:
        grouped: dict[str, dict] = {}
        for employee in employees:
            metrics = _build_row_metrics(employee, timesheet_rows, allocations, start_date, end_date, group_by)
            key, label = _get_group_key(employee, group_by if group_by != "employee" else "person")
            bucket = grouped.setdefault(
                key,
                {
                    "key": key,
                    "label": label,
                    "group_by": group_by if group_by != "employee" else "person",
                    "splits": _empty_split(),
                    "capacity_hours": 0.0,
                    "targets": {
                        "target_capacity_hours": 0.0,
                        "target_billable_hours": 0.0,
                        "target_non_billable_hours": 0.0,
                    },
                    "actual_billable_hours": 0.0,
                    "actual_total_logged_hours": 0.0,
                    "target_billable_hours": 0.0,
                    "billable_variance": 0.0,
                    "billable_attainment_pct": 0.0,
                    "periods": {},
                },
            )
            bucket["splits"] = _merge_split(bucket["splits"], metrics["splits"])
            bucket["capacity_hours"] += metrics["capacity_hours"]
            for target_key, value in metrics["targets"].items():
                bucket["targets"][target_key] += value
            bucket["actual_billable_hours"] += metrics["actual_billable_hours"]
            bucket["actual_total_logged_hours"] += metrics["actual_total_logged_hours"]

        for bucket in grouped.values():
            bucket["target_billable_hours"] = bucket["targets"]["target_billable_hours"]
            bucket["billable_variance"] = flt(bucket["actual_billable_hours"] - bucket["target_billable_hours"], 2)
            bucket["billable_attainment_pct"] = flt(
                (bucket["actual_billable_hours"] / bucket["target_billable_hours"] * 100)
                if bucket["target_billable_hours"]
                else 0,
                1,
            )
            for key in ("targets", "splits", "capacity_hours", "actual_billable_hours", "actual_total_logged_hours"):
                if isinstance(bucket.get(key), dict):
                    bucket[key] = {inner_key: flt(inner_value, 2) for inner_key, inner_value in bucket[key].items()}
                else:
                    bucket[key] = flt(bucket.get(key, 0), 2)
            rows.append(bucket)

    trend = []
    for period in periods:
        period_rows = []
        period_timesheets = _fetch_timesheet_hours(employee_names, period["start_date"], period["end_date"])
        period_allocations = _fetch_target_hours(employee_names, period["start_date"], period["end_date"])

        if group_by == "client":
            period_rows = _aggregate_client_rows(employees, period_timesheets, period_allocations, period["start_date"], period["end_date"])
        else:
            period_grouped: dict[str, dict] = {}
            for employee in employees:
                metrics = _build_row_metrics(employee, period_timesheets, period_allocations, period["start_date"], period["end_date"], group_by)
                key, label = _get_group_key(employee, group_by if group_by != "employee" else "person")
                period_grouped.setdefault(key, {"key": key, "label": label, "splits": _empty_split(), "target_billable_hours": 0.0, "actual_billable_hours": 0.0})
                period_grouped[key]["splits"] = _merge_split(period_grouped[key]["splits"], metrics["splits"])
                period_grouped[key]["target_billable_hours"] += metrics["targets"]["target_billable_hours"]
                period_grouped[key]["actual_billable_hours"] += metrics["actual_billable_hours"]
            period_rows = list(period_grouped.values())

        period_summary = {
            "key": period["key"],
            "label": period["label"],
            "start_date": period["start_date"],
            "end_date": period["end_date"],
            "splits": _empty_split(),
            "target_billable_hours": 0.0,
            "actual_billable_hours": 0.0,
        }
        for row in period_rows:
            period_summary["splits"] = _merge_split(period_summary["splits"], row.get("splits", {}))
            period_summary["target_billable_hours"] += flt(row.get("target_billable_hours") or row.get("targets", {}).get("target_billable_hours", 0))
            period_summary["actual_billable_hours"] += flt(row.get("actual_billable_hours", 0))

        period_summary["target_billable_hours"] = flt(period_summary["target_billable_hours"], 2)
        period_summary["actual_billable_hours"] = flt(period_summary["actual_billable_hours"], 2)
        trend.append(period_summary)

        for row in rows:
            matching = next((item for item in period_rows if item["key"] == row["key"]), None)
            if matching:
                row.setdefault("periods", {})
                row["periods"][period["key"]] = {
                    "splits": matching.get("splits", _empty_split()),
                    "target_billable_hours": flt(matching.get("target_billable_hours") or matching.get("targets", {}).get("target_billable_hours", 0), 2),
                    "actual_billable_hours": flt(matching.get("actual_billable_hours", 0), 2),
                }

    summary = {
        "splits": _empty_split(),
        "capacity_hours": 0.0,
        "target_billable_hours": 0.0,
        "actual_billable_hours": 0.0,
        "billable_variance": 0.0,
    }
    for row in rows:
        summary["splits"] = _merge_split(summary["splits"], row.get("splits", {}))
        summary["capacity_hours"] += flt(row.get("capacity_hours", 0))
        summary["target_billable_hours"] += flt(row.get("target_billable_hours", 0))
        summary["actual_billable_hours"] += flt(row.get("actual_billable_hours", 0))
    summary["billable_variance"] = flt(summary["actual_billable_hours"] - summary["target_billable_hours"], 2)
    summary["billable_attainment_pct"] = flt(
        (summary["actual_billable_hours"] / summary["target_billable_hours"] * 100) if summary["target_billable_hours"] else 0,
        1,
    )

    rows.sort(key=lambda item: item.get("actual_billable_hours", 0), reverse=True)

    return {
        "start_date": str(getdate(start_date)),
        "end_date": str(getdate(end_date)),
        "group_by": group_by if group_by != "employee" else "person",
        "period": period_type,
        "summary": summary,
        "rows": rows,
        "trend": trend,
        "split_keys": list(SPLIT_KEYS),
    }


def _resolve_allocation_filters(filters: dict | None) -> frappe._dict:
    filters = frappe._dict(filters or {})
    start_date = filters.get("start_date") or filters.get("from_date")
    end_date = filters.get("end_date") or filters.get("to_date")
    if not start_date or not end_date:
        frappe.throw("Start date and end date are required.")

    group_by = filters.get("group_by") or "team"
    if group_by == "person":
        group_by = "employee"
    if group_by not in ("team", "role", "employee", "client", "department"):
        frappe.throw(f"Invalid group_by. Choose one of: {', '.join(GROUP_BY_OPTIONS)}")

    return frappe._dict(
        {
            **filters,
            "start_date": start_date,
            "end_date": end_date,
            "group_by": group_by,
            "period_type": filters.get("period") if filters.get("period") in {"week", "month"} else "week",
            "horizon_months": min(max(int(filters.get("horizon_months") or 3), 1), 12),
        }
    )


def _employee_matches_group(employee: dict, group_by: str, group_key: str | None) -> bool:
    if not group_key:
        return True
    if group_by in ("person", "employee"):
        return employee.get("name") == group_key or employee.get("employee_name") == group_key
    if group_by == "team":
        return (employee.get("user_group") or "Unassigned") == group_key
    if group_by == "role":
        return (employee.get("primary_role") or employee.get("designation") or "Unassigned") == group_key
    if group_by == "department":
        return (employee.get("department") or "Unassigned") == group_key
    return True


def _employees_for_client_group(
    employees: list[dict],
    group_key: str | None,
    timesheet_rows: list[dict],
    allocations: list,
) -> list[dict]:
    if not group_key:
        return employees
    if group_key == "Internal / Admin":
        admin_employees = {
            row.employee for row in timesheet_rows if _classify_timesheet_hours(row) == "admin"
        }
        return [employee for employee in employees if employee.get("name") in admin_employees]

    matched_employees = {row.employee for row in timesheet_rows if (row.customer or "No Client") == group_key}
    project_customers = {
        row.project: row.customer or "No Client" for row in timesheet_rows if row.project
    }
    for allocation in allocations:
        customer = project_customers.get(allocation.project, "No Client")
        if customer == group_key:
            matched_employees.add(allocation.employee)
    return [employee for employee in employees if employee.get("name") in matched_employees]


def _scoped_employees(filters: frappe._dict, employees: list[dict], timesheet_rows: list[dict], allocations: list) -> list[dict]:
    group_by = filters.group_by
    group_key = filters.get("group_key")
    if group_by == "client":
        return _employees_for_client_group(employees, group_key, timesheet_rows, allocations)
    if not group_key:
        return employees
    return [employee for employee in employees if _employee_matches_group(employee, group_by, group_key)]


def _resolve_drill_date_range(filters: frappe._dict) -> tuple:
    start_date = getdate(filters.start_date)
    end_date = getdate(filters.end_date)
    period_key = filters.get("period_key")
    if not period_key:
        return start_date, end_date

    periods = build_period_buckets(
        filters.start_date,
        horizon_months=filters.horizon_months,
        period_type=filters.period_type,
    )
    period = next((item for item in periods if item["key"] == period_key), None)
    if not period:
        frappe.throw("Invalid period_key for drill-down.")
    drill_start = max(start_date, getdate(period["start_date"]))
    drill_end = min(end_date, getdate(period["end_date"]))
    return drill_start, drill_end


def _fetch_timesheet_detail_rows(employee_names: list[str], start_date, end_date) -> list[dict]:
    if not employee_names:
        return []
    return frappe.db.sql(
        """
        SELECT
            td.name,
            td.parent AS timesheet,
            ts.employee,
            COALESCE(e.employee_name, ts.employee) AS employee_name,
            td.project,
            p.project_name,
            p.customer,
            td.activity_type,
            td.is_billable,
            COALESCE(td.hours, 0) AS hours,
            DATE(td.from_time) AS entry_date,
            td.description
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        LEFT JOIN `tabEmployee` e ON e.name = ts.employee
        LEFT JOIN `tabProject` p ON p.name = td.project
        WHERE ts.employee IN %(employees)s
          AND ts.docstatus < 2
          AND DATE(td.from_time) BETWEEN %(start_date)s AND %(end_date)s
        ORDER BY td.from_time DESC
        LIMIT 500
        """,
        {
            "employees": tuple(employee_names),
            "start_date": getdate(start_date),
            "end_date": getdate(end_date),
        },
        as_dict=True,
    )


def _timesheet_records_for_split(rows: list[dict], split_key: str, group_by: str, group_key: str | None) -> list[dict]:
    records: list[dict] = []
    for row in rows:
        classified = _classify_timesheet_hours(row)
        if classified != split_key:
            continue
        if group_by == "client" and group_key:
            customer = row.customer or "No Client"
            if group_key == "Internal / Admin" and classified != "admin":
                continue
            if group_key != "Internal / Admin" and customer != group_key:
                continue
        records.append(
            {
                "label": row.name,
                "date": str(row.entry_date),
                "hours": flt(row.hours, 2),
                "employee": row.employee,
                "employee_name": row.employee_name,
                "project": row.project,
                "project_name": row.project_name,
                "customer": row.customer,
                "activity_type": row.activity_type,
                "meta": f"{row.employee_name} · {row.project_name or row.project or 'No Project'}",
                "description": row.description,
                "reference_doctype": "Timesheet",
                "reference_name": row.timesheet,
            }
        )
    return records


def _leave_records_for_split(
    employees: list[dict],
    start_date,
    end_date,
    split_key: str,
) -> list[dict]:
    records: list[dict] = []
    for employee in employees:
        daily_hours = get_employee_daily_working_norm(employee.get("name"))
        holidays = get_holidays(employee=employee.get("name"), start_date=start_date, end_date=end_date) or []
        leaves = get_employee_leaves(employee.get("name"), start_date, end_date) or []
        date = getdate(start_date)
        end = getdate(end_date)
        while date <= end:
            leave_data = is_on_leave(date, daily_hours, leaves, holidays)
            if not leave_data.get("on_leave"):
                date = add_days(date, 1)
                continue

            consumed = flt(daily_hours - flt(leave_data.get("leave_work_hours") or 0), 2) or daily_hours
            is_holiday = any(getdate(holiday.holiday_date) == date for holiday in holidays)
            if split_key == "holiday" and is_holiday:
                holiday_name = next(
                    (getattr(holiday, "description", None) or holiday.get("description") or "Holiday" for holiday in holidays if getdate(holiday.holiday_date) == date),
                    "Holiday",
                )
                records.append(
                    {
                        "label": f"{employee.get('employee_name')} · {date}",
                        "date": str(date),
                        "hours": consumed,
                        "employee": employee.get("name"),
                        "employee_name": employee.get("employee_name"),
                        "meta": holiday_name,
                        "reference_doctype": None,
                        "reference_name": None,
                    }
                )
            elif split_key == "pto" and not is_holiday:
                leave_doc = next(
                    (
                        leave
                        for leave in leaves
                        if getdate(leave["from_date"]) <= date <= getdate(leave["to_date"])
                    ),
                    None,
                )
                records.append(
                    {
                        "label": leave_doc["name"] if leave_doc else f"{employee.get('employee_name')} · {date}",
                        "date": str(date),
                        "hours": consumed,
                        "employee": employee.get("name"),
                        "employee_name": employee.get("employee_name"),
                        "meta": leave_doc["leave_type"] if leave_doc else "Leave",
                        "reference_doctype": "Leave Application" if leave_doc else None,
                        "reference_name": leave_doc["name"] if leave_doc else None,
                    }
                )
            date = add_days(date, 1)
    return records


TIME_ALLOCATION_DRILL_COLUMNS = [
    {"key": "label", "label": "Record"},
    {"key": "date", "label": "Date"},
    {"key": "hours", "label": "Hours"},
    {"key": "employee_name", "label": "Employee"},
    {"key": "project_name", "label": "Project"},
    {"key": "customer", "label": "Client"},
    {"key": "activity_type", "label": "Activity"},
    {"key": "meta", "label": "Details"},
    {"key": "reference_doctype", "label": "Source DocType"},
    {"key": "reference_name", "label": "Source Document"},
]


def get_time_allocation_drilldown(filters: dict | None = None) -> dict:
    from next_pms.next_pms.utils.analytics_drilldown import build_drilldown_payload

    resolved = _resolve_allocation_filters(filters)
    split_key = resolved.get("split_key")
    if split_key not in SPLIT_KEYS:
        frappe.throw(f"Invalid split_key. Choose one of: {', '.join(SPLIT_KEYS)}")

    drill_start, drill_end = _resolve_drill_date_range(resolved)

    employees, _ = filter_employees(
        employee_name=resolved.get("employee_name"),
        department=resolved.get("department"),
        user_group=resolved.get("user_group"),
        business_unit=resolved.get("business_unit"),
        designation=resolved.get("designation"),
        branch=resolved.get("branch"),
        role_filter=resolved.get("roles"),
        page_length=5000,
        start=0,
        status=["Active"],
        ignore_permissions=True,
    )
    _attach_primary_skills(employees)
    _attach_employee_view_metadata(employees)

    timesheet_rows = _fetch_timesheet_hours(
        [employee.name for employee in employees],
        resolved.start_date,
        resolved.end_date,
    )
    allocations = _fetch_target_hours(
        [employee.name for employee in employees],
        resolved.start_date,
        resolved.end_date,
    )
    scoped_employees = _scoped_employees(resolved, employees, timesheet_rows, allocations)
    scoped_names = [employee.get("name") for employee in scoped_employees]

    if split_key in ("billable", "non_billable", "admin"):
        detail_rows = _fetch_timesheet_detail_rows(scoped_names, drill_start, drill_end)
        records = _timesheet_records_for_split(
            detail_rows,
            split_key,
            resolved.group_by,
            resolved.get("group_key"),
        )
    else:
        records = _leave_records_for_split(scoped_employees, drill_start, drill_end, split_key)

    total_hours = flt(sum(record.get("hours", 0) for record in records), 2)
    filter_payload = {
        "start_date": str(getdate(resolved.start_date)),
        "end_date": str(getdate(resolved.end_date)),
        "group_by": resolved.group_by if resolved.group_by != "employee" else "person",
        "period": resolved.period_type,
        "split_key": split_key,
        "group_key": resolved.get("group_key"),
        "group_label": resolved.get("group_label"),
        "period_key": resolved.get("period_key"),
        "period_label": resolved.get("period_label"),
        "context": resolved.get("context") or "summary",
        "employee_name": resolved.get("employee_name"),
        "department": resolved.get("department"),
        "user_group": resolved.get("user_group"),
    }

    return build_drilldown_payload(
        view="time_allocation",
        filters=filter_payload,
        filter_labels={
            "start_date": "From",
            "end_date": "To",
            "group_by": "Group By",
            "split_key": "Split",
            "group_key": "Group",
            "group_label": "Group",
            "period_key": "Period",
            "period_label": "Period",
            "context": "Context",
            "employee_name": "Employee",
            "department": "Department",
            "user_group": "Team",
        },
        context={
            "split_key": split_key,
            "split_label": split_key.replace("_", " ").title(),
            "group_key": resolved.get("group_key"),
            "group_label": resolved.get("group_label"),
            "period_key": resolved.get("period_key"),
            "period_label": resolved.get("period_label"),
            "drill_start_date": str(drill_start),
            "drill_end_date": str(drill_end),
        },
        records=records,
        columns=TIME_ALLOCATION_DRILL_COLUMNS,
        summary={"total_hours": total_hours, "record_count": len(records)},
    )
