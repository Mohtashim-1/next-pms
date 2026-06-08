from __future__ import annotations

import json

import frappe
import requests
from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification
from frappe.utils import add_to_date, flt, get_datetime, now_datetime

from next_pms.next_pms.utils.project_budget import refresh_allocation_usage, serialize_allocation

DEFAULT_THRESHOLDS = [50, 75, 90, 100, 110]


def _get_webhook_password(doc, fieldname: str) -> str | None:
    if not doc or not doc.get(fieldname):
        return None
    try:
        return doc.get_password(fieldname)
    except Exception:
        return None
ACTIVE_ALERT_STATUSES = ("Open", "Snoozed", "Acknowledged", "Actioned")
ALERT_FIELDS = [
    "name",
    "project",
    "budget_allocation",
    "scope_label",
    "utilization_metric",
    "threshold_pct",
    "utilization_pct",
    "status",
    "recommended_action",
    "snoozed_until",
    "snooze_reason",
    "action_taken",
    "action_notes",
    "action_by",
    "action_on",
    "channels_sent",
    "message",
    "creation",
]


def parse_thresholds(raw_value) -> list[float]:
    if not raw_value:
        return list(DEFAULT_THRESHOLDS)
    if isinstance(raw_value, list):
        values = raw_value
    else:
        try:
            values = json.loads(raw_value)
        except (TypeError, json.JSONDecodeError):
            values = [part.strip() for part in str(raw_value).split(",") if part.strip()]
    thresholds = sorted({flt(value) for value in values if flt(value) > 0})
    return thresholds or list(DEFAULT_THRESHOLDS)


def get_alert_settings(project: str | None = None) -> dict:
    settings = frappe.get_single("Timesheet Settings")
    project_doc = frappe.get_doc("Project", project) if project else None

    enabled = bool(settings.get("enable_budget_alerts", 1))
    if project_doc is not None and project_doc.get("custom_budget_alerts_enabled") is not None:
        enabled = bool(project_doc.custom_budget_alerts_enabled)

    project_thresholds = project_doc.get("custom_budget_alert_thresholds") if project_doc else None
    global_thresholds = settings.get("budget_alert_thresholds")
    thresholds = parse_thresholds(project_thresholds or global_thresholds)

    def channel_enabled(field: str, project_field: str) -> bool:
        if project_doc and project_doc.get(project_field) is not None:
            return bool(project_doc.get(project_field))
        return bool(settings.get(field))

    slack_webhook = _get_webhook_password(project_doc, "custom_budget_alert_slack_webhook") or _get_webhook_password(
        settings, "budget_alert_slack_webhook"
    )
    teams_webhook = _get_webhook_password(project_doc, "custom_budget_alert_teams_webhook") or _get_webhook_password(
        settings, "budget_alert_teams_webhook"
    )

    return {
        "enabled": enabled,
        "thresholds": thresholds,
        "channels": {
            "email": channel_enabled("budget_alert_channel_email", "custom_budget_alert_channel_email"),
            "in_app": channel_enabled("budget_alert_channel_in_app", "custom_budget_alert_channel_in_app"),
            "slack": channel_enabled("budget_alert_channel_slack", "custom_budget_alert_channel_slack"),
            "teams": channel_enabled("budget_alert_channel_teams", "custom_budget_alert_channel_teams"),
        },
        "slack_webhook": slack_webhook,
        "teams_webhook": teams_webhook,
        "email_template": project_doc.get("custom_email_template")
        if project_doc and project_doc.get("custom_email_template")
        else settings.get("budget_alert_email_template"),
    }


def get_allocation_utilizations(doc) -> list[tuple[str, float]]:
    utilizations: list[tuple[str, float]] = []
    if doc.metric_type in ("Hours", "Both") and flt(doc.budget_hours) > 0:
        utilizations.append(("Hours", flt((flt(doc.consumed_hours) / flt(doc.budget_hours)) * 100, 1)))
    if doc.metric_type in ("Dollars", "Both") and flt(doc.budget_amount) > 0:
        utilizations.append(("Amount", flt((flt(doc.consumed_amount) / flt(doc.budget_amount)) * 100, 1)))
    return utilizations


def recommend_action(threshold_pct: float) -> str:
    if threshold_pct >= 110:
        return "Notify Client"
    if threshold_pct >= 100:
        return "Request Change Order"
    return "Escalate"


def _scope_label(allocation_doc) -> str:
    data = serialize_allocation(allocation_doc)
    if allocation_doc.scope_type == "Phase":
        return data.get("phase_name") or allocation_doc.project_phase or "Phase"
    if allocation_doc.scope_type == "Task":
        return data.get("task_subject") or allocation_doc.task or "Task"
    return "Project Total"


def _alert_exists(allocation: str, threshold_pct: float, metric: str) -> bool:
    return bool(
        frappe.db.exists(
            "Project Budget Alert",
            {
                "budget_allocation": allocation,
                "threshold_pct": threshold_pct,
                "utilization_metric": metric,
                "status": ["in", list(ACTIVE_ALERT_STATUSES)],
            },
        )
    )


def _build_alert_message(project: str, allocation_doc, threshold_pct: float, metric: str, utilization_pct: float) -> str:
    scope = _scope_label(allocation_doc)
    return (
        f"Project {project}: {scope} ({allocation_doc.allocation_type}) "
        f"has reached {utilization_pct}% of the {metric.lower()} budget "
        f"(threshold {threshold_pct}%)."
    )


def get_project_stakeholders(project: str) -> list[str]:
    users: set[str] = set()
    pm = frappe.db.get_value("Project", project, "custom_project_manager")
    if pm:
        users.add(pm)

    shared_users = frappe.get_all(
        "DocShare",
        filters={"share_doctype": "Project", "share_name": project},
        pluck="user",
    )
    users.update(shared_users)

    managers = frappe.get_all(
        "Has Role",
        filters={"role": "Projects Manager", "parenttype": "User"},
        pluck="parent",
    )
    users.update(managers)
    return [user for user in users if user and user != "Guest"]


def send_alert_notifications(alert_name: str, settings: dict | None = None):
    alert = frappe.get_doc("Project Budget Alert", alert_name)
    if alert.status == "Snoozed" and alert.snoozed_until and get_datetime(alert.snoozed_until) > now_datetime():
        return alert

    settings = settings or get_alert_settings(alert.project)
    channels_sent: list[str] = []
    subject = f"Budget alert: {alert.project} at {alert.threshold_pct}%"
    message = alert.message or _build_alert_message(
        alert.project,
        frappe.get_doc("Project Budget Allocation", alert.budget_allocation),
        alert.threshold_pct,
        alert.utilization_metric,
        alert.utilization_pct,
    )
    recipients = get_project_stakeholders(alert.project)

    if settings["channels"]["email"] and recipients:
        _send_email_alert(alert, settings, recipients, subject, message)
        channels_sent.append("email")

    if settings["channels"]["in_app"] and recipients:
        enqueue_create_notification(
            recipients,
            {
                "type": "Alert",
                "document_type": "Project Budget Alert",
                "document_name": alert.name,
                "subject": subject,
                "email_content": message,
                "link": f"/next-pms/project/{alert.project}?tab=budget",
            },
        )
        channels_sent.append("in_app")

    if settings["channels"]["slack"] and settings.get("slack_webhook"):
        if _send_slack_alert(settings["slack_webhook"], subject, message):
            channels_sent.append("slack")

    if settings["channels"]["teams"] and settings.get("teams_webhook"):
        if _send_teams_alert(settings["teams_webhook"], subject, message):
            channels_sent.append("teams")

    if channels_sent:
        alert.db_set("channels_sent", json.dumps(channels_sent))
    return alert


def _send_email_alert(alert, settings: dict, recipients: list[str], subject: str, message: str):
    if settings.get("email_template") and frappe.db.exists("Email Template", settings["email_template"]):
        template = frappe.get_doc("Email Template", settings["email_template"])
        project = frappe.get_doc("Project", alert.project)
        allocation = frappe.get_doc("Project Budget Allocation", alert.budget_allocation)
        args = {
            "alert": alert,
            "project": project,
            "allocation": allocation,
            "subject": subject,
            "message": message,
        }
        body = frappe.render_template(
            template.response_html if template.use_html else template.response,
            args,
        )
        rendered_subject = frappe.render_template(template.subject, args)
        frappe.sendmail(recipients=recipients, subject=rendered_subject, message=body)
        return

    frappe.sendmail(recipients=recipients, subject=subject, message=message)


def _send_slack_alert(webhook_url: str, subject: str, message: str) -> bool:
    try:
        response = requests.post(
            webhook_url,
            json={"text": f"*{subject}*\n{message}"},
            timeout=15,
        )
        response.raise_for_status()
        return True
    except Exception:
        frappe.log_error(title="Budget alert Slack delivery failed")
        return False


def _send_teams_alert(webhook_url: str, subject: str, message: str) -> bool:
    try:
        response = requests.post(
            webhook_url,
            json={
                "@type": "MessageCard",
                "@context": "https://schema.org/extensions",
                "summary": subject,
                "themeColor": "D13438",
                "title": subject,
                "text": message,
            },
            timeout=15,
        )
        response.raise_for_status()
        return True
    except Exception:
        frappe.log_error(title="Budget alert Teams delivery failed")
        return False


def create_budget_alert(
    allocation_doc,
    threshold_pct: float,
    metric: str,
    utilization_pct: float,
    settings: dict | None = None,
) -> frappe.Document:
    settings = settings or get_alert_settings(allocation_doc.project)
    message = _build_alert_message(
        allocation_doc.project,
        allocation_doc,
        threshold_pct,
        metric,
        utilization_pct,
    )
    alert = frappe.get_doc(
        {
            "doctype": "Project Budget Alert",
            "project": allocation_doc.project,
            "budget_allocation": allocation_doc.name,
            "scope_label": _scope_label(allocation_doc),
            "utilization_metric": metric,
            "threshold_pct": threshold_pct,
            "utilization_pct": utilization_pct,
            "status": "Open",
            "recommended_action": recommend_action(threshold_pct),
            "message": message,
        }
    ).insert(ignore_permissions=True)
    send_alert_notifications(alert.name, settings)
    return alert


def evaluate_project_budget_alerts(project: str) -> list[str]:
    settings = get_alert_settings(project)
    if not settings["enabled"]:
        return []

    created: list[str] = []
    allocation_names = frappe.get_all(
        "Project Budget Allocation",
        filters={"project": project},
        pluck="name",
    )

    for allocation_name in allocation_names:
        allocation_doc = frappe.get_doc("Project Budget Allocation", allocation_name)
        refresh_allocation_usage(allocation_doc)

        for metric, utilization_pct in get_allocation_utilizations(allocation_doc):
            for threshold_pct in settings["thresholds"]:
                if utilization_pct < threshold_pct:
                    continue
                if _alert_exists(allocation_doc.name, threshold_pct, metric):
                    continue
                alert = create_budget_alert(
                    allocation_doc,
                    threshold_pct,
                    metric,
                    utilization_pct,
                    settings,
                )
                created.append(alert.name)

    process_expired_snoozes(project)
    return created


def process_expired_snoozes(project: str | None = None):
    filters = {
        "status": "Snoozed",
        "snoozed_until": ["<=", now_datetime()],
    }
    if project:
        filters["project"] = project

    for alert_name in frappe.get_all("Project Budget Alert", filters=filters, pluck="name"):
        alert = frappe.get_doc("Project Budget Alert", alert_name)
        allocation_doc = frappe.get_doc("Project Budget Allocation", alert.budget_allocation)
        refresh_allocation_usage(allocation_doc)
        current_util = dict(get_allocation_utilizations(allocation_doc)).get(alert.utilization_metric, 0)

        if current_util >= alert.threshold_pct:
            alert.db_set("status", "Open")
            send_alert_notifications(alert.name)
        else:
            alert.db_set("status", "Closed")


def evaluate_all_project_budget_alerts():
    projects = frappe.get_all(
        "Project",
        filters={"status": ["!=", "Completed"]},
        pluck="name",
    )
    for project in projects:
        try:
            evaluate_project_budget_alerts(project)
        except Exception:
            frappe.log_error(title=f"Budget alert evaluation failed for {project}")


def get_project_budget_alerts(project: str, include_closed: bool = False) -> list[dict]:
    filters = {"project": project}
    if not include_closed:
        filters["status"] = ["!=", "Closed"]

    rows = frappe.get_all(
        "Project Budget Alert",
        filters=filters,
        fields=ALERT_FIELDS,
        order_by="creation desc",
        limit_page_length=100,
    )
    return rows


def snooze_budget_alert(alert_name: str, snooze_until: str, reason: str | None = None):
    alert = frappe.get_doc("Project Budget Alert", alert_name)
    if not snooze_until:
        frappe.throw("Snooze until date is required.")

    alert.status = "Snoozed"
    alert.snoozed_until = get_datetime(snooze_until)
    alert.snooze_reason = reason
    alert.save(ignore_permissions=True)
    return serialize_alert(alert)


def acknowledge_budget_alert(alert_name: str):
    alert = frappe.get_doc("Project Budget Alert", alert_name)
    if alert.status in ("Open", "Snoozed"):
        alert.status = "Acknowledged"
        alert.save(ignore_permissions=True)
    return serialize_alert(alert)


def execute_budget_alert_action(alert_name: str, action: str, notes: str | None = None):
    valid_actions = ("Notify Client", "Request Change Order", "Escalate")
    if action not in valid_actions:
        frappe.throw(f"Invalid action. Choose one of: {', '.join(valid_actions)}")

    alert = frappe.get_doc("Project Budget Alert", alert_name)
    alert.action_taken = action
    alert.action_notes = notes
    alert.action_by = frappe.session.user
    alert.action_on = now_datetime()
    alert.status = "Actioned"
    alert.save(ignore_permissions=True)

    if action == "Notify Client":
        _notify_client(alert, notes)
    elif action == "Request Change Order":
        _request_change_order(alert, notes)
    elif action == "Escalate":
        _escalate_alert(alert, notes)

    return serialize_alert(alert)


def _notify_client(alert, notes: str | None):
    project = frappe.get_doc("Project", alert.project)
    recipients: list[str] = []
    poc = project.get("custom_client_point_of_contact")
    if poc and frappe.db.exists("Contact", poc):
        for row in frappe.get_all("Contact Email", filters={"parent": poc}, pluck="email_id"):
            if row:
                recipients.append(row)

    if not recipients and project.customer:
        customer_email = frappe.db.get_value("Customer", project.customer, "email_id")
        if customer_email:
            recipients.append(customer_email)

    if not recipients:
        frappe.throw("No client contact email found for this project.")

    subject = f"Budget update for {project.project_name or project.name}"
    message = alert.message
    if notes:
        message = f"{message}\n\nNotes: {notes}"
    frappe.sendmail(recipients=recipients, subject=subject, message=message)


def _request_change_order(alert, notes: str | None):
    project = frappe.get_doc("Project", alert.project)
    task = frappe.get_doc(
        {
            "doctype": "Task",
            "subject": f"Change order request — {alert.scope_label} at {alert.utilization_pct}%",
            "project": alert.project,
            "description": "\n".join(
                part
                for part in [
                    alert.message,
                    f"Recommended action: {alert.recommended_action}",
                    f"Notes: {notes}" if notes else None,
                ]
                if part
            ),
            "status": "Open",
        }
    ).insert(ignore_permissions=True)

    recipients = get_project_stakeholders(alert.project)
    if recipients:
        enqueue_create_notification(
            recipients,
            {
                "type": "Alert",
                "document_type": "Task",
                "document_name": task.name,
                "subject": f"Change order requested for {project.project_name or project.name}",
                "email_content": task.description,
                "link": f"/app/task/{task.name}",
            },
        )


def _escalate_alert(alert, notes: str | None):
    recipients = get_project_stakeholders(alert.project)
    subject = f"Escalation: budget alert on {alert.project}"
    message = alert.message
    if notes:
        message = f"{message}\n\nEscalation notes: {notes}"
    if recipients:
        frappe.sendmail(recipients=recipients, subject=subject, message=message)
        enqueue_create_notification(
            recipients,
            {
                "type": "Alert",
                "document_type": "Project Budget Alert",
                "document_name": alert.name,
                "subject": subject,
                "email_content": message,
                "link": f"/next-pms/project/{alert.project}?tab=budget",
            },
        )


def serialize_alert(alert) -> dict:
    if isinstance(alert, str):
        alert = frappe.get_doc("Project Budget Alert", alert)
    return {field: alert.get(field) for field in ALERT_FIELDS}


def save_budget_alert_settings(project: str, settings: dict):
    doc = frappe.get_doc("Project", project)
    if "enabled" in settings:
        doc.custom_budget_alerts_enabled = 1 if settings["enabled"] else 0
    if "thresholds" in settings:
        doc.custom_budget_alert_thresholds = json.dumps(parse_thresholds(settings["thresholds"]))
    for channel in ("email", "in_app", "slack", "teams"):
        key = f"channel_{channel}"
        field = f"custom_budget_alert_channel_{channel}"
        if key in settings:
            doc.set(field, 1 if settings[key] else 0)
    if settings.get("slack_webhook"):
        doc.custom_budget_alert_slack_webhook = settings["slack_webhook"]
    if settings.get("teams_webhook"):
        doc.custom_budget_alert_teams_webhook = settings["teams_webhook"]
    doc.save(ignore_permissions=True)
    return get_alert_settings(project)


def default_snooze_until(days: int = 7) -> str:
    return str(add_to_date(now_datetime(), days=days))
