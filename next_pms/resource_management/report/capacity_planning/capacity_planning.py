# Copyright (c) 2025, rtCamp and contributors
# For license information, please see license.txt

"""Capacity Planning — optimized for portal multi-company runs.

Hot path used to N+1: per-employee leaves/holidays/salary/billing-rate and
per-day Project lookups. Those are now batched / cached for a single execute().
"""

from __future__ import annotations

import datetime

import frappe
from erpnext.setup.utils import get_exchange_rate
from frappe import _
from frappe.utils import add_days, flt, getdate

from next_pms.resource_management.api.utils.helpers import is_on_leave
from next_pms.resource_management.api.utils.query import (
	get_allocation_list_for_employee_for_given_range,
)
from next_pms.resource_management.report.utils import (
	calculate_employee_available_hours,
	calculate_employee_hours,
	get_employee_allocations_for_date,
)
from next_pms.timesheet.api.employee import get_employee_daily_working_norm
from next_pms.utils.employee import get_employee_salary

CURRENCY = "USD"


def execute(filters=None):
	filters = frappe._dict(filters or {})
	employee_meta = frappe.get_meta("Employee")
	columns = get_columns(employee_meta)
	data = get_data(filters=filters, meta=employee_meta)
	return columns, data


def _company_list(filters) -> list[str]:
	raw = filters.get("company")
	if raw in (None, "", [], ()):
		return []
	if isinstance(raw, str):
		raw = raw.strip()
		if not raw:
			return []
		if raw.startswith("["):
			try:
				parsed = frappe.parse_json(raw)
				if isinstance(parsed, list):
					return [str(c).strip() for c in parsed if c]
			except Exception:
				pass
		return [raw]
	if isinstance(raw, (list, tuple)):
		return [str(c).strip() for c in raw if c]
	return [str(raw)]


def get_data(meta, filters=None):
	start_date = filters.get("from")
	end_date = filters.get("to")
	employee_status = filters.get("status") or "Active"

	fields = ["name as employee", "employee_name", "designation", "status", "company"]
	if meta.has_field("custom_business_unit"):
		fields.append("custom_business_unit")

	emp_filters: dict = {}
	if employee_status:
		emp_filters["status"] = employee_status
	companies = _company_list(filters)
	if companies:
		emp_filters["company"] = ["in", companies]

	employees = frappe.get_all(
		"Employee",
		fields=fields,
		filters=emp_filters,
		order_by="employee_name ASC",
	)
	for employee in employees:
		employee["currency"] = CURRENCY

	if not employees:
		return []

	employee_names = [employee.employee for employee in employees]
	resource_allocations = get_allocation_list_for_employee_for_given_range(
		columns=get_resource_allocation_fields(),
		value_key="employee",
		values=employee_names,
		start_date=start_date,
		end_date=end_date,
	)
	return calculate_hours_and_revenue(employees, resource_allocations, start_date, end_date)


def get_columns(meta):
	has_bu_field = meta.has_field("custom_business_unit")

	columns = [
		{"fieldname": "employee", "label": _("Employee"), "fieldtype": "Link", "options": "Employee"},
		{"fieldname": "employee_name", "label": _("Employee Name"), "fieldtype": "Data"},
		{"fieldname": "status", "label": _("Status"), "fieldtype": "Data"},
		{"fieldname": "designation", "label": _("Designation"), "fieldtype": "Link", "options": "Designation"},
		{
			"fieldname": "custom_business_unit",
			"label": _("Business Unit"),
			"fieldtype": "Link",
			"options": "Business Unit",
		},
		{"fieldname": "booked_hous", "label": _("Booked Hours"), "fieldtype": "Float"},
		{"fieldname": "available_hours", "label": _("Available Hours"), "fieldtype": "Float"},
		{"fieldname": "total_hours", "label": _("Total Hours"), "fieldtype": "Float"},
		{
			"fieldname": "potential_revenue",
			"label": _("Potential Revenue"),
			"fieldtype": "Currency",
			"options": "currency",
		},
		{
			"fieldname": "booked_revenue",
			"label": _("Booked Revenue"),
			"fieldtype": "Currency",
			"options": "currency",
		},
	]
	if not has_bu_field:
		# designation is index 3 when BU column is present at 4; drop BU column
		columns = [c for c in columns if c["fieldname"] != "custom_business_unit"]
	return columns


def get_resource_allocation_fields():
	return [
		"name",
		"employee",
		"employee_name",
		"allocation_start_date",
		"allocation_end_date",
		"hours_allocated_per_day",
		"project",
		"project_name",
		"customer",
		"is_billable",
		"note",
		"total_allocated_hours",
	]


def calculate_hours_and_revenue(employees, resource_allocations, start_date, end_date):
	res = []
	start_date = getdate(start_date)
	end_date = getdate(end_date)

	resource_allocation_map: dict[str, list] = {}
	projects: set[str] = set()
	for resource_allocation in resource_allocations:
		resource_allocation_map.setdefault(resource_allocation.employee, []).append(resource_allocation)
		if resource_allocation.project:
			projects.add(resource_allocation.project)

	# One-shot project + billing-team preload (kills per-day get_value N+1).
	employee_names = [e.employee for e in employees]
	project_info = _preload_projects(projects)
	billing_rates = _preload_billing_rates(projects, employee_names)
	fx_cache: dict[tuple[str, str], float] = {}
	norm_cache: dict[str, float] = {}
	salary_cache: dict[str, float] = {}
	# Batch leaves + holidays for all employees (same approach as Employee Billability).
	leave_holiday_map = _batch_leaves_and_holidays(employee_names, start_date, end_date)

	for employee in employees:
		employee_allocations = resource_allocation_map.get(employee.employee, [])
		if not employee_allocations and employee.status != "Active":
			continue

		emp_id = employee.employee
		if emp_id not in norm_cache:
			try:
				norm_cache[emp_id] = flt(get_employee_daily_working_norm(emp_id) or 8)
			except Exception:
				norm_cache[emp_id] = 8.0
		daily_hours = norm_cache[emp_id]

		lh = leave_holiday_map.get(emp_id) or {"holidays": [], "leaves": []}
		holidays = lh.get("holidays") or []
		leaves = lh.get("leaves") or []

		billable_allocations = [r for r in employee_allocations if r.is_billable]
		non_billable_allocations = [r for r in employee_allocations if not r.is_billable]

		employee_free_hours = calculate_employee_available_hours(
			daily_hours, start_date, end_date, employee_allocations, holidays, leaves
		)
		employee_billable_hours = calculate_employee_hours(
			daily_hours, start_date, end_date, billable_allocations, holidays, leaves
		)
		employee_non_billable_hours = calculate_employee_hours(
			daily_hours, start_date, end_date, non_billable_allocations, holidays, leaves
		)

		if emp_id not in salary_cache:
			try:
				salary_cache[emp_id] = flt(
					get_employee_salary(emp_id, CURRENCY, throw=False).get("hourly_salary", 0)
				)
			except Exception:
				salary_cache[emp_id] = 0.0
		free_hours_revenue = (salary_cache[emp_id] * 3) * employee_free_hours

		employee["booked_hous"] = employee_billable_hours
		employee["available_hours"] = employee_free_hours + employee_non_billable_hours
		employee["booked_revenue"] = _period_revenue(
			emp_id,
			billable_allocations,
			start_date,
			end_date,
			daily_hours,
			holidays,
			leaves,
			project_info,
			billing_rates,
			fx_cache,
		)
		employee["potential_revenue"] = (
			_period_revenue(
				emp_id,
				non_billable_allocations,
				start_date,
				end_date,
				daily_hours,
				holidays,
				leaves,
				project_info,
				billing_rates,
				fx_cache,
			)
			+ free_hours_revenue
		)
		employee["total_hours"] = employee_billable_hours + employee_free_hours + employee_non_billable_hours
		res.append(employee)
	return res


def _batch_leaves_and_holidays(employee_names: list[str], start_date, end_date) -> dict[str, dict]:
	"""Preload holidays + approved leaves for many employees in a few queries."""
	from collections import defaultdict

	out = {emp: {"holidays": [], "leaves": []} for emp in employee_names}
	if not employee_names:
		return out

	emp_rows = frappe.get_all(
		"Employee",
		filters={"name": ["in", employee_names]},
		fields=["name", "holiday_list", "company"],
	)
	company_ids = list({r.company for r in emp_rows if r.company})
	company_hl = {}
	if company_ids and frappe.db.has_column("Company", "default_holiday_list"):
		company_hl = {
			r.name: r.default_holiday_list
			for r in frappe.get_all(
				"Company",
				filters={"name": ["in", company_ids]},
				fields=["name", "default_holiday_list"],
			)
			if r.default_holiday_list
		}
	emp_hl = {r.name: r.holiday_list or company_hl.get(r.company) for r in emp_rows}
	list_names = {hl for hl in emp_hl.values() if hl}
	holidays_by_list: dict[str, list] = defaultdict(list)
	if list_names:
		for row in frappe.get_all(
			"Holiday",
			filters={
				"parent": ["in", list(list_names)],
				"holiday_date": ["between", [start_date, end_date]],
			},
			fields=["parent", "holiday_date"],
		):
			holidays_by_list[row.parent].append(frappe._dict(holiday_date=getdate(row.holiday_date)))
	for emp_id, hl in emp_hl.items():
		out[emp_id]["holidays"] = list(holidays_by_list.get(hl) or []) if hl else []

	if frappe.db.exists("DocType", "Leave Application"):
		for row in frappe.db.sql(
			"""
			SELECT employee, from_date, to_date, total_leave_days, half_day, half_day_date
			FROM `tabLeave Application`
			WHERE docstatus = 1 AND status = 'Approved'
			  AND employee IN %(employees)s
			  AND from_date <= %(end)s AND to_date >= %(start)s
			""",
			{"employees": employee_names, "start": start_date, "end": end_date},
			as_dict=True,
		):
			out.setdefault(row.employee, {"holidays": [], "leaves": []})["leaves"].append(row)
	return out


def _preload_projects(projects: set[str]) -> dict[str, dict]:
	if not projects:
		return {}
	rows = frappe.get_all(
		"Project",
		filters={"name": ["in", list(projects)]},
		fields=[
			"name",
			"custom_currency",
			"custom_billing_type",
			"custom_default_hourly_billing_rate",
		],
	)
	return {r.name: r for r in rows}


def _preload_billing_rates(projects: set[str], employees: list[str]) -> dict[tuple[str, str], float]:
	"""Map (project, employee) → hourly_billing_rate from Project Billing Team."""
	if not projects or not employees:
		return {}
	if not frappe.db.exists("DocType", "Project Billing Team"):
		return {}
	rows = frappe.get_all(
		"Project Billing Team",
		filters={"parent": ["in", list(projects)], "employee": ["in", employees]},
		fields=["parent", "employee", "hourly_billing_rate"],
	)
	return {(r.parent, r.employee): flt(r.hourly_billing_rate) for r in rows}


def _hourly_rate(employee: str, project: str, project_info: dict, billing_rates: dict) -> float:
	info = project_info.get(project)
	if not info:
		return 0.0
	billing_type = info.get("custom_billing_type")
	if billing_type == "Non-Billable":
		return 0.0
	if billing_type in ("Fixed Cost", "Retainer"):
		return flt(info.get("custom_default_hourly_billing_rate"))
	return flt(billing_rates.get((project, employee)) or 0)


def _period_revenue(
	employee: str,
	allocations: list,
	start_date: datetime.date,
	end_date: datetime.date,
	daily_hours: float,
	holidays,
	leaves,
	project_info: dict,
	billing_rates: dict,
	fx_cache: dict,
) -> float:
	if not allocations:
		return 0.0

	total_revenue = 0.0
	cursor = start_date
	while cursor <= end_date:
		data = is_on_leave(cursor, daily_hours, leaves, holidays)
		if not data.get("on_leave"):
			for allocation in get_employee_allocations_for_date(allocations, cursor):
				project = allocation.project
				if not project:
					continue
				rate = _hourly_rate(employee, project, project_info, billing_rates)
				if not rate:
					continue
				currency = (project_info.get(project) or {}).get("custom_currency") or CURRENCY
				if currency != CURRENCY:
					fx_key = (currency, CURRENCY)
					if fx_key not in fx_cache:
						try:
							fx_cache[fx_key] = flt(get_exchange_rate(currency, CURRENCY) or 1)
						except Exception:
							fx_cache[fx_key] = 1.0
					rate = rate * fx_cache[fx_key]
				total_revenue += flt(allocation.hours_allocated_per_day) * rate
		cursor = add_days(cursor, 1)
	return total_revenue
