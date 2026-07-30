# Copyright (c) 2026, Act Holding and contributors
# For license information, please see license.txt

"""Line-level timesheet hours with Timesheet ID drill-down and employee subtotals."""

from __future__ import annotations

from datetime import timedelta

import frappe
from frappe import _
from frappe.query_builder import DocType
from frappe.utils import flt, format_datetime, get_datetime, getdate


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{"fieldname": "serial_no", "label": _("S.No"), "fieldtype": "Int", "width": 70},
		{
			"fieldname": "employee_name",
			"label": _("Employee Name"),
			"fieldtype": "Data",
			"width": 180,
		},
		{
			"fieldname": "duration",
			"label": _("Duration (from-to)"),
			"fieldtype": "Data",
			"width": 220,
		},
		{
			"fieldname": "project",
			"label": _("Project"),
			"fieldtype": "Link",
			"options": "Project",
			"width": 160,
		},
		{
			"fieldname": "task",
			"label": _("Task"),
			"fieldtype": "Link",
			"options": "Task",
			"width": 140,
		},
		{
			"fieldname": "task_subject",
			"label": _("Task Subject"),
			"fieldtype": "Data",
			"width": 180,
		},
		{
			"fieldname": "timesheet",
			"label": _("Timesheet ID"),
			"fieldtype": "Link",
			"options": "Timesheet",
			"width": 150,
		},
		{
			"fieldname": "total_hours",
			"label": _("Total Hours"),
			"fieldtype": "Float",
			"width": 110,
			"precision": 2,
		},
	]


def get_data(filters):
	rows = _fetch_detail_rows(filters)
	data = []
	serial = 0
	current_employee = None
	employee_hours = 0.0
	employee_name = ""
	grand_total = 0.0

	def append_subtotal():
		nonlocal employee_hours
		if current_employee is None:
			return
		data.append(
			{
				"serial_no": None,
				"employee": current_employee,
				"employee_name": _("{0} total").format(employee_name),
				"duration": "",
				"project": "",
				"task": "",
				"task_subject": "",
				"timesheet": "",
				"total_hours": flt(employee_hours, 2),
				"is_group": 1,
			}
		)
		employee_hours = 0.0

	for row in rows:
		emp = row.employee
		if current_employee is not None and emp != current_employee:
			append_subtotal()

		if emp != current_employee:
			current_employee = emp
			employee_name = row.employee_name or emp
			employee_hours = 0.0

		hours = flt(row.hours)
		serial += 1
		employee_hours += hours
		grand_total += hours
		duration = ""
		if row.from_time and row.to_time:
			duration = f"{format_datetime(row.from_time)} - {format_datetime(row.to_time)}"
		elif row.from_time:
			duration = format_datetime(row.from_time)

		data.append(
			{
				"serial_no": serial,
				"employee": emp,
				"employee_name": row.employee_name or emp,
				"duration": duration,
				"project": row.project or "",
				"task": row.task or "",
				"task_subject": row.task_subject or "",
				"timesheet": row.timesheet or "",
				"total_hours": flt(hours, 2),
				"is_group": 0,
			}
		)

	append_subtotal()

	if data:
		data.append(
			{
				"serial_no": None,
				"employee_name": "Total",
				"duration": "",
				"project": "",
				"task": "",
				"task_subject": "",
				"timesheet": "",
				"total_hours": flt(grand_total, 2),
				"is_group": 1,
			}
		)

	return data


def _fetch_detail_rows(filters):
	timesheet = DocType("Timesheet")
	detail = DocType("Timesheet Detail")
	task = DocType("Task")
	from_dt = get_datetime(filters.get("from_date"))
	to_dt = get_datetime(getdate(filters.get("to_date")) + timedelta(days=1))

	query = (
		frappe.qb.from_(timesheet)
		.inner_join(detail)
		.on(detail.parent == timesheet.name)
		.left_join(task)
		.on(task.name == detail.task)
		.select(
			timesheet.employee,
			timesheet.employee_name,
			timesheet.name.as_("timesheet"),
			detail.project,
			detail.task,
			task.subject.as_("task_subject"),
			detail.from_time,
			detail.to_time,
			detail.hours,
		)
		.where(detail.from_time >= from_dt)
		.where(detail.from_time < to_dt)
		.where(timesheet.docstatus.isin([0, 1]))
		.orderby(timesheet.employee_name)
		.orderby(detail.from_time)
	)

	if filters.get("employee"):
		query = query.where(timesheet.employee == filters.get("employee"))
	if filters.get("project"):
		query = query.where(detail.project == filters.get("project"))
	if filters.get("task"):
		query = query.where(detail.task == filters.get("task"))
	if filters.get("company"):
		companies = filters.get("company")
		if isinstance(companies, (list, tuple)):
			if companies:
				query = query.where(timesheet.company.isin(list(companies)))
		else:
			query = query.where(timesheet.company == companies)

	return query.run(as_dict=True)
