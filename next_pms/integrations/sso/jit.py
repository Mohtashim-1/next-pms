# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _


def provision_user(email: str, profile: dict, provider_label: str):
	email = (email or "").strip().lower()
	if not email:
		frappe.throw(_("SSO login did not return an email address."))

	settings = frappe.get_single("PMS SSO Settings")
	if not settings.enable_jit_provisioning:
		return

	row = _find_provider(provider_label)
	if row and not row.allow_jit_provisioning:
		return

	first_name = profile.get("first_name") or email.split("@")[0]
	last_name = profile.get("last_name") or ""

	user = frappe.db.exists("User", email)
	if user:
		doc = frappe.get_doc("User", email)
		changed = False
		if first_name and doc.first_name != first_name:
			doc.first_name = first_name
			changed = True
		if last_name and doc.last_name != last_name:
			doc.last_name = last_name
			changed = True
		if not doc.enabled:
			doc.enabled = 1
			changed = True
		if changed:
			doc.flags.ignore_permissions = True
			doc.save()
	else:
		doc = frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": first_name,
				"last_name": last_name,
				"enabled": 1,
				"user_type": settings.default_user_type or "System User",
				"send_welcome_email": 0,
				"new_password": frappe.generate_hash(),
			}
		)
		doc.flags.ignore_permissions = True
		doc.flags.no_welcome_mail = True
		doc.insert()

	_assign_roles(doc, row, settings)

	if settings.create_employee_on_jit:
		_ensure_employee(doc, first_name, last_name)


def _assign_roles(user_doc, provider_row, settings):
	roles: list[str] = []
	if settings.default_role:
		roles.append(settings.default_role)
	if provider_row and provider_row.default_roles:
		roles.extend([role.strip() for role in provider_row.default_roles.split(",") if role.strip()])
	if roles:
		user_doc.add_roles(*roles)


def _ensure_employee(user_doc, first_name: str, last_name: str):
	if frappe.db.exists("Employee", {"user_id": user_doc.name}):
		return

	company = frappe.defaults.get_global_default("company")
	if not company:
		return

	employee = frappe.get_doc(
		{
			"doctype": "Employee",
			"first_name": first_name,
			"last_name": last_name or first_name,
			"employee_name": f"{first_name} {last_name}".strip(),
			"company": company,
			"user_id": user_doc.name,
			"status": "Active",
		}
	)
	employee.flags.ignore_permissions = True
	employee.insert(ignore_if_duplicate=True)


def _find_provider(provider_label: str):
	settings = frappe.get_single("PMS SSO Settings")
	for row in settings.providers or []:
		if row.provider_label == provider_label:
			return row
	return None
