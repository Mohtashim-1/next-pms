from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.project_budget import _build_summary


class TestProjectBudget(IntegrationTestCase):
    def test_build_summary_totals_only(self):
        summary = _build_summary(
            [
                {
                    "scope_type": "Total",
                    "allocation_type": "Billable",
                    "metric_type": "Both",
                    "budget_hours": 100,
                    "consumed_hours": 40,
                    "budget_amount": 10000,
                    "consumed_amount": 2500,
                },
                {
                    "scope_type": "Total",
                    "allocation_type": "Non-Billable",
                    "metric_type": "Hours",
                    "budget_hours": 50,
                    "consumed_hours": 10,
                    "budget_amount": 0,
                    "consumed_amount": 0,
                },
                {
                    "scope_type": "Phase",
                    "allocation_type": "Billable",
                    "metric_type": "Hours",
                    "budget_hours": 20,
                    "consumed_hours": 5,
                    "budget_amount": 0,
                    "consumed_amount": 0,
                },
            ]
        )
        self.assertEqual(summary["billable_hours_budget"], 100)
        self.assertEqual(summary["non_billable_hours_budget"], 50)
        self.assertEqual(summary["billable_amount_budget"], 10000)
