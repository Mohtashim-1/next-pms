# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe

from next_pms.integrations.mfa.policy import mfa_is_active


def sync_frappe_two_factor_settings(settings=None):
	settings = settings or frappe.get_single("PMS MFA Settings")
	active = settings.enforcement_mode != "Off"

	frappe.db.set_single_value("System Settings", "enable_two_factor_auth", 1 if active else 0)
	if active:
		frappe.db.set_single_value("System Settings", "two_factor_method", "OTP App")
		if settings.enforcement_mode == "Global":
			from frappe.twofactor import toggle_two_factor_auth

			toggle_two_factor_auth(True, roles=["All"])
		elif settings.enforcement_mode == "Per Role":
			from frappe.twofactor import toggle_two_factor_auth

			toggle_two_factor_auth(False, roles=["All"])
			role_names = [row.role for row in settings.enforced_roles or []]
			if role_names:
				toggle_two_factor_auth(True, roles=role_names)
