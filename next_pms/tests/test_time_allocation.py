from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.time_allocation import (
    SPLIT_KEYS,
    _classify_timesheet_hours,
    _employee_matches_group,
    _empty_split,
    _merge_split,
)


class TestTimeAllocation(IntegrationTestCase):
    def test_classify_billable(self):
        self.assertEqual(_classify_timesheet_hours({"is_billable": 1, "project": "PRJ-1"}), "billable")

    def test_classify_admin_without_project(self):
        self.assertEqual(_classify_timesheet_hours({"is_billable": 0, "project": None}), "admin")

    def test_classify_non_billable_with_project(self):
        self.assertEqual(
            _classify_timesheet_hours({"is_billable": 0, "project": "PRJ-1", "activity_type": "Development"}),
            "non_billable",
        )

    def test_merge_split(self):
        merged = _merge_split(
            {"billable": 10, "non_billable": 2, "pto": 0, "holiday": 0, "admin": 1},
            {"billable": 5, "non_billable": 0, "pto": 8, "holiday": 1, "admin": 0},
        )
        self.assertEqual(merged["billable"], 15)
        self.assertEqual(merged["pto"], 8)
        self.assertEqual(set(merged.keys()), set(SPLIT_KEYS))

    def test_empty_split_keys(self):
        self.assertEqual(set(_empty_split().keys()), set(SPLIT_KEYS))

    def test_employee_matches_group(self):
        employee = {"name": "EMP-1", "employee_name": "Alex", "user_group": "Delivery"}
        self.assertTrue(_employee_matches_group(employee, "team", None))
        self.assertTrue(_employee_matches_group(employee, "team", "Delivery"))
        self.assertFalse(_employee_matches_group(employee, "team", "Sales"))
        self.assertTrue(_employee_matches_group(employee, "person", "EMP-1"))
