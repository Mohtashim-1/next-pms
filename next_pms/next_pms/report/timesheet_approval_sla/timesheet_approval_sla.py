# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import add_months, date_diff, flt, getdate, now_datetime, today


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Manager"), "fieldname": "manager_name", "fieldtype": "Data", "width": 160},
		{"label": _("Manager Employee"), "fieldname": "manager", "fieldtype": "Link", "options": "Employee", "width": 120},
		{"label": _("Pending Sheets"), "fieldname": "pending_count", "fieldtype": "Int", "width": 120},
		{"label": _("Avg Wait (Days)"), "fieldname": "avg_wait_days", "fieldtype": "Float", "width": 120},
		{"label": _("Max Wait (Days)"), "fieldname": "max_wait_days", "fieldtype": "Int", "width": 120},
		{"label": _("0–2 Days"), "fieldname": "bucket_0_2", "fieldtype": "Int", "width": 90},
		{"label": _("3–5 Days"), "fieldname": "bucket_3_5", "fieldtype": "Int", "width": 90},
		{"label": _("6–10 Days"), "fieldname": "bucket_6_10", "fieldtype": "Int", "width": 90},
		{"label": _("10+ Days"), "fieldname": "bucket_10_plus", "fieldtype": "Int", "width": 90},
		{"label": _("SLA Heat"), "fieldname": "sla_heat", "fieldtype": "Data", "width": 100},
	]


def get_data(filters):
	from_date = getdate(filters.get("from_date") or add_months(today(), -2))
	to_date = getdate(filters.get("to_date") or today())
	now = now_datetime()

	# Pending / submitted awaiting approval — status heuristics for Next PMS
	sheets = frappe.db.sql(
		"""
		SELECT
			t.name,
			t.employee,
			t.employee_name,
			t.company,
			t.status,
			t.custom_approval_status,
			t.custom_weekly_approval_status,
			t.modified,
			t.creation,
			t.start_date,
			t.end_date,
			e.reports_to AS manager
		FROM `tabTimesheet` t
		LEFT JOIN `tabEmployee` e ON e.name = t.employee
		WHERE t.docstatus < 2
		  AND t.start_date BETWEEN %(from_date)s AND %(to_date)s
		  AND (
			IFNULL(t.custom_weekly_approval_status, '') IN ('Pending', 'Approval Pending', 'Submitted')
			OR IFNULL(t.custom_approval_status, '') IN ('Pending', 'Approval Pending', 'Submitted')
			OR t.status IN ('Submitted')
		  )
		""",
		{"from_date": from_date, "to_date": to_date},
		as_dict=True,
	)

	by_manager: dict[str, dict] = {}
	for sheet in sheets:
		manager = sheet.manager or "UNASSIGNED"
		bucket = by_manager.setdefault(
			manager,
			{
				"manager": None if manager == "UNASSIGNED" else manager,
				"manager_name": "Unassigned / No reports_to",
				"pending_count": 0,
				"wait_total": 0.0,
				"max_wait_days": 0,
				"bucket_0_2": 0,
				"bucket_3_5": 0,
				"bucket_6_10": 0,
				"bucket_10_plus": 0,
			},
		)
		wait = max(date_diff(getdate(now), getdate(sheet.modified or sheet.creation)), 0)
		bucket["pending_count"] += 1
		bucket["wait_total"] += wait
		bucket["max_wait_days"] = max(bucket["max_wait_days"], wait)
		if wait <= 2:
			bucket["bucket_0_2"] += 1
		elif wait <= 5:
			bucket["bucket_3_5"] += 1
		elif wait <= 10:
			bucket["bucket_6_10"] += 1
		else:
			bucket["bucket_10_plus"] += 1

	manager_ids = [m for m in by_manager if m != "UNASSIGNED"]
	names = {}
	if manager_ids:
		for row in frappe.get_all(
			"Employee", filters={"name": ["in", manager_ids]}, fields=["name", "employee_name"]
		):
			names[row.name] = row.employee_name

	data = []
	for manager, bucket in by_manager.items():
		if manager != "UNASSIGNED":
			bucket["manager_name"] = names.get(manager) or manager
		avg = bucket["wait_total"] / bucket["pending_count"] if bucket["pending_count"] else 0
		heat = "Green"
		if avg > 5 or bucket["bucket_10_plus"]:
			heat = "Red"
		elif avg > 2 or bucket["bucket_6_10"]:
			heat = "Amber"
		data.append(
			{
				"manager": bucket["manager"],
				"manager_name": bucket["manager_name"],
				"pending_count": bucket["pending_count"],
				"avg_wait_days": flt(avg, 1),
				"max_wait_days": bucket["max_wait_days"],
				"bucket_0_2": bucket["bucket_0_2"],
				"bucket_3_5": bucket["bucket_3_5"],
				"bucket_6_10": bucket["bucket_6_10"],
				"bucket_10_plus": bucket["bucket_10_plus"],
				"sla_heat": heat,
			}
		)

	data.sort(key=lambda r: (-r["avg_wait_days"], -r["pending_count"]))
	return data
