import frappe
from frappe import get_all, get_list, get_roles, get_value, whitelist


@whitelist()
def get_employee_with_role(role: str | list[str], employee: str | None = None):
    import json

    from frappe import get_all

    if isinstance(role, str):
        role = json.loads(role)

    user_ids = get_all(
        "Has Role",
        filters={"role": ["in", role], "parenttype": "User", "parent": ["!=", "Administrator"]},
        pluck="parent",
    )
    source_employee = employee or frappe.db.get_value(
        "Employee", {"user_id": frappe.session.user, "status": "Active"}, "name"
    )
    company = frappe.db.get_value("Employee", source_employee, "company") if source_employee else None
    filters = {"user_id": ["in", user_ids], "status": "Active"}
    if company:
        filters["company"] = company
    employees = get_all(
        "Employee",
        filters=filters,
        fields=["name", "employee_name", "user_id", "company"],
        order_by="employee_name asc",
    )
    return employees


def _as_list(value):
    import json

    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return [value] if value else []
    if isinstance(value, (list, tuple, set)):
        return [item for item in value if item]
    return [value] if value else []


def _intersect_values(current, candidates):
    candidates = set(candidates or [])
    if current is None:
        return candidates
    return current & candidates


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
    customer=None,
    project_type=None,
    task=None,
    ignore_default_filters=False,
    ignore_permissions=False,
):
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

    department = _as_list(department)
    business_unit = _as_list(business_unit)
    designation = _as_list(designation)
    branch = _as_list(branch)
    role_filter = _as_list(role_filter)
    project = _as_list(project)
    user_group = _as_list(user_group)
    customer = _as_list(customer)
    project_type = _as_list(project_type)
    task = _as_list(task)
    status = _as_list(status)

    if status:
        filters["status"] = ["in", status]

    if employee_name:
        or_filters["employee_name"] = ["like", f"%{employee_name}%"]

    if department:
        filters["department"] = ["in", department]

    if designation:
        filters["designation"] = ["in", designation]

    if business_unit and has_business_unit_field:
        filters["custom_business_unit"] = ["in", business_unit]

    if branch:
        filters["branch"] = ["in", branch]

    if role_filter:
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

    resolved_projects = None
    if project:
        resolved_projects = _intersect_values(resolved_projects, project)

    if customer:
        customer_projects = get_all("Project", filters={"customer": ["in", customer]}, pluck="name")
        resolved_projects = _intersect_values(resolved_projects, customer_projects)

    if project_type:
        typed_projects = get_all("Project", filters={"project_type": ["in", project_type]}, pluck="name")
        resolved_projects = _intersect_values(resolved_projects, typed_projects)

    if task:
        task_projects = [
            project_name
            for project_name in get_all("Task", filters={"name": ["in", task]}, pluck="project")
            if project_name
        ]
        timesheet_parents = get_all("Timesheet Detail", filters={"task": ["in", task]}, pluck="parent")
        task_employees = []
        if timesheet_parents:
            task_employees = [
                emp
                for emp in get_all(
                    "Timesheet",
                    filters={"name": ["in", timesheet_parents], "docstatus": ["!=", 2]},
                    pluck="employee",
                )
                if emp
            ]
            employee_ids.extend(task_employees)

        if not task_projects and not task_employees:
            return [], 0

        if task_projects:
            resolved_projects = _intersect_values(resolved_projects, task_projects)

    if resolved_projects is not None:
        if not resolved_projects:
            return [], 0
        project_employee = get_all(
            "DocShare",
            filters={"share_doctype": "Project", "share_name": ["IN", list(resolved_projects)]},
            pluck="user",
        )
        shared_employees = [get_value("Employee", {"user_id": user}) for user in project_employee]
        employee_ids.extend([emp for emp in shared_employees if emp])
        if not employee_ids:
            return [], 0

    if user_group:
        users = get_all("User Group Member", pluck="user", filters={"parent": ["in", user_group]})
        group_employees = [get_value("Employee", {"user_id": user}, cache=True) for user in users]
        employee_ids.extend([emp for emp in group_employees if emp])

    if role_employee_ids:
        employee_ids = list(set(employee_ids) & set(role_employee_ids)) if employee_ids else role_employee_ids

    if employee_ids:
        filters["name"] = ["in", list(set(employee_ids))]
    elif role_filter and not role_employee_ids:
        return [], 0
    elif resolved_projects is not None and not employee_ids:
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
    from frappe.query_builder.functions import Count
    from frappe.utils import cint

    count = frappe.qb.get_query(
        table=doctype,
        filters=filters,
        or_filters=or_filters,
        fields=Count("name" if distinct else "*"),
        distinct=distinct,
        limit=limit,
        ignore_permissions=ignore_permissions,
    ).run()[0][0]
    return cint(count)
