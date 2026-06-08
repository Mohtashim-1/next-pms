import frappe
from frappe.tests import IntegrationTestCase

from next_pms.resource_management.utils.ics import build_allocations_ics


class TestPersonalAllocations(IntegrationTestCase):
    def test_build_allocations_ics(self):
        ics = build_allocations_ics(
            [
                {
                    "name": "RA-TEST-001",
                    "project_name": "Demo Project",
                    "allocation_start_date": "2026-06-01",
                    "allocation_end_date": "2026-06-05",
                    "hours_allocated_per_day": 4,
                    "is_billable": 1,
                    "status": "Confirmed",
                    "note": "Sample note",
                }
            ],
            calendar_name="Test Assignments",
        )
        self.assertIn("BEGIN:VCALENDAR", ics)
        self.assertIn("BEGIN:VEVENT", ics)
        self.assertIn("Demo Project", ics)
        self.assertIn("RA-TEST-001@next-pms", ics)

    def test_calendar_token_field_fixture(self):
        self.assertTrue(frappe.db.has_column("Employee", "custom_allocation_calendar_token"))
