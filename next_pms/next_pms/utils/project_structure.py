from __future__ import annotations

import frappe


def _task_has_phase_field() -> bool:
    return frappe.db.has_column("Task", "custom_project_phase")


def _serialize_task(task: dict) -> dict:
    return {
        "name": task.name,
        "subject": task.subject,
        "status": task.status,
        "priority": task.get("priority"),
        "exp_start_date": task.get("exp_start_date"),
        "exp_end_date": task.get("exp_end_date"),
        "progress": task.get("progress"),
        "parent_task": task.get("parent_task"),
        "custom_project_phase": task.get("custom_project_phase"),
        "is_milestone": task.get("is_milestone"),
        "level": "subtask" if task.get("parent_task") else "task",
    }


def get_tasks_for_phase(phase_name: str) -> list[dict]:
    if not _task_has_phase_field():
        return []

    parent_tasks = frappe.get_all(
        "Task",
        filters={"custom_project_phase": phase_name, "parent_task": ["is", "not set"]},
        fields=[
            "name",
            "subject",
            "status",
            "priority",
            "exp_start_date",
            "exp_end_date",
            "progress",
            "parent_task",
            "custom_project_phase",
            "is_milestone",
        ],
        order_by="exp_start_date asc, subject asc",
    )

    result = []
    for task in parent_tasks:
        serialized = _serialize_task(task)
        serialized["subtasks"] = [
            _serialize_task(row)
            for row in frappe.get_all(
                "Task",
                filters={"parent_task": task.name},
                fields=[
                    "name",
                    "subject",
                    "status",
                    "priority",
                    "exp_start_date",
                    "exp_end_date",
                    "progress",
                    "parent_task",
                    "custom_project_phase",
                    "is_milestone",
                ],
                order_by="exp_start_date asc, subject asc",
            )
        ]
        result.append(serialized)
    return result


def get_unassigned_project_tasks(project: str) -> list[dict]:
    filters = {"project": project, "parent_task": ["is", "not set"]}
    if _task_has_phase_field():
        filters["custom_project_phase"] = ["is", "not set"]

    parent_tasks = frappe.get_all(
        "Task",
        filters=filters,
        fields=[
            "name",
            "subject",
            "status",
            "priority",
            "exp_start_date",
            "exp_end_date",
            "progress",
            "parent_task",
            "custom_project_phase",
            "is_milestone",
        ],
        order_by="exp_start_date asc, subject asc",
    )

    result = []
    for task in parent_tasks:
        serialized = _serialize_task(task)
        serialized["subtasks"] = [
            _serialize_task(row)
            for row in frappe.get_all(
                "Task",
                filters={"parent_task": task.name},
                fields=[
                    "name",
                    "subject",
                    "status",
                    "priority",
                    "exp_start_date",
                    "exp_end_date",
                    "progress",
                    "parent_task",
                    "custom_project_phase",
                    "is_milestone",
                ],
                order_by="exp_start_date asc, subject asc",
            )
        ]
        result.append(serialized)
    return result


def get_project_structure(project: str) -> dict:
    phases = frappe.get_all(
        "Project Phase",
        filters={"project": project},
        fields=[
            "name",
            "phase_name",
            "status",
            "start_date",
            "end_date",
            "sequence",
            "description",
        ],
        order_by="sequence asc, creation asc",
    )

    for phase in phases:
        phase["depends_on"] = frappe.get_all(
            "Project Phase Dependency",
            filters={"parent": phase.name},
            fields=["depends_on_phase", "dependency_type"],
            order_by="idx asc",
        )
        phase["tasks"] = get_tasks_for_phase(phase.name)
        phase["level"] = "phase"

    milestones = frappe.get_all(
        "Project Milestone",
        filters={"project": project},
        fields=[
            "name",
            "phase",
            "milestone_name",
            "milestone_date",
            "status",
            "billing_trigger",
            "billing_amount",
            "billing_percentage",
            "billing_status",
            "sales_invoice",
            "notes",
        ],
        order_by="milestone_date asc, creation asc",
    )

    return {
        "project": project,
        "phases": phases,
        "unassigned_tasks": get_unassigned_project_tasks(project),
        "milestones": milestones,
    }
