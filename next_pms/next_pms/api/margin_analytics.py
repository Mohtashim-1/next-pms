import frappe
from frappe import whitelist

from next_pms.api.utils import error_logger
from next_pms.next_pms.utils.analytics_drilldown import records_to_csv, set_csv_download_response
from next_pms.next_pms.utils.margin_analytics import (
    GROUP_BY_OPTIONS,
    MARGIN_DRILL_COLUMNS,
    get_margin_drilldown,
    get_portfolio_margin_view,
    get_project_margin_snapshot,
)


def _ensure_access():
    roles = set(frappe.get_roles())
    allowed = {"Projects Manager", "Accounts Manager", "Administrator"}
    if not roles.intersection(allowed):
        frappe.throw("You do not have permission to view margin analytics.", frappe.PermissionError)


@whitelist()
@error_logger
def get_portfolio_view(
    from_date: str,
    to_date: str,
    group_by: str = "customer",
    customer: str | None = None,
    project_type: str | None = None,
    department: str | None = None,
    project: str | None = None,
    company: str | None = None,
):
    _ensure_access()
    if group_by not in GROUP_BY_OPTIONS:
        frappe.throw(f"Invalid group_by. Choose one of: {', '.join(GROUP_BY_OPTIONS)}")

    return get_portfolio_margin_view(
        {
            "from_date": from_date,
            "to_date": to_date,
            "group_by": group_by,
            "customer": customer,
            "project_type": project_type,
            "department": department,
            "project": project,
            "company": company,
        }
    )


@whitelist()
@error_logger
def get_project_margin(project: str, from_date: str, to_date: str):
    _ensure_access()
    frappe.has_permission("Project", doc=project, throw=True)
    return get_project_margin_snapshot(project, from_date, to_date)


@whitelist()
@error_logger
def get_drilldown(
    project: str,
    from_date: str,
    to_date: str,
    driver: str | None = None,
    driver_key: str | None = None,
    group_by: str | None = None,
    customer: str | None = None,
    project_type: str | None = None,
    department: str | None = None,
    company: str | None = None,
    portfolio_group_key: str | None = None,
    portfolio_group_label: str | None = None,
):
    _ensure_access()
    frappe.has_permission("Project", doc=project, throw=True)
    return get_margin_drilldown(
        project,
        from_date,
        to_date,
        driver=driver,
        driver_key=driver_key,
        portfolio_filters={
            "group_by": group_by,
            "customer": customer,
            "project_type": project_type,
            "department": department,
            "company": company,
            "portfolio_group_key": portfolio_group_key,
            "portfolio_group_label": portfolio_group_label,
        },
    )


@whitelist()
@error_logger
def export_drilldown(
    project: str,
    from_date: str,
    to_date: str,
    driver: str | None = None,
    driver_key: str | None = None,
    group_by: str | None = None,
    customer: str | None = None,
    project_type: str | None = None,
    department: str | None = None,
    company: str | None = None,
    portfolio_group_key: str | None = None,
    portfolio_group_label: str | None = None,
):
    _ensure_access()
    frappe.has_permission("Project", doc=project, throw=True)
    payload = get_margin_drilldown(
        project,
        from_date,
        to_date,
        driver=driver,
        driver_key=driver_key,
        portfolio_filters={
            "group_by": group_by,
            "customer": customer,
            "project_type": project_type,
            "department": department,
            "company": company,
            "portfolio_group_key": portfolio_group_key,
            "portfolio_group_label": portfolio_group_label,
        },
    )
    records = payload.get("records") or payload.get("details") or []
    csv_content = records_to_csv(records, MARGIN_DRILL_COLUMNS)
    filename = f"margin-drilldown-{project}-{from_date}-to-{to_date}.csv"
    set_csv_download_response(csv_content, filename)
