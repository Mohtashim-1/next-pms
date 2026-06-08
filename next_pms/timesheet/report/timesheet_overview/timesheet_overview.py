# Copyright (c) 2024, rtCamp and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.query_builder import Case, DocType


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
            "label": _("Projects"),
            "fieldtype": "Link",
            "options": "Project",
        },
        {
            "fieldname": "task_subject",
            "label": _("Task Subject"),
            "fieldtype": "Data",
        },
        {
            "fieldname": "non_billable_hours",
            "label": _("Non-billable Hours"),
            "fieldtype": "Float",
        },
        {
            "fieldname": "billable_hours",
            "label": _("Billable Hours"),
            "fieldtype": "Float",
        },
        {
            "fieldname": "is_billable",
            "label": _("Billable Status"),
            "fieldtype": "Data",
        },
        {
            "fieldname": "billable_override_reason",
            "label": _("Billable Override Reason"),
            "fieldtype": "Data",
        },
        {
            "fieldname": "entry_approval_status",
            "label": _("Entry Approval Status"),
            "fieldtype": "Data",
        },
        {
            "fieldname": "rejection_comment",
            "label": _("Rejection Comment"),
            "fieldtype": "Data",
        },
        {
            "fieldname": "rejected_by",
            "label": _("Rejected By"),
            "fieldtype": "Link",
            "options": "User",
        },
        {
            "fieldname": "rejected_on",
            "label": _("Rejected On"),
            "fieldtype": "Datetime",
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
    timesheet = DocType("Timesheet")
    timesheet_details = DocType("Timesheet Detail")
    task = DocType("Task")
    billable_hours = (
        Case().when(timesheet_details.is_billable == 1, timesheet_details.hours).else_(0).as_("billable_hours")
    )

    non_billable_hours = (
        Case().when(timesheet_details.is_billable == 0, timesheet_details.hours).else_(0).as_("non_billable_hours")
    )
    query = (
        frappe.qb.from_(timesheet)
        .inner_join(timesheet_details)
        .on(timesheet_details.parent == timesheet.name)
        .inner_join(task)
        .on(task.name == timesheet_details.task)
        .select(
            timesheet.start_date.as_("from_date"),
            timesheet_details.from_time.as_("entry_date"),
            timesheet.employee_name,
            timesheet_details.project,
            task.subject.as_("task_subject"),
            billable_hours,
            non_billable_hours,
            timesheet_details.is_billable,
            timesheet_details.custom_billable_override_reason.as_("billable_override_reason"),
            timesheet_details.custom_entry_approval_status.as_("entry_approval_status"),
            timesheet_details.custom_rejection_comment.as_("rejection_comment"),
            timesheet_details.custom_rejected_by.as_("rejected_by"),
            timesheet_details.custom_rejected_on.as_("rejected_on"),
        )
        .where(timesheet.start_date >= filters.get("from_date"))
        .where(timesheet.end_date <= filters.get("to_date"))
        .where(timesheet.docstatus.isin([0, 1]))
    )
    if filters.get("employee", None) is not None:
        query = query.where(timesheet.employee == filters.get("employee"))
    if filters.get("task", None) is not None:
        query = query.where(timesheet_details.task == filters.get("task"))

    if filters.get("project", None) is not None:
        query = query.where(timesheet_details.project == filters.get("project"))

    if filters.get("rejected_only"):
        query = query.where(timesheet_details.custom_rejection_comment.isnotnull())
        query = query.where(timesheet_details.custom_rejection_comment != "")

    return query.run(as_dict=True)


def execute(filters=None):
    from next_pms.timesheet.utils.period_lock import annotate_report_rows

    columns = get_columns()
    data = get_data(filters)
    for row in data:
        row["is_billable"] = _("Billable") if row.get("is_billable") else _("Non-Billable")
    data = annotate_report_rows(data, date_field="entry_date")
    return columns, data
