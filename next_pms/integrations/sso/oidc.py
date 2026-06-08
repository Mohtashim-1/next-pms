# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe

from next_pms.integrations.sso.presets import build_social_login_doc, provider_key


def sync_oidc_providers(settings=None):
	settings = settings or frappe.get_single("PMS SSO Settings")
	active_keys: set[str] = set()

	for row in settings.providers or []:
		if not row.enabled or row.protocol != "OIDC":
			continue

		key = provider_key(row.provider_label)
		active_keys.add(key)
		payload = build_social_login_doc(row)

		if frappe.db.exists("Social Login Key", key):
			doc = frappe.get_doc("Social Login Key", key)
			doc.update({k: v for k, v in payload.items() if k not in ("doctype", "name") and v is not None})
			if payload.get("client_secret"):
				doc.client_secret = payload["client_secret"]
		else:
			doc = frappe.get_doc(payload)
		doc.flags.ignore_permissions = True
		doc.save()

		frappe.db.set_value(
			"PMS SSO Provider",
			row.name,
			"social_login_key",
			key,
			update_modified=False,
		)

	_disable_stale_oidc_keys(active_keys)


def _disable_stale_oidc_keys(active_keys: set[str]):
	settings = frappe.get_single("PMS SSO Settings")
	managed = {provider_key(row.provider_label) for row in settings.providers or [] if row.protocol == "OIDC"}

	for key in managed - active_keys:
		if frappe.db.exists("Social Login Key", key):
			frappe.db.set_value("Social Login Key", key, "enable_social_login", 0)


def get_enabled_oidc_providers() -> list[dict]:
	from frappe.utils.oauth import get_oauth2_authorize_url

	providers = []
	settings = frappe.get_single("PMS SSO Settings")

	for row in settings.providers or []:
		if not row.enabled or row.protocol != "OIDC":
			continue
		key = provider_key(row.provider_label)
		if not frappe.db.get_value("Social Login Key", key, "enable_social_login"):
			continue
		providers.append(
			{
				"provider": row.provider_label,
				"vendor": row.vendor,
				"protocol": "OIDC",
				"auth_url": get_oauth2_authorize_url(key, None),
				"icon": frappe.db.get_value("Social Login Key", key, "icon"),
			}
		)
	return providers


def install_oidc_hook():
	import frappe.utils.oauth as oauth_module

	if getattr(oauth_module, "_pms_sso_hook_installed", False):
		return

	from next_pms.integrations.sso.enforcement import complete_sso_login

	original = oauth_module.update_oauth_user

	def wrapped(user: str, data: dict, provider: str):
		original(user, data, provider)
		settings = frappe.get_single("PMS SSO Settings")
		if not settings.enable_jit_provisioning:
			return

		row = _find_provider_by_social_key(provider)
		if row and not row.allow_jit_provisioning:
			return

		from next_pms.integrations.sso.jit import provision_user

		profile = _normalize_oidc_profile(data, row)
		email = profile.get("email") or user
		provision_user(email, profile, row.provider_label if row else provider)
		complete_sso_login(email, profile, row.provider_label if row else provider)

	oauth_module.update_oauth_user = wrapped
	oauth_module._pms_sso_hook_installed = True


def _find_provider_by_social_key(social_key: str):
	settings = frappe.get_single("PMS SSO Settings")
	for row in settings.providers or []:
		if frappe.scrub(row.provider_label) == social_key:
			return row
	return None


def _normalize_oidc_profile(data: dict, row) -> dict:
	email_attr = (row.attribute_email if row else None) or "email"
	first_attr = (row.attribute_first_name if row else None) or "given_name"
	last_attr = (row.attribute_last_name if row else None) or "last_name"

	return {
		"email": data.get(email_attr) or data.get("email") or data.get("upn"),
		"first_name": data.get(first_attr) or data.get("given_name") or data.get("first_name"),
		"last_name": data.get(last_attr) or data.get("family_name") or data.get("last_name"),
	}
