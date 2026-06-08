# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import base64
import json

import frappe
from frappe import _
from frappe.utils import get_url, now_datetime

from next_pms.integrations.mfa.policy import get_mfa_settings
from next_pms.integrations.mfa.recovery import generate_recovery_codes


def get_rp_config() -> dict:
	host = frappe.local.request.host.split(":")[0] if frappe.local.request else frappe.local.site
	origin = get_url().rstrip("/")
	return {
		"rp_id": host,
		"rp_name": frappe.get_system_settings("otp_issuer_name") or "Next PMS",
		"origin": origin,
	}


def begin_registration(user: str, device_name: str) -> dict:
	settings = get_mfa_settings()
	if not settings.enable_webauthn:
		frappe.throw(_("WebAuthn is disabled in PMS MFA Settings."))

	from webauthn.helpers.structs import AuthenticatorSelectionCriteria, ResidentKeyRequirement, UserVerificationRequirement
	from webauthn import generate_registration_options

	rp = get_rp_config()
	options = generate_registration_options(
		rp_id=rp["rp_id"],
		rp_name=rp["rp_name"],
		user_id=user.encode(),
		user_name=user,
		user_display_name=frappe.db.get_value("User", user, "full_name") or user,
		authenticator_selection=AuthenticatorSelectionCriteria(
			resident_key=ResidentKeyRequirement.PREFERRED,
			user_verification=UserVerificationRequirement.PREFERRED,
		),
	)

	challenge_key = _cache_key("reg", user)
	frappe.cache.set_value(challenge_key, base64.b64encode(options.challenge).decode(), expires_in_sec=300)

	return json.loads(options.model_dump_json())


def complete_registration(user: str, device_name: str, credential: dict | str) -> list[str]:
	from webauthn import verify_registration_response

	if isinstance(credential, str):
		credential = json.loads(credential)

	rp = get_rp_config()
	challenge_key = _cache_key("reg", user)
	challenge_b64 = frappe.cache.get_value(challenge_key)
	if not challenge_b64:
		frappe.throw(_("Registration session expired. Please try again."))

	verification = verify_registration_response(
		credential=credential,
		expected_challenge=base64.b64decode(challenge_b64),
		expected_rp_id=rp["rp_id"],
		expected_origin=rp["origin"],
		require_user_verification=False,
	)

	cred_id = credential.get("id")
	if not cred_id:
		cred_id = base64.b64encode(verification.credential_id).decode()
	if frappe.db.exists("PMS WebAuthn Credential", {"credential_id": cred_id}):
		frappe.throw(_("This passkey is already registered."))

	doc = frappe.get_doc(
		{
			"doctype": "PMS WebAuthn Credential",
			"user": user,
			"device_name": device_name or "Passkey",
			"credential_id": cred_id,
			"public_key": base64.b64encode(verification.credential_public_key).decode(),
			"sign_count": verification.sign_count,
			"transports": json.dumps(credential.get("response", {}).get("transports") or []),
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()

	frappe.cache.delete_value(challenge_key)

	from next_pms.integrations.mfa.totp import user_has_totp

	if not user_has_totp(user):
		return generate_recovery_codes(user, force=False)
	return []


def begin_authentication(user: str, tmp_id: str | None = None) -> dict:
	from webauthn.helpers.structs import PublicKeyCredentialDescriptor
	from webauthn import generate_authentication_options

	credentials = frappe.get_all(
		"PMS WebAuthn Credential",
		filters={"user": user},
		fields=["credential_id"],
	)
	if not credentials:
		frappe.throw(_("No passkeys registered for this user."))

	rp = get_rp_config()
	allow_credentials = [
		PublicKeyCredentialDescriptor(id=base64.b64decode(row.credential_id)) for row in credentials
	]
	options = generate_authentication_options(rp_id=rp["rp_id"], allow_credentials=allow_credentials)

	cache_suffix = tmp_id or user
	challenge_key = _cache_key("auth", cache_suffix)
	frappe.cache.set_value(challenge_key, base64.b64encode(options.challenge).decode(), expires_in_sec=300)
	frappe.cache.set_value(challenge_key + ":user", user, expires_in_sec=300)

	payload = json.loads(options.model_dump_json())
	payload["tmp_id"] = tmp_id
	return payload


def verify_authentication(user: str, credential: dict | str, tmp_id: str | None = None) -> bool:
	from webauthn import verify_authentication_response

	if isinstance(credential, str):
		credential = json.loads(credential)

	cred_id = credential.get("id") or credential.get("rawId")
	if not cred_id:
		return False

	stored = frappe.db.get_value(
		"PMS WebAuthn Credential",
		{"user": user, "credential_id": cred_id},
		["name", "public_key", "sign_count"],
		as_dict=True,
	)
	if not stored:
		# rawId may be base64url without padding
		for row in frappe.get_all("PMS WebAuthn Credential", filters={"user": user}, fields=["name", "credential_id", "public_key", "sign_count"]):
			if row.credential_id == cred_id or row.credential_id.replace("=", "") == str(cred_id).replace("=", ""):
				stored = row
				break
	if not stored:
		return False

	rp = get_rp_config()
	cache_suffix = tmp_id or user
	challenge_key = _cache_key("auth", cache_suffix)
	challenge_b64 = frappe.cache.get_value(challenge_key)
	if not challenge_b64:
		frappe.throw(_("Authentication session expired. Please try again."))

	verification = verify_authentication_response(
		credential=credential,
		expected_challenge=base64.b64decode(challenge_b64),
		expected_rp_id=rp["rp_id"],
		expected_origin=rp["origin"],
		credential_public_key=base64.b64decode(stored.public_key),
		credential_current_sign_count=int(stored.sign_count or 0),
		require_user_verification=False,
	)

	frappe.db.set_value(
		"PMS WebAuthn Credential",
		stored.name,
		{"sign_count": verification.new_sign_count, "last_used_on": now_datetime()},
	)
	frappe.cache.delete_value(challenge_key)
	frappe.cache.delete_value(challenge_key + ":user")
	return True


def delete_credential(user: str, credential_name: str):
	doc = frappe.get_doc("PMS WebAuthn Credential", credential_name)
	if doc.user != user and "System Manager" not in frappe.get_roles():
		frappe.throw(_("Not permitted."), frappe.PermissionError)
	frappe.delete_doc("PMS WebAuthn Credential", credential_name, ignore_permissions=True)


def clear_webauthn_for_user(user: str):
	for row in frappe.get_all("PMS WebAuthn Credential", filters={"user": user}, pluck="name"):
		frappe.delete_doc("PMS WebAuthn Credential", row, ignore_permissions=True)


def _cache_key(kind: str, suffix: str) -> str:
	return f"pms_mfa_webauthn_{kind}:{suffix}"
