# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import getdate


class ProjectPhase(Document):
    def validate(self):
        self.validate_dates()
        self.validate_dependencies()
        self.validate_no_self_dependency()

    def validate_dates(self):
        if self.start_date and self.end_date and getdate(self.start_date) > getdate(self.end_date):
            frappe.throw("Phase end date must be on or after start date.")

    def validate_no_self_dependency(self):
        for row in self.depends_on or []:
            if row.depends_on_phase == self.name:
                frappe.throw("A phase cannot depend on itself.")

    def validate_dependencies(self):
        if self.status != "In Progress":
            return

        for row in self.depends_on or []:
            if not row.depends_on_phase:
                continue
            dependency = frappe.db.get_value(
                "Project Phase",
                row.depends_on_phase,
                ["project", "status", "phase_name"],
                as_dict=True,
            )
            if not dependency:
                frappe.throw(f"Dependency phase {row.depends_on_phase} was not found.")
            if dependency.project != self.project:
                frappe.throw("Phase dependencies must belong to the same project.")
            if row.dependency_type == "Finish to Start" and dependency.status != "Completed":
                frappe.throw(
                    f"Phase '{dependency.phase_name}' must be completed before '{self.phase_name}' can start."
                )
            if row.dependency_type == "Start to Start" and dependency.status in ("Planned", "Cancelled"):
                frappe.throw(
                    f"Phase '{dependency.phase_name}' must be started before '{self.phase_name}' can start."
                )
