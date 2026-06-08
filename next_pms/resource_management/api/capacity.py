import frappe

from next_pms.api.utils import error_logger
from next_pms.resource_management.utils.capacity_thresholds import (
    get_employee_utilization_thresholds,
    get_global_utilization_thresholds,
)


@frappe.whitelist()
@error_logger
def get_utilization_threshold_settings(employee: str | None = None):
    frappe.has_permission("Timesheet Settings", "read", throw=True)
    return {
        "global": get_global_utilization_thresholds(),
        "employee": get_employee_utilization_thresholds(employee) if employee else None,
    }
