# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import hashlib
import json
import secrets
import string

import frappe
from frappe.utils import now_datetime

from next_pms.integrations.mfa.policy import get_mfa_settings
from next_pms.integrations.mfa.totp import _get_or_create_user_mfa


def _hash_code(code: str) -> str:
	normalized = code.replace("-", "").replace(" ", "").upper()
	return hashlib.sha256(normalized.encode()).hexdigest()


def _generate_code() -> str:
	alphabet = string.ascii_uppercase + string.digits
	segments = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(4)]
	return "-".join(segments)


def generate_recovery_codes(user: str, force: bool = False) -> list[str]:
	settings = get_mfa_settings()
	count = int(settings.recovery_code_count or 10)
	doc = _get_or_create_user_mfa(user)

	if not force and int(doc.recovery_codes_remaining or 0) > 0:
		frappe.throw("Recovery codes already exist. Regenerating will invalidate old codes.")

	codes = [_generate_code() for _ in range(count)]
	doc.recovery_code_hashes = json.dumps([_hash_code(code) for code in codes])
	doc.recovery_codes_remaining = count
	doc.recovery_codes_generated_on = now_datetime()
	doc.flags.ignore_permissions = True
	doc.save()
	return codes


def verify_recovery_code(user: str, code: str) -> bool:
	if not frappe.db.exists("PMS User MFA", user):
		return False

	doc = frappe.get_doc("PMS User MFA", user)
	hashes = json.loads(doc.recovery_code_hashes or "[]")
	if not hashes:
		return False

	submitted = _hash_code(code)
	if submitted not in hashes:
		return False

	hashes.remove(submitted)
	doc.recovery_code_hashes = json.dumps(hashes)
	doc.recovery_codes_remaining = len(hashes)
	doc.flags.ignore_permissions = True
	doc.save()
	return True


def clear_recovery_codes(user: str):
	if not frappe.db.exists("PMS User MFA", user):
		return
	frappe.db.set_value(
		"PMS User MFA",
		user,
		{
			"recovery_code_hashes": None,
			"recovery_codes_remaining": 0,
			"recovery_codes_generated_on": None,
		},
	)
