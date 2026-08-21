# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

from datetime import datetime, timedelta

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, getdate, now_datetime


def execute(filters=None):
	filters = frappe._dict(filters or {})
	data = get_data(filters)
	return get_columns(), data, None, None, get_report_summary(data)


def get_columns():
	return [
		{
			"label": _("Employee"),
			"fieldname": "employee",
			"fieldtype": "Link",
			"options": "Employee",
			"width": 110,
		},
		{
			"label": _("Employee Name"),
			"fieldname": "employee_name",
			"fieldtype": "Data",
			"width": 170,
		},
		{
			"label": _("Email"),
			"fieldname": "email",
			"fieldtype": "Data",
			"width": 230,
		},
		{
			"label": _("Department"),
			"fieldname": "department",
			"fieldtype": "Link",
			"options": "Department",
			"width": 150,
		},
		{
			"label": _("Login Status"),
			"fieldname": "login_status",
			"fieldtype": "Data",
			"width": 150,
		},
		{
			"label": _("Last Login"),
			"fieldname": "last_login",
			"fieldtype": "Datetime",
			"width": 150,
		},
		{
			"label": _("Days Since Login"),
			"fieldname": "days_since_login",
			"fieldtype": "Int",
			"width": 120,
		},
		{
			"label": _("Timesheet Cadence"),
			"fieldname": "timesheet_cadence",
			"fieldtype": "Data",
			"width": 160,
		},
		{
			"label": _("TS Total"),
			"fieldname": "ts_total",
			"fieldtype": "Int",
			"width": 80,
		},
		{
			"label": _("TS Submitted"),
			"fieldname": "ts_submitted",
			"fieldtype": "Int",
			"width": 100,
		},
		{
			"label": _("TS Draft"),
			"fieldname": "ts_draft",
			"fieldtype": "Int",
			"width": 80,
		},
		{
			"label": _("Last Timesheet End"),
			"fieldname": "last_ts_end",
			"fieldtype": "Date",
			"width": 130,
		},
		{
			"label": _("Days Since TS"),
			"fieldname": "days_since_ts",
			"fieldtype": "Int",
			"width": 110,
		},
		{
			"label": _("Hours (7d)"),
			"fieldname": "hours_7d",
			"fieldtype": "Float",
			"width": 95,
		},
		{
			"label": _("Hours (14d)"),
			"fieldname": "hours_14d",
			"fieldtype": "Float",
			"width": 100,
		},
		{
			"label": _("Hours (30d)"),
			"fieldname": "hours_30d",
			"fieldtype": "Float",
			"width": 100,
		},
		{
			"label": _("TS Count (7d)"),
			"fieldname": "ts_7d",
			"fieldtype": "Int",
			"width": 100,
		},
		{
			"label": _("TS Count (14d)"),
			"fieldname": "ts_14d",
			"fieldtype": "Int",
			"width": 110,
		},
		{
			"label": _("TS Count (30d)"),
			"fieldname": "ts_30d",
			"fieldtype": "Int",
			"width": 110,
		},
		{
			"label": _("User Enabled"),
			"fieldname": "user_enabled",
			"fieldtype": "Check",
			"width": 100,
		},
	]


def get_data(filters):
	company = filters.get("company") or "Cloud Primero Pvt. Ltd."
	employee_status = filters.get("employee_status") or "Active"
	department = filters.get("department")
	login_filter = filters.get("login_status")
	cadence_filter = filters.get("timesheet_cadence")

	today = getdate()
	d7 = today - timedelta(days=7)
	d14 = today - timedelta(days=14)
	d30 = today - timedelta(days=30)

	params = {
		"company": company,
		"status": employee_status,
		"d7": d7,
		"d14": d14,
		"d30": d30,
	}

	dept_clause = ""
	if department:
		dept_clause = "AND e.department = %(department)s"
		params["department"] = department

	rows = frappe.db.sql(
		f"""
		SELECT
			e.name AS employee,
			e.employee_name,
			e.user_id,
			e.department,
			e.company_email,
			e.prefered_email,
			u.enabled AS user_enabled,
			u.last_login,
			u.last_active,
			(
				SELECT COUNT(*) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus != 2
			) AS ts_total,
			(
				SELECT COUNT(*) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus = 1
			) AS ts_submitted,
			(
				SELECT COUNT(*) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus = 0
			) AS ts_draft,
			(
				SELECT MAX(t.end_date) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus != 2
			) AS last_ts_end,
			(
				SELECT COUNT(*) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus != 2 AND t.end_date >= %(d7)s
			) AS ts_7d,
			(
				SELECT COUNT(*) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus != 2 AND t.end_date >= %(d14)s
			) AS ts_14d,
			(
				SELECT COUNT(*) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus != 2 AND t.end_date >= %(d30)s
			) AS ts_30d,
			(
				SELECT COALESCE(SUM(t.total_hours), 0) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus != 2 AND t.end_date >= %(d7)s
			) AS hours_7d,
			(
				SELECT COALESCE(SUM(t.total_hours), 0) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus != 2 AND t.end_date >= %(d14)s
			) AS hours_14d,
			(
				SELECT COALESCE(SUM(t.total_hours), 0) FROM `tabTimesheet` t
				WHERE t.employee = e.name AND t.docstatus != 2 AND t.end_date >= %(d30)s
			) AS hours_30d
		FROM `tabEmployee` e
		LEFT JOIN `tabUser` u ON u.name = e.user_id
		WHERE e.company = %(company)s
		  AND e.status = %(status)s
		  {dept_clause}
		ORDER BY e.employee_name
		""",
		params,
		as_dict=True,
	)

	data = []
	for row in rows:
		login_status, days_since_login = _login_status(row)
		cadence, days_since_ts = _timesheet_cadence(row, today)

		if login_filter and login_status != login_filter:
			continue
		if cadence_filter and cadence != cadence_filter:
			continue

		email = (
			(row.user_id or "").strip()
			or (row.company_email or "").strip()
			or (row.prefered_email or "").strip()
		)

		data.append(
			{
				"employee": row.employee,
				"employee_name": row.employee_name,
				"email": email,
				"department": row.department,
				"login_status": login_status,
				"last_login": row.last_login,
				"days_since_login": days_since_login,
				"timesheet_cadence": cadence,
				"ts_total": int(row.ts_total or 0),
				"ts_submitted": int(row.ts_submitted or 0),
				"ts_draft": int(row.ts_draft or 0),
				"last_ts_end": row.last_ts_end,
				"days_since_ts": days_since_ts,
				"hours_7d": flt(row.hours_7d, 1),
				"hours_14d": flt(row.hours_14d, 1),
				"hours_30d": flt(row.hours_30d, 1),
				"ts_7d": int(row.ts_7d or 0),
				"ts_14d": int(row.ts_14d or 0),
				"ts_30d": int(row.ts_30d or 0),
				"user_enabled": 1 if row.user_enabled else 0,
			}
		)

	# Keep actionable people on top: never login / no TS first, then inactive, then active.
	priority = {
		"Never Logged In": 0,
		"No/Disabled User": 1,
		"Login Inactive (>14d)": 2,
		"Login Stale (8-14d)": 3,
		"Active Login (<=7d)": 4,
	}
	cadence_priority = {
		"No Timesheets Yet": 0,
		"Inactive (>30d)": 1,
		"Sporadic (15-30d)": 2,
		"Weekly-ish (8-14d)": 3,
		"Active This Week": 4,
		"Regular / Daily-ish": 5,
	}
	data.sort(
		key=lambda r: (
			cadence_priority.get(r["timesheet_cadence"], 99),
			priority.get(r["login_status"], 99),
			(r["employee_name"] or "").lower(),
		)
	)
	return data


def _login_status(row) -> tuple[str, int | None]:
	last_login = _parse_dt(row.last_login)
	days = None
	if last_login:
		days = (now_datetime() - last_login).days

	if not row.user_id or not row.user_enabled:
		return "No/Disabled User", days
	if not last_login:
		return "Never Logged In", None
	if days is not None and days <= 7:
		return "Active Login (<=7d)", days
	if days is not None and days <= 14:
		return "Login Stale (8-14d)", days
	return "Login Inactive (>14d)", days


def _timesheet_cadence(row, today) -> tuple[str, int | None]:
	days_since_ts = None
	if row.last_ts_end:
		days_since_ts = (today - getdate(row.last_ts_end)).days

	h7 = float(row.hours_7d or 0)
	h14 = float(row.hours_14d or 0)
	h30 = float(row.hours_30d or 0)
	c7 = int(row.ts_7d or 0)
	c14 = int(row.ts_14d or 0)
	c30 = int(row.ts_30d or 0)
	total = int(row.ts_total or 0)

	if total == 0:
		return "No Timesheets Yet", None
	if c7 >= 3 or h7 >= 20:
		return "Regular / Daily-ish", days_since_ts
	if c7 >= 1 or h7 >= 8:
		return "Active This Week", days_since_ts
	if c14 >= 1 or h14 >= 8:
		return "Weekly-ish (8-14d)", days_since_ts
	if c30 >= 1 or h30 > 0:
		return "Sporadic (15-30d)", days_since_ts
	return "Inactive (>30d)", days_since_ts


def _parse_dt(value):
	if not value:
		return None
	if isinstance(value, datetime):
		return value
	try:
		return get_datetime(value)
	except Exception:
		return None


def get_report_summary(data):
	def count(field, value):
		return sum(1 for row in data if row.get(field) == value)

	total = len(data)
	return [
		{"value": total, "label": _("Employees"), "datatype": "Int"},
		{
			"value": count("login_status", "Never Logged In"),
			"label": _("Never Logged In"),
			"datatype": "Int",
		},
		{
			"value": count("timesheet_cadence", "No Timesheets Yet"),
			"label": _("No Timesheets Yet"),
			"datatype": "Int",
		},
		{
			"value": count("timesheet_cadence", "Regular / Daily-ish")
			+ count("timesheet_cadence", "Active This Week"),
			"label": _("Active This Week+"),
			"datatype": "Int",
		},
		{
			"value": sum(int(row.get("ts_draft") or 0) for row in data),
			"label": _("Draft Timesheets"),
			"datatype": "Int",
		},
		{
			"value": sum(int(row.get("ts_submitted") or 0) for row in data),
			"label": _("Submitted Timesheets"),
			"datatype": "Int",
		},
	]
