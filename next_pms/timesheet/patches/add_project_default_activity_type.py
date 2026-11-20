import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

KNOWN_ACTIVITY_TYPES = (
    "Admin",
    "Meeting",
    "Development",
    "Support",
    "Training",
    "Research",
    "Bug",
    "Issue",
)


def execute():
    create_custom_fields(
        {
            "Project": [
                {
                    "fieldname": "custom_default_activity_type",
                    "label": "Default Work Type",
                    "fieldtype": "Link",
                    "options": "Activity Type",
                    "insert_after": "custom_require_timesheet_description",
                    "permlevel": 0,
                    "description": (
                        "Default work type for new time entries on this project "
                        "(e.g. Admin for [Internal] - Admin)."
                    ),
                    "module": "Timesheet",
                }
            ]
        },
        update=True,
    )

    frappe.reload_doc("projects", "doctype", "project", force=True)

    # Seed from project names like "[Internal] - Admin" when still empty.
    projects = frappe.get_all(
        "Project",
        fields=["name", "project_name", "custom_default_activity_type"],
    )
    for project in projects:
        if (project.custom_default_activity_type or "").strip():
            continue
        label = (project.project_name or project.name or "").strip()
        for activity in KNOWN_ACTIVITY_TYPES:
            if (
                label == activity
                or label.endswith(f" - {activity}")
                or label.endswith(f" {activity}")
            ):
                if frappe.db.exists("Activity Type", activity):
                    frappe.db.set_value(
                        "Project",
                        project.name,
                        "custom_default_activity_type",
                        activity,
                        update_modified=False,
                    )
                break
