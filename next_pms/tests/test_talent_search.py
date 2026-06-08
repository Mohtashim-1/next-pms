from frappe.tests import IntegrationTestCase

from next_pms.resource_management.utils.talent_search import (
    compute_filter_fit_score,
    compute_skill_fit_score,
    evaluate_skill_query,
    get_employees_for_skill_group,
)


class TestTalentSearch(IntegrationTestCase):
    def test_evaluate_skill_query_and_operator(self):
        result = evaluate_skill_query(
            {
                "operator": "AND",
                "groups": [
                    {
                        "operator": "OR",
                        "skills": [
                            {"name": "__missing_skill_a__", "proficiency": 0.2, "operator": ">="},
                            {"name": "__missing_skill_b__", "proficiency": 0.2, "operator": ">="},
                        ],
                    }
                ],
            }
        )
        self.assertEqual(result, [])

    def test_get_employees_for_skill_group_or_empty(self):
        self.assertEqual(get_employees_for_skill_group([], "OR"), [])

    def test_compute_skill_fit_score_no_requirements(self):
        score = compute_skill_fit_score("EMP-TEST", None, {})
        self.assertEqual(score, 100.0)

    def test_compute_filter_fit_score_no_filters(self):
        score = compute_filter_fit_score({"branch": "HQ"}, 100, {})
        self.assertEqual(score, 100.0)
