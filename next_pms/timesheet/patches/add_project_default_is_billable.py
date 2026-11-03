import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from next_pms.timesheet.utils.billable import BILLABLE_PROJECT_TYPES


def execute():
    create_custom_fields(
        {
            "Project": [
                {
                    "fieldname": "custom_default_is_billable",
                    "label": "Project Default Billable",
                    "fieldtype": "Check",
                    "insert_after": "custom_billing_type",
                    "default": "0",
                    "permlevel": 0,
                    "description": (
                        "Default billable flag for new time entries on this project. "
                        "PMs can change this without changing Billing Type."
                    ),
                    "module": "Timesheet",
                }
            ]
        },
        update=True,
    )

    # Keep Require Timesheet Description after the new field when present.
    if frappe.db.exists("Custom Field", "Project-custom_require_timesheet_description"):
        frappe.db.set_value(
            "Custom Field",
            "Project-custom_require_timesheet_description",
            "insert_after",
            "custom_default_is_billable",
            update_modified=False,
        )

    frappe.reload_doc("projects", "doctype", "project", force=True)

    projects = frappe.get_all(
        "Project",
        fields=["name", "custom_billing_type", "custom_default_is_billable"],
    )
    for project in projects:
        expected = 1 if project.custom_billing_type in BILLABLE_PROJECT_TYPES else 0
        if cint_safe(project.custom_default_is_billable) != expected:
            frappe.db.set_value(
                "Project",
                project.name,
                "custom_default_is_billable",
                expected,
                update_modified=False,
            )


def cint_safe(value):
    try:
        return 1 if int(value or 0) else 0
    except (TypeError, ValueError):
        return 0
