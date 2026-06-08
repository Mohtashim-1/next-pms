# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import now_datetime

from next_pms.integrations.security.crypto import (
	fingerprint_key,
	generate_master_key_material,
)


def get_security_settings():
	return frappe.get_single("PMS Security Settings")


def get_active_key_version() -> str:
	version = frappe.db.get_single_value("PMS Security Settings", "active_key_version")
	if version:
		return version
	settings = get_security_settings()
	doc = ensure_active_encryption_key(settings)
	return doc.key_version


def get_master_key_material(key_version: str | None = None) -> str:
	key_version = key_version or get_active_key_version()
	settings = get_security_settings()

	if settings.customer_managed_keys and settings.security_tier == "Enterprise":
		cmk = _load_customer_master_key()
		if cmk:
			return f"{cmk}:{key_version}"

	wrapped = frappe.conf.get(f"pms_encryption_key_{key_version}")
	if wrapped:
		from frappe.utils.password import decrypt

		return decrypt(wrapped, key=f"pms.encryption.{key_version}")

	# Bootstrap: derive from site encryption key + version salt
	from frappe.utils.password import get_encryption_key

	return f"{get_encryption_key()}:{key_version}"


def ensure_active_encryption_key(settings=None):
	settings = settings or get_security_settings()
	active = frappe.db.get_value("PMS Encryption Key", {"is_active": 1}, "name")
	if active:
		doc = frappe.get_doc("PMS Encryption Key", active)
		frappe.db.set_single_value("PMS Security Settings", "active_key_version", doc.key_version)
		return doc

	return create_encryption_key(settings, activate=True)


def create_encryption_key(settings=None, activate: bool = False):
	settings = settings or get_security_settings()
	key_version = _next_key_version()

	if settings.customer_managed_keys and settings.security_tier == "Enterprise":
		material = _load_customer_master_key()
		if not material:
			frappe.throw("Customer master key is required for Enterprise BYOK.")
	else:
		material = generate_master_key_material()
		_store_wrapped_key(key_version, material, settings)

	doc = frappe.get_doc(
		{
			"doctype": "PMS Encryption Key",
			"key_version": key_version,
			"is_active": 1 if activate else 0,
			"tier": settings.security_tier,
			"key_fingerprint": fingerprint_key(material),
			"activated_on": now_datetime() if activate else None,
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert(ignore_if_duplicate=True)

	if activate:
		_deactivate_other_keys(key_version)
		frappe.db.set_single_value("PMS Security Settings", "active_key_version", key_version)
		if not settings.last_key_rotation_on:
			frappe.db.set_single_value("PMS Security Settings", "last_key_rotation_on", now_datetime())

	return doc


def sync_customer_master_key(settings):
	if not settings.customer_managed_keys:
		return

	cmk = settings.get_password("customer_master_key")
	if not cmk:
		return

	from frappe.utils.password import encrypt

	frappe.conf.pms_customer_master_key = encrypt(cmk, key="pms.cmk.wrapper")


def _load_customer_master_key() -> str | None:
	if frappe.conf.get("pms_customer_master_key"):
		from frappe.utils.password import decrypt

		return decrypt(frappe.conf.pms_customer_master_key, key="pms.cmk.wrapper")

	settings = get_security_settings()
	cmk = settings.get_password("customer_master_key", raise_exception=False)
	return cmk


def _store_wrapped_key(key_version: str, material: str, settings):
	from frappe.installer import update_site_config
	from frappe.utils.password import encrypt

	conf_key = f"pms_encryption_key_{key_version}"
	wrapped = encrypt(material, key=f"pms.encryption.{key_version}")
	update_site_config(conf_key, wrapped)
	frappe.local.conf[conf_key] = wrapped


def _deactivate_other_keys(active_version: str):
	for row in frappe.get_all("PMS Encryption Key", filters={"is_active": 1}, pluck="name"):
		doc = frappe.get_doc("PMS Encryption Key", row)
		if doc.key_version != active_version:
			doc.is_active = 0
			doc.retired_on = now_datetime()
			doc.flags.ignore_permissions = True
			doc.save()


def _next_key_version() -> str:
	prefix = frappe.utils.now_datetime().strftime("v%Y%m%d")
	existing = frappe.db.count("PMS Encryption Key", {"key_version": ("like", f"{prefix}%")})
	return f"{prefix}-{existing + 1:03d}"
