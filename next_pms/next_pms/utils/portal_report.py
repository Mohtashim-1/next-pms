# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

import json
import os
import re

import frappe
from frappe.modules import get_module_path, scrub
from frappe.utils import add_months, today

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
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
	],
	"Monthly Attendance Sheet": [
		{"fieldname": "month", "label": "Month", "fieldtype": "Select", "options": "\nJan\nFeb\nMar\nApr\nMay\nJun\nJul\nAug\nSep\nOct\nNov\nDec", "reqd": 1},
		{"fieldname": "year", "label": "Year", "fieldtype": "Int", "reqd": 1, "default": "year"},
		{
			"fieldname": "filter_based_on",
			"label": "Filter Based On",
			"fieldtype": "Select",
			"options": "\nEmployee\nCompany\nDepartment\nBranch",
			"reqd": 1,
			"default": "Company",
		},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
	],
	"Employee Analytics": [
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company", "reqd": 1},
	],
	"Gross Profit": [
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
	],
	"Employees working on a holiday": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
	],
	"Appraisal Evaluation Report": [
		{"fieldname": "from_date", "label": "From Date", "fieldtype": "Date", "reqd": 1, "default": "month_ago"},
		{"fieldname": "to_date", "label": "To Date", "fieldtype": "Date", "reqd": 1, "default": "today"},
		{"fieldname": "company", "label": "Company", "fieldtype": "Link", "options": "Company", "default": "company"},
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
	if value == "company":
		return frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
	if value == "year":
		return frappe.utils.getdate(today()).year
	return value


def _filters_from_report_doc(report) -> list[dict]:
	rows = []
	for row in report.get("filters") or []:
		rows.append(
			{
				"fieldname": row.fieldname,
				"label": row.label,
				"fieldtype": row.fieldtype,
				"options": row.options,
				"default": row.default,
				"reqd": int(row.reqd or 0),
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

		# Link doctype (string options)
		opt = re.search(r"options\s*:\s*[\"']([^\"']*)[\"']", block)
		if opt:
			item["options"] = opt.group(1)
		else:
			opt2 = re.search(r"options\s*:\s*`([^`]*)`", block)
			if opt2:
				item["options"] = opt2.group(1)

		# Array-of-values / array-of-objects options (Select)
		if "options" not in item:
			arr = re.search(r"options\s*:\s*\[([\s\S]*?)\]", block)
			if arr:
				values = re.findall(r"value\s*:\s*[\"']([^\"']*)[\"']", arr.group(1))
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
		if "get_today" in block and "add_months" in block:
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


def get_portal_report_meta(report_name: str) -> dict:
	ensure_portal_report_access()
	if not frappe.db.exists("Report", report_name):
		frappe.throw(f"Report {report_name} not found", frappe.DoesNotExistError)

	report = frappe.get_doc("Report", report_name)
	if not _user_can_view_report(report):
		frappe.throw("You do not have permission to view this report.", frappe.PermissionError)

	filters = PORTAL_REPORT_FILTERS.get(report_name) or _filters_from_report_doc(report)
	if not filters:
		filters = _parse_filters_from_js(report_name, report.module)

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

	return {
		"name": report_name,
		"columns": columns,
		"result": normalized,
		"message": result.get("message"),
		"chart": result.get("chart"),
		"report_summary": result.get("report_summary"),
		"placeholder": placeholder,
		"filters": merged,
	}
