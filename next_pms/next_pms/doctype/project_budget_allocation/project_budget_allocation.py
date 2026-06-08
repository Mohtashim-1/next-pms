# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt

from next_pms.next_pms.utils.project_budget import refresh_allocation_usage, validate_allocation_payload


class ProjectBudgetAllocation(Document):
    def validate(self):
        validate_allocation_payload(self)
        refresh_allocation_usage(self)
