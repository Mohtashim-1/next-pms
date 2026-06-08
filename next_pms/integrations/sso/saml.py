# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import base64
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from xml.etree import ElementTree as ET

import frappe
from frappe import _
from frappe.utils import get_url

from next_pms.integrations.sso.enforcement import complete_sso_login
from next_pms.integrations.sso.presets import get_saml_preset, provider_key


def ensure_saml_sp_credentials(settings):
	has_saml = any(row.enabled and row.protocol == "SAML" for row in settings.providers or [])
	if not has_saml:
		return

	if settings.saml_sp_certificate and settings.get_password("saml_sp_private_key", raise_exception=False):
		return

	cert_pem, key_pem = _generate_self_signed_cert()
	settings.saml_sp_certificate = cert_pem
	settings.saml_sp_private_key = key_pem


def get_sp_entity_id(settings=None) -> str:
	settings = settings or frappe.get_single("PMS SSO Settings")
	return settings.saml_sp_entity_id or get_url("/api/method/next_pms.api.sso.saml_metadata")


def get_acs_url(provider_label: str) -> str:
	return get_url(f"/api/method/next_pms.api.sso.saml_acs?provider={provider_label}")


def get_saml_provider_row(provider_label: str):
	settings = frappe.get_single("PMS SSO Settings")
	for row in settings.providers or []:
		if row.provider_label == provider_label and row.enabled and row.protocol == "SAML":
			return row
	frappe.throw(_("SAML provider {0} was not found or is disabled.").format(provider_label))


def build_saml_settings(row, settings=None) -> dict[str, Any]:
	settings = settings or frappe.get_single("PMS SSO Settings")
	idp = _resolve_idp_config(row)

	sp_cert = (settings.saml_sp_certificate or "").strip()
	sp_key = settings.get_password("saml_sp_private_key", raise_exception=False) or ""

	return {
		"strict": True,
		"debug": frappe.conf.developer_mode,
		"sp": {
			"entityId": get_sp_entity_id(settings),
			"assertionConsumerService": {
				"url": get_acs_url(row.provider_label),
				"binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
			},
			"x509cert": _strip_pem(sp_cert),
			"privateKey": _strip_pem(sp_key),
		},
		"idp": idp,
		"security": {
			"authnRequestsSigned": False,
			"wantAssertionsSigned": True,
			"wantMessagesSigned": False,
		},
	}


def initiate_saml_login(provider_label: str, redirect_to: str | None = None):
	from onelogin.saml2.auth import OneLogin_Saml2_Auth

	row = get_saml_provider_row(provider_label)
	auth = OneLogin_Saml2_Auth(_prepare_request(redirect_to=redirect_to), build_saml_settings(row))
	login_url = auth.login()
	frappe.local.response["type"] = "redirect"
	frappe.local.response["location"] = login_url


def process_saml_acs(provider_label: str):
	from onelogin.saml2.auth import OneLogin_Saml2_Auth

	row = get_saml_provider_row(provider_label)
	req = _prepare_request()
	auth = OneLogin_Saml2_Auth(req, build_saml_settings(row))
	auth.process_response()
	errors = auth.get_errors()
	if errors:
		frappe.log_error(message=str(errors), title="SAML ACS Error")
		frappe.throw(_("SAML authentication failed: {0}").format(", ".join(errors)))

	if not auth.is_authenticated():
		frappe.throw(_("SAML authentication failed."))

	attributes = auth.get_attributes()
	name_id = auth.get_nameid()
	profile = extract_saml_profile(attributes, name_id, row)
	email = profile.get("email")
	if not email:
		frappe.throw(_("SAML response did not include an email attribute."))

	settings = frappe.get_single("PMS SSO Settings")
	if settings.enable_jit_provisioning and row.allow_jit_provisioning:
		from next_pms.integrations.sso.jit import provision_user

		provision_user(email, profile, row.provider_label)
	elif not frappe.db.exists("User", email):
		frappe.throw(_("User {0} is not registered. JIT provisioning is disabled.").format(email))

	frappe.local.login_manager.login_as(email)
	complete_sso_login(email, profile, row.provider_label)

	redirect_to = req.get("redirect_to")
	frappe.local.response["type"] = "redirect"
	frappe.local.response["location"] = redirect_to or get_url("/next-pms")


def extract_saml_profile(attributes: dict, name_id: str | None, row) -> dict:
	preset = get_saml_preset(row.vendor)
	email_attr = row.attribute_email or preset.get("attribute_email") or "email"
	first_attr = row.attribute_first_name or preset.get("attribute_first_name") or "given_name"
	last_attr = row.attribute_last_name or preset.get("attribute_last_name") or "family_name"

	def pick(attr: str) -> str | None:
		values = attributes.get(attr) or attributes.get(attr.lower())
		if values:
			return values[0]
		return None

	email = pick(email_attr) or name_id
	return {
		"email": (email or "").strip().lower(),
		"first_name": pick(first_attr) or (email.split("@")[0] if email else ""),
		"last_name": pick(last_attr) or "",
	}


def render_sp_metadata() -> str:
	from onelogin.saml2.settings import OneLogin_Saml2_Settings

	settings = frappe.get_single("PMS SSO Settings")
	row = next((r for r in settings.providers or [] if r.enabled and r.protocol == "SAML"), None)
	if not row:
		frappe.throw(_("No enabled SAML provider configured."))

	saml_settings = OneLogin_Saml2_Settings(build_saml_settings(row, settings), sp_validation_only=True)
	metadata = saml_settings.get_sp_metadata()
	errors = saml_settings.validate_metadata(metadata)
	if errors:
		frappe.throw(_("Invalid SP metadata: {0}").format(", ".join(errors)))
	return metadata


def _resolve_idp_config(row) -> dict[str, Any]:
	entity_id = row.saml_idp_entity_id
	sso_url = row.saml_idp_sso_url
	cert = row.saml_idp_x509_cert

	if row.saml_idp_metadata:
		parsed = parse_idp_metadata(row.saml_idp_metadata)
		entity_id = entity_id or parsed.get("entity_id")
		sso_url = sso_url or parsed.get("sso_url")
		cert = cert or parsed.get("certificate")

	if not entity_id or not sso_url or not cert:
		frappe.throw(_("Incomplete SAML IdP configuration for {0}.").format(row.provider_label))

	return {
		"entityId": entity_id,
		"singleSignOnService": {
			"url": sso_url,
			"binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
		},
		"x509cert": _strip_pem(cert),
	}


def parse_idp_metadata(metadata_xml: str) -> dict[str, str]:
	root = ET.fromstring(metadata_xml)
	ns = {"md": "urn:oasis:names:tc:SAML:2.0:metadata", "ds": "http://www.w3.org/2000/09/xmldsig#"}
	entity_id = root.attrib.get("entityID")
	sso_node = root.find('.//md:SingleSignOnService[@Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"]', ns)
	if sso_node is None:
		sso_node = root.find(".//md:SingleSignOnService", ns)
	cert_node = root.find(".//ds:X509Certificate", ns)
	return {
		"entity_id": entity_id or "",
		"sso_url": sso_node.attrib.get("Location") if sso_node is not None else "",
		"certificate": cert_node.text.strip() if cert_node is not None and cert_node.text else "",
	}


def _prepare_request(redirect_to: str | None = None) -> dict[str, Any]:
	form_dict = frappe.local.form_dict
	return {
		"https": "on" if frappe.local.request.scheme == "https" else "off",
		"http_host": frappe.local.request.host,
		"script_name": frappe.local.request.path,
		"get_data": dict(frappe.local.request.args or {}),
		"post_data": dict(form_dict or {}),
		"redirect_to": redirect_to or (frappe.local.request.args or {}).get("redirect_to"),
	}


def _strip_pem(value: str) -> str:
	if not value:
		return ""
	return re.sub(r"-----BEGIN[^-]+-----|-----END[^-]+-----|\s", "", value)


def _generate_self_signed_cert() -> tuple[str, str]:
	from cryptography import x509
	from cryptography.hazmat.primitives import hashes, serialization
	from cryptography.hazmat.primitives.asymmetric import rsa
	from cryptography.x509.oid import NameOID

	key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
	subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, get_sp_entity_id())])
	cert = (
		x509.CertificateBuilder()
		.subject_name(subject)
		.issuer_name(issuer)
		.public_key(key.public_key())
		.serial_number(x509.random_serial_number())
		.not_valid_before(datetime.now(timezone.utc))
		.not_valid_after(datetime.now(timezone.utc) + timedelta(days=825))
		.sign(key, hashes.SHA256())
	)

	cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode()
	key_pem = key.private_bytes(
		encoding=serialization.Encoding.PEM,
		format=serialization.PrivateFormat.TraditionalOpenSSL,
		encryption_algorithm=serialization.NoEncryption(),
	).decode()
	return cert_pem, key_pem


def get_enabled_saml_providers() -> list[dict]:
	settings = frappe.get_single("PMS SSO Settings")
	providers = []
	for row in settings.providers or []:
		if not row.enabled or row.protocol != "SAML":
			continue
		providers.append(
			{
				"provider": row.provider_label,
				"vendor": row.vendor,
				"protocol": "SAML",
				"auth_url": get_url(
					f"/api/method/next_pms.api.sso.initiate_saml_login?provider={row.provider_label}"
				),
			}
		)
	return providers
