import frappe
from frappe.tests import IntegrationTestCase

from next_pms.resource_management.utils.capacity_thresholds import (
    get_employee_utilization_thresholds,
    get_global_utilization_thresholds,
    get_utilization_band,
)


class TestCapacityThresholds(IntegrationTestCase):
    def setUp(self):
        frappe.db.set_single_value("Timesheet Settings", "under_utilized_threshold", 70)
        frappe.db.set_single_value("Timesheet Settings", "over_capacity_threshold", 100)

    def test_global_threshold_defaults(self):
        thresholds = get_global_utilization_thresholds()
        self.assertEqual(thresholds["under_utilized_max"], 0.7)
        self.assertEqual(thresholds["over_capacity_min"], 1.0)

    def test_utilization_bands(self):
        thresholds = get_global_utilization_thresholds()
        self.assertEqual(get_utilization_band(0.5, thresholds), "under_utilized")
        self.assertEqual(get_utilization_band(0.85, thresholds), "target")
        self.assertEqual(get_utilization_band(1.2, thresholds), "over_capacity")

    def test_employee_threshold_override(self):
        employee = frappe.db.get_value("Employee", {"status": "Active"}, "name")
        if not employee:
            self.skipTest("No active employee found")

        frappe.db.set_value("Employee", employee, "custom_under_utilized_threshold", 50)
        frappe.db.set_value("Employee", employee, "custom_over_capacity_threshold", 90)

        thresholds = get_employee_utilization_thresholds(employee)
        self.assertEqual(thresholds["under_utilized_max"], 0.5)
        self.assertEqual(thresholds["over_capacity_min"], 0.9)

        frappe.db.set_value("Employee", employee, "custom_under_utilized_threshold", None)
        frappe.db.set_value("Employee", employee, "custom_over_capacity_threshold", None)
