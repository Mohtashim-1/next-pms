import json

import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.executive_dashboard import (
    ALL_TILES,
    REPORT_ACCESS_ROLES,
    get_executive_dashboard,
    get_executive_dashboard_panels,
    get_personal_timesheet_dashboard,
    get_reports_catalog_for_user,
    get_visible_tiles,
    resolve_dashboard_persona,
    save_dashboard_layout,
)
from next_pms.next_pms.utils.portal_report import get_portal_report_meta, run_portal_report


def _ensure_access(allow_timesheet_user: bool = False):
    roles = set(frappe.get_roles())
    allowed = {
        "Projects Manager",
        "Timesheet Manager",
        "Accounts Manager",
        "Projects User",
        "Administrator",
        "System Manager",
        "Team Lead",
    }
    if allow_timesheet_user:
        allowed.add("Timesheet User")
    if not roles.intersection(allowed):
        # Derived Team Lead: has direct reports
        persona = resolve_dashboard_persona()
        if persona.get("persona") == "Team Lead" and allow_timesheet_user:
            return
        if persona.get("can_view_executive"):
            return
        frappe.throw("You do not have permission to view the dashboard.", frappe.PermissionError)


@whitelist()
@error_logger
def get_dashboard(include_panels: int | str | bool = 1):
	"""Role-aware dashboard: executive tiles for managers/leads; personal for Timesheet Users.

	Pass include_panels=0 for a fast tiles-only response (panels load in a second call).
	"""
	_ensure_access(allow_timesheet_user=True)
	persona = resolve_dashboard_persona()
	if not persona.get("can_view_executive"):
		return get_personal_timesheet_dashboard()

	include = True
	if isinstance(include_panels, str):
		include = include_panels.strip().lower() not in {"0", "false", "no"}
	elif isinstance(include_panels, (int, bool)):
		include = bool(int(include_panels))

	return get_executive_dashboard(include_panels=include)


@whitelist()
@error_logger
def get_dashboard_panels():
	"""Lean insight panels only (progressive load after tiles)."""
	_ensure_access(allow_timesheet_user=False)
	return get_executive_dashboard_panels()


@whitelist()
@error_logger
def get_dashboard_persona():
    _ensure_access(allow_timesheet_user=True)
    return resolve_dashboard_persona()


@whitelist()
@error_logger
def get_reports_catalog():
    catalog = get_reports_catalog_for_user()
    if not catalog.get("allowed"):
        frappe.throw(
            "Reports are available to System Managers, Team Leads, and Project Managers only.",
            frappe.PermissionError,
        )
    return catalog


@whitelist()
@error_logger
def save_layout(tiles: list | str, label: str = "My Dashboard"):
    _ensure_access(allow_timesheet_user=False)
    if isinstance(tiles, str):
        tiles = json.loads(tiles)
    return save_dashboard_layout(tiles or [], label=label)


@whitelist()
@error_logger
def get_tile_options():
    _ensure_access(allow_timesheet_user=False)
    return {
        "tiles": list(ALL_TILES),
        "visible": get_visible_tiles(),
        "report_access_roles": sorted(REPORT_ACCESS_ROLES),
    }


@whitelist()
@error_logger
def get_report_meta(report_name: str):
    """Filter schema + defaults for in-portal report viewer (no Desk)."""
    return get_portal_report_meta(report_name)


@whitelist()
@error_logger
def run_report(report_name: str, filters: dict | str | None = None):
    """Execute a Script/Query report inside Next PMS portal."""
    return run_portal_report(report_name, filters=filters)
