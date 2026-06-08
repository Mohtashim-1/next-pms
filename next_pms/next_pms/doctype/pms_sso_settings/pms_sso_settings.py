# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from next_pms.integrations.sso.enforcement import sync_sso_only_setting
from next_pms.integrations.sso.oidc import sync_oidc_providers
from next_pms.integrations.sso.saml import ensure_saml_sp_credentials


class PMSSSOSettings(Document):
	def validate(self):
		self._validate_providers()
		ensure_saml_sp_credentials(self)

	def on_update(self):
		sync_oidc_providers(self)
		sync_sso_only_setting(self.enforce_sso_only)

	def _validate_providers(self):
		labels = []
		for row in self.providers or []:
			if not row.enabled:
				continue
			label = (row.provider_label or "").strip()
			if not label:
				frappe.throw(_("Each enabled provider needs a label."))
			if label in labels:
				frappe.throw(_("Duplicate provider label: {0}").format(label))
			labels.append(label)

			if row.protocol == "OIDC":
				if not row.client_id:
					frappe.throw(_("Client ID is required for OIDC provider {0}.").format(label))
				if not row.get_password("client_secret", raise_exception=False):
					existing = frappe.db.get_value(
						"Social Login Key",
						frappe.scrub(label),
						"name",
					)
					if not existing:
						frappe.throw(_("Client Secret is required for new OIDC provider {0}.").format(label))

			if row.protocol == "SAML":
				has_metadata = bool((row.saml_idp_metadata or "").strip())
				has_manual = bool(row.saml_idp_entity_id and row.saml_idp_sso_url and row.saml_idp_x509_cert)
				if not has_metadata and not has_manual:
					frappe.throw(
						_("SAML provider {0} needs metadata XML or Entity ID, SSO URL, and certificate.").format(
							label
						)
					)
