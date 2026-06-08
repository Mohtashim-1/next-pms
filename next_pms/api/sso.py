# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint

from next_pms.integrations.sso.oidc import get_enabled_oidc_providers
from next_pms.integrations.sso.saml import (
	get_acs_url,
	get_enabled_saml_providers,
	get_sp_entity_id,
	initiate_saml_login as start_saml_login,
	process_saml_acs,
	render_sp_metadata,
)


@frappe.whitelist(allow_guest=True)
def get_login_providers(redirect_to: str | None = None):
	settings = frappe.get_single("PMS SSO Settings")
	providers = get_enabled_oidc_providers()

	if redirect_to:
		from frappe.utils.oauth import get_oauth2_authorize_url

		from next_pms.integrations.sso.presets import provider_key

		for provider in providers:
			key = provider_key(provider["provider"])
			provider["auth_url"] = get_oauth2_authorize_url(key, redirect_to)

	for provider in get_enabled_saml_providers():
		if redirect_to:
			provider["auth_url"] = (
				f"{provider['auth_url']}&redirect_to={frappe.utils.quote(redirect_to, safe='')}"
			)
		providers.append(provider)

	return {
		"enforce_sso_only": cint(settings.enforce_sso_only),
		"providers": providers,
	}


@frappe.whitelist(allow_guest=True)
def initiate_saml_login(provider: str, redirect_to: str | None = None):
	start_saml_login(provider, redirect_to)


@frappe.whitelist(allow_guest=True, methods=["POST"])
def saml_acs(provider: str):
	process_saml_acs(provider)


@frappe.whitelist(allow_guest=True, methods=["GET"])
def saml_metadata():
	frappe.local.response.filecontent = render_sp_metadata()
	frappe.local.response.type = "download"
	frappe.local.response.filename = "pms_sp_metadata.xml"
	frappe.local.response.display_content_as = "inline"


@frappe.whitelist()
def get_sso_admin_context():
	frappe.only_for("System Manager")
	settings = frappe.get_single("PMS SSO Settings")
	return {
		"enforce_sso_only": cint(settings.enforce_sso_only),
		"enable_jit_provisioning": cint(settings.enable_jit_provisioning),
		"sp_entity_id": get_sp_entity_id(settings),
		"acs_url_template": get_acs_url("{provider}"),
		"metadata_url": frappe.utils.get_url("/api/method/next_pms.api.sso.saml_metadata"),
		"providers": [
			{
				"label": row.provider_label,
				"protocol": row.protocol,
				"vendor": row.vendor,
				"enabled": row.enabled,
			}
			for row in settings.providers or []
		],
	}
