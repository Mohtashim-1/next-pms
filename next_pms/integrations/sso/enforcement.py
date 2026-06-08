# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _

def sync_sso_only_setting(enforce: bool | int):
	frappe.db.set_single_value("System Settings", "disable_user_pass_login", 1 if enforce else 0)


def block_password_login_for_non_admin():
	if frappe.session.user == "Administrator":
		return
	if not frappe.db.get_single_value("PMS SSO Settings", "enforce_sso_only"):
		return
	if frappe.local.form_dict.get("cmd") != "login" and frappe.local.request.path != "/api/method/login":
		return

	from frappe.twofactor import get_cached_user_pass

	user, _pwd = get_cached_user_pass()
	if user and user != "Administrator":
		frappe.throw(_("Password login is disabled. Please sign in with SSO."), frappe.AuthenticationError)


def complete_sso_login(user_email: str, profile: dict, provider_label: str):
	frappe.flags.pms_sso_provider = provider_label
