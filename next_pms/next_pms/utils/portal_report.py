# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

import json
import os
import re

import frappe
from frappe.modules import get_module_path, scrub
from frappe.utils import add_months, getdate, today

from next_pms.next_pms.utils.executive_dashboard import REPORT_ACCESS_ROLES, resolve_dashboard_persona


# Default filter schemas for portal reports (JS filters are Desk-only).
PORTAL_REPORT_FILTERS: dict[str, list[dict]] = {
	"Holiday Timesheet Gap": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company"},
	],
	"Timesheet Approval SLA": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "two_months_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "today"},
	],
	"Task Burndown": [
		{"fieldname": "project", "label": "Project", "fieldtype": "Link", "options": "Project"},
		{"fieldname": "as_of", "label": "As Of", "fieldtype": "Date", "default": "today"},
	],
	"Retainer vs Consumed Hours": [
		{"fieldname": "as_of", "label": "As Of", "fieldtype": "Date", "default": "today"},
		{"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer"},
	],
	"Forecast vs Actual Revenue": [
		{"fieldname": "months", "label": "Months", "fieldtype": "Int", "default": 6, "reqd": 1},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company"},
	],
	"Employee Leave Balance": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "fiscal_year_start"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "fiscal_year_end"},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
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
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company", "reqd": 1},
		{
			"fieldname": "group_by",
			"label": "Group By",
			"fieldtype": "Select",
			"options": "\nBranch\nGrade\nDepartment\nDesignation",
		},
	],
	"Employee Analytics": [
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company", "reqd": 1},
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
		{"fieldname": "company", "default": "company"},
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
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
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
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
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
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
		{"fieldname": "customer", "label": "Customer", "fieldtype": "Link", "options": "Customer"},
		{"fieldname": "project_type", "label": "Project Type", "fieldtype": "Link", "options": "Project Type"},
	],
	"Department / Team Scorecard": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "month_ago", "reqd": 1},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today", "reqd": 1},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
		{"fieldname": "department", "label": "Department", "fieldtype": "Link", "options": "Department"},
	],
	"Employees working on a holiday": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
	],
	"Appraisal Evaluation Report": [
		# Script uses fieldnames `from` / `to` (not from_date / to_date).
		{"fieldname": "from", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "month_ago"},
		{"fieldname": "to", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
		{"fieldname": "status", "label": "Status", "fieldtype": "Select", "options": "\nActive\nInactive\nLeft", "default": "Active"},
		{"fieldname": "currency", "label": "Currency", "fieldtype": "Select", "options": "USD\nINR", "default": "USD"},
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
		if not out.get("company"):
			out["company"] = _resolve_default("company")
		if not out.get("company"):
			frappe.throw("Company is required for Employee Analytics.")

	elif report_name == "Appraisal Evaluation Report":
		# Accept either naming convention from the portal UI.
		if not out.get("from") and out.get("from_date"):
			out["from"] = out["from_date"]
		if not out.get("to") and out.get("to_date"):
			out["to"] = out["to_date"]
		if not out.get("from"):
			out["from"] = add_months(today(), -1)
		if not out.get("to"):
			out["to"] = today()

	return out


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

	resolved = []
	defaults = {}
	for f in filters:
		item = dict(f)
		default = _resolve_default(item.get("default"))
		# Auto-fill Company when Link options is Company
		if (
			(default is None or default == "")
			and item.get("fieldtype") == "Link"
			and item.get("options") == "Company"
		):
			default = _resolve_default("company")
		item["default"] = default
		if default is not None and default != "":
			defaults[item["fieldname"]] = default
		resolved.append(item)

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
				"fieldtype": "Link",
				"options": "Company",
				"default": _resolve_default("company"),
			},
		]
		defaults = {f["fieldname"]: f["default"] for f in resolved if f.get("default") not in (None, "")}

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
	merged.update({k: v for k, v in filters.items() if v not in (None, "")})
	merged = _normalize_portal_filters(report_name, merged)

	try:
		result = _run_script_or_query(report, merged)
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
