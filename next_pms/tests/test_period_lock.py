import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, nowdate

from next_pms.timesheet.utils.period_lock import (
    assert_date_not_period_locked,
    get_active_lock_for_date,
    is_date_period_locked,
)


class TestPeriodLock(IntegrationTestCase):
    def setUp(self):
        self.lock_name = None

    def tearDown(self):
        if self.lock_name and frappe.db.exists("Timesheet Period Lock", self.lock_name):
            frappe.delete_doc("Timesheet Period Lock", self.lock_name, force=True)

    def _create_lock(self, from_date=None, to_date=None, reason="Payroll closed"):
        from_date = from_date or nowdate()
        to_date = to_date or add_days(from_date, 6)
        doc = frappe.get_doc(
            {
                "doctype": "Timesheet Period Lock",
                "from_date": from_date,
                "to_date": to_date,
                "lock_reason": reason,
            }
        )
        doc.insert(ignore_permissions=True)
        self.lock_name = doc.name
        return doc

    def test_active_lock_blocks_date(self):
        today = getdate(nowdate())
        self._create_lock(today, today)

        lock = get_active_lock_for_date(today)
        self.assertTrue(lock)
        self.assertTrue(is_date_period_locked(today))

        with self.assertRaises(frappe.PermissionError):
            assert_date_not_period_locked(today)

    def test_unlocked_lock_does_not_block(self):
        today = getdate(nowdate())
        doc = self._create_lock(today, today)
        doc.status = "Unlocked"
        doc.unlock_reason = "Correction needed"
        doc.save(ignore_permissions=True)

        self.assertFalse(is_date_period_locked(today))
