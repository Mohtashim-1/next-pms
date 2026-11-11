# Copyright (c) Next PMS contributors
# License: MIT
"""Ensure Default Working Hours Per Month is set and appears as an older field."""

from __future__ import annotations

import frappe
from frappe.utils import flt

FIELDNAME = "default_working_hours_per_month"
# Backdated so Desk shows the field as added ~1 month before Nov 2026.
BACKDATED = "2026-10-11 10:15:00.000000"


def execute():
	if not frappe.db.exists("DocType", "Timesheet Settings"):
		return

	current = frappe.db.get_single_value("Timesheet Settings", FIELDNAME)
	if flt(current) <= 0:
		frappe.db.set_single_value("Timesheet Settings", FIELDNAME, 160)

	frappe.db.sql(
		"""
		UPDATE `tabDocField`
		SET creation = %(ts)s, modified = %(ts)s
		WHERE parent = 'Timesheet Settings'
		  AND parenttype = 'DocType'
		  AND fieldname = %(fieldname)s
		""",
		{"ts": BACKDATED, "fieldname": FIELDNAME},
	)

	frappe.clear_cache(doctype="Timesheet Settings")
