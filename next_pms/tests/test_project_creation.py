from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, today

from next_pms.api.project_creation import (
    _normalize_csv_row,
    _validate_project_payload,
    get_project_template_defaults,
)


class TestProjectCreation(IntegrationTestCase):
    def test_normalize_csv_row(self):
        row = _normalize_csv_row(
            {
                "project_name": " Test ",
                "customer": "CUST-1",
                "project_type": "Internal",
                "expected_start_date": today(),
                "expected_end_date": add_days(today(), 7),
                "custom_project_manager": "admin@example.com",
                "tags": "alpha, beta",
            },
            default_company="Test Company",
            default_naming_series="PROJ-.####",
        )
        self.assertEqual(row["project_name"], "Test")
        self.assertEqual(row["tags"], ["alpha", "beta"])
        self.assertEqual(row["company"], "Test Company")

    def test_validate_project_payload_requires_fields(self):
        with self.assertRaises(Exception):
            _validate_project_payload({"project_name": "Only Name"})

    def test_get_project_template_defaults_missing(self):
        with self.assertRaises(Exception):
            get_project_template_defaults("__missing_template__")
