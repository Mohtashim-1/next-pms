# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from next_pms.integrations.mfa.sync import sync_frappe_two_factor_settings


class PMSMFASettings(Document):
	def validate(self):
		if self.enforcement_mode == "Per Role" and not self.enforced_roles:
			frappe.throw(_("Add at least one role when enforcement mode is Per Role."))
		if int(self.recovery_code_count or 0) < 4:
			frappe.throw(_("Recovery code count must be at least 4."))

	def on_update(self):
		sync_frappe_two_factor_settings(self)
