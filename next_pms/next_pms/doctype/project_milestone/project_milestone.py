# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document

from next_pms.next_pms.utils.milestone_billing import trigger_milestone_billing


class ProjectMilestone(Document):
    def validate(self):
        if self.phase:
            phase_project = frappe.db.get_value("Project Phase", self.phase, "project")
            if phase_project and phase_project != self.project:
                frappe.throw("Selected phase does not belong to this project.")

    def on_update(self):
        previous = self.get_doc_before_save()
        if self.status == "Achieved" and (not previous or previous.status != "Achieved"):
            trigger_milestone_billing(self)
