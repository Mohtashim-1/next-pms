# Copyright (c) 2024, rtCamp and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.query_builder import DocType


def get_columns():
    return [
        {
            "fieldname": "from_date",
            "label": _("Date"),
            "fieldtype": "Date",
        },
        {
            "fieldname": "employee_name",
            "label": _("Employee"),
            "fieldtype": "Data",
            "options": "Employee",
            "width": 200,
        },
        {
            "fieldname": "project",
            "label": _("Project"),
            "fieldtype": "Link",
            "options": "Project",
        },
        {
            "fieldname": "task_subject",
            "label": _("Task Subject"),
            "fieldtype": "Data",
        },
        {
            "fieldname": "hours",
            "label": _("Hours"),
            "fieldtype": "Float",
        },
        {
            "fieldname": "description",
            "label": _("Comments"),
            "fieldtype": "data",
            "width": 300,
        },
        {
            "fieldname": "is_period_locked",
            "label": _("Period Locked"),
            "fieldtype": "Data",
        },
        {
            "fieldname": "period_lock_reason",
            "label": _("Period Lock Reason"),
            "fieldtype": "Data",
        },
    ]


def get_data(filters):
    from frappe.utils import get_datetime, getdate
    from datetime import timedelta

    timesheet = DocType("Timesheet")
    timesheet_details = DocType("Timesheet Detail")
    task = DocType("Task")
    from_dt = get_datetime(filters.get("from_date"))
    to_dt = get_datetime(getdate(filters.get("to_date")) + timedelta(days=1))
    # LEFT JOIN Task: most entries here have no task linked.
    # Filter by detail from_time (not strict timesheet start/end containment)
    # so weekly sheets that overlap the window still appear.
    query = (
        frappe.qb.from_(timesheet)
        .inner_join(timesheet_details)
        .on(timesheet_details.parent == timesheet.name)
        .left_join(task)
        .on(task.name == timesheet_details.task)
        .select(
            timesheet.start_date.as_("from_date"),
            timesheet_details.from_time.as_("entry_date"),
            timesheet.employee_name,
            timesheet_details.project,
            task.subject.as_("task_subject"),
            timesheet_details.hours,
            timesheet_details.description,
        )
        .where(timesheet_details.from_time >= from_dt)
        .where(timesheet_details.from_time < to_dt)
        .where(timesheet_details.is_billable == 1)
        .where(timesheet.docstatus.isin([0, 1]))
    )
    if filters.get("employee", None) is not None:
        query = query.where(timesheet.employee == filters.get("employee"))
    if filters.get("task", None) is not None:
        query = query.where(timesheet_details.task == filters.get("task"))

    if filters.get("project", None) is not None:
        query = query.where(timesheet_details.project == filters.get("project"))

    return query.run(as_dict=True)


def execute(filters=None):
    from next_pms.timesheet.utils.period_lock import annotate_report_rows

    columns = get_columns()
    data = annotate_report_rows(get_data(filters), date_field="entry_date")
    return columns, data
