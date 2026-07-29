import os

from frappe import _, get_app_path, get_doc, read_file


def after_install():
    create_roles()
    add_project_manager_perm()
    setup_email_template()
    ensure_desktop_icon()


def after_migrate():
    ensure_desktop_icon()


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
    create_docs(records)


def create_docs(records: list):
    for doc in records:
        get_doc(doc).insert(ignore_permissions=True, ignore_mandatory=True, ignore_if_duplicate=True)


def create_roles():
    import frappe

    roles = ["Timesheet Manager", "Timesheet User"]

    for role in roles:
        role = frappe.get_doc({"doctype": "Role", "role_name": role, "is_custom": 1})
        role.insert(ignore_permissions=True, ignore_if_duplicate=True)
