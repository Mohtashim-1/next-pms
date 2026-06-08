import frappe

from next_pms.timesheet.utils.description import get_project_description_settings, strip_description_content


@frappe.whitelist()
def make_sales_invoice(source_name, item_code=None, customer=None, currency=None):
    from erpnext.projects.doctype.timesheet.timesheet import make_sales_invoice as erpnext_make_sales_invoice

    target = erpnext_make_sales_invoice(source_name, item_code, customer, currency)

    for row in target.get("timesheets", []):
        project = frappe.db.get_value("Timesheet Detail", row.timesheet_detail, "project")
        settings = get_project_description_settings(project)
        if settings["include_on_invoice"]:
            row.description = strip_description_content(row.description)
        else:
            row.description = ""

    return target
