# Cache Keys

EMP_WOKING_DETAILS = "emp_working_details"
EMP_TIMESHEET = "emp_timesheet_v2"

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
# Format: activity::<Activity Type>::<Project>
# Project segment may be empty when the log has no project.
ACTIVITY_ROW_PREFIX = "activity::"


def activity_row_key(activity_type: str, project: str | None = None) -> str:
	"""Build a unique grid row key for an activity-only timesheet log."""
	activity = (activity_type or "").strip()
	project = (project or "").strip()
	return f"{ACTIVITY_ROW_PREFIX}{activity}::{project}"


def parse_activity_row_key(key: str) -> tuple[str | None, str | None]:
	"""Return (activity_type, project) from a synthetic row key.

	Supports legacy keys ``activity::<Activity Type>`` (no project segment).
	"""
	if not key or not str(key).startswith(ACTIVITY_ROW_PREFIX):
		return None, None
	rest = str(key)[len(ACTIVITY_ROW_PREFIX) :]
	if "::" in rest:
		activity, project = rest.split("::", 1)
		return (activity.strip() or None), (project.strip() or None)
	return (rest.strip() or None), None
