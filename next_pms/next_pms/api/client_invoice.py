import json

import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.client_invoice import (
    abandon_invoice_draft,
    create_invoice_draft,
    finalize_invoice_draft,
    get_template_options,
    list_invoice_drafts,
    render_invoice_preview,
    save_invoice_template,
    search_billable_entries,
    serialize_draft,
    update_invoice_draft,
)


def _ensure_access(write: bool = False):
    roles = set(frappe.get_roles())
    allowed = {"Projects Manager", "Accounts Manager", "Administrator"}
    if not roles.intersection(allowed):
        frappe.throw("You do not have permission to manage client invoices.", frappe.PermissionError)


@whitelist()
@error_logger
def search_entries(
    customer: str,
    period_start: str,
    period_end: str,
    project: str | None = None,
    po_no: str | None = None,
    sales_order: str | None = None,
):
    _ensure_access()
    return search_billable_entries(customer, period_start, period_end, project, po_no, sales_order)


@whitelist()
@error_logger
def get_drafts(customer: str | None = None, project: str | None = None, status: str | None = None):
    _ensure_access()
    return list_invoice_drafts(customer=customer, project=project, status=status)


@whitelist()
@error_logger
def get_draft(name: str, include_preview: int = 1):
    _ensure_access()
    if not frappe.db.exists("Client Invoice Draft", name):
        frappe.throw("Invoice draft not found.")
    return serialize_draft(name, include_preview=bool(include_preview))


@whitelist()
@error_logger
def create_draft(payload: dict | str):
    _ensure_access(write=True)
    if isinstance(payload, str):
        payload = json.loads(payload)
    return create_invoice_draft(payload or {})


@whitelist()
@error_logger
def update_draft(name: str, payload: dict | str, autosave: int = 0):
    _ensure_access(write=True)
    if isinstance(payload, str):
        payload = json.loads(payload)
    return update_invoice_draft(name, payload or {}, autosave=bool(autosave))


@whitelist()
@error_logger
def abandon_draft(name: str):
    _ensure_access(write=True)
    if not frappe.db.exists("Client Invoice Draft", name):
        frappe.throw("Invoice draft not found.")
    return abandon_invoice_draft(name)


@whitelist()
@error_logger
def preview_draft(name: str):
    _ensure_access()
    if not frappe.db.exists("Client Invoice Draft", name):
        frappe.throw("Invoice draft not found.")
    return {"html": render_invoice_preview(name)}


@whitelist()
@error_logger
def finalize_draft(name: str, submit: int = 0):
    _ensure_access(write=True)
    return finalize_invoice_draft(name, submit=submit)


@whitelist()
@error_logger
def get_templates(customer: str | None = None):
    _ensure_access()
    return get_template_options(customer)


@whitelist()
@error_logger
def save_template(payload: dict | str):
    _ensure_access(write=True)
    if isinstance(payload, str):
        payload = json.loads(payload)
    return save_invoice_template(payload or {})
