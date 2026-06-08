# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe.utils import add_days, get_datetime, now_datetime

from next_pms.integrations.security.keys import create_encryption_key, get_security_settings
from next_pms.integrations.security.storage import reencrypt_all_secrets


def rotate_encryption_keys(force: bool = False) -> dict:
	settings = get_security_settings()
	if not settings.key_rotation_enabled and not force:
		return {"rotated": False, "reason": "disabled"}

	if not force and settings.next_key_rotation_on:
		if get_datetime(settings.next_key_rotation_on) > get_datetime(now_datetime()):
			return {"rotated": False, "reason": "not_due", "next": settings.next_key_rotation_on}

	old_version = settings.active_key_version or frappe.db.get_value(
		"PMS Encryption Key", {"is_active": 1}, "key_version"
	)
	if not old_version:
		create_encryption_key(settings, activate=True)
		return {"rotated": True, "reason": "bootstrap"}

	new_doc = create_encryption_key(settings, activate=True)
	reencrypted = reencrypt_all_secrets(old_version, new_doc.key_version)

	now = now_datetime()
	next_due = add_days(get_datetime(now), int(settings.key_rotation_interval_days or 365))
	frappe.db.set_single_value(
		"PMS Security Settings",
		{
			"last_key_rotation_on": now,
			"next_key_rotation_on": next_due,
			"active_key_version": new_doc.key_version,
		},
	)

	if old_version:
		frappe.db.set_value(
			"PMS Encryption Key",
			old_version,
			{"rotation_notes": f"Retired during rotation to {new_doc.key_version}"},
		)

	return {
		"rotated": True,
		"old_version": old_version,
		"new_version": new_doc.key_version,
		"reencrypted_secrets": reencrypted,
		"next_rotation": next_due,
	}


def check_due_rotation():
	settings = get_security_settings()
	if not settings.key_rotation_enabled:
		return
	if not settings.next_key_rotation_on:
		return
	if get_datetime(settings.next_key_rotation_on) <= get_datetime(now_datetime()):
		rotate_encryption_keys(force=True)
