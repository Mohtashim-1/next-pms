# Copyright (c) 2025, rtCamp and contributors
# For license information, please see license.txt

"""Employee Billability — optimized for portal multi-company runs.

Capacity used to load Holiday List + leaves per employee (N+1). Timesheets were
already batched; capacity / joining-date lookups are now batched too.
"""

from __future__ import annotations

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, flt, getdate, month_diff

from next_pms.resource_management.api.utils.helpers import is_on_leave
from next_pms.timesheet.api.employee import get_employee_daily_working_norm


def execute(filters=None):
	filters = frappe._dict(filters or {})
	columns = get_columns()
	data = get_data(filters)
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


def get_data(filters):
	res = []
	employees = get_employees(
		designation=filters.get("designation"),
		status=filters.get("status") or "Active",
		companies=_company_list(filters),
	)
	if not employees:
		return []

	employee_names = [employee.employee for employee in employees]
	start_date = getdate(filters.get("from"))
	end_date = getdate(filters.get("to"))

	time_entries = get_employee_time(start_date, end_date, employee_names)
	capacity_map = get_capacity_hours_batch(employees, start_date, end_date)

	today = getdate()
	for employee in employees:
		employee_time_entry = time_entries.get(employee.employee) or {}
		billable_hours = flt(employee_time_entry.get("billable_hours"))
		valuable_hours = flt(employee_time_entry.get("valuable_hours"))
		if not billable_hours and not valuable_hours and employee.status != "Active":
			continue

		capacity_hours = flt(capacity_map.get(employee.employee))
		joining = getdate(employee.date_of_joining) if employee.date_of_joining else today
		number_of_years = year_diff(today, joining)

		employee["number_of_years"] = number_of_years
		employee["capacity_hours"] = capacity_hours
		employee["billable_hours"] = billable_hours
		employee["valuable_hours"] = valuable_hours
		employee["untracked_hours"] = capacity_hours - (billable_hours + valuable_hours)
		employee["billing_percentage"] = (billable_hours / capacity_hours * 100.0) if capacity_hours else 0.0
		employee["deficit"] = get_deficit(capacity_hours, billable_hours, number_of_years)
		res.append(employee)
	return res


def get_columns():
	return [
		{"fieldname": "employee", "label": _("Employee"), "fieldtype": "Link", "options": "Employee", "width": 200},
		{"fieldname": "employee_name", "label": _("Employee Name"), "fieldtype": "Data"},
		{"fieldname": "status", "label": _("Status"), "fieldtype": "Data"},
		{"fieldname": "number_of_years", "label": _("Number of Years"), "fieldtype": "Int"},
		{"fieldname": "capacity_hours", "label": _("Capacity Hours"), "fieldtype": "Float"},
		{"fieldname": "billable_hours", "label": _("Billable Hours"), "fieldtype": "Float"},
		{"fieldname": "valuable_hours", "label": _("Valuable Hours"), "fieldtype": "Float"},
		{"fieldname": "untracked_hours", "label": _("Untracked Hours"), "fieldtype": "Float"},
		{"fieldname": "billing_percentage", "label": _("Billing %"), "fieldtype": "Percent"},
		{"fieldname": "deficit", "label": _("Deficit"), "fieldtype": "Float"},
	]


def get_employees(designation=None, status=None, companies=None):
	filters: dict = {}
	if designation:
		if isinstance(designation, str):
			designation = [designation] if designation else []
		if designation:
			filters["designation"] = ["in", designation]
	if status:
		filters["status"] = status
	if companies:
		filters["company"] = ["in", companies]

	employees = frappe.get_all(
		"Employee",
		filters=filters,
		fields=["name as employee", "employee_name", "date_of_joining", "status", "company"],
		order_by="employee_name ASC",
	)
	# Joining date: use Employee.date_of_joining (work-history walk was an N+1).
	# Most sites already store the effective joining date on the employee.
	return employees


def year_diff(string_ed_date, string_st_date):
	month = month_diff(string_ed_date, string_st_date)
	return month / 12


def get_capacity_hours_batch(employees: list, start_date, end_date) -> dict[str, float]:
	"""Compute capacity hours for all employees with batched holiday/leave loads."""
	if not employees:
		return {}

	start_date = getdate(start_date)
	end_date = getdate(end_date)
	names = [e.employee for e in employees]

	# Daily norms (cached per call)
	norm_cache: dict[str, float] = {}
	for emp_id in names:
		try:
			norm_cache[emp_id] = flt(get_employee_daily_working_norm(emp_id) or 8)
		except Exception:
			norm_cache[emp_id] = 8.0

	# Holiday dates by employee via Holiday List assignment (employee or company default)
	emp_rows = frappe.get_all(
		"Employee",
		filters={"name": ["in", names]},
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

	emp_holiday_list = {
		r.name: r.holiday_list or company_hl.get(r.company)
		for r in emp_rows
	}
	list_names = {hl for hl in emp_holiday_list.values() if hl}
	holidays_by_list: dict[str, set] = defaultdict(set)
	if list_names:
		for row in frappe.get_all(
			"Holiday",
			filters={
				"parent": ["in", list(list_names)],
				"holiday_date": ["between", [start_date, end_date]],
			},
			fields=["parent", "holiday_date"],
		):
			holidays_by_list[row.parent].add(getdate(row.holiday_date))

	holiday_by_emp: dict[str, list] = {}
	for emp_id, hl in emp_holiday_list.items():
		holiday_by_emp[emp_id] = [
			frappe._dict(holiday_date=d) for d in (holidays_by_list.get(hl) or ())
		] if hl else []

	# Leaves overlapping the window
	leaves_by_emp: dict[str, list] = defaultdict(list)
	if frappe.db.exists("DocType", "Leave Application"):
		leave_rows = frappe.db.sql(
			"""
			SELECT employee, from_date, to_date, total_leave_days, half_day, half_day_date
			FROM `tabLeave Application`
			WHERE docstatus = 1
			  AND status = 'Approved'
			  AND employee IN %(employees)s
			  AND from_date <= %(end)s
			  AND to_date >= %(start)s
			""",
			{"employees": names, "start": start_date, "end": end_date},
			as_dict=True,
		)
		for row in leave_rows:
			leaves_by_emp[row.employee].append(row)

	# Walk the date range per employee (CPU-bound, no further DB).
	result: dict[str, float] = {}
	for emp in employees:
		emp_id = emp.employee
		daily_hours = norm_cache.get(emp_id, 8.0)
		joining = getdate(emp.date_of_joining) if emp.date_of_joining else start_date
		holidays = holiday_by_emp.get(emp_id, [])
		leaves = leaves_by_emp.get(emp_id, [])

		total = 0.0
		cursor = start_date
		while cursor <= end_date:
			if cursor < joining:
				cursor = add_days(cursor, 1)
				continue
			data = is_on_leave(cursor, daily_hours, leaves, holidays)
			if not data.get("on_leave"):
				total += daily_hours
			else:
				total += flt(data.get("leave_work_hours"))
			cursor = add_days(cursor, 1)
		result[emp_id] = total
	return result


def get_employee_time(start_date, end_date, employee_names):
	data = {emp: {"billable_hours": 0.0, "valuable_hours": 0.0} for emp in employee_names}
	if not employee_names:
		return data

	# Aggregate in SQL — far cheaper than pulling every timesheet row into Python.
	rows = frappe.db.sql(
		"""
		SELECT
			ts.employee AS employee,
			SUM(CASE WHEN IFNULL(tsd.is_billable, 0) = 1 THEN IFNULL(tsd.hours, 0) ELSE 0 END) AS billable_hours,
			SUM(CASE WHEN IFNULL(tsd.is_billable, 0) = 0 THEN IFNULL(tsd.hours, 0) ELSE 0 END) AS valuable_hours
		FROM `tabTimesheet Detail` tsd
		INNER JOIN `tabTimesheet` ts ON ts.name = tsd.parent
		WHERE ts.docstatus < 2
		  AND ts.employee IN %(employees)s
		  AND DATE(tsd.from_time) BETWEEN %(start)s AND %(end)s
		GROUP BY ts.employee
		""",
		{"employees": employee_names, "start": start_date, "end": end_date},
		as_dict=True,
	)
	for row in rows:
		data[row.employee] = {
			"billable_hours": flt(row.billable_hours),
			"valuable_hours": flt(row.valuable_hours),
		}
	return data


def get_deficit(capacity_hours, billable_hours, years):
	if years > 5:
		threshold = 0.9
	elif years > 2:
		threshold = 0.8
	else:
		threshold = 0.4
	return (capacity_hours * threshold) - billable_hours
