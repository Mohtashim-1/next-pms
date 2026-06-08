import frappe
from frappe import _
from frappe.utils import now_datetime


def require_rejection_comment(status: str, note: str | None):
    if status == "Rejected" and not (note or "").strip():
        frappe.throw(_("A rejection comment is required."), frappe.MandatoryError)


def entry_is_rejected_draft(log) -> bool:
    status = log.get("custom_entry_approval_status") or "Pending"
    return status == "Draft" and bool((log.get("custom_rejection_comment") or "").strip())


def apply_entry_rejection(log, note: str):
    note = (note or "").strip()
    require_rejection_comment("Rejected", note)
    log.custom_entry_approval_status = "Draft"
    log.custom_rejection_comment = note
    log.custom_rejected_by = frappe.session.user
    log.custom_rejected_on = now_datetime()


def clear_entry_rejection_audit(log):
    log.custom_rejection_comment = None
    log.custom_rejected_by = None
    log.custom_rejected_on = None


def return_timesheet_to_draft(doc):
    doc.custom_approval_status = "Not Submitted"
    doc.custom_weekly_approval_status = "Rejected"


def notify_employee_of_rejection(employee: str, dates: list[str], note: str):
    from next_pms.timesheet.api.team import trigger_notification_for_approved_or_rejected_timesheet

    trigger_notification_for_approved_or_rejected_timesheet(
        status="Rejected",
        employee=employee,
        dates=dates,
        note=note,
    )


def prepare_entries_for_resubmission(doc):
    for log in doc.time_logs:
        if log.custom_entry_approval_status in {"Draft", "Rejected", None, ""}:
            log.custom_entry_approval_status = "Pending"


def enrich_entry_rejection_fields(log: dict):
    log["entry_approval_status"] = log.get("custom_entry_approval_status") or "Pending"
    log["rejection_comment"] = log.get("custom_rejection_comment")
    log["rejected_by"] = log.get("custom_rejected_by")
    log["rejected_on"] = log.get("custom_rejected_on")
    log["was_rejected"] = entry_is_rejected_draft(log) or bool(log.get("custom_rejection_comment"))
    return log
