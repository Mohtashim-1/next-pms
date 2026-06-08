# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ClientInvoiceTemplate(Document):
    def validate(self):
        if self.is_default:
            frappe.db.set_value(
                "Client Invoice Template",
                {"name": ["!=", self.name], "is_default": 1},
                "is_default",
                0,
            )
