import frappe
from frappe import _
from frappe.utils import getdate, now_datetime

from next_pms.api.utils import error_logger
from next_pms.timesheet.utils.period_lock import get_active_locks_between


def _assert_can_lock():
    if frappe.session.user == "Administrator":
        return
    frappe.only_for(["Timesheet Manager", "Projects Manager"], message=True)


def _assert_can_unlock():
    if frappe.session.user != "Administrator":
        frappe.only_for(["Administrator"], message=True)


@frappe.whitelist()
@error_logger
def get_period_locks(from_date: str, to_date: str):
    frappe.has_permission("Timesheet Period Lock", "read", throw=True)
    return get_active_locks_between(from_date, to_date)


@frappe.whitelist(methods=["POST"])
@error_logger
def lock_period(from_date: str, to_date: str, reason: str):
    _assert_can_lock()
    if not (reason or "").strip():
        frappe.throw(_("Lock reason is required."), frappe.MandatoryError)

    doc = frappe.get_doc(
        {
            "doctype": "Timesheet Period Lock",
            "from_date": getdate(from_date),
            "to_date": getdate(to_date),
            "lock_reason": reason.strip(),
        }
    )
    doc.insert(ignore_permissions=False)
    return {
        "message": _("Timesheet period locked from {0} to {1}.").format(doc.from_date, doc.to_date),
        "lock": doc.as_dict(),
    }


@frappe.whitelist(methods=["POST"])
@error_logger
def unlock_period(name: str, reason: str):
    _assert_can_unlock()
    if not (reason or "").strip():
        frappe.throw(_("Unlock reason is required."), frappe.MandatoryError)

    doc = frappe.get_doc("Timesheet Period Lock", name)
    if doc.status != "Active":
        frappe.throw(_("This period lock is not active."))

    doc.status = "Unlocked"
    doc.unlock_reason = reason.strip()
    doc.unlocked_by = frappe.session.user
    doc.unlocked_on = now_datetime()
    doc.save(ignore_permissions=True)

    return {
        "message": _("Timesheet period {0} unlocked.").format(doc.name),
        "lock": doc.as_dict(),
    }
