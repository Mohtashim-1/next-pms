import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.budget_burn import (
    disable_client_share,
    enable_client_share,
    get_project_burn_metrics,
    get_share_by_token,
    save_burn_report_settings,
    send_project_weekly_burn_report,
    serialize_share_settings,
)


def _ensure_project_access(project: str, write: bool = False):
    if not project or not frappe.db.exists("Project", project):
        frappe.throw("Project not found.")
    frappe.has_permission("Project", doc=project, ptype="write" if write else "read", throw=True)


@whitelist()
@error_logger
def get_burn_view(project: str):
    _ensure_project_access(project)
    return get_project_burn_metrics(project)


@whitelist()
@error_logger
def save_report_settings(project: str, settings: dict | str):
    _ensure_project_access(project, write=True)
    if isinstance(settings, str):
        import json

        settings = json.loads(settings)
    return save_burn_report_settings(project, settings or {})


@whitelist()
@error_logger
def enable_share(project: str, expires_days: int = 90):
    _ensure_project_access(project, write=True)
    return enable_client_share(project, expires_days=expires_days)


@whitelist()
@error_logger
def disable_share(project: str):
    _ensure_project_access(project, write=True)
    return disable_client_share(project)


@whitelist()
@error_logger
def send_report_now(project: str):
    _ensure_project_access(project, write=True)
    return send_project_weekly_burn_report(project)


@whitelist()
@error_logger
def get_share_status(project: str):
    _ensure_project_access(project)
    return serialize_share_settings(project)


@whitelist(allow_guest=True)
@error_logger
def get_shared_burn_view(token: str):
    share = get_share_by_token(token)
    if not share:
        frappe.throw("This share link is invalid or has expired.", frappe.PermissionError)
    return get_project_burn_metrics(share.project, client_safe=True)
