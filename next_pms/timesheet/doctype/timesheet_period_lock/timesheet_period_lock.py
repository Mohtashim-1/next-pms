import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, now_datetime


class TimesheetPeriodLock(Document):
    def validate(self):
        self.from_date = getdate(self.from_date)
        self.to_date = getdate(self.to_date)
        if self.from_date > self.to_date:
            frappe.throw(_("From Date cannot be after To Date."))

        if self.is_new():
            self._validate_no_overlapping_active_lock()
            self.locked_by = frappe.session.user
            self.locked_on = now_datetime()
            self.status = "Active"

    def _validate_no_overlapping_active_lock(self):
        overlapping = frappe.db.sql(
            """
            SELECT name
            FROM `tabTimesheet Period Lock`
            WHERE status = 'Active'
              AND from_date <= %s
              AND to_date >= %s
              AND name != %s
            LIMIT 1
            """,
            (self.to_date, self.from_date, self.name or ""),
            as_dict=True,
        )
        if overlapping:
            frappe.throw(
                _("An active period lock already overlaps this date range ({0}).").format(overlapping[0].name)
            )
