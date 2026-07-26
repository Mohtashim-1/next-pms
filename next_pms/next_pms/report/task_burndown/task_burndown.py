# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import flt, getdate, today


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Project"), "fieldname": "project", "fieldtype": "Link", "options": "Project", "width": 130},
		{"label": _("Project Name"), "fieldname": "project_name", "fieldtype": "Data", "width": 180},
		{"label": _("Phase / Sprint"), "fieldname": "phase", "fieldtype": "Data", "width": 140},
		{"label": _("Open Tasks"), "fieldname": "open_tasks", "fieldtype": "Int", "width": 100},
		{"label": _("Completed"), "fieldname": "completed_tasks", "fieldtype": "Int", "width": 100},
		{"label": _("Total Tasks"), "fieldname": "total_tasks", "fieldtype": "Int", "width": 100},
		{"label": _("Progress %"), "fieldname": "progress_pct", "fieldtype": "Percent", "width": 100},
		{"label": _("Expected Hours"), "fieldname": "expected_hours", "fieldtype": "Float", "width": 120},
		{"label": _("Logged Hours"), "fieldname": "logged_hours", "fieldtype": "Float", "width": 110},
		{"label": _("Remaining Hours"), "fieldname": "remaining_hours", "fieldtype": "Float", "width": 120},
		{"label": _("Overdue Tasks"), "fieldname": "overdue_tasks", "fieldtype": "Int", "width": 110},
	]


def get_data(filters):
	project = filters.get("project")
	as_of = getdate(filters.get("as_of") or today())

	task_filters = {"is_group": 0, "is_template": 0}
	if project:
		task_filters["project"] = project

	tasks = frappe.get_all(
		"Task",
		filters=task_filters,
		fields=[
			"name",
			"project",
			"status",
			"progress",
			"expected_time",
			"exp_end_date",
			"custom_project_phase",
			"actual_time",
		],
		limit=5000,
	)
	if not tasks:
		return []

	project_ids = list({t.project for t in tasks if t.project})
	project_names = {
		p.name: p.project_name
		for p in frappe.get_all("Project", filters={"name": ["in", project_ids]}, fields=["name", "project_name"])
	} if project_ids else {}

	# Logged hours by task
	task_names = [t.name for t in tasks]
	logged_map = {}
	if task_names:
		for row in frappe.db.sql(
			"""
			SELECT td.task, SUM(td.hours) AS hours
			FROM `tabTimesheet Detail` td
			INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
			WHERE ts.docstatus < 2 AND td.task IN %(tasks)s
			GROUP BY td.task
			""",
			{"tasks": task_names},
			as_dict=True,
		):
			logged_map[row.task] = flt(row.hours)

	buckets: dict[tuple, dict] = {}
	for task in tasks:
		phase = (task.custom_project_phase or "").strip() or "No Phase"
		key = (task.project or "NO-PROJECT", phase)
		row = buckets.setdefault(
			key,
			{
				"project": task.project,
				"project_name": project_names.get(task.project) or task.project or "—",
				"phase": phase,
				"open_tasks": 0,
				"completed_tasks": 0,
				"total_tasks": 0,
				"expected_hours": 0.0,
				"logged_hours": 0.0,
				"overdue_tasks": 0,
				"progress_sum": 0.0,
			},
		)
		row["total_tasks"] += 1
		status = (task.status or "").lower()
		if status in ("completed", "cancelled"):
			row["completed_tasks"] += 1
		else:
			row["open_tasks"] += 1
			if task.exp_end_date and getdate(task.exp_end_date) < as_of:
				row["overdue_tasks"] += 1
		row["expected_hours"] += flt(task.expected_time)
		row["logged_hours"] += logged_map.get(task.name, flt(task.actual_time))
		row["progress_sum"] += flt(task.progress)

	data = []
	for row in buckets.values():
		progress = (row["progress_sum"] / row["total_tasks"]) if row["total_tasks"] else 0
		remaining = max(row["expected_hours"] - row["logged_hours"], 0)
		data.append(
			{
				"project": row["project"],
				"project_name": row["project_name"],
				"phase": row["phase"],
				"open_tasks": row["open_tasks"],
				"completed_tasks": row["completed_tasks"],
				"total_tasks": row["total_tasks"],
				"progress_pct": flt(progress, 1),
				"expected_hours": flt(row["expected_hours"], 2),
				"logged_hours": flt(row["logged_hours"], 2),
				"remaining_hours": flt(remaining, 2),
				"overdue_tasks": row["overdue_tasks"],
			}
		)
	data.sort(key=lambda r: (r["project_name"] or "", r["phase"]))
	return data
