import frappe


DEFAULT_UNDER_UTILIZED_THRESHOLD = 70
DEFAULT_OVER_CAPACITY_THRESHOLD = 100


def _normalize_percent(value, default: float) -> float:
    if value in (None, ""):
        return default
    return float(value)


def get_global_utilization_thresholds() -> dict:
    under_utilized = _normalize_percent(
        frappe.db.get_single_value("Timesheet Settings", "under_utilized_threshold"),
        DEFAULT_UNDER_UTILIZED_THRESHOLD,
    )
    over_capacity = _normalize_percent(
        frappe.db.get_single_value("Timesheet Settings", "over_capacity_threshold"),
        DEFAULT_OVER_CAPACITY_THRESHOLD,
    )

    if over_capacity < under_utilized:
        over_capacity = under_utilized

    return {
        "under_utilized_max": under_utilized / 100,
        "over_capacity_min": over_capacity / 100,
    }


def get_employee_utilization_thresholds(employee: str | None = None) -> dict:
    thresholds = get_global_utilization_thresholds()

    if not employee:
        return thresholds

    employee_doc = frappe.db.get_value(
        "Employee",
        employee,
        ["custom_under_utilized_threshold", "custom_over_capacity_threshold"],
        as_dict=True,
    )

    if not employee_doc:
        return thresholds

    if employee_doc.get("custom_under_utilized_threshold") not in (None, ""):
        thresholds["under_utilized_max"] = float(employee_doc.custom_under_utilized_threshold) / 100

    if employee_doc.get("custom_over_capacity_threshold") not in (None, ""):
        thresholds["over_capacity_min"] = float(employee_doc.custom_over_capacity_threshold) / 100

    if thresholds["over_capacity_min"] < thresholds["under_utilized_max"]:
        thresholds["over_capacity_min"] = thresholds["under_utilized_max"]

    return thresholds


def get_utilization_band(utilization: float, thresholds: dict | None = None) -> str:
    thresholds = thresholds or get_global_utilization_thresholds()

    if utilization > thresholds["over_capacity_min"]:
        return "over_capacity"
    if utilization >= thresholds["under_utilized_max"]:
        return "target"
    return "under_utilized"
