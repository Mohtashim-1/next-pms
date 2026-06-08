from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.analytics_drilldown import (
    apply_record_permissions,
    format_filter_chips,
    records_to_csv,
    slug_doctype,
)


class TestAnalyticsDrilldown(IntegrationTestCase):
    def test_slug_doctype(self):
        self.assertEqual(slug_doctype("Sales Invoice"), "sales-invoice")

    def test_format_filter_chips_skips_empty_values(self):
        chips = format_filter_chips(
            {"from_date": "2026-01-01", "customer": "", "group_by": "team"},
            {"from_date": "From", "group_by": "Group By"},
        )
        self.assertEqual(len(chips), 2)
        self.assertEqual(chips[0]["label"], "From")
        self.assertEqual(chips[1]["value"], "team")

    def test_records_to_csv(self):
        csv_content = records_to_csv(
            [{"label": "TS-1", "date": "2026-01-02", "hours": 4}],
            [
                {"key": "label", "label": "Record"},
                {"key": "date", "label": "Date"},
                {"key": "hours", "label": "Hours"},
            ],
        )
        self.assertIn("Record,Date,Hours", csv_content)
        self.assertIn("TS-1,2026-01-02,4", csv_content)

    def test_apply_record_permissions_without_reference(self):
        records = apply_record_permissions(
            [{"label": "Holiday", "reference_doctype": None, "reference_name": None}]
        )
        self.assertFalse(records[0]["can_read"])
        self.assertIsNone(records[0]["link"])
