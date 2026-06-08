# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

"""Vendor presets for OIDC and SAML identity providers."""

from __future__ import annotations

import json
from typing import Any

import frappe

OIDC_REDIRECT = "/api/method/frappe.integrations.oauth2_logins.custom/{provider_key}"


def provider_key(label: str) -> str:
	return frappe.scrub(label)


def get_oidc_preset(vendor: str, tenant_domain: str | None = None) -> dict[str, Any]:
	vendor = vendor or "Custom"
	tenant = (tenant_domain or "").strip().rstrip("/")

	if vendor == "Google":
		return {
			"social_login_provider": "Google",
			"custom_base_url": 0,
			"base_url": "https://www.googleapis.com",
			"authorize_url": "https://accounts.google.com/o/oauth2/auth",
			"access_token_url": "https://accounts.google.com/o/oauth2/token",
			"api_endpoint": "oauth2/v2/userinfo",
			"user_id_property": "email",
			"auth_url_data": json.dumps(
				{
					"scope": "openid email profile",
					"response_type": "code",
				}
			),
			"icon": "/assets/frappe/icons/social/google.svg",
		}

	if vendor == "Azure AD":
		tenant_segment = tenant or "common"
		base = f"https://login.microsoftonline.com/{tenant_segment}"
		return {
			"social_login_provider": "Custom",
			"custom_base_url": 0,
			"base_url": base,
			"authorize_url": f"{base}/oauth2/v2.0/authorize",
			"access_token_url": f"{base}/oauth2/v2.0/token",
			"api_endpoint": "https://graph.microsoft.com/oidc/userinfo",
			"user_id_property": "sub",
			"auth_url_data": json.dumps(
				{
					"scope": "openid profile email",
					"response_type": "code",
				}
			),
			"icon": "/assets/frappe/icons/social/office_365.svg",
		}

	if vendor == "Okta":
		if not tenant:
			frappe.throw("Okta domain is required (e.g. dev-123456.okta.com).")
		if not tenant.startswith("http"):
			tenant = f"https://{tenant}"
		return {
			"social_login_provider": "Custom",
			"custom_base_url": 1,
			"base_url": tenant,
			"authorize_url": "/oauth2/v1/authorize",
			"access_token_url": "/oauth2/v1/token",
			"api_endpoint": "/oauth2/v1/userinfo",
			"user_id_property": "sub",
			"auth_url_data": json.dumps(
				{
					"scope": "openid profile email",
					"response_type": "code",
				}
			),
			"icon": "fa fa-key",
		}

	if vendor == "OneLogin":
		if not tenant:
			frappe.throw("OneLogin subdomain is required.")
		base = tenant if tenant.startswith("http") else f"https://{tenant}.onelogin.com"
		return {
			"social_login_provider": "Custom",
			"custom_base_url": 1,
			"base_url": base,
			"authorize_url": "/oidc/2/auth",
			"access_token_url": "/oidc/2/token",
			"api_endpoint": "/oidc/2/me",
			"user_id_property": "sub",
			"auth_url_data": json.dumps(
				{
					"scope": "openid profile email",
					"response_type": "code",
				}
			),
			"icon": "fa fa-key",
		}

	return {
		"social_login_provider": "Custom",
		"custom_base_url": 1,
		"base_url": tenant or "",
		"authorize_url": "",
		"access_token_url": "",
		"api_endpoint": "",
		"user_id_property": "sub",
		"auth_url_data": json.dumps({"response_type": "code", "scope": "openid profile email"}),
		"icon": "fa fa-key",
	}


def get_saml_preset(vendor: str) -> dict[str, str]:
	presets = {
		"Okta": {
			"attribute_email": "email",
			"attribute_first_name": "firstName",
			"attribute_last_name": "lastName",
		},
		"Azure AD": {
			"attribute_email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
			"attribute_first_name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
			"attribute_last_name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
		},
		"OneLogin": {
			"attribute_email": "User.email",
			"attribute_first_name": "User.FirstName",
			"attribute_last_name": "User.LastName",
		},
		"Google": {
			"attribute_email": "email",
			"attribute_first_name": "first_name",
			"attribute_last_name": "last_name",
		},
	}
	return presets.get(vendor or "Custom", {})


def build_social_login_doc(row) -> dict[str, Any]:
	key = provider_key(row.provider_label)
	preset = get_oidc_preset(row.vendor, row.tenant_domain)
	redirect = OIDC_REDIRECT.format(provider_key=key)

	return {
		"doctype": "Social Login Key",
		"name": key,
		"provider_name": row.provider_label,
		"enable_social_login": 1,
		"client_id": row.client_id,
		"client_secret": row.get_password("client_secret"),
		"redirect_url": redirect,
		"sign_ups": "Allow" if row.allow_jit_provisioning else "Deny",
		**preset,
	}
