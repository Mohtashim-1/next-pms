import json

import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.budget_alerts import (
    acknowledge_budget_alert,
    evaluate_project_budget_alerts,
    execute_budget_alert_action,
    get_alert_settings,
    get_project_budget_alerts,
    save_budget_alert_settings,
    snooze_budget_alert,
)


def _check_project_access(project: str, write: bool = False):
    if not project or not frappe.db.exists("Project", project):
        frappe.throw("Project not found.")
    frappe.has_permission("Project", doc=project, ptype="write" if write else "read", throw=True)


@whitelist()
@error_logger
def get_alerts(project: str, include_closed: int = 0):
    _check_project_access(project)
    return {
        "alerts": get_project_budget_alerts(project, include_closed=bool(include_closed)),
        "settings": _serialize_settings(get_alert_settings(project)),
    }


@whitelist()
@error_logger
def save_alert_settings(project: str, settings: dict | str):
    _check_project_access(project, write=True)
    if isinstance(settings, str):
        settings = json.loads(settings)
    return {
        "settings": _serialize_settings(save_budget_alert_settings(project, settings or {})),
    }


@whitelist()
@error_logger
def snooze_alert(alert: str, snooze_until: str, reason: str | None = None):
    if not frappe.db.exists("Project Budget Alert", alert):
        frappe.throw("Alert not found.")
    project = frappe.db.get_value("Project Budget Alert", alert, "project")
    _check_project_access(project, write=True)
    return snooze_budget_alert(alert, snooze_until, reason)


@whitelist()
@error_logger
def acknowledge_alert(alert: str):
    if not frappe.db.exists("Project Budget Alert", alert):
        frappe.throw("Alert not found.")
    project = frappe.db.get_value("Project Budget Alert", alert, "project")
    _check_project_access(project, write=True)
    return acknowledge_budget_alert(alert)


@whitelist()
@error_logger
def execute_action(alert: str, action: str, notes: str | None = None):
    if not frappe.db.exists("Project Budget Alert", alert):
        frappe.throw("Alert not found.")
    project = frappe.db.get_value("Project Budget Alert", alert, "project")
    _check_project_access(project, write=True)
    return execute_budget_alert_action(alert, action, notes)


@whitelist()
@error_logger
def evaluate_now(project: str):
    _check_project_access(project, write=True)
    created = evaluate_project_budget_alerts(project)
    return {
        "created": created,
        "alerts": get_project_budget_alerts(project),
        "settings": _serialize_settings(get_alert_settings(project)),
    }


def _serialize_settings(settings: dict) -> dict:
    return {
        "enabled": settings.get("enabled"),
        "thresholds": settings.get("thresholds", []),
        "channels": settings.get("channels", {}),
        "has_slack_webhook": bool(settings.get("slack_webhook")),
        "has_teams_webhook": bool(settings.get("teams_webhook")),
        "email_template": settings.get("email_template"),
    }
