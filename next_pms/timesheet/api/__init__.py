import frappe
from frappe import get_all, get_list, get_roles, get_value, whitelist


@whitelist()
def get_employee_with_role(role: str | list[str]):
    import json

    from frappe import get_all

    if isinstance(role, str):
        role = json.loads(role)

    user_ids = get_all(
        "Has Role",
        filters={"role": ["in", role], "parenttype": "User", "parent": ["!=", "Administrator"]},
        pluck="parent",
    )
    employees = get_all(
        "Employee", filters={"user_id": ["in", user_ids], "status": "Active"}, fields=["name", "employee_name"]
    )
    return employees


def filter_employees(
    employee_name=None,
    department=None,
    project=None,
    page_length=10,
    start=0,
    user_group=None,
    status=None,
    ids: list[str] | None = None,
    reports_to: None | str = None,
    business_unit=None,
    designation=None,
    branch=None,
    role_filter=None,
    ignore_default_filters=False,
    ignore_permissions=False,
):
    import json

    current_roles = get_roles()

    if not ignore_permissions:
        ignore_permissions = set(current_roles).intersection(["Timesheet User", "Timesheet Manager"])

    fields = ["name", "image", "employee_name", "department", "designation", "branch", "user_id"]
    has_business_unit_field = frappe.db.has_column("Employee", "custom_business_unit")
    if has_business_unit_field:
        fields.append("custom_business_unit")
    employee_ids = []
    role_employee_ids = []
    filters = {"status": ["in", ["Active"]]}
    or_filters = {}

    if reports_to:
        filters["reports_to"] = reports_to

    if isinstance(department, str):
        department = json.loads(department)

    if isinstance(business_unit, str):
        business_unit = json.loads(business_unit)

    if isinstance(designation, str):
        designation = json.loads(designation)

    if isinstance(branch, str):
        branch = json.loads(branch)

    if isinstance(role_filter, str):
        role_filter = json.loads(role_filter)

    if isinstance(status, str):
        status = json.loads(status)
        if len(status) > 0:
            filters["status"] = ["in", status]

    if isinstance(status, list):
        if len(status) > 0:
            filters["status"] = ["in", status]

    if isinstance(project, str):
        project = json.loads(project)

    if isinstance(user_group, str):
        user_group = json.loads(user_group)

    if employee_name:
        or_filters["employee_name"] = ["like", f"%{employee_name}%"]

    if department and len(department) > 0:
        filters["department"] = ["in", department]

    if designation and len(designation) > 0:
        filters["designation"] = ["in", designation]

    if business_unit and len(business_unit) > 0 and has_business_unit_field:
        filters["custom_business_unit"] = ["in", business_unit]

    if branch and len(branch) > 0:
        filters["branch"] = ["in", branch]

    if role_filter and len(role_filter) > 0:
        role_users = get_all(
            "Has Role",
            filters={"role": ["in", role_filter], "parenttype": "User"},
            pluck="parent",
        )
        role_employee_ids = [
            employee
            for employee in [get_value("Employee", {"user_id": user}) for user in role_users]
            if employee
        ]

    if ids:
        employee_ids.extend(ids)

    if project and len(project) > 0:
        project_employee = get_all(
            "DocShare",
            filters={"share_doctype": "Project", "share_name": ["IN", project]},
            pluck="user",
        )
        ids = [get_value("Employee", {"user_id": employee}) for employee in project_employee]
        employee_ids.extend(ids)

    if user_group and len(user_group) > 0:
        users = get_all("User Group Member", pluck="user", filters={"parent": ["in", user_group]})
        ids = [get_value("Employee", {"user_id": user}, cache=True) for user in users]
        employee_ids.extend(ids)

    if role_employee_ids:
        employee_ids = list(set(employee_ids) & set(role_employee_ids)) if employee_ids else role_employee_ids

    if len(employee_ids) > 0:
        filters["name"] = ["in", employee_ids]
    elif role_filter and len(role_filter) > 0 and not role_employee_ids:
        return [], 0

    if ignore_default_filters:
        filters.pop("status", None)

    employees = get_list(
        "Employee",
        fields=fields,
        or_filters=or_filters,
        filters=filters,
        page_length=page_length,
        start=start,
        ignore_permissions=ignore_permissions,
        order_by="employee_name asc",
    )
    total_count = get_count(
        "Employee",
        filters=filters,
        or_filters=or_filters,
        ignore_permissions=ignore_permissions,
    )

    return employees, total_count


def get_count(
    doctype: str,
    limit: int | None = None,
    distinct: bool = False,
    filters=None,
    or_filters=None,
    ignore_permissions=False,
) -> int:
    from frappe.desk.reportview import execute

    distinct = "distinct " if distinct else ""
    fieldname = f"{distinct}`tab{doctype}`.name"

    fieldname = [f"count({fieldname}) as total_count"]
    count = execute(
        doctype,
        distinct=distinct,
        limit=limit,
        fields=fieldname,
        filters=filters,
        or_filters=or_filters,
        ignore_permissions=ignore_permissions,
    )[0].get("total_count")
    return count
