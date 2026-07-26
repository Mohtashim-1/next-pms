# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

import json
import os
import re

import frappe
from frappe.modules import get_module_path, scrub
from frappe.utils import add_months, flt, getdate, today

from next_pms.next_pms.utils.executive_dashboard import REPORT_ACCESS_ROLES, resolve_dashboard_persona


# Reports whose execute() already accepts company as a list (or empty = all).
_NATIVE_MULTI_COMPANY_REPORTS = {
	"Department / Team Scorecard",
	"Appraisal Evaluation Report",
	"Milestone Tracking Report",
	"Portfolio Summary Dashboard",
	"Project Completion Trend",
	"Earned Value Management (EVM)",
	"Project Expense Report",
	"Project Health Dashboard",
	"Project Manager Scorecard",
	"Project Change Request Log",
	"Project Risk Register Report",
	"Bench Cost Analysis",
	"Planned vs Actual Hours",
	"Resource Allocation / Capacity Planning",
	"Skill Matrix and Availability",
	"Capacity Planning",
	"Employee Billability",
	"Over Capacity",
}


# Default filter schemas for portal reports (JS filters are Desk-only).
PORTAL_REPORT_FILTERS: dict[str, list[dict]] = {
	"Holiday Timesheet Gap": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
	],
	"Timesheet Approval SLA": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "two_months_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "today"},
	],
	"Task Burndown": [
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
		{"fieldname": "as_of", "label": "As Of", "fieldtype": "Date", "default": "today"},
	],
	"Delayed Tasks Summary": [
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date"},
		{
			"fieldname": "priority",
			"label": "Priority",
			"fieldtype": "Select",
			"options": "\nLow\nMedium\nHigh\nUrgent",
		},
		# Stock report includes Completed for historical delay — keep it selectable,
		# but portal defaults to open work so "Delayed" isn't flooded with done tasks.
		{
			"fieldname": "status",
			"label": "Status",
			"fieldtype": "Select",
			"options": "\nOpen\nWorking\nPending Review\nOverdue\nCompleted",
			"default": "Open",
		},
	],
	"Project Summary": [
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{
			"fieldname": "project",
			"label": "Project",
			"fieldtype": "MultiSelectList",
			"options": "Project",
		},
		# No default Status / Is Active — "All" so Completed & Cancelled are visible.
		{"fieldname": "is_active", "label": "Is Active", "fieldtype": "Select", "options": "\nYes\nNo", "default": ""},
		{
			"fieldname": "status",
			"label": "Status",
			"fieldtype": "Select",
			"options": "\nOpen\nCompleted\nCancelled",
			"default": "",
		},
		{"fieldname": "project_type", "label": "Project Type", "fieldtype": "Link", "options": "Project Type"},
		{"fieldname": "priority", "label": "Priority", "fieldtype": "Select", "options": "\nLow\nMedium\nHigh"},
	],
	"Retainer vs Consumed Hours": [
		{"fieldname": "as_of", "label": "As Of", "fieldtype": "Date", "default": "today"},
		{"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer"},
	],
	"Forecast vs Actual Revenue": [
		{"fieldname": "months", "label": "Months", "fieldtype": "Int", "default": 6, "reqd": 1},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
	],
	"Employee Leave Balance": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "fiscal_year_start"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "fiscal_year_end"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
	],
	"Monthly Attendance Sheet": [
		# HRMS expects Month | Date Range (NOT Company/Employee) and month as 1–12.
		{
			"fieldname": "filter_based_on",
			"label": "Filter Based On",
			"fieldtype": "Select",
			"options": "Month\nDate Range",
			"reqd": 1,
			"default": "Month",
		},
		{
			"fieldname": "month",
			"label": "Month",
			"fieldtype": "Select",
			"options": "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12",
			"reqd": 1,
			"default": "current_month",
		},
		{"fieldname": "year", "label": "Year", "fieldtype": "Int", "reqd": 1, "default": "year"},
		{"fieldname": "start_date", "label": "Start Date", "fieldtype": "Date"},
		{"fieldname": "end_date", "label": "End Date", "fieldtype": "Date"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
		{
			"fieldname": "group_by",
			"label": "Group By",
			"fieldtype": "Select",
			"options": "\nBranch\nGrade\nDepartment\nDesignation",
		},
	],
	"Employee Analytics": [
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
		{
			"fieldname": "parameter",
			"label": "Parameter",
			"fieldtype": "Select",
			"options": "Branch\nGrade\nDepartment\nDesignation\nEmployment Type",
			"default": "Department",
			"reqd": 1,
		},
	],
	# Gross Profit keeps its own JS schema (company / dates / group_by / dimensions).
	# Company default is a Desk-session value, and the fiscal-year default window can start
	# in the future — a trailing 12 months is a more useful landing state in the portal.
	"Gross Profit": [
		{"fieldname": "company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
		{"fieldname": "from_date", "default": "year_ago"},
		{"fieldname": "to_date", "default": "today"},
	],
	"Overhead Allocation Report": [
		{"fieldname": "from_date", "default": "year_ago"},
		{"fieldname": "to_date", "default": "today"},
	],
	"Service Line / Department Profitability": [
		{"fieldname": "from_date", "default": "year_ago"},
		{"fieldname": "to_date", "default": "today"},
	],
	"Client Profitability Report": [
		{"fieldname": "from_date", "default": "year_ago"},
		{"fieldname": "to_date", "default": "today"},
	],
	"Project Profitability Report": [
		{"fieldname": "from_date", "default": "year_ago"},
		{"fieldname": "to_date", "default": "today"},
	],
	"Milestone Tracking Report": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "year_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
		{"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer"},
		{
			"fieldname": "status",
			"label": "Status",
			"fieldtype": "Select",
			"options": "\nOpen\nWorking\nPending Review\nOverdue\nTemplate\nCompleted\nCancelled",
		},
	],
	"Portfolio Summary Dashboard": [
		{"fieldname": "from_date", "label": "Hours From", "fieldtype": "Date", "default": "year_ago"},
		{"fieldname": "to_date", "label": "Hours To", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
		{"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer"},
		{
			"fieldname": "status",
			"label": "Status",
			"fieldtype": "Select",
			"options": "\nOpen\nCompleted\nCancelled",
		},
		{"fieldname": "project_type", "label": "Project Type", "fieldtype": "Link", "options": "Project Type"},
		{
			"fieldname": "rag_status",
			"label": "RAG",
			"fieldtype": "Select",
			"options": "\nGreen\nAmber\nRed",
		},
	],
	"Project Completion Trend": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "year_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
		{"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer"},
		{"fieldname": "project_type", "label": "Project Type", "fieldtype": "Link", "options": "Project Type"},
	],
	"Department / Team Scorecard": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "month_ago", "reqd": 1},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today", "reqd": 1},
		# Multi-select; leave empty to include all companies.
		{
			"fieldname": "company",
			"label": "Company",
			"fieldtype": "MultiSelectList",
			"options": "Company",
			"default": "company",
		},
		{"fieldname": "department", "label": "Department", "fieldtype": "Link", "options": "Department"},
	],
	"Employees working on a holiday": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
	],
	"Appraisal Evaluation Report": [
		# Prefer standard from_date / to_date (legacy `from` / `to` still accepted in execute).
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company", "default": "company"},
		{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\nActive\nInactive\nLeft", "default": "Active"},
		{"fieldname": "currency", "label": "Currency", "fieldtype": "Select", "options": "USD\nINR", "default": "USD"},
	],
	"Earned Value Management (EVM)": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "year_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
		{"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer"},
		{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\nOpen\nCompleted\nCancelled"},
	],
	"Project Expense Report": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "year_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
	],
	"Project Health Dashboard": [
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
		{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\nOpen\nCompleted\nCancelled"},
		{"fieldname": "rag_status", "label": "RAG", "fieldtype": "Select", "options": "\nGreen\nAmber\nRed"},
	],
	"Project Manager Scorecard": [
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "project_manager", "label": "Project Manager", "fieldtype": "Data"},
	],
	"Project Change Request Log": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "year_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
	],
	"Project Risk Register Report": [
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
		{"fieldname": "severity", "label": "Severity", "fieldtype": "Select", "options": "\nCritical\nHigh\nMedium\nLow"},
	],
	# ——— Resource reports ———
	"Bench Cost Analysis": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "three_months_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "department", "label": "Department", "fieldtype": "Link", "options": "Department"},
		{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee"},
	],
	"Planned vs Actual Hours": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "three_months_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "department", "label": "Department", "fieldtype": "Link", "options": "Department"},
		{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee"},
	],
	"Resource Allocation / Capacity Planning": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "department", "label": "Department", "fieldtype": "Link", "options": "Department"},
		{"fieldname": "designation", "label": "Designation", "fieldtype": "Link", "options": "Designation"},
	],
	"Skill Matrix and Availability": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "employee", "label": "Employee", "fieldtype": "MultiSelectList", "options": "Employee"},
		{"fieldname": "department", "label": "Department", "fieldtype": "Link", "options": "Department"},
		{"fieldname": "designation", "label": "Designation", "fieldtype": "Link", "options": "Designation"},
		{"fieldname": "skill", "label": "Skills", "fieldtype": "MultiSelectList", "options": "Skill"},
	],
	"Capacity Planning": [
		{"fieldname": "status", "label": "Employee Status", "fieldtype": "Select", "options": "\nActive\nInactive\nSuspended\nLeft", "default": "Active"},
		{"fieldname": "from", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
	],
	"Employee Billability": [
		{"fieldname": "status", "label": "Employee Status", "fieldtype": "Select", "options": "\nActive\nInactive\nSuspended\nLeft", "default": "Active"},
		{"fieldname": "from", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "designation", "label": "Designation", "fieldtype": "MultiSelectList", "options": "Designation"},
	],
	"Over Capacity": [
		{"fieldname": "status", "label": "Employee Status", "fieldtype": "Select", "options": "\nActive\nInactive\nSuspended\nLeft", "default": "Active"},
		{"fieldname": "from", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
	],
	"Resource Utilization Report": [
		# Site timesheet data is historical; a trailing year is a useful landing window.
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "year_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "MultiSelectList", "options": "Company"},
		{"fieldname": "employee", "label": "Employee", "fieldtype": "Link", "options": "Employee"},
	],
	"Spare Capacity Report": [
		# Stock report defaults from/to to today (a zero-width, weekend-prone window).
		# Give a forward-looking month so capacity is meaningful.
		{"fieldname": "from", "label": "From", "fieldtype": "Date", "default": "today"},
		{"fieldname": "to", "label": "To", "fieldtype": "Date", "default": "month_ahead"},
		# Flat employee view avoids the stock aggregate divide-by-zero on empty groups.
		{"fieldname": "group_by", "label": "Group By", "fieldtype": "Select", "options": "employee\nbusiness_unit\ndesignation", "default": "employee"},
		{"fieldname": "aggregate", "label": "Aggregate", "fieldtype": "Check", "default": 0},
	],
}


def ensure_portal_report_access():
	roles = set(frappe.get_roles())
	persona = resolve_dashboard_persona(list(roles))
	allowed = bool(roles.intersection(REPORT_ACCESS_ROLES)) or persona.get("persona") == "Team Lead"
	if not allowed:
		frappe.throw(
			"Reports are available to System Managers, Team Leads, and Project Managers only.",
			frappe.PermissionError,
		)


# DocTypes whose Link options must remain usable in portal filters even when the
# calling user lacks Desk read permission (common for HR masters like Skill).
_PORTAL_FILTER_OPTION_DOCTYPES = {
	"Skill",
	"Designation",
	"Department",
	"Branch",
	"Company",
	"Employee",
}


def search_portal_filter_options(doctype: str, txt: str = "", page_length: int | str = 20) -> list[dict]:
	"""Return [{value, label, description}] for a portal report Link/MultiSelect filter."""
	if not doctype or not frappe.db.exists("DocType", doctype):
		return []

	try:
		limit = max(1, min(int(page_length or 20), 50))
	except (TypeError, ValueError):
		limit = 20

	txt = (txt or "").strip()

	# Skill is HR-only by default — always resolve via ignore_permissions for portal users.
	use_fallback_first = doctype in {"Skill"}

	rows: list = []
	if not use_fallback_first:
		try:
			from frappe.desk.search import search_link

			rows = search_link(doctype, txt, page_length=limit) or []
			if rows:
				return rows
		except Exception:
			rows = []

	if doctype not in _PORTAL_FILTER_OPTION_DOCTYPES and not use_fallback_first:
		return rows

	# Fallback for restricted masters (e.g. Skill is HR Manager–only by default).
	meta = frappe.get_meta(doctype)
	title_field = meta.title_field or ("employee_name" if doctype == "Employee" else "name")
	if not meta.has_field(title_field):
		title_field = "name"

	filters: dict = {}
	if doctype == "Employee":
		filters["status"] = "Active"

	or_filters = None
	if txt:
		or_filters = [["name", "like", f"%{txt}%"]]
		if title_field != "name":
			or_filters.append([title_field, "like", f"%{txt}%"])
		if meta.has_field("skill_name"):
			or_filters.append(["skill_name", "like", f"%{txt}%"])
		if meta.has_field("employee_name") and title_field != "employee_name":
			or_filters.append(["employee_name", "like", f"%{txt}%"])

	fields = ["name"]
	if title_field != "name":
		fields.append(title_field)

	found = frappe.get_all(
		doctype,
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		order_by=f"`tab{doctype}`.modified desc",
		limit_page_length=limit,
		ignore_permissions=True,
	)
	out = []
	for row in found:
		if doctype == "Employee" and row.get("employee_name"):
			label = row.employee_name
			description = row.name
		else:
			label = row.get(title_field) or row.name
			description = row.name if title_field != "name" and label != row.name else ""
		out.append({"value": row.name, "label": label, "description": description})
	return out or rows


def _as_company_list(value) -> list[str]:
	"""Normalize company filter from string / list / JSON string → list of names."""
	if value in (None, "", [], ()):
		return []
	if isinstance(value, str):
		raw = value.strip()
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
	if isinstance(value, (list, tuple)):
		return [str(c).strip() for c in value if c]
	return [str(value)]


def _upgrade_company_filters(filters: list[dict]) -> list[dict]:
	"""Force every Company Link filter to MultiSelectList across all portal reports."""
	out = []
	for f in filters or []:
		item = dict(f)
		if item.get("options") == "Company" and item.get("fieldtype") in ("Link", "MultiSelectList", None):
			item["fieldtype"] = "MultiSelectList"
			item["options"] = "Company"
			# Multi-select is never mandatory — empty means all companies.
			item.pop("reqd", None)
			default = item.get("default")
			if default not in (None, ""):
				item["default"] = default if isinstance(default, list) else [default]
		out.append(item)
	return out


def _all_companies() -> list[str]:
	return frappe.get_all("Company", pluck="name", order_by="name asc")


def _is_total_row(row) -> bool:
	"""True for auto-added / manual Total footer rows."""
	if isinstance(row, dict):
		for key in ("employee", "employee_name", "name", "account", "particulars", "id"):
			val = row.get(key)
			if val is not None and str(val).strip().lower() == "total":
				return True
		return False
	if isinstance(row, (list, tuple)) and row:
		return str(row[0]).strip().lower() == "total"
	return False


def _sum_total_row(columns: list, data_rows: list) -> dict | list | None:
	"""Build a single Total row by summing numeric columns across data rows."""
	if not data_rows or not columns:
		return None

	numeric_types = {"Float", "Int", "Currency", "Percent"}
	fieldnames = []
	for col in columns:
		if isinstance(col, dict):
			fieldnames.append(
				(
					col.get("fieldname") or col.get("label"),
					col.get("fieldtype") or "Data",
				)
			)
		else:
			parts = str(col).split(":")
			fieldnames.append((parts[0].strip().lower().replace(" ", "_"), parts[1] if len(parts) > 1 else "Data"))

	sample = data_rows[0]
	if isinstance(sample, dict):
		total: dict = {}
		label_set = False
		for fieldname, fieldtype in fieldnames:
			if not fieldname:
				continue
			if not label_set and fieldtype not in numeric_types:
				total[fieldname] = "Total"
				label_set = True
			elif fieldtype in numeric_types:
				total[fieldname] = sum(flt(r.get(fieldname)) for r in data_rows if isinstance(r, dict))
			else:
				total[fieldname] = ""
		return total

	# List/tuple rows
	total_list = []
	label_set = False
	for idx, (_, fieldtype) in enumerate(fieldnames):
		if not label_set and fieldtype not in numeric_types:
			total_list.append("Total")
			label_set = True
		elif fieldtype in numeric_types:
			total_list.append(sum(flt(r[idx]) for r in data_rows if isinstance(r, (list, tuple)) and len(r) > idx))
		else:
			total_list.append("")
	return total_list


def _merge_company_runs(report, filters: dict, companies: list[str]) -> dict:
	"""Run a single-company report once per company and concatenate rows.

	Each company run may include an `add_total_row` Total footer — keep only one
	combined Total at the end so the portal never shows 6 duplicate Totals.
	"""
	all_rows: list = []
	columns = None
	chart = None
	summary = None
	message = None
	saw_total = False
	for company in companies:
		run_filters = dict(filters)
		run_filters["company"] = company
		result = _run_script_or_query(report, run_filters)
		if columns is None:
			columns = result.get("columns") or []
			chart = result.get("chart")
			summary = result.get("report_summary")
			message = result.get("message")
		rows = result.get("result") or result.get("data") or []
		for row in rows or []:
			if _is_total_row(row):
				saw_total = True
				continue
			all_rows.append(row)

	if saw_total and all_rows:
		combined = _sum_total_row(columns or [], all_rows)
		if combined is not None:
			all_rows.append(combined)

	return {
		"columns": columns or [],
		"result": all_rows,
		"chart": chart,
		"report_summary": summary,
		"message": message,
	}


def _run_with_company_filter(report, report_name: str, filters: dict) -> dict:
	"""Dispatch execute() with multi-company support for every portal report."""
	companies = _as_company_list(filters.get("company"))
	run_filters = dict(filters)

	# Native reports accept list / empty (= all) directly.
	if report_name in _NATIVE_MULTI_COMPANY_REPORTS:
		run_filters["company"] = companies
		return _run_script_or_query(report, run_filters)

	# Stock / single-company scripts: 0 → all, 1 → string, N → merge runs.
	if not companies:
		companies = _all_companies()
	if not companies:
		run_filters.pop("company", None)
		return _run_script_or_query(report, run_filters)
	if len(companies) == 1:
		run_filters["company"] = companies[0]
		return _run_script_or_query(report, run_filters)
	return _merge_company_runs(report, run_filters, companies)


def _safe_report_folder(report_name: str) -> str:
	"""Scrub report names so `/` and `()` do not break Python import paths."""
	s = scrub(report_name)
	s = re.sub(r"[^a-z0-9_]+", "_", s)
	return re.sub(r"_+", "_", s).strip("_")


def _resolve_default(value):
	if value == "today":
		return today()
	if value == "month_ago":
		return add_months(today(), -1)
	if value == "two_months_ago":
		return add_months(today(), -2)
	if value == "three_months_ago":
		return add_months(today(), -3)
	if value == "month_ahead":
		return add_months(today(), 1)
	if value == "year_ago":
		return add_months(today(), -12)
	if value == "company":
		return frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
	if value == "year":
		return getdate(today()).year
	if value == "current_month":
		return getdate(today()).month
	if value in ("fiscal_year_start", "fiscal_year_end"):
		try:
			from erpnext.accounts.utils import get_fiscal_year

			fy = get_fiscal_year(today(), as_dict=True)
			return str(fy.year_start_date if value == "fiscal_year_start" else fy.year_end_date)
		except Exception:
			return add_months(today(), -12) if value == "fiscal_year_start" else today()
	return value


def _filters_from_report_doc(report) -> list[dict]:
	rows = []
	for row in report.get("filters") or []:
		rows.append(
			{
				"fieldname": row.fieldname,
				"label": row.label or row.fieldname.replace("_", " ").title(),
				"fieldtype": row.fieldtype,
				"options": row.get("options"),
				"default": row.get("default"),
				# `Report Filter` stores this as `mandatory`, not `reqd`.
				"reqd": int(row.get("mandatory") or 0),
			}
		)
	return rows


def _split_filter_blocks(script: str) -> list[str]:
	"""Slice a report JS into per-filter text blocks keyed by each `fieldname:`."""
	positions = [m.start() for m in re.finditer(r"fieldname\s*:", script)]
	blocks = []
	for i, start in enumerate(positions):
		end = positions[i + 1] if i + 1 < len(positions) else len(script)
		blocks.append(script[start:end])
	return blocks


def _parse_filters_from_js(report_name: str, module: str | None) -> list[dict]:
	"""Best-effort extract of filter definitions from standard report JS."""
	if not module:
		return []
	try:
		module_path = get_module_path(module)
	except Exception:
		return []

	candidates = [
		os.path.join(module_path, "report", scrub(report_name), scrub(report_name) + ".js"),
		os.path.join(module_path, "report", _safe_report_folder(report_name), _safe_report_folder(report_name) + ".js"),
	]
	script = ""
	for script_path in candidates:
		if os.path.exists(script_path):
			with open(script_path) as f:
				script = f.read()
			break
	if not script:
		return []

	filters = []
	for block in _split_filter_blocks(script):
		fn_m = re.search(r"fieldname\s*:\s*[\"']([^\"']+)[\"']", block)
		ft_m = re.search(r"fieldtype\s*:\s*[\"']([^\"']+)[\"']", block)
		if not fn_m or not ft_m:
			continue
		fieldname, fieldtype = fn_m.group(1), ft_m.group(1)
		if any(f["fieldname"] == fieldname for f in filters):
			continue
		label_m = re.search(r"label\s*:\s*(?:__\()?[\"']([^\"']+)[\"']\)?", block)
		item = {
			"fieldname": fieldname,
			"label": label_m.group(1) if label_m else fieldname.replace("_", " ").title(),
			"fieldtype": fieldtype,
		}

		# Link doctype (string options). JS sources embed `\n` as an escape, not a real newline.
		opt = re.search(r"options\s*:\s*[\"']([^\"']*)[\"']", block)
		if opt:
			item["options"] = opt.group(1).replace("\\n", "\n")
		else:
			opt2 = re.search(r"options\s*:\s*`([^`]*)`", block)
			if opt2:
				item["options"] = opt2.group(1).replace("\\n", "\n")

		# Array-of-values / array-of-objects options (Select)
		# Supports both value: "x" and bare numeric value: 1 (HRMS month picker).
		if "options" not in item:
			arr = re.search(r"options\s*:\s*\[([\s\S]*?)\]", block)
			if arr:
				values = re.findall(r"value\s*:\s*(?:[\"']([^\"']*)[\"']|(\d+))", arr.group(1))
				values = [a or b for a, b in values if (a or b) != ""]
				if not values:
					values = re.findall(r"[\"']([^\"']+)[\"']", arr.group(1))
				values = [v for v in values if v != ""]
				if values:
					item["options"] = "\n" + "\n".join(dict.fromkeys(values))

		# MultiSelectList / dynamic link via get_link_options("Doctype")
		if fieldtype in ("MultiSelectList", "Link") and "options" not in item:
			link_dt = re.search(r"get_link_options\(\s*[\"']([^\"']+)[\"']", block)
			if not link_dt:
				link_dt = re.search(r"doctype\s*:\s*[\"']([^\"']+)[\"']", block)
			if link_dt:
				item["options"] = link_dt.group(1)

		# Defaults
		if "get_fiscal_year" in block:
			item["default"] = "fiscal_year_end" if re.search(r"\)\s*\[\s*2\s*\]", block) else "fiscal_year_start"
		elif "get_today" in block and "add_months" in block:
			if "-1" in block or "- 1" in block:
				item["default"] = "month_ago"
			elif "-2" in block or "- 2" in block:
				item["default"] = "two_months_ago"
			else:
				item["default"] = "today"
		elif "get_today" in block:
			item["default"] = "today"
		elif re.search(r"default\s*:\s*(\d+)", block):
			item["default"] = int(re.search(r"default\s*:\s*(\d+)", block).group(1))
		elif re.search(r"default\s*:\s*[\"']([^\"']+)[\"']", block):
			item["default"] = re.search(r"default\s*:\s*[\"']([^\"']+)[\"']", block).group(1)
		if re.search(r"reqd\s*:\s*1", block):
			item["reqd"] = 1

		filters.append(item)
	return filters


def _merge_filter_defs(base: list[dict], overrides: list[dict] | None) -> list[dict]:
	"""Patch parsed filters with portal overrides, keeping filters the script needs."""
	if not overrides:
		return base
	if not base:
		# Partial overrides only patch an existing schema; they cannot stand alone.
		return [dict(o) for o in overrides if o.get("fieldtype")]

	by_name = {f["fieldname"]: dict(f) for f in base}
	order = [f["fieldname"] for f in base]
	for override in overrides:
		name = override["fieldname"]
		if name in by_name:
			by_name[name].update({k: v for k, v in override.items() if v is not None})
		else:
			by_name[name] = dict(override)
			order.append(name)
	return [by_name[name] for name in order]


def _user_can_view_report(report) -> bool:
	"""Portal roles may view catalogued reports even if Report Has Role is incomplete."""
	if report.is_permitted():
		return True
	roles = set(frappe.get_roles())
	persona = resolve_dashboard_persona(list(roles))
	return bool(roles.intersection(REPORT_ACCESS_ROLES)) or persona.get("persona") == "Team Lead"


def _get_execute_method(report):
	"""Resolve report execute(), with fallback for names containing `/` or `()`."""
	from frappe.core.doctype.report.report import get_report_module_dotted_path

	module = report.module or frappe.db.get_value("DocType", report.ref_doctype, "module")
	primary = get_report_module_dotted_path(module, report.name) + ".execute"
	try:
		return frappe.get_attr(primary)
	except (ImportError, AttributeError, ModuleNotFoundError):
		pass

	app = frappe.local.module_app.get(scrub(module))
	if not app:
		raise ModuleNotFoundError(f"Cannot resolve app for module {module}")
	folder = _safe_report_folder(report.name)
	alt = f"{app}.{scrub(module)}.report.{folder}.{folder}.execute"
	return frappe.get_attr(alt)


def _run_script_or_query(report, filters: dict) -> dict:
	"""Run report with path fallback for broken scrub names."""
	from frappe.desk.query_report import generate_report_result

	try:
		return generate_report_result(report, filters=filters, user=frappe.session.user)
	except ModuleNotFoundError:
		if report.report_type != "Script Report":
			raise
		execute_fn = _get_execute_method(report)
		res = execute_fn(frappe._dict(filters))
		columns, data, message, chart, report_summary, *rest = (list(res) + [None] * 5)[:5]
		return {
			"result": data or [],
			"columns": columns or [],
			"message": message,
			"chart": chart,
			"report_summary": report_summary,
		}


def _normalize_portal_filters(report_name: str, filters: dict) -> dict:
	"""Coerce portal filter values into what each report's execute() expects."""
	out = dict(filters or {})

	if report_name == "Monthly Attendance Sheet":
		# Portal used to send filter_based_on=Company which makes PyPika crash with nodes_.
		if out.get("filter_based_on") not in ("Month", "Date Range"):
			out["filter_based_on"] = "Month"

		month = out.get("month")
		month_map = {
			"jan": 1,
			"january": 1,
			"feb": 2,
			"february": 2,
			"mar": 3,
			"march": 3,
			"apr": 4,
			"april": 4,
			"may": 5,
			"jun": 6,
			"june": 6,
			"jul": 7,
			"july": 7,
			"aug": 8,
			"august": 8,
			"sep": 9,
			"sept": 9,
			"september": 9,
			"oct": 10,
			"october": 10,
			"nov": 11,
			"november": 11,
			"dec": 12,
			"december": 12,
		}
		if isinstance(month, str):
			key = month.strip().lower()
			if key in month_map:
				out["month"] = month_map[key]
			elif re.match(r"^\d{4}-\d{2}-\d{2}", key):
				out["month"] = getdate(key).month
			elif key.isdigit():
				out["month"] = int(key)
		elif month is not None:
			try:
				out["month"] = int(month)
			except (TypeError, ValueError):
				out["month"] = getdate(today()).month

		if out.get("year") is not None:
			try:
				out["year"] = int(out["year"])
			except (TypeError, ValueError):
				out["year"] = getdate(today()).year

		# Checkboxes often arrive as "0"/"1" strings — leave them; HRMS handles that.
		if out.get("filter_based_on") == "Date Range":
			if not out.get("start_date") or not out.get("end_date"):
				frappe.throw("Start Date and End Date are required when Filter Based On is Date Range.")

	elif report_name == "Employee Analytics":
		if not out.get("parameter"):
			out["parameter"] = "Department"
		# Company may be a list; empty is allowed (runner expands to all).
		companies = _as_company_list(out.get("company"))
		out["company"] = companies

	elif report_name == "Appraisal Evaluation Report":
		# Accept either naming convention; prefer from_date / to_date in the payload.
		if not out.get("from_date") and out.get("from"):
			out["from_date"] = out["from"]
		if not out.get("to_date") and out.get("to"):
			out["to_date"] = out["to"]
		if not out.get("from_date"):
			out["from_date"] = add_months(today(), -1)
		if not out.get("to_date"):
			out["to_date"] = today()
		# Drop legacy aliases so they never show as empty mandatory filters.
		out.pop("from", None)
		out.pop("to", None)
		out["company"] = _as_company_list(out.get("company"))

	elif report_name == "Project Summary":
		# Stock execute() passes filters straight into frappe.db.get_all("Project").
		# Map portal "project" → Project.name; drop empty Status / Is Active (= All).
		projects = out.pop("project", None)
		if isinstance(projects, str) and projects.strip().startswith("["):
			try:
				parsed = frappe.parse_json(projects)
				if isinstance(parsed, list):
					projects = parsed
			except Exception:
				pass
		if projects in (None, "", [], ()):
			pass
		elif isinstance(projects, (list, tuple)):
			names = [str(p) for p in projects if p]
			if len(names) == 1:
				out["name"] = names[0]
			elif names:
				out["name"] = ["in", names]
		else:
			out["name"] = str(projects)
		for key in ("status", "is_active", "project_type", "priority"):
			if out.get(key) in (None, "", [], ()):
				out.pop(key, None)
		# Keep company as a plain list; runner passes 1 as string or merges N companies.
		out["company"] = _as_company_list(out.get("company"))
		# When specific projects are selected with All Companies, infer their companies.
		# This avoids running the stock report once for every company.
		if not out["company"] and out.get("name"):
			name_filter = out["name"]
			selected_names = (
				name_filter[1]
				if isinstance(name_filter, list) and len(name_filter) == 2 and name_filter[0] == "in"
				else [name_filter]
			)
			out["company"] = list(
				dict.fromkeys(
					frappe.get_all(
						"Project",
						filters={"name": ["in", selected_names]},
						pluck="company",
					)
				)
			)

	# Always normalize company to a list when present so MultiSelectList values survive.
	if "company" in out and report_name != "Project Summary":
		out["company"] = _as_company_list(out.get("company"))

	return out


def _dedupe_report_filters(report_name: str, filters: list[dict]) -> list[dict]:
	"""Remove conflicting / legacy filter aliases that confuse the portal UI."""
	if not filters:
		return filters

	by_name = {f["fieldname"]: f for f in filters}
	order = [f["fieldname"] for f in filters]

	if report_name == "Appraisal Evaluation Report":
		# Never show both `from` and `from_date` (same for to / to_date).
		if "from_date" in by_name and "from" in by_name:
			order = [name for name in order if name != "from"]
			by_name.pop("from", None)
		if "to_date" in by_name and "to" in by_name:
			order = [name for name in order if name != "to"]
			by_name.pop("to", None)
		# If only legacy names exist, rename them for the portal.
		if "from" in by_name and "from_date" not in by_name:
			legacy = by_name.pop("from")
			legacy["fieldname"] = "from_date"
			by_name["from_date"] = legacy
			order = ["from_date" if name == "from" else name for name in order]
		if "to" in by_name and "to_date" not in by_name:
			legacy = by_name.pop("to")
			legacy["fieldname"] = "to_date"
			by_name["to_date"] = legacy
			order = ["to_date" if name == "to" else name for name in order]

	# Stable unique order
	seen = set()
	unique = []
	for name in order:
		if name in seen or name not in by_name:
			continue
		seen.add(name)
		unique.append(by_name[name])
	return unique


def get_portal_report_meta(report_name: str) -> dict:
	ensure_portal_report_access()
	if not frappe.db.exists("Report", report_name):
		frappe.throw(f"Report {report_name} not found", frappe.DoesNotExistError)

	report = frappe.get_doc("Report", report_name)
	if not _user_can_view_report(report):
		frappe.throw("You do not have permission to view this report.", frappe.PermissionError)

	# Real filter schema first (report doc → report JS), then patch with portal overrides.
	# Overrides must never drop filters the report script depends on (e.g. Gross Profit's `group_by`).
	filters = _filters_from_report_doc(report) or _parse_filters_from_js(report_name, report.module)
	filters = _merge_filter_defs(filters, PORTAL_REPORT_FILTERS.get(report_name))
	filters = _dedupe_report_filters(report_name, filters)

	resolved = []
	defaults = {}
	for f in filters:
		item = dict(f)
		default = _resolve_default(item.get("default"))
		# Auto-fill Company only for single Link fields. MultiSelectList empty = All Companies.
		if (
			(default is None or default == "")
			and item.get("fieldtype") == "Link"
			and item.get("options") == "Company"
		):
			default = _resolve_default("company")
		# MultiSelectList defaults must be arrays for the portal ComboBox.
		if item.get("fieldtype") == "MultiSelectList":
			if default in (None, ""):
				default = []
			elif not isinstance(default, list):
				default = [default]
		item["default"] = default
		# Include empty MultiSelectList defaults so the UI starts at "All …"
		# and the payload still sends [] (not omitted → backend single-company fallback).
		if default is not None and default != "":
			defaults[item["fieldname"]] = default
		resolved.append(item)

	# Globally upgrade every Company Link → MultiSelectList (including JS-parsed schemas).
	resolved = _upgrade_company_filters(resolved)
	# Re-sync defaults after upgrade (company becomes a list; empty = All Companies).
	for item in resolved:
		if item.get("options") == "Company" and item.get("fieldtype") == "MultiSelectList":
			default = item.get("default")
			if default in (None, ""):
				defaults[item["fieldname"]] = []
			elif isinstance(default, list):
				defaults[item["fieldname"]] = default
			else:
				defaults[item["fieldname"]] = [default]
	# Only use generic date filters when report truly has none
	if not resolved:
		resolved = [
			{
				"fieldname": "from_date",
				"label": "From Date",
				"fieldtype": "Date",
				"default": add_months(today(), -1),
			},
			{
				"fieldname": "to_date",
				"label": "To Date",
				"fieldtype": "Date",
				"default": today(),
			},
			{
				"fieldname": "company",
				"label": "Company",
				"fieldtype": "MultiSelectList",
				"options": "Company",
				"default": [_resolve_default("company")] if _resolve_default("company") else [],
			},
		]
		defaults = {f["fieldname"]: f["default"] for f in resolved if f.get("default") not in (None, "", [])}

	letter_heads = frappe.get_all(
		"Letter Head",
		filters={"disabled": 0},
		fields=["name", "is_default"],
		order_by="is_default desc, name asc",
		limit=50,
	)

	return {
		"name": report.name,
		"report_name": report.report_name or report.name,
		"ref_doctype": report.ref_doctype,
		"report_type": report.report_type,
		"module": report.module,
		"filters": resolved,
		"defaults": defaults,
		"letter_heads": letter_heads,
		"default_letter_head": next((lh.name for lh in letter_heads if lh.is_default), None),
	}


def run_portal_report(report_name: str, filters: dict | str | None = None) -> dict:
	ensure_portal_report_access()
	if not frappe.db.exists("Report", report_name):
		frappe.throw(f"Report {report_name} not found", frappe.DoesNotExistError)

	report = frappe.get_doc("Report", report_name)
	if not _user_can_view_report(report):
		frappe.throw("You do not have permission to run this report.", frappe.PermissionError)

	if isinstance(filters, str):
		filters = json.loads(filters) if filters else {}
	filters = filters or {}

	meta = get_portal_report_meta(report_name)
	merged = dict(meta.get("defaults") or {})
	# Keep empty lists (cleared MultiSelect = all companies); only drop None / "".
	merged.update({k: v for k, v in filters.items() if v not in (None, "")})
	merged = _normalize_portal_filters(report_name, merged)

	try:
		result = _run_with_company_filter(report, report_name, merged)
	except Exception as e:
		# Surface a clear message to the portal UI (not generic "There was an error.")
		frappe.log_error(title=f"Portal report failed: {report_name}")
		frappe.throw(str(e) or "Report execution failed. Check filters and try again.")

	columns = result.get("columns") or []
	data = result.get("result") or result.get("data") or []
	normalized = []
	col_keys = []
	for col in columns:
		if isinstance(col, dict):
			col_keys.append(col.get("fieldname") or col.get("label"))
		else:
			col_keys.append(str(col).split(":")[0].strip().lower().replace(" ", "_"))

	for row in data:
		if isinstance(row, dict):
			normalized.append(row)
		elif isinstance(row, (list, tuple)):
			normalized.append({col_keys[i]: row[i] for i in range(min(len(col_keys), len(row)))})
		else:
			normalized.append({"value": row})

	# Safety net: never show more than one Total footer (multi-company merges used to).
	total_rows = [r for r in normalized if _is_total_row(r)]
	if len(total_rows) > 1:
		data_only = [r for r in normalized if not _is_total_row(r)]
		combined = _sum_total_row(columns, data_only)
		normalized = data_only + ([combined] if combined is not None else [])

	# Detect scaffolded/not-implemented reports so the UI can show a clean notice
	placeholder = None
	if (
		len(normalized) == 1
		and isinstance(normalized[0], dict)
		and "Scaffolded" in str(normalized[0].get("status", ""))
	):
		placeholder = {
			"title": normalized[0].get("report") or report_name,
			"status": normalized[0].get("status"),
			"next": normalized[0].get("next"),
		}

	message = result.get("message")
	# HRMS Monthly Attendance returns no columns when there are zero attendance rows —
	# surface a clear empty-state message instead of a blank viewer.
	if report_name == "Monthly Attendance Sheet" and not normalized and not columns:
		message = message or (
			"No attendance records found for the selected month/year and company. "
			"Try another period, or confirm Attendance has been marked in HR."
		)

	return {
		"name": report_name,
		"columns": columns,
		"result": normalized,
		"message": message,
		"chart": result.get("chart"),
		"report_summary": result.get("report_summary"),
		"placeholder": placeholder,
		"filters": merged,
	}
