from frappe.tests import IntegrationTestCase

from next_pms.next_pms.utils.client_invoice import abandon_invoice_draft, recalculate_draft_totals
from next_pms.next_pms.doctype.client_invoice_draft.client_invoice_draft import ClientInvoiceDraft


class TestClientInvoice(IntegrationTestCase):
    def test_recalculate_draft_totals(self):
        doc = type(
            "Draft",
            (),
            {
                "lines": [
                    type("Line", (), {"include": 1, "hours": 2, "rate": 100, "amount": 0})(),
                    type("Line", (),     {"include": 0, "hours": 5, "rate": 50, "amount": 250})(),
                    type("Line", (), {"include": 1, "hours": 1.5, "rate": 80, "amount": 0})(),
                ]
            },
        )()
        recalculate_draft_totals(doc)
        self.assertEqual(doc.total_hours, 3.5)
        self.assertEqual(doc.subtotal_amount, 320.0)

    def test_validate_skips_period_check_when_ignore_validate(self):
        doc = ClientInvoiceDraft(
            {
                "doctype": "Client Invoice Draft",
                "customer": "Test Customer",
                "company": "Test Company",
                "currency": "USD",
                "period_start": "2026-02-01",
                "period_end": "2026-01-01",
            }
        )
        doc.flags.ignore_validate = True
        doc.validate()

    def test_abandon_requires_draft_status_message(self):
        with self.assertRaises(Exception):
            abandon_invoice_draft("NON-EXISTENT-DRAFT")
