from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.budget_alerts import (
    get_allocation_utilizations,
    parse_thresholds,
    recommend_action,
    snooze_budget_alert,
)


class TestBudgetAlerts(IntegrationTestCase):
    def test_parse_thresholds_defaults(self):
        self.assertEqual(parse_thresholds(None), [50, 75, 90, 100, 110])
        self.assertEqual(parse_thresholds("[90, 50, 110]"), [50, 90, 110])
        self.assertEqual(parse_thresholds("75, 100"), [75, 100])

    def test_recommend_action_mapping(self):
        self.assertEqual(recommend_action(50), "Escalate")
        self.assertEqual(recommend_action(100), "Request Change Order")
        self.assertEqual(recommend_action(110), "Notify Client")

    def test_get_allocation_utilizations(self):
        doc = type(
            "Allocation",
            (),
            {
                "metric_type": "Both",
                "budget_hours": 100,
                "consumed_hours": 80,
                "budget_amount": 1000,
                "consumed_amount": 500,
            },
        )()
        utilizations = dict(get_allocation_utilizations(doc))
        self.assertEqual(utilizations["Hours"], 80.0)
        self.assertEqual(utilizations["Amount"], 50.0)

    def test_snooze_budget_alert(self):
        project = self._create_project()
        allocation = self._create_allocation(project)
        alert = self._create_alert(project, allocation)

        with patch("next_pms.next_pms.utils.budget_alerts.send_alert_notifications"):
            result = snooze_budget_alert(alert, "2099-01-01 10:00:00", "Waiting for client reply")

        self.assertEqual(result["status"], "Snoozed")
        self.assertEqual(result["snooze_reason"], "Waiting for client reply")

    def _create_project(self) -> str:
        doc = frappe.get_doc(
            {
                "doctype": "Project",
                "project_name": "Budget Alert Test Project",
                "status": "Open",
            }
        ).insert(ignore_permissions=True)
        return doc.name

    def _create_allocation(self, project: str) -> str:
        doc = frappe.get_doc(
            {
                "doctype": "Project Budget Allocation",
                "project": project,
                "scope_type": "Total",
                "allocation_type": "Billable",
                "metric_type": "Hours",
                "budget_hours": 100,
                "budget_amount": 0,
            }
        ).insert(ignore_permissions=True)
        return doc.name

    def _create_alert(self, project: str, allocation: str) -> str:
        doc = frappe.get_doc(
            {
                "doctype": "Project Budget Alert",
                "project": project,
                "budget_allocation": allocation,
                "scope_label": "Project Total",
                "utilization_metric": "Hours",
                "threshold_pct": 75,
                "utilization_pct": 80,
                "status": "Open",
                "recommended_action": "Escalate",
                "message": "Test alert",
            }
        ).insert(ignore_permissions=True)
        return doc.name
