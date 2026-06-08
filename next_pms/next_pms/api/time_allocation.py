import json

import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.analytics_drilldown import records_to_csv, set_csv_download_response
from next_pms.next_pms.utils.time_allocation import (
    GROUP_BY_OPTIONS,
    TIME_ALLOCATION_DRILL_COLUMNS,
    get_time_allocation_drilldown,
    get_time_allocation_view,
)
from next_pms.resource_management.api.utils.helpers import resource_api_permissions_check


@whitelist()
@error_logger
def get_allocation_view(
    start_date: str,
    end_date: str,
    group_by: str = "team",
    period: str = "week",
    horizon_months: int = 3,
    employee_name: str | None = None,
    department: str | None = None,
    user_group: str | None = None,
    business_unit: str | None = None,
    designation: str | None = None,
    branch: str | None = None,
    roles: str | None = None,
):
    permissions = resource_api_permissions_check()
    if not permissions.get("read") and not permissions.get("write"):
        frappe.throw("You do not have permission to view time allocation analytics.", frappe.PermissionError)

    if group_by not in GROUP_BY_OPTIONS:
        frappe.throw(f"Invalid group_by. Choose one of: {', '.join(GROUP_BY_OPTIONS)}")

    def _parse_list(value):
        if not value:
            return None
        if isinstance(value, str):
            return json.loads(value)
        return value

    return get_time_allocation_view(
        {
            "start_date": start_date,
            "end_date": end_date,
            "group_by": group_by,
            "period": period,
            "horizon_months": horizon_months,
            "employee_name": employee_name,
            "department": _parse_list(department),
            "user_group": _parse_list(user_group),
            "business_unit": _parse_list(business_unit),
            "designation": _parse_list(designation),
            "branch": _parse_list(branch),
            "roles": _parse_list(roles),
        }
    )


def _allocation_drilldown_filters(
    start_date: str,
    end_date: str,
    split_key: str,
    group_by: str = "team",
    period: str = "week",
    horizon_months: int = 3,
    group_key: str | None = None,
    group_label: str | None = None,
    period_key: str | None = None,
    period_label: str | None = None,
    context: str = "summary",
    employee_name: str | None = None,
    department: str | None = None,
    user_group: str | None = None,
    business_unit: str | None = None,
    designation: str | None = None,
    branch: str | None = None,
    roles: str | None = None,
):
    def _parse_list(value):
        if not value:
            return None
        if isinstance(value, str):
            return json.loads(value)
        return value

    return {
        "start_date": start_date,
        "end_date": end_date,
        "group_by": group_by,
        "period": period,
        "horizon_months": horizon_months,
        "split_key": split_key,
        "group_key": group_key,
        "group_label": group_label or group_key,
        "period_key": period_key,
        "period_label": period_label or period_key,
        "context": context,
        "employee_name": employee_name,
        "department": _parse_list(department),
        "user_group": _parse_list(user_group),
        "business_unit": _parse_list(business_unit),
        "designation": _parse_list(designation),
        "branch": _parse_list(branch),
        "roles": _parse_list(roles),
    }


@whitelist()
@error_logger
def get_drilldown(
    start_date: str,
    end_date: str,
    split_key: str,
    group_by: str = "team",
    period: str = "week",
    horizon_months: int = 3,
    group_key: str | None = None,
    group_label: str | None = None,
    period_key: str | None = None,
    period_label: str | None = None,
    context: str = "summary",
    employee_name: str | None = None,
    department: str | None = None,
    user_group: str | None = None,
    business_unit: str | None = None,
    designation: str | None = None,
    branch: str | None = None,
    roles: str | None = None,
):
    permissions = resource_api_permissions_check()
    if not permissions.get("read") and not permissions.get("write"):
        frappe.throw("You do not have permission to view time allocation analytics.", frappe.PermissionError)

    if group_by not in GROUP_BY_OPTIONS:
        frappe.throw(f"Invalid group_by. Choose one of: {', '.join(GROUP_BY_OPTIONS)}")

    return get_time_allocation_drilldown(
        _allocation_drilldown_filters(
            start_date=start_date,
            end_date=end_date,
            split_key=split_key,
            group_by=group_by,
            period=period,
            horizon_months=horizon_months,
            group_key=group_key,
            group_label=group_label,
            period_key=period_key,
            period_label=period_label,
            context=context,
            employee_name=employee_name,
            department=department,
            user_group=user_group,
            business_unit=business_unit,
            designation=designation,
            branch=branch,
            roles=roles,
        )
    )


@whitelist()
@error_logger
def export_drilldown(
    start_date: str,
    end_date: str,
    split_key: str,
    group_by: str = "team",
    period: str = "week",
    horizon_months: int = 3,
    group_key: str | None = None,
    group_label: str | None = None,
    period_key: str | None = None,
    period_label: str | None = None,
    context: str = "summary",
    employee_name: str | None = None,
    department: str | None = None,
    user_group: str | None = None,
    business_unit: str | None = None,
    designation: str | None = None,
    branch: str | None = None,
    roles: str | None = None,
):
    permissions = resource_api_permissions_check()
    if not permissions.get("read") and not permissions.get("write"):
        frappe.throw("You do not have permission to export time allocation drill-down.", frappe.PermissionError)

    payload = get_time_allocation_drilldown(
        _allocation_drilldown_filters(
            start_date=start_date,
            end_date=end_date,
            split_key=split_key,
            group_by=group_by,
            period=period,
            horizon_months=horizon_months,
            group_key=group_key,
            group_label=group_label,
            period_key=period_key,
            period_label=period_label,
            context=context,
            employee_name=employee_name,
            department=department,
            user_group=user_group,
            business_unit=business_unit,
            designation=designation,
            branch=branch,
            roles=roles,
        )
    )
    csv_content = records_to_csv(payload.get("records") or [], TIME_ALLOCATION_DRILL_COLUMNS)
    filename = f"time-allocation-{split_key}-{start_date}-to-{end_date}.csv"
    set_csv_download_response(csv_content, filename)
