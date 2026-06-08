# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe

from next_pms.integrations.security.crypto import ALGORITHM, decrypt_aes256_gcm, derive_aes256_key, encrypt_aes256_gcm
from next_pms.integrations.security.keys import get_active_key_version, get_master_key_material, get_security_settings


def encrypt_secret(
	plaintext: str,
	owner_doctype: str,
	owner_name: str,
	field_key: str,
) -> str:
	settings = get_security_settings()
	if not settings.enable_aes256_at_rest:
		return plaintext

	key_version = get_active_key_version()
	aes_key = derive_aes256_key(get_master_key_material(key_version))
	ciphertext = encrypt_aes256_gcm(plaintext, aes_key)

	existing = frappe.db.get_value(
		"PMS Encrypted Secret",
		{
			"owner_doctype": owner_doctype,
			"owner_name": owner_name,
			"field_key": field_key,
		},
		"name",
	)
	payload = {
		"owner_doctype": owner_doctype,
		"owner_name": owner_name,
		"field_key": field_key,
		"key_version": key_version,
		"algorithm": ALGORITHM,
		"ciphertext": ciphertext,
	}
	if existing:
		doc = frappe.get_doc("PMS Encrypted Secret", existing)
		doc.update(payload)
	else:
		doc = frappe.get_doc({"doctype": "PMS Encrypted Secret", **payload})
	doc.flags.ignore_permissions = True
	doc.save()
	return f"{key_version}:{ciphertext}"


def decrypt_secret(
	owner_doctype: str,
	owner_name: str,
	field_key: str,
	stored_value: str | None = None,
) -> str | None:
	settings = get_security_settings()
	if not settings.enable_aes256_at_rest:
		return stored_value

	row = frappe.db.get_value(
		"PMS Encrypted Secret",
		{
			"owner_doctype": owner_doctype,
			"owner_name": owner_name,
			"field_key": field_key,
		},
		["key_version", "ciphertext"],
		as_dict=True,
	)
	if not row and stored_value and ":" in stored_value:
		key_version, ciphertext = stored_value.split(":", 1)
		row = {"key_version": key_version, "ciphertext": ciphertext}
	if not row:
		return stored_value

	aes_key = derive_aes256_key(get_master_key_material(row.key_version))
	return decrypt_aes256_gcm(row.ciphertext, aes_key)


def reencrypt_all_secrets(old_version: str, new_version: str) -> int:
	count = 0
	old_material = get_master_key_material(old_version)
	new_material = get_master_key_material(new_version)
	old_key = derive_aes256_key(old_material)
	new_key = derive_aes256_key(new_material)

	for row in frappe.get_all(
		"PMS Encrypted Secret",
		filters={"key_version": old_version},
		fields=["name", "ciphertext"],
	):
		plaintext = decrypt_aes256_gcm(row.ciphertext, old_key)
		new_ciphertext = encrypt_aes256_gcm(plaintext, new_key)
		frappe.db.set_value(
			"PMS Encrypted Secret",
			row.name,
			{"ciphertext": new_ciphertext, "key_version": new_version},
		)
		count += 1
	return count
