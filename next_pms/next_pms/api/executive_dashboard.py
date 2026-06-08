import json

import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.executive_dashboard import (
    ALL_TILES,
    get_executive_dashboard,
    get_visible_tiles,
    save_dashboard_layout,
)


def _ensure_access():
    roles = set(frappe.get_roles())
    allowed = {
        "Projects Manager",
        "Timesheet Manager",
        "Accounts Manager",
        "Projects User",
        "Administrator",
    }
    if not roles.intersection(allowed):
        frappe.throw("You do not have permission to view the executive dashboard.", frappe.PermissionError)


@whitelist()
@error_logger
def get_dashboard():
    _ensure_access()
    return get_executive_dashboard()


@whitelist()
@error_logger
def save_layout(tiles: list | str, label: str = "My Dashboard"):
    _ensure_access()
    if isinstance(tiles, str):
        tiles = json.loads(tiles)
    return save_dashboard_layout(tiles or [], label=label)


@whitelist()
@error_logger
def get_tile_options():
    _ensure_access()
    return {
        "tiles": list(ALL_TILES),
        "visible": get_visible_tiles(),
    }
