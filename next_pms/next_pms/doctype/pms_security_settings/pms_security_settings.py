# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, get_datetime, now_datetime

from next_pms.integrations.security.keys import ensure_active_encryption_key, sync_customer_master_key


class PMSSecuritySettings(Document):
	def validate(self):
		if self.security_tier != "Enterprise" and self.customer_managed_keys:
			frappe.throw(_("Customer-managed keys require Enterprise tier."))
		if self.customer_managed_keys and not self.get_password("customer_master_key", raise_exception=False):
			if not frappe.conf.get("pms_customer_master_key"):
				frappe.throw(_("Customer master key is required when BYOK is enabled."))
		if int(self.key_rotation_interval_days or 0) < 30:
			frappe.throw(_("Rotation interval must be at least 30 days."))

	def on_update(self):
		sync_customer_master_key(self)
		ensure_active_encryption_key(self)
		self._update_rotation_schedule()

	def _update_rotation_schedule(self):
		if not self.key_rotation_enabled:
			frappe.db.set_single_value("PMS Security Settings", "next_key_rotation_on", None)
			return
		last = self.last_key_rotation_on or now_datetime()
		next_due = add_days(get_datetime(last), int(self.key_rotation_interval_days or 365))
		frappe.db.set_single_value("PMS Security Settings", "next_key_rotation_on", next_due)
