import secrets

import frappe
from frappe.utils import add_days, get_url, getdate, today

from next_pms.api.utils import error_logger
from next_pms.resource_management.api.utils.query import get_allocation_list_for_employee_for_given_range
from next_pms.resource_management.utils.ics import build_allocations_ics
from next_pms.timesheet.api.employee import get_employee_from_user


ALLOCATION_FIELDS = [
    "name",
    "employee",
    "employee_name",
    "project",
    "project_name",
    "customer",
    "allocation_start_date",
    "allocation_end_date",
    "hours_allocated_per_day",
    "total_allocated_hours",
    "is_billable",
    "status",
    "note",
]

COMPANY_ALLOCATION_ROLES = {"Projects Manager", "Projects User", "System Manager"}


def _can_view_company_allocations() -> bool:
    if get_employee_from_user():
        return False
    if frappe.session.user == "Administrator":
        return True
    return bool(set(frappe.get_roles()) & COMPANY_ALLOCATION_ROLES)


def _get_employee_or_throw():
    employee = get_employee_from_user()
    if not employee and not _can_view_company_allocations():
        frappe.throw("No employee record is linked to your user account.", frappe.PermissionError)
    return employee


def _fetch_personal_allocations(employee: str, start_date: str, end_date: str) -> list[dict]:
    return get_allocation_list_for_employee_for_given_range(
        ALLOCATION_FIELDS,
        "employee",
        [employee],
        start_date,
        end_date,
    )


def _fetch_company_allocations(start_date: str, end_date: str) -> list[dict]:
    employees = frappe.get_all("Employee", filters={"status": "Active"}, pluck="name")
    if not employees:
        return []
    return get_allocation_list_for_employee_for_given_range(
        ALLOCATION_FIELDS,
        "employee",
        employees,
        start_date,
        end_date,
    )


def _build_upcoming(allocations: list[dict]) -> list[dict]:
    today_date = getdate(today())
    upcoming = [
        row
        for row in allocations
        if row.get("allocation_end_date") and getdate(row.get("allocation_end_date")) >= today_date
    ]
    upcoming.sort(
        key=lambda row: (
            getdate(row.get("allocation_end_date")),
            getdate(row.get("allocation_start_date")),
        )
    )
    return upcoming


def _get_or_create_calendar_token(employee: str, regenerate: bool = False) -> str:
    fieldname = "custom_allocation_calendar_token"
    if not frappe.db.has_column("Employee", fieldname):
        frappe.throw("Calendar sync is not configured. Run bench migrate and retry.")

    token = frappe.db.get_value("Employee", employee, fieldname)
    if token and not regenerate:
        return token

    token = secrets.token_urlsafe(32)
    frappe.db.set_value("Employee", employee, fieldname, token, update_modified=False)
    return token


def _get_employee_by_calendar_token(token: str | None) -> str | None:
    if not token or not frappe.db.has_column("Employee", "custom_allocation_calendar_token"):
        return None
    return frappe.db.get_value("Employee", {"custom_allocation_calendar_token": token, "status": "Active"})


@frappe.whitelist()
@error_logger
def get_my_allocations(start_date: str | None = None, end_date: str | None = None):
    start_date = start_date or add_days(today(), -30)
    end_date = end_date or add_days(today(), 180)

    if _can_view_company_allocations():
        allocations = _fetch_company_allocations(start_date, end_date)
        return {
            "employee": None,
            "employee_name": "All Employees",
            "is_admin_view": True,
            "allocations": allocations,
            "upcoming": _build_upcoming(allocations),
            "start_date": start_date,
            "end_date": end_date,
        }

    employee = _get_employee_or_throw()
    allocations = _fetch_personal_allocations(employee, start_date, end_date)
    employee_name = frappe.db.get_value("Employee", employee, "employee_name")

    return {
        "employee": employee,
        "employee_name": employee_name,
        "is_admin_view": False,
        "allocations": allocations,
        "upcoming": _build_upcoming(allocations),
        "start_date": start_date,
        "end_date": end_date,
    }


@frappe.whitelist()
@error_logger
def get_calendar_feed_settings():
    if _can_view_company_allocations():
        return {
            "feed_url": None,
            "webcal_url": None,
            "has_token": False,
            "disabled": True,
            "message": "Calendar sync is available when your user is linked to an Employee record.",
        }

    employee = _get_employee_or_throw()
    token = _get_or_create_calendar_token(employee)
    feed_url = get_url(
        f"/api/method/next_pms.resource_management.api.personal.allocation_ics_feed?token={token}"
    )
    return {
        "feed_url": feed_url,
        "webcal_url": feed_url.replace("https://", "webcal://").replace("http://", "webcal://"),
        "has_token": bool(token),
        "disabled": False,
    }


@frappe.whitelist(methods=["POST"])
@error_logger
def regenerate_calendar_feed_token():
    employee = _get_employee_or_throw()
    token = _get_or_create_calendar_token(employee, regenerate=True)
    feed_url = get_url(
        f"/api/method/next_pms.resource_management.api.personal.allocation_ics_feed?token={token}"
    )
    return {
        "feed_url": feed_url,
        "webcal_url": feed_url.replace("https://", "webcal://").replace("http://", "webcal://"),
    }


@frappe.whitelist(allow_guest=True)
def allocation_ics_feed(token: str | None = None):
    employee = _get_employee_by_calendar_token(token)
    if not employee:
        frappe.throw("Invalid calendar feed token.", frappe.AuthenticationError)

    start_date = add_days(today(), -30)
    end_date = add_days(today(), 365)
    allocations = _fetch_personal_allocations(employee, start_date, end_date)
    employee_name = frappe.db.get_value("Employee", employee, "employee_name") or "Assignments"
    ics_content = build_allocations_ics(allocations, calendar_name=f"{employee_name} Assignments")

    frappe.local.response.filename = "assignments.ics"
    frappe.local.response.filecontent = ics_content
    frappe.local.response.type = "download"
    frappe.local.response.display_content_as = "text"
    frappe.local.response.headers["Content-Type"] = "text/calendar; charset=utf-8"
