# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import generate_hash


class ProjectBudgetBurnShare(Document):
    def before_insert(self):
        if not self.share_token:
            self.share_token = generate_hash(length=32)
        if not self.created_by_user:
            self.created_by_user = frappe.session.user
