# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

from next_pms.integrations.mfa.policy import get_mfa_settings, get_user_mfa_methods


def should_use_sms_fallback(user: str) -> bool:
	settings = get_mfa_settings()
	if not settings.allow_sms_fallback:
		return False

	methods = get_user_mfa_methods(user)
	return methods["sms_fallback"] and not methods["primary_enrolled"]


def get_login_verification_method(user: str) -> str:
	methods = get_user_mfa_methods(user)
	if methods["totp"]:
		return "OTP App"
	if should_use_sms_fallback(user):
		return "SMS"
	return "OTP App"
