# Cache Keys

EMP_WOKING_DETAILS = "emp_working_details"
EMP_TIMESHEET = "emp_timesheet"

ALLOWED_TIMESHET_DETAIL_FIELDS = [
    "name",
    "from_time",
    "to_time",
    "description",
    "project",
    "task",
    "project_name",
    "activity_type",
    "is_billable",
    "custom_billable_override_reason",
    "custom_entry_approval_status",
    "custom_rejection_comment",
    "custom_rejected_by",
    "custom_rejected_on",
    "hours",
    "parent",
    "docstatus",
]

# Synthetic timesheet-grid row key for logs that only have Activity Type (no Task)
ACTIVITY_ROW_PREFIX = "activity::"
