# Copyright (c) 2026, Act Holding and contributors
# For license information, please see license.txt

"""Employee-wise timesheet hours with in-report drill-down.

Hierarchy (expand in the portal viewer):
  Employee → Project → Work type (activity) → Time entry
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

import frappe
from frappe import _
from frappe.query_builder import DocType
from frappe.utils import flt, format_datetime, formatdate, get_datetime, getdate


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data, summary = get_data(filters)
	return columns, data, None, None, summary


def get_columns():
	return [
		{
			"fieldname": "label",
			"label": _("Employee / Project / Work type / Entry"),
			"fieldtype": "Data",
			"width": 320,
		},
		{
			"fieldname": "project",
			"label": _("Project"),
			"fieldtype": "Link",
			"options": "Project",
			"width": 160,
		},
		{
			"fieldname": "activity_type",
			"label": _("Work type"),
			"fieldtype": "Data",
			"width": 130,
		},
		{
			"fieldname": "duration",
			"label": _("When"),
			"fieldtype": "Data",
			"width": 220,
		},
		{
			"fieldname": "description",
			"label": _("Description"),
			"fieldtype": "Data",
			"width": 240,
		},
		{
			"fieldname": "total_hours",
			"label": _("Hours"),
			"fieldtype": "Float",
			"width": 100,
			"precision": 2,
		},
		{
			"fieldname": "timesheet",
			"label": _("Timesheet"),
			"fieldtype": "Link",
			"options": "Timesheet",
			"width": 140,
		},
		{
			"fieldname": "company",
			"label": _("Company"),
			"fieldtype": "Link",
			"options": "Company",
			"width": 160,
		},
	]


def get_data(filters):
	entries = _fetch_entries(filters)
	period = _period_label(filters)
	from_date = filters.get("from_date")
	to_date = filters.get("to_date")

	# employee -> project -> activity -> [entries]
	tree: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
	employee_meta: dict[str, dict] = {}

	for row in entries:
		emp = row.employee
		project = row.project or _("(No project)")
		activity = row.activity_type or _("(No work type)")
		tree[emp][project][activity].append(row)
		if emp not in employee_meta:
			employee_meta[emp] = {
				"employee_name": row.employee_name or emp,
				"company": row.company or "",
			}

	data = []
	grand_total = 0.0
	employee_count = 0

	for emp in sorted(tree.keys(), key=lambda e: (employee_meta[e]["employee_name"] or e).lower()):
		projects = tree[emp]
		emp_hours = 0.0
		emp_rows = []
		meta = employee_meta[emp]
		emp_id = f"emp::{emp}"

		for project in sorted(projects.keys(), key=lambda p: str(p).lower()):
			activities = projects[project]
			proj_hours = 0.0
			proj_rows = []
			proj_id = f"{emp_id}::proj::{project}"
			project_value = "" if project == _("(No project)") else project

			for activity in sorted(activities.keys(), key=lambda a: str(a).lower()):
				items = activities[activity]
				act_hours = sum(flt(i.hours) for i in items)
				proj_hours += act_hours
				act_id = f"{proj_id}::act::{activity}"
				activity_value = "" if activity == _("(No work type)") else activity

				act_children = []
				for item in sorted(items, key=lambda i: i.from_time or ""):
					hours = flt(item.hours)
					entry_id = f"entry::{item.detail_name}"
					when = _entry_when(item)
					act_children.append(
						{
							"row_id": entry_id,
							"parent_row": act_id,
							"indent": 3,
							"is_group": 0,
							"level": "entry",
							"label": when or item.detail_name,
							"employee": emp,
							"employee_name": meta["employee_name"],
							"project": project_value,
							"activity_type": activity_value,
							"duration": when,
							"description": (item.description or "").strip(),
							"total_hours": flt(hours, 2),
							"timesheet": item.timesheet or "",
							"company": item.company or meta["company"],
							"from_date": from_date,
							"to_date": to_date,
						}
					)

				emp_hours += act_hours
				proj_rows.append(
					{
						"row_id": act_id,
						"parent_row": proj_id,
						"indent": 2,
						"is_group": 1,
						"level": "activity",
						"label": activity,
						"employee": emp,
						"employee_name": meta["employee_name"],
						"project": project_value,
						"activity_type": activity_value,
						"duration": "",
						"description": _("{0} entries").format(len(items)),
						"total_hours": flt(act_hours, 2),
						"timesheet": "",
						"company": meta["company"],
						"from_date": from_date,
						"to_date": to_date,
						"has_children": 1,
					}
				)
				proj_rows.extend(act_children)

			emp_rows.append(
				{
					"row_id": proj_id,
					"parent_row": emp_id,
					"indent": 1,
					"is_group": 1,
					"level": "project",
					"label": project,
					"employee": emp,
					"employee_name": meta["employee_name"],
					"project": project_value,
					"activity_type": "",
					"duration": "",
					"description": "",
					"total_hours": flt(proj_hours, 2),
					"timesheet": "",
					"company": meta["company"],
					"from_date": from_date,
					"to_date": to_date,
					"has_children": 1,
				}
			)
			emp_rows.extend(proj_rows)

		employee_count += 1
		grand_total += emp_hours
		data.append(
			{
				"row_id": emp_id,
				"parent_row": "",
				"indent": 0,
				"is_group": 1,
				"level": "employee",
				"label": meta["employee_name"],
				"employee": emp,
				"employee_name": meta["employee_name"],
				"project": "",
				"activity_type": "",
				"duration": period,
				"description": _("{0} projects").format(len(projects)),
				"total_hours": flt(emp_hours, 2),
				"timesheet": "",
				"company": meta["company"],
				"from_date": from_date,
				"to_date": to_date,
				"has_children": 1,
				# Keep drill-down to flat detail report for the employee
				"drilldown_report": "Timesheet Hours Detail",
			}
		)
		data.extend(emp_rows)

	if data:
		data.append(
			{
				"row_id": "total",
				"parent_row": "",
				"indent": 0,
				"is_group": 1,
				"level": "total",
				"label": _("Total"),
				"employee": "",
				"employee_name": "Total",
				"project": "",
				"activity_type": "",
				"duration": period,
				"description": _("{0} employees").format(employee_count),
				"total_hours": flt(grand_total, 2),
				"timesheet": "",
				"company": "",
				"from_date": from_date,
				"to_date": to_date,
				"has_children": 0,
			}
		)

	summary = [
		{"label": _("Employees"), "value": employee_count, "datatype": "Int", "indicator": "blue"},
		{"label": _("Total Hours"), "value": flt(grand_total, 2), "datatype": "Float", "indicator": "green"},
		{"label": _("Period"), "value": period or "—", "datatype": "Data"},
	]
	return data, summary


def _period_label(filters) -> str:
	from_date = filters.get("from_date")
	to_date = filters.get("to_date")
	if not from_date or not to_date:
		return ""
	return f"{formatdate(from_date)} - {formatdate(to_date)}"


def _entry_when(row) -> str:
	if row.from_time and row.to_time:
		return f"{format_datetime(row.from_time)} - {format_datetime(row.to_time)}"
	if row.from_time:
		return format_datetime(row.from_time)
	return ""


def _fetch_entries(filters):
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
			timesheet.company,
			timesheet.name.as_("timesheet"),
			detail.name.as_("detail_name"),
			detail.project,
			detail.activity_type,
			detail.from_time,
			detail.to_time,
			detail.hours,
			detail.description,
		)
		.where(detail.from_time >= from_dt)
		.where(detail.from_time < to_dt)
		.where(timesheet.docstatus.isin([0, 1]))
		.orderby(timesheet.employee_name)
		.orderby(detail.from_time)
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
