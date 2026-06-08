# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt

from next_pms.next_pms.utils.client_invoice import recalculate_draft_totals


class ClientInvoiceDraft(Document):
    def validate(self):
        recalculate_draft_totals(self)
        if self.flags.get("ignore_validate"):
            return
        if self.period_start and self.period_end and self.period_start > self.period_end:
            frappe.throw("Period start cannot be after period end.")
