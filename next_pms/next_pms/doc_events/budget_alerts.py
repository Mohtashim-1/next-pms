import frappe

from next_pms.next_pms.utils.budget_alerts import evaluate_project_budget_alerts


def on_timesheet_change(doc, method=None):
    if frappe.flags.in_import or frappe.flags.in_migrate:
        return

    projects = {row.project for row in doc.time_logs if row.project}
    for project in projects:
        try:
            evaluate_project_budget_alerts(project)
        except Exception:
            frappe.log_error(title=f"Budget alert evaluation failed for {project}")
