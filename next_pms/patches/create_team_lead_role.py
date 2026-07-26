import frappe


def execute():
    if not frappe.db.exists("Role", "Team Lead"):
        frappe.get_doc(
            {
                "doctype": "Role",
                "role_name": "Team Lead",
                "desk_access": 1,
                "is_custom": 1,
            }
        ).insert(ignore_permissions=True)
