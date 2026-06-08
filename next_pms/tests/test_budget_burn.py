from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.budget_burn import _comparison


class TestBudgetBurn(IntegrationTestCase):
    def test_comparison_under_budget(self):
        result = _comparison(2500, 10000)
        self.assertEqual(result["actual"], 2500)
        self.assertEqual(result["target"], 10000)
        self.assertEqual(result["variance"], -7500)
        self.assertEqual(result["remaining"], 7500)
        self.assertEqual(result["utilization_pct"], 25.0)

    def test_comparison_over_budget(self):
        result = _comparison(12000, 10000)
        self.assertEqual(result["variance"], 2000)
        self.assertEqual(result["utilization_pct"], 120.0)
