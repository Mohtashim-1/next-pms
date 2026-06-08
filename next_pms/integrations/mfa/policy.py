# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe.permissions import ALL_USER_ROLE


def get_mfa_settings():
	return frappe.get_single("PMS MFA Settings")


def mfa_is_active() -> bool:
	return get_mfa_settings().enforcement_mode != "Off"


def mfa_required_for_user(user: str) -> bool:
	if not user or user == "Administrator":
		return False

	settings = get_mfa_settings()
	mode = settings.enforcement_mode
	if mode == "Off":
		return False
	if mode == "Global":
		return True
	if mode == "Per Role":
		enforced_roles = {row.role for row in settings.enforced_roles or []}
		if not enforced_roles:
			return False
		user_roles = set(frappe.get_roles(user)) | {ALL_USER_ROLE}
		return bool(user_roles & enforced_roles)
	return False


def user_has_primary_mfa(user: str) -> bool:
	from next_pms.integrations.mfa.totp import user_has_totp

	if user_has_totp(user):
		return True
	return bool(frappe.db.count("PMS WebAuthn Credential", {"user": user}))


def get_user_mfa_methods(user: str) -> dict:
	settings = get_mfa_settings()
	has_totp = False
	has_webauthn = False
	has_recovery = False
	has_sms = False

	if settings.enable_totp:
		from next_pms.integrations.mfa.totp import user_has_totp

		has_totp = user_has_totp(user)

	if settings.enable_webauthn:
		has_webauthn = bool(frappe.db.count("PMS WebAuthn Credential", {"user": user}))

	rec = frappe.db.get_value(
		"PMS User MFA",
		{"user": user},
		["recovery_codes_remaining"],
		as_dict=True,
	)
	has_recovery = bool(rec and int(rec.recovery_codes_remaining or 0) > 0)

	if settings.allow_sms_fallback and not has_totp and not has_webauthn:
		phone = frappe.db.get_value("User", user, ["phone", "mobile_no"], as_dict=True)
		has_sms = bool(phone and (phone.mobile_no or phone.phone))

	return {
		"totp": has_totp,
		"webauthn": has_webauthn,
		"recovery": has_recovery,
		"sms_fallback": has_sms,
		"primary_enrolled": has_totp or has_webauthn,
	}
