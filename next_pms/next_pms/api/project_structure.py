import json

import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.project_structure import get_project_structure


@whitelist()
@error_logger
def get_structure(project: str):
    if not project or not frappe.db.exists("Project", project):
        frappe.throw("Project not found.")
    frappe.has_permission("Project", doc=project, throw=True)
    return get_project_structure(project)


@whitelist()
@error_logger
def save_phase(phase: dict | str):
    if isinstance(phase, str):
        phase = json.loads(phase)

    phase = frappe._dict(phase or {})
    if not phase.get("project"):
        frappe.throw("Project is required.")

    frappe.has_permission("Project", doc=phase.project, ptype="write", throw=True)

    if phase.get("name") and frappe.db.exists("Project Phase", phase.name):
        doc = frappe.get_doc("Project Phase", phase.name)
        doc.update(phase)
    else:
        doc = frappe.get_doc({"doctype": "Project Phase", **phase})

    doc.save()
    return get_project_structure(phase.project)


@whitelist()
@error_logger
def save_milestone(milestone: dict | str):
    if isinstance(milestone, str):
        milestone = json.loads(milestone)

    milestone = frappe._dict(milestone or {})
    if not milestone.get("project"):
        frappe.throw("Project is required.")

    frappe.has_permission("Project", doc=milestone.project, ptype="write", throw=True)

    if milestone.get("name") and frappe.db.exists("Project Milestone", milestone.name):
        doc = frappe.get_doc("Project Milestone", milestone.name)
        doc.update(milestone)
    else:
        doc = frappe.get_doc({"doctype": "Project Milestone", **milestone})

    doc.save()
    return get_project_structure(milestone.project)


@whitelist()
@error_logger
def save_task_node(task: dict | str):
    if isinstance(task, str):
        task = json.loads(task)

    task = frappe._dict(task or {})
    if not task.get("project"):
        frappe.throw("Project is required.")

    frappe.has_permission("Project", doc=task.project, ptype="write", throw=True)

    payload = {
        "doctype": "Task",
        "subject": task.subject,
        "project": task.project,
        "status": task.get("status") or "Open",
        "priority": task.get("priority") or "Medium",
        "exp_start_date": task.get("exp_start_date"),
        "exp_end_date": task.get("exp_end_date"),
        "parent_task": task.get("parent_task"),
    }

    if frappe.db.has_column("Task", "custom_project_phase") and task.get("custom_project_phase"):
        payload["custom_project_phase"] = task.custom_project_phase

    if task.get("name") and frappe.db.exists("Task", task.name):
        doc = frappe.get_doc("Task", task.name)
        doc.update(payload)
        doc.save()
    else:
        doc = frappe.get_doc(payload)
        doc.insert()

    return get_project_structure(task.project)


@whitelist()
@error_logger
def update_milestone_status(name: str, status: str):
    if not frappe.db.exists("Project Milestone", name):
        frappe.throw("Milestone not found.")

    doc = frappe.get_doc("Project Milestone", name)
    frappe.has_permission("Project", doc=doc.project, ptype="write", throw=True)
    doc.status = status
    doc.save()
    return get_project_structure(doc.project)
