import frappe

from next_pms.api.utils import error_logger
from next_pms.resource_management.api.utils.helpers import resource_api_permissions_check
from next_pms.resource_management.utils.conflicts import (
    detect_allocation_conflicts,
    get_allocation_conflict_settings,
)


@frappe.whitelist()
@error_logger
def get_conflict_settings():
    frappe.has_permission("Timesheet Settings", "read", throw=True)
    return get_allocation_conflict_settings()


@frappe.whitelist(methods=["POST"])
@error_logger
def check_allocation_conflicts(
    employee: str,
    allocation_start_date: str,
    allocation_end_date: str,
    hours_allocated_per_day: float = 0,
    exclude_name: str | None = None,
):
    resource_api_permissions_check()
    return detect_allocation_conflicts(
        employee,
        allocation_start_date,
        allocation_end_date,
        hours_allocated_per_day,
        exclude_name=exclude_name,
    )
