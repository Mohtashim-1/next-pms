# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import cint

from next_pms.integrations.mfa.hooks import reset_user_mfa
from next_pms.integrations.mfa.policy import get_mfa_settings, get_user_mfa_methods, mfa_required_for_user
from next_pms.integrations.mfa.recovery import generate_recovery_codes
from next_pms.integrations.mfa.totp import confirm_totp_setup as _confirm_totp_setup
from next_pms.integrations.mfa.totp import get_totp_provisioning_uri
from next_pms.integrations.mfa.webauthn import (
	begin_authentication,
	begin_registration,
	complete_registration,
	delete_credential,
)


@frappe.whitelist()
def get_my_mfa_status():
	user = frappe.session.user
	if user == "Guest":
		frappe.throw(_("Not permitted."), frappe.PermissionError)

	settings = get_mfa_settings()
	methods = get_user_mfa_methods(user)
	credentials = frappe.get_all(
		"PMS WebAuthn Credential",
		filters={"user": user},
		fields=["name", "device_name", "last_used_on"],
	)
	rec = frappe.db.get_value(
		"PMS User MFA",
		{"user": user},
		["recovery_codes_remaining", "recovery_codes_generated_on"],
		as_dict=True,
	)

	return {
		"enforcement_required": mfa_required_for_user(user),
		"settings": {
			"enable_totp": cint(settings.enable_totp),
			"enable_webauthn": cint(settings.enable_webauthn),
			"allow_sms_fallback": cint(settings.allow_sms_fallback),
		},
		"methods": methods,
		"passkeys": credentials,
		"recovery_codes_remaining": rec.recovery_codes_remaining if rec else 0,
		"recovery_codes_generated_on": rec.recovery_codes_generated_on if rec else None,
	}


@frappe.whitelist()
def begin_totp_setup():
	user = frappe.session.user
	return get_totp_provisioning_uri(user)


@frappe.whitelist()
def confirm_totp_setup(otp: str):
	user = frappe.session.user
	codes = _confirm_totp_setup(user, otp)
	return {"recovery_codes": codes}


@frappe.whitelist()
def begin_passkey_registration(device_name: str = "Passkey"):
	user = frappe.session.user
	return begin_registration(user, device_name)


@frappe.whitelist()
def complete_passkey_registration(device_name: str, credential: str):
	user = frappe.session.user
	credential_data = json.loads(credential) if isinstance(credential, str) else credential
	codes = complete_registration(user, device_name, credential_data)
	return {"recovery_codes": codes}


@frappe.whitelist()
def remove_passkey(credential_name: str):
	delete_credential(frappe.session.user, credential_name)
	return {"ok": True}


@frappe.whitelist()
def regenerate_recovery_codes():
	user = frappe.session.user
	codes = generate_recovery_codes(user, force=True)
	return {"recovery_codes": codes}


@frappe.whitelist()
def admin_reset_user_mfa(user: str, notify: bool = True):
	return reset_user_mfa(user, notify=cint(notify))


@frappe.whitelist(allow_guest=True)
def begin_passkey_login(tmp_id: str):
	from frappe.twofactor import get_cached_user_pass

	user, _pwd = get_cached_user_pass()
	if not user:
		frappe.throw(_("Login session expired."))
	return begin_authentication(user, tmp_id=tmp_id)


@frappe.whitelist(allow_guest=True)
def get_login_mfa_context(tmp_id: str):
	from frappe.twofactor import get_cached_user_pass

	user, _pwd = get_cached_user_pass()
	if not user:
		frappe.throw(_("Login session expired."))

	methods = get_user_mfa_methods(user)
	return {
		"user": user,
		"methods": methods,
		"tmp_id": tmp_id,
	}
