from __future__ import annotations

import json

import frappe
from erpnext import get_default_company
from frappe.utils import add_days, flt, get_first_day, get_last_day, getdate, nowdate, today

from next_pms.next_pms.utils.margin_analytics import get_portfolio_margin_view
from next_pms.resource_management.api.utils.query import get_allocation_list_for_employee_for_given_range
from next_pms.resource_management.utils.capacity_demand import build_capacity_demand_rows, build_period_buckets
from next_pms.timesheet.api import filter_employees
from next_pms.timesheet.api.team import get_week_dates
from next_pms.utils.employee import convert_currency

DASHBOARD_ROUTE = "/dashboard"
ALL_TILES = (
    "utilization",
    "bench",
    "pipeline",
    "margin",
    "ar",
    "client_health",
    "approvals",
    "revenue",
    "billable_ratio",
    "overdue_tasks",
    "team_active",
    "active_allocations",
)

ROLE_TILE_DEFAULTS: dict[str, list[str]] = {
    "Administrator": list(ALL_TILES),
    "Projects Manager": list(ALL_TILES),
    "Accounts Manager": ["margin", "ar", "pipeline", "client_health", "revenue", "overdue_tasks"],
    "Timesheet Manager": [
        "utilization",
        "bench",
        "pipeline",
        "client_health",
        "approvals",
        "billable_ratio",
        "overdue_tasks",
        "team_active",
        "active_allocations",
    ],
    "Projects User": ["utilization", "pipeline", "client_health", "overdue_tasks", "billable_ratio"],
}

TILE_META = {
    "utilization": {
        "label": "Utilization",
        "description": "Allocated hours vs team capacity this week",
        "route": "/resource-management/capacity",
    },
    "bench": {
        "label": "Bench",
        "description": "Available bench capacity this week",
        "route": "/resource-management/capacity",
    },
    "pipeline": {
        "label": "Pipeline",
        "description": "Open sales pipeline and near-term demand",
        "route": "/resource-management/capacity",
    },
    "margin": {
        "label": "Margin",
        "description": "Recognized revenue minus incurred cost (MTD)",
        "route": "/project/margins",
    },
    "ar": {
        "label": "Accounts Receivable",
        "description": "Outstanding client invoice balance",
        "route": "/project/invoicing",
    },
    "client_health": {
        "label": "Client Health",
        "description": "Portfolio RAG health across active projects",
        "route": "/project",
    },
    "approvals": {
        "label": "Pending Approvals",
        "description": "Timesheet entries awaiting manager approval",
        "route": "/team/approvals",
    },
    "revenue": {
        "label": "Revenue (MTD)",
        "description": "Recognized revenue month-to-date",
        "route": "/project/margins",
    },
    "billable_ratio": {
        "label": "Billable Mix",
        "description": "Billable hours share this week",
        "route": "/timesheet",
    },
    "overdue_tasks": {
        "label": "Overdue Tasks",
        "description": "Open tasks past expected end date",
        "route": "/task",
    },
    "team_active": {
        "label": "Active Team",
        "description": "Employees available for allocation",
        "route": "/resource-management/capacity",
    },
    "active_allocations": {
        "label": "Live Allocations",
        "description": "Current confirmed resource assignments",
        "route": "/resource-management/time-allocation",
    },
}


def get_user_roles() -> list[str]:
    return list(frappe.get_roles())


def get_default_tiles_for_user() -> list[str]:
    roles = get_user_roles()
    tiles: list[str] = []
    for role in roles:
        for tile in ROLE_TILE_DEFAULTS.get(role, []):
            if tile not in tiles:
                tiles.append(tile)
    return tiles or list(ROLE_TILE_DEFAULTS["Projects Manager"])


def get_saved_layout(user: str | None = None) -> dict | None:
    user = user or frappe.session.user
    layout_name = frappe.db.get_value(
        "PMS View Setting",
        {"route": DASHBOARD_ROUTE, "user": user},
        "name",
    )
    if not layout_name:
        public_layout = frappe.db.get_value(
            "PMS View Setting",
            {"route": DASHBOARD_ROUTE, "public": 1},
            ["name", "filters"],
            as_dict=True,
        )
        if public_layout:
            return _parse_layout_filters(public_layout.filters)
        return None

    filters = frappe.db.get_value("PMS View Setting", layout_name, "filters")
    return _parse_layout_filters(filters)


def _parse_layout_filters(raw_filters) -> dict | None:
    if not raw_filters:
        return None
    try:
        parsed = json.loads(raw_filters) if isinstance(raw_filters, str) else raw_filters
    except (TypeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def get_visible_tiles(user: str | None = None) -> list[str]:
    saved = get_saved_layout(user)
    if saved and saved.get("tiles"):
        allowed = set(get_default_tiles_for_user())
        filtered = [tile for tile in saved["tiles"] if tile in allowed and tile in ALL_TILES]
        if filtered:
            return filtered
    return get_default_tiles_for_user()


def save_dashboard_layout(tiles: list[str], label: str = "My Dashboard") -> dict:
    allowed = set(get_default_tiles_for_user())
    tiles = [tile for tile in tiles if tile in allowed and tile in ALL_TILES]
    if not tiles:
        frappe.throw("Select at least one dashboard tile.")

    payload = {"tiles": tiles, "order": tiles}
    existing = frappe.db.get_value(
        "PMS View Setting",
        {"route": DASHBOARD_ROUTE, "user": frappe.session.user},
        "name",
    )
    if existing:
        doc = frappe.get_doc("PMS View Setting", existing)
        doc.filters = json.dumps(payload)
        doc.label = label
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc(
            {
                "doctype": "PMS View Setting",
                "label": label,
                "dt": "Project",
                "type": "Custom",
                "user": frappe.session.user,
                "route": DASHBOARD_ROUTE,
                "filters": json.dumps(payload),
            }
        )
        doc.insert(ignore_permissions=True)

    return {"tiles": tiles, "layout": payload}


def _current_week_period() -> dict:
    week = get_week_dates(date=today(), ignore_weekend=True)
    return {
        "key": week.get("key") or "This Week",
        "label": week.get("key") or "This Week",
        "start_date": str(week["start_date"]),
        "end_date": str(week["end_date"]),
    }


def _week_capacity_metrics() -> dict:
    period = _current_week_period()
    periods = [period]
    employees, _ = filter_employees(
        None,
        page_length=5000,
        start=0,
        status=["Active"],
        ignore_permissions=True,
    )
    if not employees:
        return {"capacity_hours": 0, "demand_hours": 0, "gap_hours": 0, "utilization_pct": 0}

    employee_names = [employee.name for employee in employees]
    allocations = get_allocation_list_for_employee_for_given_range(
        [
            "name",
            "employee",
            "employee_name",
            "project",
            "project_name",
            "allocation_start_date",
            "allocation_end_date",
            "hours_allocated_per_day",
            "is_billable",
            "status",
        ],
        "employee",
        employee_names,
        period["start_date"],
        period["end_date"],
    )
    allocation_map: dict[str, list] = {}
    for allocation in allocations:
        allocation_map.setdefault(allocation.employee, []).append(allocation)

    rows = build_capacity_demand_rows(employees, allocation_map, periods, group_by="employee")
    capacity_hours = 0.0
    demand_hours = 0.0
    for row in rows:
        metrics = row.get("periods", {}).get(period["key"], {})
        capacity_hours += flt(metrics.get("capacity_hours"))
        demand_hours += flt(metrics.get("demand_hours"))

    gap_hours = capacity_hours - demand_hours
    utilization_pct = (demand_hours / capacity_hours * 100) if capacity_hours else 0
    return {
        "capacity_hours": flt(capacity_hours, 1),
        "demand_hours": flt(demand_hours, 1),
        "gap_hours": flt(gap_hours, 1),
        "utilization_pct": flt(utilization_pct, 1),
        "period_label": period["label"],
        "period_start": period["start_date"],
        "period_end": period["end_date"],
    }


def _pipeline_metrics() -> dict:
    period = _current_week_period()
    next_periods = build_period_buckets(period["start_date"], horizon_months=3, period_type="week")[:4]

    employees, _ = filter_employees(
        None,
        page_length=2000,
        start=0,
        status=["Active"],
        ignore_permissions=True,
    )
    employee_names = [employee.name for employee in employees]
    if not employee_names or not next_periods:
        upcoming_demand = 0.0
    else:
        allocations = get_allocation_list_for_employee_for_given_range(
            [
                "employee",
                "project",
                "project_name",
                "allocation_start_date",
                "allocation_end_date",
                "hours_allocated_per_day",
            ],
            "employee",
            employee_names,
            next_periods[0]["start_date"],
            next_periods[-1]["end_date"],
        )
        allocation_map: dict[str, list] = {}
        for allocation in allocations:
            allocation_map.setdefault(allocation.employee, []).append(allocation)
        rows = build_capacity_demand_rows(employees, allocation_map, next_periods, group_by="employee")
        upcoming_demand = 0.0
        for row in rows:
            for bucket in next_periods:
                upcoming_demand += flt(row.get("periods", {}).get(bucket["key"], {}).get("demand_hours"))

    open_sales_orders = frappe.db.sql(
        """
        SELECT COALESCE(SUM(base_net_total), 0) AS amount, COUNT(*) AS count
        FROM `tabSales Order`
        WHERE docstatus = 1
          AND status NOT IN ('Completed', 'Closed', 'Cancelled')
        """,
        as_dict=True,
    )[0]

    open_projects = frappe.db.count("Project", {"status": "Open"})
    return {
        "open_sales_order_value": flt(open_sales_orders.amount, 2),
        "open_sales_order_count": int(open_sales_orders.count or 0),
        "upcoming_demand_hours": flt(upcoming_demand, 1),
        "open_projects": open_projects,
        "horizon_weeks": len(next_periods),
    }


def _ar_metrics(company: str | None = None) -> dict:
    company = company or get_default_company()
    rows = frappe.db.sql(
        """
        SELECT outstanding_amount, currency, posting_date, due_date
        FROM `tabSales Invoice`
        WHERE docstatus = 1
          AND outstanding_amount > 0
          AND company = %s
        """,
        company,
        as_dict=True,
    )
    reporting_currency = frappe.db.get_value("Company", company, "default_currency") or "USD"
    total = 0.0
    overdue = 0.0
    today_date = getdate(today())
    for row in rows:
        converted = flt(convert_currency(row.outstanding_amount, row.currency, reporting_currency, row.posting_date))
        total += converted
        if row.due_date and getdate(row.due_date) < today_date:
            overdue += converted

    return {
        "outstanding_amount": flt(total, 2),
        "overdue_amount": flt(overdue, 2),
        "invoice_count": len(rows),
        "currency": reporting_currency,
    }


def _client_health_metrics() -> dict:
    projects = frappe.get_all(
        "Project",
        filters={"status": "Open"},
        fields=["name", "customer", "custom_project_rag_status"],
    )
    counts = {"Green": 0, "Amber": 0, "Red": 0, "Unrated": 0}
    for project in projects:
        status = (project.custom_project_rag_status or "Unrated").strip() or "Unrated"
        if status not in counts:
            status = "Unrated"
        counts[status] += 1

    total = len(projects) or 1
    health_score = flt((counts["Green"] / total) * 100, 1)
    return {
        "health_score": health_score,
        "total_projects": len(projects),
        "green": counts["Green"],
        "amber": counts["Amber"],
        "red": counts["Red"],
        "unrated": counts["Unrated"],
    }


def _margin_metrics() -> dict:
    month_start = get_first_day(today())
    month_end = get_last_day(today())
    portfolio = get_portfolio_margin_view(
        {
            "from_date": str(month_start),
            "to_date": str(month_end),
            "group_by": "customer",
        }
    )
    summary = portfolio.get("summary", {})
    return {
        "recognized_revenue": summary.get("recognized_revenue", 0),
        "incurred_cost": summary.get("incurred_cost", 0),
        "actual_margin": summary.get("actual_margin", 0),
        "actual_margin_pct": summary.get("actual_margin_pct", 0),
        "planned_margin_pct": summary.get("planned_margin_pct", 0),
        "margin_variance": summary.get("margin_variance", 0),
        "currency": portfolio.get("currency"),
        "period_start": str(month_start),
        "period_end": str(month_end),
    }


def build_tile_payload(tile_key: str) -> dict:
    meta = TILE_META[tile_key]
    payload = {
        "key": tile_key,
        "label": meta["label"],
        "description": meta["description"],
        "route": meta["route"],
        "updated_at": nowdate(),
    }

    if tile_key == "utilization":
        metrics = _week_capacity_metrics()
        payload.update(
            {
                "value": metrics["utilization_pct"],
                "unit": "%",
                "display_value": f"{metrics['utilization_pct']}%",
                "status": _utilization_status(metrics["utilization_pct"]),
                "details": metrics,
            }
        )
    elif tile_key == "bench":
        metrics = _week_capacity_metrics()
        bench_hours = max(metrics["gap_hours"], 0)
        payload.update(
            {
                "value": bench_hours,
                "unit": "hours",
                "display_value": f"{bench_hours}h",
                "status": "healthy" if bench_hours > 0 else "warning",
                "details": metrics,
            }
        )
    elif tile_key == "pipeline":
        metrics = _pipeline_metrics()
        payload.update(
            {
                "value": metrics["open_sales_order_value"],
                "unit": "currency",
                "display_value": metrics["open_sales_order_value"],
                "status": "neutral",
                "details": metrics,
            }
        )
    elif tile_key == "margin":
        metrics = _margin_metrics()
        payload.update(
            {
                "value": metrics["actual_margin_pct"],
                "unit": "%",
                "display_value": f"{metrics['actual_margin_pct']}%",
                "status": _margin_status(metrics["actual_margin_pct"], metrics["planned_margin_pct"]),
                "details": metrics,
            }
        )
    elif tile_key == "ar":
        metrics = _ar_metrics()
        payload.update(
            {
                "value": metrics["outstanding_amount"],
                "unit": "currency",
                "display_value": metrics["outstanding_amount"],
                "status": "warning" if metrics["overdue_amount"] > 0 else "healthy",
                "details": metrics,
            }
        )
    elif tile_key == "client_health":
        metrics = _client_health_metrics()
        payload.update(
            {
                "value": metrics["health_score"],
                "unit": "%",
                "display_value": f"{metrics['health_score']}%",
                "status": _health_status(metrics),
                "details": metrics,
            }
        )
    elif tile_key == "approvals":
        metrics = _approval_summary()
        pending = metrics.get("pending_entries", 0)
        payload.update(
            {
                "value": pending,
                "unit": "entries",
                "display_value": pending,
                "status": "warning" if pending > 0 else "healthy",
                "details": metrics,
            }
        )
    elif tile_key == "revenue":
        metrics = _margin_metrics()
        revenue = flt(metrics.get("recognized_revenue"), 2)
        payload.update(
            {
                "value": revenue,
                "unit": "currency",
                "display_value": revenue,
                "status": "healthy" if revenue > 0 else "neutral",
                "details": metrics,
            }
        )
    elif tile_key == "billable_ratio":
        metrics = _timesheet_week_summary()
        logged = flt(metrics.get("logged_hours"))
        billable = flt(metrics.get("billable_hours"))
        ratio = (billable / logged * 100) if logged else 0
        payload.update(
            {
                "value": ratio,
                "unit": "%",
                "display_value": f"{flt(ratio, 1)}%",
                "status": "healthy" if ratio >= 70 else "warning" if ratio >= 50 else "critical",
                "details": {**metrics, "billable_ratio": flt(ratio, 1)},
            }
        )
    elif tile_key == "overdue_tasks":
        metrics = _tasks_overview()
        overdue = int(metrics.get("overdue") or 0)
        payload.update(
            {
                "value": overdue,
                "unit": "tasks",
                "display_value": overdue,
                "status": "critical" if overdue > 0 else "healthy",
                "details": metrics,
            }
        )
    elif tile_key == "team_active":
        count = len(_get_active_employees())
        payload.update(
            {
                "value": count,
                "unit": "people",
                "display_value": count,
                "status": "neutral",
                "details": {"active_employees": count},
            }
        )
    elif tile_key == "active_allocations":
        metrics = _allocation_summary()
        count = int(metrics.get("confirmed") or 0)
        payload.update(
            {
                "value": count,
                "unit": "allocations",
                "display_value": count,
                "status": "healthy" if count > 0 else "warning",
                "details": metrics,
            }
        )
    return payload


def _utilization_status(pct: float) -> str:
    if pct > 100:
        return "critical"
    if pct >= 70:
        return "healthy"
    if pct >= 50:
        return "warning"
    return "critical"


def _margin_status(actual_pct: float, planned_pct: float) -> str:
    if actual_pct >= planned_pct:
        return "healthy"
    if actual_pct >= max(planned_pct - 10, 0):
        return "warning"
    return "critical"


def _health_status(metrics: dict) -> str:
    if metrics.get("red", 0) > 0:
        return "critical"
    if metrics.get("amber", 0) > 0:
        return "warning"
    return "healthy"


def _get_active_employees():
    employees, _ = filter_employees(
        None,
        page_length=5000,
        start=0,
        status=["Active"],
        ignore_permissions=True,
    )
    return employees


def _capacity_metrics_for_periods(periods: list[dict]) -> list[dict]:
    employees = _get_active_employees()
    if not employees or not periods:
        return []

    employee_names = [employee.name for employee in employees]
    allocations = get_allocation_list_for_employee_for_given_range(
        [
            "name",
            "employee",
            "employee_name",
            "project",
            "project_name",
            "allocation_start_date",
            "allocation_end_date",
            "hours_allocated_per_day",
            "is_billable",
            "status",
        ],
        "employee",
        employee_names,
        periods[0]["start_date"],
        periods[-1]["end_date"],
    )
    allocation_map: dict[str, list] = {}
    for allocation in allocations:
        allocation_map.setdefault(allocation.employee, []).append(allocation)

    rows = build_capacity_demand_rows(employees, allocation_map, periods, group_by="employee")
    trend = []
    for period in periods:
        capacity_hours = 0.0
        demand_hours = 0.0
        for row in rows:
            metrics = row.get("periods", {}).get(period["key"], {})
            capacity_hours += flt(metrics.get("capacity_hours"))
            demand_hours += flt(metrics.get("demand_hours"))
        utilization_pct = (demand_hours / capacity_hours * 100) if capacity_hours else 0
        trend.append(
            {
                "label": period["label"],
                "key": period["key"],
                "start_date": period["start_date"],
                "end_date": period["end_date"],
                "capacity_hours": flt(capacity_hours, 1),
                "demand_hours": flt(demand_hours, 1),
                "bench_hours": flt(max(capacity_hours - demand_hours, 0), 1),
                "utilization_pct": flt(utilization_pct, 1),
            }
        )
    return trend


def _utilization_trend(weeks: int = 8) -> list[dict]:
    period = _current_week_period()
    start = add_days(period["start_date"], -7 * max(weeks - 1, 0))
    periods = build_period_buckets(start, horizon_months=3, period_type="week")[:weeks]
    return _capacity_metrics_for_periods(periods)


def _capacity_forecast(weeks: int = 6) -> list[dict]:
    period = _current_week_period()
    periods = build_period_buckets(period["start_date"], horizon_months=3, period_type="week")[:weeks]
    return _capacity_metrics_for_periods(periods)


def _tasks_overview() -> dict:
    by_status = frappe.db.sql(
        """
        SELECT status, COUNT(*) AS count
        FROM `tabTask`
        WHERE status NOT IN ('Cancelled')
        GROUP BY status
        ORDER BY count DESC
        """,
        as_dict=True,
    )
    overdue = frappe.db.count(
        "Task",
        {
            "exp_end_date": ["<", today()],
            "status": ["not in", ["Completed", "Cancelled"]],
        },
    )
    total = sum(int(row.count or 0) for row in by_status)
    return {
        "total": total,
        "overdue": overdue,
        "by_status": [{"status": row.status or "Not Set", "count": int(row.count or 0)} for row in by_status],
    }


def _margin_by_customer(limit: int = 6) -> list[dict]:
    month_start = get_first_day(today())
    month_end = get_last_day(today())
    portfolio = get_portfolio_margin_view(
        {
            "from_date": str(month_start),
            "to_date": str(month_end),
            "group_by": "customer",
        }
    )
    rows = sorted(
        portfolio.get("rows") or [],
        key=lambda row: flt(row.get("actual_margin")),
        reverse=True,
    )
    return [
        {
            "key": row.get("key"),
            "label": row.get("label"),
            "actual_margin": flt(row.get("actual_margin"), 2),
            "actual_margin_pct": flt(row.get("actual_margin_pct"), 1),
            "recognized_revenue": flt(row.get("recognized_revenue"), 2),
            "incurred_cost": flt(row.get("incurred_cost"), 2),
            "project_count": int(row.get("project_count") or 0),
        }
        for row in rows[:limit]
    ]


def _ar_aging_buckets() -> dict:
    company = get_default_company()
    rows = frappe.db.sql(
        """
        SELECT outstanding_amount, currency, posting_date, due_date
        FROM `tabSales Invoice`
        WHERE docstatus = 1
          AND outstanding_amount > 0
          AND company = %s
        """,
        company,
        as_dict=True,
    )
    reporting_currency = frappe.db.get_value("Company", company, "default_currency") or "USD"
    buckets = {
        "current": 0.0,
        "1_30": 0.0,
        "31_60": 0.0,
        "61_90": 0.0,
        "90_plus": 0.0,
    }
    today_date = getdate(today())
    for row in rows:
        converted = flt(convert_currency(row.outstanding_amount, row.currency, reporting_currency, row.posting_date))
        if not row.due_date or getdate(row.due_date) >= today_date:
            buckets["current"] += converted
            continue
        days_overdue = (today_date - getdate(row.due_date)).days
        if days_overdue <= 30:
            buckets["1_30"] += converted
        elif days_overdue <= 60:
            buckets["31_60"] += converted
        elif days_overdue <= 90:
            buckets["61_90"] += converted
        else:
            buckets["90_plus"] += converted

    return {
        "currency": reporting_currency,
        "labels": {
            "current": "Current",
            "1_30": "1–30 days",
            "31_60": "31–60 days",
            "61_90": "61–90 days",
            "90_plus": "90+ days",
        },
        "values": {key: flt(value, 2) for key, value in buckets.items()},
    }


def _at_risk_projects(limit: int = 8) -> list[dict]:
    projects = frappe.get_all(
        "Project",
        filters={"status": "Open"},
        fields=[
            "name",
            "project_name",
            "customer",
            "custom_project_rag_status",
            "percent_complete",
            "expected_end_date",
        ],
        order_by="modified desc",
        limit=100,
    )
    priority = {"Red": 0, "Amber": 1, "Unrated": 2, "Green": 3}
    at_risk = []
    for project in projects:
        rag = (project.custom_project_rag_status or "Unrated").strip() or "Unrated"
        if rag not in {"Red", "Amber"}:
            continue
        at_risk.append(
            {
                "project": project.name,
                "project_name": project.project_name or project.name,
                "customer": project.customer,
                "rag_status": rag,
                "percent_complete": flt(project.percent_complete, 1),
                "expected_end_date": project.expected_end_date,
            }
        )
    at_risk.sort(key=lambda item: (priority.get(item["rag_status"], 9), item["percent_complete"]))
    return at_risk[:limit]


def _timesheet_week_summary() -> dict:
    period = _current_week_period()
    summary = frappe.db.sql(
        """
        SELECT
            COALESCE(SUM(td.hours), 0) AS total_hours,
            COALESCE(SUM(CASE WHEN IFNULL(td.is_billable, 0) = 1 THEN td.hours ELSE 0 END), 0) AS billable_hours,
            COUNT(DISTINCT ts.employee) AS active_employees,
            COUNT(DISTINCT td.task) AS active_tasks
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        WHERE ts.start_date <= %s
          AND ts.end_date >= %s
          AND ts.docstatus < 2
        """,
        (period["end_date"], period["start_date"]),
        as_dict=True,
    )[0]
    capacity = _week_capacity_metrics()
    return {
        "period_label": period["label"],
        "period_start": period["start_date"],
        "period_end": period["end_date"],
        "logged_hours": flt(summary.total_hours, 1),
        "billable_hours": flt(summary.billable_hours, 1),
        "active_employees": int(summary.active_employees or 0),
        "active_tasks": int(summary.active_tasks or 0),
        "allocated_hours": capacity.get("demand_hours", 0),
        "capacity_hours": capacity.get("capacity_hours", 0),
    }


def _budget_alerts(limit: int = 6) -> list[dict]:
    if not frappe.get_meta("Project").has_field("custom_burn_budget_amount"):
        return []

    projects = frappe.get_all(
        "Project",
        filters={"status": "Open", "custom_burn_budget_amount": [">", 0]},
        fields=["name", "project_name", "customer", "custom_burn_budget_amount"],
        limit=30,
    )
    alerts = []
    for project in projects:
        try:
            from next_pms.next_pms.utils.budget_burn import get_project_burn_metrics

            metrics = get_project_burn_metrics(project.name)
            comparison = metrics.get("vs_budget") or {}
            utilization_pct = flt(comparison.get("utilization_pct"))
            if utilization_pct >= 80:
                alerts.append(
                    {
                        "project": project.name,
                        "project_name": project.project_name or project.name,
                        "customer": project.customer,
                        "budget_amount": flt(metrics.get("budget_total") or project.custom_burn_budget_amount, 2),
                        "burn_amount": flt(comparison.get("actual"), 2),
                        "utilization_pct": utilization_pct,
                        "currency": metrics.get("currency"),
                    }
                )
        except Exception:
            continue

    alerts.sort(key=lambda item: item["utilization_pct"], reverse=True)
    return alerts[:limit]


def _approval_summary() -> dict:
    try:
        from next_pms.timesheet.api.approval_queue import get_approval_queue_count

        result = get_approval_queue_count()
        return {
            "pending_entries": int(result.get("count") or 0),
            "pending_sheets": int(result.get("sheet_count") or 0),
        }
    except Exception:
        return {"pending_entries": 0, "pending_sheets": 0}


def _allocation_summary() -> dict:
    if not frappe.db.exists("DocType", "Resource Allocation"):
        return {"confirmed": 0, "tentative": 0, "total": 0, "by_status": []}

    rows = frappe.db.sql(
        """
        SELECT status, COUNT(*) AS count
        FROM `tabResource Allocation`
        WHERE status NOT IN ('Cancelled', 'Closed')
          AND allocation_start_date <= %s
          AND (allocation_end_date IS NULL OR allocation_end_date >= %s)
        GROUP BY status
        ORDER BY count DESC
        """,
        (today(), today()),
        as_dict=True,
    )
    by_status = [{"status": row.status or "Not Set", "count": int(row.count or 0)} for row in rows]
    confirmed = sum(row["count"] for row in by_status if row["status"] == "Confirmed")
    tentative = sum(row["count"] for row in by_status if row["status"] == "Tentative")
    return {
        "confirmed": confirmed,
        "tentative": tentative,
        "total": sum(row["count"] for row in by_status),
        "by_status": by_status,
    }


def _timesheet_hours_trend(weeks: int = 8) -> list[dict]:
    period = _current_week_period()
    start = add_days(period["start_date"], -7 * max(weeks - 1, 0))
    periods = build_period_buckets(start, horizon_months=3, period_type="week")[:weeks]
    trend = []
    for bucket in periods:
        summary = frappe.db.sql(
            """
            SELECT
                COALESCE(SUM(td.hours), 0) AS total_hours,
                COALESCE(SUM(CASE WHEN IFNULL(td.is_billable, 0) = 1 THEN td.hours ELSE 0 END), 0) AS billable_hours
            FROM `tabTimesheet Detail` td
            INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
            WHERE ts.start_date <= %s
              AND ts.end_date >= %s
              AND ts.docstatus < 2
            """,
            (bucket["end_date"], bucket["start_date"]),
            as_dict=True,
        )[0]
        logged = flt(summary.total_hours, 1)
        billable = flt(summary.billable_hours, 1)
        trend.append(
            {
                "label": bucket["label"],
                "logged_hours": logged,
                "billable_hours": billable,
                "non_billable_hours": flt(max(logged - billable, 0), 1),
                "billable_ratio": flt((billable / logged * 100) if logged else 0, 1),
            }
        )
    return trend


def _department_utilization(limit: int = 8) -> list[dict]:
    period = _current_week_period()
    periods = [period]
    employees = _get_active_employees()
    if not employees:
        return []

    employee_names = [employee.name for employee in employees]
    allocations = get_allocation_list_for_employee_for_given_range(
        [
            "employee",
            "hours_allocated_per_day",
            "allocation_start_date",
            "allocation_end_date",
        ],
        "employee",
        employee_names,
        period["start_date"],
        period["end_date"],
    )
    allocation_map: dict[str, list] = {}
    for allocation in allocations:
        allocation_map.setdefault(allocation.employee, []).append(allocation)

    rows = build_capacity_demand_rows(employees, allocation_map, periods, group_by="department")
    departments = []
    for row in rows:
        metrics = row.get("periods", {}).get(period["key"], {})
        capacity = flt(metrics.get("capacity_hours"))
        demand = flt(metrics.get("demand_hours"))
        utilization_pct = (demand / capacity * 100) if capacity else 0
        departments.append(
            {
                "department": row.get("label") or "Unassigned",
                "capacity_hours": flt(capacity, 1),
                "demand_hours": flt(demand, 1),
                "utilization_pct": flt(utilization_pct, 1),
            }
        )
    departments.sort(key=lambda item: item["utilization_pct"], reverse=True)
    return departments[:limit]


def _project_status_breakdown() -> dict:
    rows = frappe.db.sql(
        """
        SELECT status, COUNT(*) AS count
        FROM `tabProject`
        GROUP BY status
        ORDER BY count DESC
        """,
        as_dict=True,
    )
    by_status = [{"status": row.status or "Not Set", "count": int(row.count or 0)} for row in rows]
    open_count = frappe.db.count("Project", {"status": "Open"})
    return {"open": open_count, "total": sum(row["count"] for row in by_status), "by_status": by_status}


def _top_projects_by_hours(limit: int = 8) -> list[dict]:
    month_start = get_first_day(today())
    month_end = get_last_day(today())
    rows = frappe.db.sql(
        """
        SELECT
            td.project,
            p.project_name,
            p.customer,
            COALESCE(SUM(td.hours), 0) AS total_hours,
            COALESCE(SUM(CASE WHEN IFNULL(td.is_billable, 0) = 1 THEN td.hours ELSE 0 END), 0) AS billable_hours
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        LEFT JOIN `tabProject` p ON p.name = td.project
        WHERE td.project IS NOT NULL
          AND td.project != ''
          AND ts.start_date <= %s
          AND ts.end_date >= %s
          AND ts.docstatus < 2
        GROUP BY td.project, p.project_name, p.customer
        ORDER BY total_hours DESC
        LIMIT %s
        """,
        (month_end, month_start, limit),
        as_dict=True,
    )
    return [
        {
            "project": row.project,
            "project_name": row.project_name or row.project,
            "customer": row.customer,
            "total_hours": flt(row.total_hours, 1),
            "billable_hours": flt(row.billable_hours, 1),
        }
        for row in rows
    ]


def _overdue_tasks(limit: int = 10) -> list[dict]:
    tasks = frappe.get_all(
        "Task",
        filters={
            "exp_end_date": ["<", today()],
            "status": ["not in", ["Completed", "Cancelled"]],
        },
        fields=["name", "subject", "project", "status", "exp_end_date", "priority"],
        order_by="exp_end_date asc",
        limit=limit,
    )
    return [
        {
            "task": task.name,
            "subject": task.subject or task.name,
            "project": task.project,
            "status": task.status,
            "exp_end_date": str(task.exp_end_date) if task.exp_end_date else None,
            "priority": task.priority,
        }
        for task in tasks
    ]


def _margin_waterfall() -> dict:
    metrics = _margin_metrics()
    revenue = flt(metrics.get("recognized_revenue"), 2)
    cost = flt(metrics.get("incurred_cost"), 2)
    margin = flt(metrics.get("actual_margin"), 2)
    return {
        "currency": metrics.get("currency"),
        "recognized_revenue": revenue,
        "incurred_cost": cost,
        "actual_margin": margin,
        "actual_margin_pct": flt(metrics.get("actual_margin_pct"), 1),
        "planned_margin_pct": flt(metrics.get("planned_margin_pct"), 1),
        "period_start": metrics.get("period_start"),
        "period_end": metrics.get("period_end"),
    }


def _margin_by_project_type(limit: int = 6) -> list[dict]:
    month_start = get_first_day(today())
    month_end = get_last_day(today())
    portfolio = get_portfolio_margin_view(
        {
            "from_date": str(month_start),
            "to_date": str(month_end),
            "group_by": "project_type",
        }
    )
    rows = sorted(
        portfolio.get("rows") or [],
        key=lambda row: flt(row.get("actual_margin")),
        reverse=True,
    )
    return [
        {
            "label": row.get("label"),
            "actual_margin": flt(row.get("actual_margin"), 2),
            "actual_margin_pct": flt(row.get("actual_margin_pct"), 1),
            "recognized_revenue": flt(row.get("recognized_revenue"), 2),
            "project_count": int(row.get("project_count") or 0),
        }
        for row in rows[:limit]
    ]


def _recent_activity(limit: int = 10) -> list[dict]:
    activity: list[dict] = []

    recent_tasks = frappe.get_all(
        "Task",
        fields=["name", "subject", "status", "modified", "project"],
        order_by="modified desc",
        limit=limit,
    )
    for task in recent_tasks:
        activity.append(
            {
                "type": "Task",
                "title": task.subject or task.name,
                "status": task.status,
                "reference": task.name,
                "project": task.project,
                "when": str(task.modified),
            }
        )

    recent_logs = frappe.db.sql(
        """
        SELECT
            td.name,
            td.task,
            td.project,
            td.hours,
            td.modified,
            ts.employee_name
        FROM `tabTimesheet Detail` td
        INNER JOIN `tabTimesheet` ts ON ts.name = td.parent
        ORDER BY td.modified DESC
        LIMIT %s
        """,
        (limit,),
        as_dict=True,
    )
    for log in recent_logs:
        activity.append(
            {
                "type": "Timesheet",
                "title": f"{flt(log.hours, 1)}h logged",
                "status": log.task or log.project or "Time entry",
                "reference": log.name,
                "project": log.project,
                "when": str(log.modified),
                "user": log.employee_name,
            }
        )

    activity.sort(key=lambda item: item.get("when") or "", reverse=True)
    return activity[:limit]


def _build_extra_kpis(visible_tiles: list[str]) -> list[dict]:
    tile_set = set(visible_tiles)
    kpis: list[dict] = []

    tasks = _tasks_overview()
    kpis.append(
        {
            "key": "tasks_open",
            "label": "Open Tasks",
            "value": sum(row["count"] for row in tasks["by_status"] if row["status"] not in {"Completed", "Cancelled"}),
            "route": "/task",
        }
    )
    kpis.append({"key": "tasks_overdue", "label": "Overdue", "value": tasks["overdue"], "route": "/task", "status": "critical" if tasks["overdue"] else "healthy"})

    project_stats = _project_status_breakdown()
    kpis.append({"key": "projects_open", "label": "Open Projects", "value": project_stats["open"], "route": "/project"})

    if tile_set.intersection({"utilization", "bench", "team_active"}):
        capacity = _week_capacity_metrics()
        kpis.append({"key": "capacity_week", "label": "Capacity (wk)", "value": f"{capacity['capacity_hours']}h", "route": "/resource-management/capacity"})
        kpis.append({"key": "demand_week", "label": "Demand (wk)", "value": f"{capacity['demand_hours']}h", "route": "/resource-management/capacity"})

    if tile_set.intersection({"approvals"}):
        approvals = _approval_summary()
        pending = approvals["pending_entries"]
        kpis.append(
            {
                "key": "approvals_pending",
                "label": "Pending Approvals",
                "value": pending,
                "route": "/team/approvals",
                "status": "warning" if pending else "healthy",
            }
        )

    if tile_set.intersection({"margin", "revenue"}):
        margin = _margin_metrics()
        kpis.append(
            {
                "key": "cost_mtd",
                "label": "Cost (MTD)",
                "value": flt(margin.get("incurred_cost"), 2),
                "route": "/project/margins",
            }
        )

    if tile_set.intersection({"ar"}):
        ar = _ar_metrics()
        kpis.append(
            {
                "key": "ar_overdue",
                "label": "Overdue AR",
                "value": flt(ar.get("overdue_amount"), 2),
                "route": "/project/invoicing",
                "status": "warning" if ar.get("overdue_amount") else "healthy",
            }
        )

    if tile_set.intersection({"active_allocations"}):
        allocations = _allocation_summary()
        kpis.append({"key": "allocations_live", "label": "Live Allocations", "value": allocations["total"], "route": "/resource-management/time-allocation"})

    pipeline = _pipeline_metrics()
    kpis.append({"key": "sales_pipeline", "label": "Pipeline Orders", "value": pipeline.get("open_sales_order_count", 0), "route": "/resource-management/capacity"})

    return kpis


MODULE_SHORTCUTS = [
    {"key": "timesheet", "label": "Timesheet", "description": "Log and review team hours", "route": "/timesheet"},
    {"key": "team", "label": "Team", "description": "Team calendar and approvals", "route": "/team"},
    {"key": "task", "label": "Tasks", "description": "Track delivery work", "route": "/task"},
    {"key": "project", "label": "Projects", "description": "Portfolio and project health", "route": "/project"},
    {
        "key": "capacity",
        "label": "Capacity Planning",
        "description": "Demand vs bench forecast",
        "route": "/resource-management/capacity",
    },
    {
        "key": "allocation",
        "label": "Time Allocation",
        "description": "Resource assignments",
        "route": "/resource-management/time-allocation",
    },
    {"key": "margins", "label": "Portfolio Margins", "description": "Revenue and cost analytics", "route": "/project/margins"},
    {"key": "invoicing", "label": "Client Invoicing", "description": "Draft and track invoices", "route": "/project/invoicing"},
]


def build_dashboard_panels(visible_tiles: list[str]) -> dict:
    tile_set = set(visible_tiles)
    panels: dict = {
        "shortcuts": MODULE_SHORTCUTS,
        "extra_kpis": _build_extra_kpis(visible_tiles),
    }

    if tile_set.intersection({"utilization", "bench", "billable_ratio"}):
        panels["utilization_trend"] = _utilization_trend()
        panels["timesheet_week"] = _timesheet_week_summary()
        panels["timesheet_trend"] = _timesheet_hours_trend()
        panels["department_utilization"] = _department_utilization()

    if tile_set.intersection({"utilization", "bench", "pipeline"}):
        panels["capacity_forecast"] = _capacity_forecast()

    if tile_set.intersection({"margin", "revenue"}):
        panels["margin_by_customer"] = _margin_by_customer()
        panels["margin_waterfall"] = _margin_waterfall()
        panels["margin_by_project_type"] = _margin_by_project_type()

    if tile_set.intersection({"ar"}):
        panels["ar_aging"] = _ar_aging_buckets()

    if tile_set.intersection({"client_health", "pipeline"}):
        panels["client_health"] = _client_health_metrics()
        panels["at_risk_projects"] = _at_risk_projects()
        panels["project_status"] = _project_status_breakdown()

    panels["tasks_overview"] = _tasks_overview()
    panels["overdue_tasks"] = _overdue_tasks()
    panels["top_projects_by_hours"] = _top_projects_by_hours()
    panels["recent_activity"] = _recent_activity()

    if tile_set.intersection({"approvals"}):
        panels["approval_summary"] = _approval_summary()

    if tile_set.intersection({"active_allocations", "team_active"}):
        panels["allocation_summary"] = _allocation_summary()

    if tile_set.intersection({"margin", "pipeline", "client_health"}):
        panels["budget_alerts"] = _budget_alerts()

    return panels


def get_executive_dashboard(user: str | None = None) -> dict:
    visible_tiles = get_visible_tiles(user)
    tiles = [build_tile_payload(tile_key) for tile_key in visible_tiles if tile_key in TILE_META]
    return {
        "tiles": tiles,
        "panels": build_dashboard_panels(visible_tiles),
        "available_tiles": [
            {
                "key": key,
                **TILE_META[key],
                "enabled_by_role": key in get_default_tiles_for_user(),
            }
            for key in ALL_TILES
        ],
        "layout": get_saved_layout(user) or {"tiles": visible_tiles, "order": visible_tiles},
        "roles": get_user_roles(),
        "refreshed_at": frappe.utils.now(),
    }
