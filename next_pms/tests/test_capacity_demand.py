from frappe.tests import IntegrationTestCase
from frappe.utils import add_months, today

from next_pms.resource_management.utils.capacity_demand import (
    build_period_buckets,
    compute_period_metrics,
)


class TestCapacityDemand(IntegrationTestCase):
    def test_build_monthly_periods_twelve_months(self):
        periods = build_period_buckets(today(), horizon_months=12, period_type="month")
        self.assertGreaterEqual(len(periods), 12)
        self.assertEqual(len(periods[0]["key"]), 7)

    def test_build_weekly_periods(self):
        periods = build_period_buckets(today(), horizon_months=3, period_type="week")
        self.assertGreater(len(periods), 8)

    def test_compute_period_metrics_balanced(self):
        metrics = compute_period_metrics(
            daily_hours=8,
            allocations=[],
            leaves=[],
            holidays=[],
            period_start=today(),
            period_end=today(),
        )
        self.assertEqual(metrics["capacity_hours"], 8)
        self.assertEqual(metrics["demand_hours"], 0)
        self.assertEqual(metrics["status"], "surplus")
