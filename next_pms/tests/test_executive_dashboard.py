from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.executive_dashboard import (
    ROLE_TILE_DEFAULTS,
    _health_status,
    _margin_status,
    _utilization_status,
    get_default_tiles_for_user,
)


class TestExecutiveDashboard(IntegrationTestCase):
    def test_role_tile_defaults_exist(self):
        self.assertIn("utilization", ROLE_TILE_DEFAULTS["Projects Manager"])
        self.assertIn("margin", ROLE_TILE_DEFAULTS["Accounts Manager"])
        self.assertNotIn("ar", ROLE_TILE_DEFAULTS["Timesheet Manager"])

    def test_get_default_tiles_for_user(self):
        tiles = get_default_tiles_for_user()
        self.assertTrue(tiles)
        self.assertTrue(all(tile in ROLE_TILE_DEFAULTS["Administrator"] for tile in tiles))

    def test_status_helpers(self):
        self.assertEqual(_utilization_status(80), "healthy")
        self.assertEqual(_utilization_status(120), "critical")
        self.assertEqual(_margin_status(35, 30), "healthy")
        self.assertEqual(_health_status({"red": 1, "amber": 0, "green": 3}), "critical")
