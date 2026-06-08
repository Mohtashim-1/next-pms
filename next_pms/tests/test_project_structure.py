from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.milestone_billing import _resolve_milestone_amount
from next_pms.next_pms.utils.project_structure import _serialize_task


class TestProjectStructure(IntegrationTestCase):
    def test_serialize_task_levels(self):
        task = _serialize_task({"name": "T-1", "subject": "Task", "status": "Open", "parent_task": None})
        self.assertEqual(task["level"], "task")

        subtask = _serialize_task(
            {"name": "T-2", "subject": "Sub", "status": "Open", "parent_task": "T-1"}
        )
        self.assertEqual(subtask["level"], "subtask")

    def test_resolve_milestone_amount_from_percentage(self):
        milestone = type("Milestone", (), {"billing_amount": 0, "billing_percentage": 25})()
        project = type("Project", (), {"estimated_costing": 1000, "total_sales_amount": 0})()
        self.assertEqual(_resolve_milestone_amount(milestone, project), 250.0)
