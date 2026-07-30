# Copyright (c) 2026, Act Holding and contributors
# For license information, please see license.txt

"""Employee-level timesheet hours summary with drill-down to detail by employee."""

from __future__ import annotations

from datetime import timedelta

import frappe
from frappe import _
from frappe.query_builder import DocType
from frappe.query_builder.functions import Sum
from frappe.utils import flt, formatdate, get_datetime, getdate


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
			"width": 220,
			# Portal viewer: click opens Timesheet Hours Detail for this employee + dates
			"drilldown_report": "Timesheet Hours Detail",
			"drilldown_filters": ["employee", "from_date", "to_date", "company"],
		},
		{
			"fieldname": "duration",
			"label": _("Duration (from-to)"),
			"fieldtype": "Data",
			"width": 220,
		},
		{
			"fieldname": "total_hours",
			"label": _("Total Hours"),
			"fieldtype": "Float",
			"width": 120,
			"precision": 2,
			"drilldown_report": "Timesheet Hours Detail",
			"drilldown_filters": ["employee", "from_date", "to_date", "company"],
		},
	]


def get_data(filters):
	rows = _fetch_employee_totals(filters)
	duration = _duration_label(filters)
	from_date = filters.get("from_date")
	to_date = filters.get("to_date")
	company = filters.get("company") or ""
	data = []
	for idx, row in enumerate(rows, start=1):
		data.append(
			{
				"serial_no": idx,
				"employee": row.employee,
				"employee_name": row.employee_name or row.employee,
				"duration": duration,
				"total_hours": flt(row.total_hours, 2),
				"from_date": from_date,
				"to_date": to_date,
				"company": company,
			}
		)
	return data


def _duration_label(filters) -> str:
	from_date = filters.get("from_date")
	to_date = filters.get("to_date")
	if not from_date or not to_date:
		return ""
	return f"{formatdate(from_date)} - {formatdate(to_date)}"


def _fetch_employee_totals(filters):
	timesheet = DocType("Timesheet")
	detail = DocType("Timesheet Detail")
	from_dt = get_datetime(filters.get("from_date"))
	to_dt = get_datetime(getdate(filters.get("to_date")) + timedelta(days=1))

	query = (
		frappe.qb.from_(timesheet)
		.inner_join(detail)
		.on(detail.parent == timesheet.name)
		.select(
			timesheet.employee,
			timesheet.employee_name,
			Sum(detail.hours).as_("total_hours"),
		)
		.where(detail.from_time >= from_dt)
		.where(detail.from_time < to_dt)
		.where(timesheet.docstatus.isin([0, 1]))
		.groupby(timesheet.employee, timesheet.employee_name)
		.orderby(timesheet.employee_name)
	)

	if filters.get("employee"):
		query = query.where(timesheet.employee == filters.get("employee"))
	if filters.get("company"):
		companies = filters.get("company")
		if isinstance(companies, (list, tuple)):
			if companies:
				query = query.where(timesheet.company.isin(list(companies)))
		else:
			query = query.where(timesheet.company == companies)

	return query.run(as_dict=True)
