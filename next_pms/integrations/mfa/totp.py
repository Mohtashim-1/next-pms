# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe.utils.password import decrypt, encrypt

from next_pms.integrations.mfa.policy import get_mfa_settings


def user_has_totp(user: str) -> bool:
	if frappe.db.get_value("PMS User MFA", {"user": user}, "totp_enabled"):
		return True
	from frappe.twofactor import get_default

	return bool(get_default(user + "_otplogin"))


def mark_totp_enabled(user: str):
	doc = _get_or_create_user_mfa(user)
	doc.totp_enabled = 1
	doc.flags.ignore_permissions = True
	doc.save()


def get_otpsecret_for_user(user: str) -> str:
	from frappe.twofactor import get_default, set_default

	if otp_secret := get_default(user + "_otpsecret"):
		return decrypt(otp_secret, key=f"{user}.otpsecret")

	import os
	from base64 import b32encode

	otp_secret = b32encode(os.urandom(10)).decode("utf-8")
	set_default(user + "_otpsecret", encrypt(otp_secret))
	frappe.db.commit()
	return otp_secret


def get_totp_provisioning_uri(user: str) -> dict:
	import pyotp

	settings = get_mfa_settings()
	if not settings.enable_totp:
		frappe.throw("TOTP is disabled in PMS MFA Settings.")

	issuer = frappe.db.get_single_value("System Settings", "otp_issuer_name") or "Next PMS"
	secret = get_otpsecret_for_user(user)
	uri = pyotp.TOTP(secret).provisioning_uri(user, issuer_name=issuer)
	return {"secret": secret, "provisioning_uri": uri, "issuer": issuer}


def confirm_totp_setup(user: str, otp: str) -> list[str]:
	import pyotp

	from next_pms.integrations.mfa.recovery import generate_recovery_codes

	secret = get_otpsecret_for_user(user)
	if not pyotp.TOTP(secret).verify(str(otp).strip(), valid_window=1):
		frappe.throw("Invalid authenticator code.")

	from frappe.twofactor import set_default

	set_default(user + "_otplogin", 1)
	mark_totp_enabled(user)
	return generate_recovery_codes(user, force=True)


def clear_totp_for_user(user: str):
	from frappe.twofactor import clear_default

	clear_default(user + "_otplogin")
	clear_default(user + "_otpsecret")
	if frappe.db.exists("PMS User MFA", user):
		frappe.db.set_value("PMS User MFA", user, "totp_enabled", 0)


def _get_or_create_user_mfa(user: str):
	if frappe.db.exists("PMS User MFA", user):
		return frappe.get_doc("PMS User MFA", user)
	doc = frappe.get_doc({"doctype": "PMS User MFA", "user": user})
	doc.flags.ignore_permissions = True
	doc.insert(ignore_if_duplicate=True)
	return doc
