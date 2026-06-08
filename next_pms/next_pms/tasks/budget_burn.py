import frappe

from next_pms.next_pms.utils.budget_burn import send_weekly_burn_reports


def send_weekly_project_burn_reports():
    try:
        send_weekly_burn_reports()
    except Exception:
        frappe.log_error(title="Scheduled weekly budget burn report failed")
