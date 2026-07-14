import re

import frappe
from frappe import _

from next_pms.timesheet.utils.time_log import strip_input_mode_marker

PLACEHOLDER_DESCRIPTIONS = {"", "-", "—", "–"}
HTML_TAG_RE = re.compile(r"<[^>]+>")


def strip_description_content(description: str | None) -> str:
    content = strip_input_mode_marker(description)
    return (content or "").strip()


def is_meaningful_description(description: str | None) -> bool:
    content = strip_description_content(description)
    if not content or content in PLACEHOLDER_DESCRIPTIONS:
        return False

    plain = HTML_TAG_RE.sub("", content).strip()
    return bool(plain) and plain not in PLACEHOLDER_DESCRIPTIONS


def get_project_description_settings(project: str | None) -> dict:
    defaults = {
        "required": False,
        "show_in_approval": False,
        "include_on_invoice": False,
    }
    if not project:
        return defaults

    description_fields = [
        "custom_require_timesheet_description",
        "custom_show_description_in_approval",
        "custom_include_description_on_invoice",
    ]
    if not all(frappe.db.has_column("Project", field) for field in description_fields):
        return defaults

    settings = frappe.db.get_value(
        "Project",
        project,
        description_fields,
        as_dict=True,
    )
    if not settings:
        return defaults

    return {
        "required": bool(settings.custom_require_timesheet_description),
        "show_in_approval": bool(settings.custom_show_description_in_approval),
        "include_on_invoice": bool(settings.custom_include_description_on_invoice),
    }


def validate_entry_description(task: str | None, project: str | None, description: str | None):
    # Remarks / description are always required for time entries.
    if not is_meaningful_description(description):
        task_label = task or project or _("this entry")
        throw(
            _("Remarks are required. Please add remarks for {0}.").format(task_label),
            frappe.MandatoryError,
        )


def enrich_log_description_fields(log: dict, project: str | None = None):
    project = project or log.get("project")
    settings = get_project_description_settings(project)
    # Always mark description required in UI; project flag still controls approval display.
    log["description_required"] = True
    log["show_description_in_approval"] = settings["show_in_approval"]
    log["include_description_on_invoice"] = settings["include_on_invoice"]
    log["description"] = strip_description_content(log.get("description"))
    return log
