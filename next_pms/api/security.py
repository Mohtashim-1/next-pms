# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import cint

from next_pms.integrations.security.crypto import ALGORITHM
from next_pms.integrations.security.keys import get_security_settings
from next_pms.integrations.security.rotation import rotate_encryption_keys
from next_pms.integrations.security.tls import get_request_tls_version, is_secure_request, probe_external_tls


@frappe.whitelist()
def get_security_status():
	frappe.only_for("System Manager")
	settings = get_security_settings()
	keys = frappe.get_all(
		"PMS Encryption Key",
		fields=["key_version", "is_active", "tier", "activated_on", "retired_on", "key_fingerprint"],
		order_by="activated_on desc",
		limit=10,
	)
	secret_count = frappe.db.count("PMS Encrypted Secret")

	return {
		"tier": settings.security_tier,
		"aes256_at_rest": cint(settings.enable_aes256_at_rest),
		"algorithm": ALGORITHM,
		"customer_managed_keys": cint(settings.customer_managed_keys),
		"transit": {
			"require_tls_13": cint(settings.require_tls_13),
			"enforce_https": cint(settings.enforce_https),
			"current_request_secure": is_secure_request(),
			"current_tls_version": get_request_tls_version(),
			"last_tls_check_on": settings.last_tls_check_on,
			"last_tls_version": settings.last_tls_version,
		},
		"rotation": {
			"enabled": cint(settings.key_rotation_enabled),
			"interval_days": settings.key_rotation_interval_days,
			"active_key_version": settings.active_key_version,
			"last_rotation": settings.last_key_rotation_on,
			"next_rotation": settings.next_key_rotation_on,
		},
		"encryption_keys": keys,
		"encrypted_secret_count": secret_count,
	}


@frappe.whitelist()
def run_tls_probe(host: str | None = None):
	frappe.only_for("System Manager")
	return probe_external_tls(host)


@frappe.whitelist()
def run_key_rotation(force: bool = False):
	frappe.only_for("System Manager")
	return rotate_encryption_keys(force=cint(force))
