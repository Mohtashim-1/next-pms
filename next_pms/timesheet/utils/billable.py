import frappe
from frappe import _
from frappe.utils import cint


BILLABLE_PROJECT_TYPES = {"Fixed Cost", "Retainer", "Time and Material"}


def get_project_default_is_billable(project: str | None) -> int:
    if not project:
        return 0

    billing_type = frappe.db.get_value("Project", project, "custom_billing_type")
    if not billing_type or billing_type == "Non-Billable":
        return 0

    if billing_type in BILLABLE_PROJECT_TYPES:
        return 1

    return 0


def get_task_project_default_is_billable(task: str | None) -> int:
    if not task:
        return 0

    project = frappe.db.get_value("Task", task, "project")
    return get_project_default_is_billable(project)


def resolve_entry_billable(
    task: str,
    is_billable=None,
    billable_override_reason: str | None = None,
    require_override_reason: bool = True,
):
    default = get_task_project_default_is_billable(task)

    if is_billable is None:
        return default, None, default

    resolved = cint(is_billable)
    reason = (billable_override_reason or "").strip() or None

    if resolved != default:
        if require_override_reason and not reason:
            frappe.throw(
                _("Billable override reason is required when billable status differs from the project default."),
                frappe.MandatoryError,
            )
        return resolved, reason, default

    return resolved, None, default


def enrich_log_billable_fields(log: dict, task: str | None = None):
    task = task or log.get("task")
    project_default = get_task_project_default_is_billable(task)
    log["project_default_is_billable"] = project_default
    log["is_billable_override"] = cint(log.get("is_billable")) != project_default
    reason = log.get("custom_billable_override_reason") or log.get("billable_override_reason")
    log["billable_override_reason"] = (reason or "").strip() or None
    return log
