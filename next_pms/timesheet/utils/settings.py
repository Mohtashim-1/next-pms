# Copyright (c) Next PMS contributors
# License: MIT

import frappe


def is_project_required_on_timesheet() -> bool:
	"""Return True when Timesheet Settings → Require Project on Timesheet is enabled."""
	try:
		return bool(frappe.db.get_single_value("Timesheet Settings", "require_project_on_timesheet"))
	except Exception:
		return False
