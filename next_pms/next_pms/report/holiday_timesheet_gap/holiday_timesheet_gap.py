# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_months, flt, getdate, today


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Date"), "fieldname": "work_date", "fieldtype": "Date", "width": 110},
		{"label": _("Employee"), "fieldname": "employee", "fieldtype": "Link", "options": "Employee", "width": 110},
		{"label": _("Employee Name"), "fieldname": "employee_name", "fieldtype": "Data", "width": 160},
		{"label": _("Company"), "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 160},
		{"label": _("Holiday List"), "fieldname": "holiday_list", "fieldtype": "Link", "options": "Holiday List", "width": 180},
		{"label": _("Holiday"), "fieldname": "holiday_description", "fieldtype": "Data", "width": 140},
		{"label": _("Hours Logged"), "fieldname": "hours", "fieldtype": "Float", "width": 110},
		{"label": _("Billable Hours"), "fieldname": "billable_hours", "fieldtype": "Float", "width": 120},
		{"label": _("Project"), "fieldname": "project", "fieldtype": "Link", "options": "Project", "width": 130},
		{"label": _("Timesheet"), "fieldname": "timesheet", "fieldtype": "Link", "options": "Timesheet", "width": 140},
	]


def get_data(filters):
	from_date = getdate(filters.get("from_date") or add_months(today(), -1))
	to_date = getdate(filters.get("to_date") or today())
	company = filters.get("company")

	holiday_rows = frappe.db.sql(
		"""
		SELECT h.parent AS holiday_list, h.holiday_date, h.description, IFNULL(h.weekly_off, 0) AS weekly_off
		FROM `tabHoliday` h
		WHERE h.holiday_date BETWEEN %(from_date)s AND %(to_date)s
		""",
		{"from_date": from_date, "to_date": to_date},
		as_dict=True,
	)
	if not holiday_rows:
		return []

	# Map holiday_list -> {date: description}
	holiday_map: dict[str, dict] = {}
	for row in holiday_rows:
		holiday_map.setdefault(row.holiday_list, {})[getdate(row.holiday_date)] = row.description or (
			"Weekly Off" if row.weekly_off else "Holiday"
		)

	emp_filters = {"status": "Active"}
	if company:
		emp_filters["company"] = company
	employees = frappe.get_all(
		"Employee",
		filters=emp_filters,
		fields=["name", "employee_name", "company", "holiday_list"],
	)
	emp_by_name = {e.name: e for e in employees}
	emp_names = list(emp_by_name)

	if not emp_names:
		return []

	logs = frappe.db.sql(
		"""
		SELECT
			t.name AS timesheet,
			t.employee,
			t.employee_name,
			t.company,
			DATE(td.from_time) AS work_date,
			SUM(td.hours) AS hours,
			SUM(CASE WHEN IFNULL(td.is_billable, 0)=1 THEN td.hours ELSE 0 END) AS billable_hours,
			MAX(td.project) AS project
		FROM `tabTimesheet Detail` td
		INNER JOIN `tabTimesheet` t ON t.name = td.parent
		WHERE t.docstatus < 2
		  AND t.employee IN %(employees)s
		  AND DATE(td.from_time) BETWEEN %(from_date)s AND %(to_date)s
		GROUP BY t.name, t.employee, DATE(td.from_time)
		ORDER BY work_date DESC, t.employee_name
		""",
		{"employees": emp_names, "from_date": from_date, "to_date": to_date},
		as_dict=True,
	)

	data = []
	for log in logs:
		emp = emp_by_name.get(log.employee)
		if not emp:
			continue
		hl = emp.holiday_list
		if not hl:
			continue
		day = getdate(log.work_date)
		desc = holiday_map.get(hl, {}).get(day)
		if not desc:
			continue
		data.append(
			{
				"work_date": day,
				"employee": log.employee,
				"employee_name": log.employee_name,
				"company": log.company or emp.company,
				"holiday_list": hl,
				"holiday_description": desc,
				"hours": flt(log.hours, 2),
				"billable_hours": flt(log.billable_hours, 2),
				"project": log.project,
				"timesheet": log.timesheet,
			}
		)
	return data
