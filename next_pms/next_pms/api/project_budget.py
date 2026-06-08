import json

import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.project_budget import (
    get_project_budget_view,
    log_budget_audit,
    serialize_allocation,
    snapshot_allocation,
)


@whitelist()
@error_logger
def get_budget_view(project: str):
    if not project or not frappe.db.exists("Project", project):
        frappe.throw("Project not found.")
    frappe.has_permission("Project", doc=project, throw=True)
    return get_project_budget_view(project)


@whitelist()
@error_logger
def save_budget_allocation(allocation: dict | str, change_reason: str | None = None):
    if isinstance(allocation, str):
        allocation = json.loads(allocation)

    allocation = frappe._dict(allocation or {})
    if not allocation.get("project"):
        frappe.throw("Project is required.")

    frappe.has_permission("Project", doc=allocation.project, ptype="write", throw=True)

    if not change_reason:
        frappe.throw("A change reason is required for budget edits.")

    previous = None
    if allocation.get("name") and frappe.db.exists("Project Budget Allocation", allocation.name):
        previous_doc = frappe.get_doc("Project Budget Allocation", allocation.name)
        previous = snapshot_allocation(previous_doc)
        doc = previous_doc
        doc.update(allocation)
        action = "Update"
    else:
        doc = frappe.get_doc({"doctype": "Project Budget Allocation", **allocation})
        action = "Create"

    doc.save()
    log_budget_audit(
        doc.project,
        action,
        doc.name,
        previous,
        snapshot_allocation(doc),
        change_reason,
    )
    return get_project_budget_view(doc.project)


@whitelist()
@error_logger
def delete_budget_allocation(name: str, change_reason: str | None = None):
    if not frappe.db.exists("Project Budget Allocation", name):
        frappe.throw("Budget allocation not found.")

    doc = frappe.get_doc("Project Budget Allocation", name)
    frappe.has_permission("Project", doc=doc.project, ptype="write", throw=True)

    if not change_reason:
        frappe.throw("A change reason is required to delete a budget allocation.")

    previous = snapshot_allocation(doc)
    project = doc.project
    doc.delete()
    log_budget_audit(project, "Delete", name, previous, {}, change_reason)
    return get_project_budget_view(project)
