import os

from frappe import _, get_app_path, get_doc, read_file


def after_install():
    create_roles()
    ensure_two_stage_timesheet_approval()
    add_project_manager_perm()
    setup_email_template()
    ensure_hr_approval_settings()
    ensure_desktop_icon()


def after_migrate():
    ensure_two_stage_timesheet_approval()
    setup_email_template()
    ensure_hr_approval_settings()
    ensure_desktop_icon()


def ensure_two_stage_timesheet_approval():
    """Create the approver role/fields used by the Next PMS two-stage flow."""
    import frappe
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

    if not frappe.db.exists("Role", "Timesheet Approver"):
        frappe.get_doc(
            {"doctype": "Role", "role_name": "Timesheet Approver", "desk_access": 1, "is_custom": 1}
        ).insert(ignore_permissions=True)

    create_custom_fields(
        {
            "Timesheet": [
                {
                    "fieldname": "custom_timesheet_approver",
                    "label": "Line Manager Approver",
                    "fieldtype": "Link",
                    "options": "Employee",
                    "insert_after": "custom_weekly_approval_status",
                    "read_only": 1,
                },
                {
                    "fieldname": "custom_approval_stage",
                    "label": "Approval Stage",
                    "fieldtype": "Select",
                    "options": "\nPending Line Manager\nPending HR\nApproved\nRejected",
                    "insert_after": "custom_timesheet_approver",
                    "read_only": 1,
                },
                {
                    "fieldname": "custom_line_manager_approved_by",
                    "label": "Line Manager Approved By",
                    "fieldtype": "Link",
                    "options": "User",
                    "insert_after": "custom_approval_stage",
                    "read_only": 1,
                },
                {
                    "fieldname": "custom_hr_approved_by",
                    "label": "HR Approved By",
                    "fieldtype": "Link",
                    "options": "User",
                    "insert_after": "custom_line_manager_approved_by",
                    "read_only": 1,
                },
            ]
        },
        update=True,
    )

    # Existing Timesheet Managers are the safe initial approver pool.
    manager_users = frappe.get_all(
        "Has Role",
        filters={"role": "Timesheet Manager", "parenttype": "User"},
        pluck="parent",
    )
    for user in manager_users:
        if not frappe.db.exists(
            "Has Role",
            {"parent": user, "parenttype": "User", "parentfield": "roles", "role": "Timesheet Approver"},
        ):
            frappe.get_doc(
                {
                    "doctype": "Has Role",
                    "parent": user,
                    "parenttype": "User",
                    "parentfield": "roles",
                    "role": "Timesheet Approver",
                }
            ).insert(ignore_permissions=True)

    # Statuses the two-stage approval flow writes; a missing option fails the save.
    required_options = {
        "custom_approval_status": ("Partially Approved", "Partially Rejected", "Pending HR Approval"),
        "custom_weekly_approval_status": ("Partially Approved", "Partially Rejected", "Pending HR Approval"),
    }
    for fieldname, options in required_options.items():
        field = frappe.db.get_value(
            "Custom Field", {"dt": "Timesheet", "fieldname": fieldname}, ["name", "options"], as_dict=True
        )
        if not field:
            continue
        existing = (field.options or "").rstrip("\n").split("\n")
        missing = [option for option in options if option not in existing]
        if missing:
            frappe.db.set_value(
                "Custom Field",
                field.name,
                "options",
                "\n".join(existing + missing),
            )

    frappe.clear_cache(doctype="Timesheet")


def ensure_desktop_icon():
    """Desk home icon that opens the Next PMS portal dashboard."""
    import frappe

    label = "Project Management"
    link = "/next-pms/dashboard"
    logo = "/assets/next_pms/images/next-pms-logo.svg"

    if frappe.db.exists("Desktop Icon", label):
        doc = frappe.get_doc("Desktop Icon", label)
        changed = False
        for field, value in {
            "icon_type": "App",
            "link_type": "External",
            "link": link,
            "app": "next_pms",
            "logo_url": logo,
            "standard": 1,
            "hidden": 0,
            "bg_color": "blue",
        }.items():
            if doc.get(field) != value:
                doc.set(field, value)
                changed = True
        if changed:
            doc.save(ignore_permissions=True)
    else:
        frappe.get_doc(
            {
                "doctype": "Desktop Icon",
                "label": label,
                "icon_type": "App",
                "link_type": "External",
                "link": link,
                "app": "next_pms",
                "logo_url": logo,
                "standard": 1,
                "hidden": 0,
                "bg_color": "blue",
                "idx": 2,
            }
        ).insert(ignore_permissions=True, ignore_if_duplicate=True)

    frappe.clear_cache()


def add_project_manager_perm():
    from frappe.permissions import add_permission, update_permission_property

    role = "Projects Manager"
    doctype = "Timesheet"
    perm_level = 0
    permissions = {
        perm_level: {
            "create": 0,
            "read": 0,
            "delete": 0,
            "write": 0,
            "export": 0,
            "submit": 1,
        }
    }
    add_permission(doctype, role, perm_level)
    for perm_key, perm_val in permissions[perm_level].items():
        update_permission_property(doctype, role, perm_level, perm_key, perm_val)


def setup_email_template():
    base_path = get_app_path("next_pms", "templates", "timesheet")
    response = read_file(os.path.join(base_path, "daily_timesheet_reminder.html"))

    records = [
        {
            "doctype": "Email Template",
            "name": _("Daily Timesheet Reminder"),
            "response": response,
            "subject": _("Daily Timesheet Reminder"),
            "owner": "Administrator",
        }
    ]
    response = read_file(os.path.join(base_path, "approval_reminder.html"))
    records.append(
        {
            "doctype": "Email Template",
            "name": _("Approval Request Reminder"),
            "response": response,
            "subject": _("Approval Request Reminder"),
            "owner": "Administrator",
        }
    )
    response = read_file(os.path.join(base_path, "weekly_approval_reminder.html"))
    records.append(
        {
            "doctype": "Email Template",
            "name": _("Weekly Approval Reminder"),
            "response": response,
            "subject": _("Weekly Approval Reminder"),
            "owner": "Administrator",
            "use_html": 1,
        }
    )
    response = read_file(os.path.join(base_path, "hr_approval_reminder.html"))
    records.append(
        {
            "doctype": "Email Template",
            "name": _("HR Approval Reminder"),
            "response": response,
            "subject": _("HR Approval Required"),
            "owner": "Administrator",
        }
    )
    create_docs(records)


def ensure_hr_approval_settings():
    """Enable HR stage email settings and link the default template."""
    import frappe

    template_name = "HR Approval Reminder"
    if not frappe.db.exists("Email Template", template_name):
        setup_email_template()

    settings = frappe.get_single("Timesheet Settings")
    changed = False
    if not settings.get("send_hr_approval_request"):
        settings.send_hr_approval_request = 1
        changed = True
    if not settings.get("hr_approval_reminder_template") and frappe.db.exists("Email Template", template_name):
        settings.hr_approval_reminder_template = template_name
        changed = True
    if changed:
        settings.save(ignore_permissions=True)
    frappe.clear_cache(doctype="Timesheet Settings")


def create_docs(records: list):
    for doc in records:
        get_doc(doc).insert(ignore_permissions=True, ignore_mandatory=True, ignore_if_duplicate=True)


def create_roles():
    import frappe

    roles = ["Timesheet Manager", "Timesheet User"]

    for role in roles:
        role = frappe.get_doc({"doctype": "Role", "role_name": role, "is_custom": 1})
        role.insert(ignore_permissions=True, ignore_if_duplicate=True)
