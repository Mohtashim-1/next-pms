from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.margin_analytics import _planned_metrics


class TestMarginAnalytics(IntegrationTestCase):
    def test_planned_metrics_with_sales_order_value(self):
        metrics = _planned_metrics(
            {
                "total_sales_amount": 100000,
                "estimated_costing": 60000,
            }
        )
        self.assertEqual(metrics["planned_revenue"], 100000)
        self.assertEqual(metrics["planned_cost"], 60000)
        self.assertEqual(metrics["planned_margin"], 40000)
        self.assertEqual(metrics["planned_margin_pct"], 40.0)

    def test_planned_metrics_fallback_to_estimated_costing(self):
        metrics = _planned_metrics(
            {
                "total_sales_amount": 0,
                "estimated_costing": 50000,
            }
        )
        self.assertEqual(metrics["planned_revenue"], 50000)
        self.assertGreater(metrics["planned_cost"], 0)
        self.assertEqual(metrics["planned_margin"], metrics["planned_revenue"] - metrics["planned_cost"])
