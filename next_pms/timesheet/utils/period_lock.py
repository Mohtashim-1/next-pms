import frappe
from frappe import _
from frappe.utils import getdate


def _normalize_date(value):
    return getdate(value) if value else None


def get_active_locks_between(start_date, end_date):
    start_date = _normalize_date(start_date)
    end_date = _normalize_date(end_date)
    if not start_date or not end_date:
        return []

    return frappe.get_all(
        "Timesheet Period Lock",
        filters={
            "status": "Active",
            "from_date": ["<=", end_date],
            "to_date": [">=", start_date],
        },
        fields=[
            "name",
            "from_date",
            "to_date",
            "lock_reason",
            "locked_by",
            "locked_on",
        ],
        order_by="from_date asc",
    )


def get_active_lock_for_date(date):
    date = _normalize_date(date)
    if not date:
        return None

    locks = get_active_locks_between(date, date)
    return locks[0] if locks else None


def is_date_period_locked(date, locks: list | None = None) -> bool:
    date = _normalize_date(date)
    if not date:
        return False

    if locks is None:
        return bool(get_active_lock_for_date(date))

    for lock in locks:
        if getdate(lock["from_date"]) <= date <= getdate(lock["to_date"]):
            return True
    return False


def get_lock_meta_for_date(date, locks: list | None = None):
    date = _normalize_date(date)
    if not date:
        return None

    if locks is None:
        return get_active_lock_for_date(date)

    for lock in locks:
        if getdate(lock["from_date"]) <= date <= getdate(lock["to_date"]):
            return lock
    return None


def assert_date_not_period_locked(date):
    lock = get_active_lock_for_date(date)
    if not lock:
        return

    frappe.throw(
        _(
            "Timesheet entries from {0} to {1} are locked. Reason: {2}. Contact an administrator to unlock the period."
        ).format(lock.get("from_date"), lock.get("to_date"), lock.get("lock_reason") or "-"),
        frappe.PermissionError,
    )


def enrich_entry_period_lock_fields(log: dict, locks: list | None = None):
    entry_date = _normalize_date(log.get("from_time") or log.get("date"))
    lock = get_lock_meta_for_date(entry_date, locks)
    log["is_period_locked"] = bool(lock)
    log["period_lock_reason"] = lock.get("lock_reason") if lock else None
    log["period_lock_name"] = lock.get("name") if lock else None
    return log


def annotate_report_rows(rows: list, date_field: str = "from_date"):
    if not rows:
        return rows

    dates = [_normalize_date(row.get(date_field)) for row in rows if row.get(date_field)]
    if not dates:
        return rows

    locks = get_active_locks_between(min(dates), max(dates))
    for row in rows:
        entry_date = _normalize_date(row.get(date_field))
        lock = get_lock_meta_for_date(entry_date, locks)
        row["is_period_locked"] = _("Yes") if lock else _("No")
        row["period_lock_reason"] = lock.get("lock_reason") if lock else ""
    return rows
