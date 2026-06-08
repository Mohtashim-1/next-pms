from __future__ import annotations

import json

import frappe
from erpnext import get_default_company
from frappe.utils import flt, get_first_day, get_last_day, getdate, nowdate, today

from next_pms.next_pms.utils.margin_analytics import get_portfolio_margin_view
from next_pms.resource_management.api.utils.query import get_allocation_list_for_employee_for_given_range
from next_pms.resource_management.utils.capacity_demand import build_capacity_demand_rows, build_period_buckets
from next_pms.timesheet.api import filter_employees
from next_pms.timesheet.api.team import get_week_dates
from next_pms.utils.employee import convert_currency

DASHBOARD_ROUTE = "/dashboard"
ALL_TILES = ("utilization", "bench", "pipeline", "margin", "ar", "client_health")

ROLE_TILE_DEFAULTS: dict[str, list[str]] = {
    "Administrator": list(ALL_TILES),
    "Projects Manager": list(ALL_TILES),
    "Accounts Manager": ["margin", "ar", "pipeline", "client_health"],
    "Timesheet Manager": ["utilization", "bench", "pipeline", "client_health"],
    "Projects User": ["utilization", "pipeline", "client_health"],
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
        return [tile for tile in saved["tiles"] if tile in allowed and tile in ALL_TILES]
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
    week = get_week_dates(ignore_weekend=True)
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


def get_executive_dashboard(user: str | None = None) -> dict:
    visible_tiles = get_visible_tiles(user)
    tiles = [build_tile_payload(tile_key) for tile_key in visible_tiles if tile_key in TILE_META]
    return {
        "tiles": tiles,
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
