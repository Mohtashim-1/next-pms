from __future__ import annotations

import frappe
from frappe.utils import flt


def trigger_milestone_billing(milestone):
    if isinstance(milestone, str):
        milestone = frappe.get_doc("Project Milestone", milestone)

    if not milestone.billing_trigger:
        milestone.db_set("billing_status", "Skipped", update_modified=False)
        return None

    if milestone.billing_status == "Invoiced" and milestone.sales_invoice:
        return milestone.sales_invoice

    project = frappe.get_doc("Project", milestone.project)
    billing_type = project.get("custom_billing_type") or "Non-Billable"

    if billing_type == "Non-Billable":
        milestone.db_set("billing_status", "Skipped", update_modified=False)
        return None

    amount = _resolve_milestone_amount(milestone, project)
    if amount <= 0:
        milestone.db_set("billing_status", "Skipped", update_modified=False)
        return None

    if billing_type == "Time and Material":
        milestone.db_set("billing_status", "Ready to Invoice", update_modified=False)
        return None

    invoice_name = _create_milestone_sales_invoice(milestone, project, amount)
    milestone.db_set(
        {
            "billing_status": "Invoiced",
            "sales_invoice": invoice_name,
        },
        update_modified=False,
    )
    return invoice_name


def _resolve_milestone_amount(milestone, project) -> float:
    amount = flt(milestone.billing_amount)
    if amount > 0:
        return amount

    percentage = flt(milestone.billing_percentage)
    if percentage > 0:
        base = flt(project.estimated_costing) or flt(project.total_sales_amount)
        return flt(base * percentage / 100, 2)

    return 0.0


def _create_milestone_sales_invoice(milestone, project, amount: float) -> str:
    if not project.customer:
        frappe.throw("Project customer is required to create a milestone invoice.")

    company = project.company or frappe.defaults.get_user_default("Company")
    currency = project.get("custom_currency") or frappe.db.get_value("Company", company, "default_currency")
    item_code = _get_default_service_item(company)

    invoice = frappe.new_doc("Sales Invoice")
    invoice.customer = project.customer
    invoice.company = company
    invoice.project = project.name
    invoice.currency = currency
    invoice.set_posting_time = 1
    invoice.append(
        "items",
        {
            "item_code": item_code,
            "qty": 1,
            "rate": amount,
            "description": f"Milestone: {milestone.milestone_name}",
        },
    )
    invoice.insert(ignore_permissions=True)
    return invoice.name


def _get_default_service_item(company: str) -> str:
    item = frappe.db.get_value(
        "Item",
        {"is_sales_item": 1, "disabled": 0},
        "name",
        order_by="modified desc",
    )
    if not item:
        frappe.throw("No sales item found. Create a service item to enable milestone billing.")
    return item
