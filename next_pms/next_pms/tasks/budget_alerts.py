import frappe

from next_pms.next_pms.utils.budget_alerts import evaluate_all_project_budget_alerts


def check_budget_alerts():
    try:
        evaluate_all_project_budget_alerts()
    except Exception:
        frappe.log_error(title="Scheduled budget alert check failed")
