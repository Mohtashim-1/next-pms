from __future__ import annotations

import frappe
from frappe.utils import add_days, flt, getdate, now_datetime, today

from next_pms.next_pms.utils.budget_alerts import get_project_stakeholders
from next_pms.next_pms.utils.project_budget import get_project_budget_view


def _project_currency(project_doc) -> str:
    if project_doc.customer:
        currency = frappe.db.get_value("Customer", project_doc.customer, "default_currency")
        if currency:
            return currency
    if project_doc.company:
        return frappe.db.get_value("Company", project_doc.company, "default_currency") or ""
    return ""


def _project_start_date(project_doc):
    return project_doc.actual_start_date or project_doc.expected_start_date


def _comparison(actual: float, target: float) -> dict:
    target = flt(target, 2)
    actual = flt(actual, 2)
    variance = flt(actual - target, 2)
    variance_pct = flt((variance / target) * 100, 1) if target else 0
    utilization_pct = flt((actual / target) * 100, 1) if target else 0
    return {
        "target": target,
        "actual": actual,
        "variance": variance,
        "variance_pct": variance_pct,
        "utilization_pct": utilization_pct,
        "remaining": flt(target - actual, 2),
    }


def get_project_burn_metrics(project: str, client_safe: bool = False) -> dict:
    project_doc = frappe.get_doc("Project", project)
    budget_view = get_project_budget_view(project)
    summary = budget_view.get("summary") or {}

    amount_budget = flt(summary.get("billable_amount_budget", 0)) + flt(summary.get("non_billable_amount_budget", 0))
    hours_budget = flt(summary.get("billable_hours_budget", 0)) + flt(summary.get("non_billable_hours_budget", 0))
    burn_amount = flt(summary.get("billable_amount_consumed", 0)) + flt(summary.get("non_billable_amount_consumed", 0))
    burn_hours = flt(summary.get("billable_hours_consumed", 0)) + flt(summary.get("non_billable_hours_consumed", 0))

    budget_total = flt(project_doc.get("custom_burn_budget_amount") or amount_budget or project_doc.estimated_costing or 0, 2)
    baseline_total = flt(project_doc.get("custom_burn_baseline_amount") or project_doc.estimated_costing or budget_total, 2)

    start_date = _project_start_date(project_doc)
    as_of = getdate(today())
    days_elapsed = max((as_of - getdate(start_date)).days, 1) if start_date else 1
    weeks_elapsed = flt(days_elapsed / 7.0, 2)

    burn_rate_daily = flt(burn_amount / days_elapsed, 2)
    burn_rate_weekly = flt(burn_amount / weeks_elapsed, 2) if weeks_elapsed else burn_rate_daily * 7
    burn_rate_monthly = flt(burn_rate_weekly * 4.33, 2)

    remaining_amount = flt(budget_total - burn_amount, 2)
    if burn_rate_daily > 0 and remaining_amount > 0:
        days_to_finish = int(remaining_amount / burn_rate_daily)
        projected_finish = add_days(as_of, days_to_finish)
    elif remaining_amount <= 0:
        projected_finish = as_of
    else:
        projected_finish = project_doc.expected_end_date or project_doc.actual_end_date

    expected_end = project_doc.expected_end_date or project_doc.actual_end_date
    schedule_variance_days = None
    if projected_finish and expected_end:
        schedule_variance_days = (getdate(projected_finish) - getdate(expected_end)).days

    payload = {
        "project": project,
        "project_name": project_doc.project_name or project,
        "customer_name": project_doc.customer_name or project_doc.customer,
        "currency": _project_currency(project_doc),
        "as_of_date": str(as_of),
        "start_date": str(start_date) if start_date else None,
        "expected_end_date": str(expected_end) if expected_end else None,
        "burn_to_date": {
            "amount": burn_amount,
            "hours": burn_hours,
        },
        "burn_rate": {
            "daily": burn_rate_daily,
            "weekly": burn_rate_weekly,
            "monthly": burn_rate_monthly,
        },
        "projected_finish_date": str(projected_finish) if projected_finish else None,
        "schedule_variance_days": schedule_variance_days,
        "budget_total": budget_total,
        "baseline_total": baseline_total,
        "hours_budget": hours_budget,
        "vs_budget": _comparison(burn_amount, budget_total),
        "vs_baseline": _comparison(burn_amount, baseline_total),
        "vs_budget_hours": _comparison(burn_hours, hours_budget),
        "weekly_report_enabled": bool(project_doc.get("custom_weekly_burn_report_enabled")),
        "weekly_email_team": bool(project_doc.get("custom_weekly_burn_report_team", 1)),
        "weekly_email_client": bool(project_doc.get("custom_weekly_burn_report_client")),
    }

    if not client_safe:
        payload["share"] = serialize_share_settings(project)

    return payload


def get_active_share(project: str):
    return frappe.db.get_value(
        "Project Budget Burn Share",
        {"project": project, "is_active": 1},
        ["name", "share_token", "expires_on", "last_emailed_on", "is_active"],
        as_dict=True,
    )


def _share_is_valid(share: dict | None) -> bool:
    if not share or not share.get("is_active"):
        return False
    if share.get("expires_on") and getdate(share.expires_on) < getdate(today()):
        return False
    return True


def get_share_by_token(token: str):
    if not token:
        return None
    share = frappe.db.get_value(
        "Project Budget Burn Share",
        {"share_token": token, "is_active": 1},
        ["name", "project", "share_token", "expires_on", "is_active"],
        as_dict=True,
    )
    if not _share_is_valid(share):
        return None
    return share


def build_share_url(token: str) -> str:
    return frappe.utils.get_url(f"/next-pms/share/budget-burn/{token}")


def enable_client_share(project: str, expires_days: int = 90) -> dict:
    existing = get_active_share(project)
    if existing:
        doc = frappe.get_doc("Project Budget Burn Share", existing.name)
        doc.is_active = 1
        doc.expires_on = add_days(today(), max(int(expires_days or 90), 7))
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc(
            {
                "doctype": "Project Budget Burn Share",
                "project": project,
                "is_active": 1,
                "expires_on": add_days(today(), max(int(expires_days or 90), 7)),
            }
        ).insert(ignore_permissions=True)

    frappe.db.set_value("Project", project, "custom_client_burn_share_enabled", 1)
    return serialize_share_settings(project)


def disable_client_share(project: str) -> dict:
    for name in frappe.get_all("Project Budget Burn Share", filters={"project": project, "is_active": 1}, pluck="name"):
        frappe.db.set_value("Project Budget Burn Share", name, "is_active", 0)
    frappe.db.set_value("Project", project, "custom_client_burn_share_enabled", 0)
    return serialize_share_settings(project)


def serialize_share_settings(project: str) -> dict:
    share = get_active_share(project)
    if not share or not _share_is_valid(share):
        return {"enabled": False, "share_url": None, "expires_on": None, "last_emailed_on": None}
    return {
        "enabled": True,
        "share_token": share.share_token,
        "share_url": build_share_url(share.share_token),
        "expires_on": str(share.expires_on) if share.expires_on else None,
        "last_emailed_on": str(share.last_emailed_on) if share.last_emailed_on else None,
    }


def get_client_recipients(project: str) -> list[str]:
    project_doc = frappe.get_doc("Project", project)
    recipients: list[str] = []
    poc = project_doc.get("custom_client_point_of_contact")
    if poc and frappe.db.exists("Contact", poc):
        for row in frappe.get_all("Contact Email", filters={"parent": poc}, pluck="email_id"):
            if row:
                recipients.append(row)
    if not recipients and project_doc.customer:
        customer_email = frappe.db.get_value("Customer", project_doc.customer, "email_id")
        if customer_email:
            recipients.append(customer_email)
    return list(dict.fromkeys(recipients))


def get_team_recipients(project: str) -> list[str]:
    emails: list[str] = []
    for user in get_project_stakeholders(project):
        email = frappe.db.get_value("User", user, "email")
        if email:
            emails.append(email)
    return list(dict.fromkeys(emails))


def render_burn_report_html(metrics: dict, share_url: str | None = None, client_safe: bool = False) -> str:
    return frappe.render_template(
        "budget_burn_report.html",
        {
            "metrics": metrics,
            "share_url": share_url,
            "client_safe": client_safe,
        },
    )


def save_burn_report_settings(project: str, settings: dict) -> dict:
    doc = frappe.get_doc("Project", project)
    if "weekly_report_enabled" in settings:
        doc.custom_weekly_burn_report_enabled = 1 if settings.get("weekly_report_enabled") else 0
    if "weekly_email_team" in settings:
        doc.custom_weekly_burn_report_team = 1 if settings.get("weekly_email_team") else 0
    if "weekly_email_client" in settings:
        doc.custom_weekly_burn_report_client = 1 if settings.get("weekly_email_client") else 0
    if "baseline_amount" in settings and settings.get("baseline_amount") not in (None, ""):
        doc.custom_burn_baseline_amount = flt(settings.get("baseline_amount"), 2)
    doc.save(ignore_permissions=True)
    return get_project_burn_metrics(project)


def send_burn_report_email(project: str, recipients: list[str], share_url: str | None = None) -> bool:
    if not recipients:
        return False

    metrics = get_project_burn_metrics(project, client_safe=bool(share_url))
    project_doc = frappe.get_doc("Project", project)
    subject = f"Weekly budget burn — {project_doc.project_name or project}"
    message = render_burn_report_html(metrics, share_url=share_url, client_safe=bool(share_url))
    frappe.sendmail(recipients=recipients, subject=subject, message=message)
    return True


def send_project_weekly_burn_report(project: str) -> dict:
    project_doc = frappe.get_doc("Project", project)
    if not project_doc.get("custom_weekly_burn_report_enabled"):
        return {"project": project, "sent": False, "reason": "disabled"}

    sent_to: list[str] = []
    share = get_active_share(project)
    share_url = build_share_url(share.share_token) if _share_is_valid(share) else None

    if project_doc.get("custom_weekly_burn_report_team", 1):
        team_recipients = get_team_recipients(project)
        if team_recipients and send_burn_report_email(project, team_recipients, share_url=None):
            sent_to.extend(team_recipients)

    if project_doc.get("custom_weekly_burn_report_client"):
        if not share_url:
            share_settings = enable_client_share(project)
            share_url = share_settings.get("share_url")
            share = get_active_share(project)
        client_recipients = get_client_recipients(project)
        if client_recipients and send_burn_report_email(project, client_recipients, share_url=share_url):
            sent_to.extend(client_recipients)

    if sent_to and share and share.get("name"):
        frappe.db.set_value("Project Budget Burn Share", share.name, "last_emailed_on", now_datetime())

    return {"project": project, "sent": bool(sent_to), "recipients": list(dict.fromkeys(sent_to))}


def send_weekly_burn_reports() -> list[dict]:
    projects = frappe.get_all(
        "Project",
        filters={"custom_weekly_burn_report_enabled": 1, "status": ["!=", "Cancelled"]},
        pluck="name",
    )
    results = []
    for project in projects:
        try:
            results.append(send_project_weekly_burn_report(project))
        except Exception:
            frappe.log_error(title=f"Weekly burn report failed for {project}")
            results.append({"project": project, "sent": False, "reason": "error"})
    return results
