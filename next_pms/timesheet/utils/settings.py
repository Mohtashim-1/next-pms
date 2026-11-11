# Copyright (c) Next PMS contributors
# License: MIT

import frappe
from frappe.utils import flt


DEFAULT_WORKING_HOURS_PER_MONTH = 160.0
WEEKS_PER_MONTH = 4.0


def is_project_required_on_timesheet() -> bool:
	"""Return True when Timesheet Settings → Require Project on Timesheet is enabled."""
	try:
		return bool(frappe.db.get_single_value("Timesheet Settings", "require_project_on_timesheet"))
	except Exception:
		return False


def get_default_working_hours_per_month() -> float:
	"""Timesheet Settings → Default Working Hours Per Month (fallback 160)."""
	try:
		value = frappe.db.get_single_value("Timesheet Settings", "default_working_hours_per_month")
		return flt(value) or DEFAULT_WORKING_HOURS_PER_MONTH
	except Exception:
		return DEFAULT_WORKING_HOURS_PER_MONTH


def get_default_weekly_target_hours() -> float:
	"""Weekly capacity derived from monthly default (160 → 40h/week)."""
	return flt(get_default_working_hours_per_month() / WEEKS_PER_MONTH, 2)


def get_employee_weekly_target_hours(employee: str | None = None) -> float:
	"""
	Weekly hour target for utilization widgets.

	Priority:
	1. Employee Work Schedule + Working Hours
	   - Per Week → use hours as weekly target
	   - Per Day → hours × 5
	2. Else Timesheet Settings → Default Working Hours Per Month ÷ 4
	"""
	if employee:
		row = frappe.db.get_value(
			"Employee",
			employee,
			["custom_work_schedule", "custom_working_hours"],
			as_dict=True,
		) or {}
		schedule = (row.get("custom_work_schedule") or "").strip()
		hours = flt(row.get("custom_working_hours"))
		if schedule and hours > 0:
			if schedule == "Per Day":
				return flt(hours * 5, 2)
			# Per Week (and any other non-daily schedule)
			return flt(hours, 2)

	return get_default_weekly_target_hours()
