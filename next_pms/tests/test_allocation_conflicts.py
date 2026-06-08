import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from next_pms.resource_management.utils.conflicts import detect_allocation_conflicts


class TestAllocationConflicts(IntegrationTestCase):
    def setUp(self):
        self.employee = frappe.db.get_value("Employee", {"status": "Active"}, "name")
        if not self.employee:
            self.skipTest("No active employee available for conflict tests")

        self.created_allocations = []

    def tearDown(self):
        for name in self.created_allocations:
            if frappe.db.exists("Resource Allocation", name):
                frappe.delete_doc("Resource Allocation", name, force=True)

    def _create_allocation(self, hours: float, offset_days: int = 0):
        today = nowdate()
        doc = frappe.get_doc(
            {
                "doctype": "Resource Allocation",
                "employee": self.employee,
                "allocation_start_date": add_days(today, offset_days),
                "allocation_end_date": add_days(today, offset_days),
                "hours_allocated_per_day": hours,
                "project": frappe.db.get_value("Project", {}, "name"),
                "customer": frappe.db.get_value("Customer", {}, "name"),
                "total_allocated_hours": hours,
                "is_billable": 1,
            }
        )
        doc.insert(ignore_permissions=True)
        self.created_allocations.append(doc.name)
        return doc

    def test_detects_over_allocation(self):
        self._create_allocation(6)
        result = detect_allocation_conflicts(self.employee, nowdate(), nowdate(), 4)
        self.assertTrue(result["has_conflicts"])
        self.assertGreaterEqual(len(result["conflicts"]), 1)

    def test_no_conflict_when_within_capacity(self):
        result = detect_allocation_conflicts(self.employee, nowdate(), nowdate(), 1)
        self.assertFalse(result["has_conflicts"])
