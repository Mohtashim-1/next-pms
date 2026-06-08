# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import now_datetime

from next_pms.integrations.mfa.policy import get_user_mfa_methods, mfa_required_for_user
from next_pms.integrations.mfa.recovery import clear_recovery_codes, verify_recovery_code
from next_pms.integrations.mfa.sms import get_login_verification_method, should_use_sms_fallback
from next_pms.integrations.mfa.totp import clear_totp_for_user
from next_pms.integrations.mfa.webauthn import clear_webauthn_for_user, verify_authentication


def install_mfa_hooks():
	import frappe.twofactor as twofactor

	if getattr(twofactor, "_pms_mfa_hook_installed", False):
		return

	original_should_run = twofactor.should_run_2fa
	original_confirm = twofactor.confirm_otp_token
	original_get_method = twofactor.get_verification_method
	original_get_verification = twofactor.get_verification_obj

	def should_run_2fa(user):
		if mfa_required_for_user(user):
			return True
		return original_should_run(user)

	def get_verification_method():
		user, _pwd = twofactor.get_cached_user_pass()
		if user:
			return get_login_verification_method(user)
		return original_get_method()

	def get_verification_obj(user, token, otp_secret):
		obj = original_get_verification(user, token, otp_secret)
		methods = get_user_mfa_methods(user)
		obj["available_methods"] = [
			k for k, enabled in methods.items() if enabled and k not in ("primary_enrolled",)
		]
		obj["allow_sms_fallback"] = should_use_sms_fallback(user)
		if methods["webauthn"]:
			obj["webauthn_available"] = True
		if methods["recovery"]:
			obj["recovery_available"] = True
		return obj

	def confirm_otp_token(login_manager, otp=None, tmp_id=None):
		otp = otp or frappe.form_dict.get("otp")
		tmp_id = tmp_id or frappe.form_dict.get("tmp_id")
		user = login_manager.user

		webauthn_cred = frappe.form_dict.get("webauthn_credential")
		if webauthn_cred:
			if verify_authentication(user, webauthn_cred, tmp_id=tmp_id):
				_mark_login_success(login_manager, tmp_id)
				return True
			login_manager.fail(_("Passkey verification failed."), user)
			return False

		if otp and ("-" in str(otp) or len(str(otp).replace("-", "").replace(" ", "")) >= 16):
			if verify_recovery_code(user, str(otp)):
				_mark_login_success(login_manager, tmp_id)
				return True
			login_manager.fail(_("Invalid recovery code."), user)
			return False

		return original_confirm(login_manager, otp=otp, tmp_id=tmp_id)

	twofactor.should_run_2fa = should_run_2fa
	twofactor.confirm_otp_token = confirm_otp_token
	twofactor.get_verification_method = get_verification_method
	twofactor.get_verification_obj = get_verification_obj
	twofactor._pms_mfa_hook_installed = True


def _mark_login_success(login_manager, tmp_id):
	from frappe.auth import get_login_attempt_tracker

	if tmp_id:
		for suffix in ("_usr", "_pwd", "_otp_secret", "_token"):
			frappe.cache.delete(tmp_id + suffix)
	tracker = get_login_attempt_tracker(login_manager.user)
	tracker.add_success_attempt()


def reset_user_mfa(user: str, notify: bool = True):
	frappe.only_for("System Manager")

	clear_totp_for_user(user)
	clear_webauthn_for_user(user)
	clear_recovery_codes(user)

	if frappe.db.exists("PMS User MFA", user):
		doc = frappe.get_doc("PMS User MFA", user)
		doc.last_mfa_reset_by = frappe.session.user
		doc.last_mfa_reset_on = now_datetime()
		doc.totp_enabled = 0
		doc.flags.ignore_permissions = True
		doc.save()

	if notify:
		_send_reset_notification(user)

	return {"ok": True, "user": user}


def _send_reset_notification(user: str):
	email = frappe.db.get_value("User", user, "email")
	if not email:
		return
	issuer = frappe.get_system_settings("otp_issuer_name") or "Next PMS"
	frappe.sendmail(
		recipients=email,
		subject=_("MFA Reset - {0}").format(issuer),
		message=_(
			"<p>Your multi-factor authentication settings on {0} were reset by an administrator. "
			"You will need to enroll again on your next login.</p>"
		).format(issuer),
		delayed=False,
	)
