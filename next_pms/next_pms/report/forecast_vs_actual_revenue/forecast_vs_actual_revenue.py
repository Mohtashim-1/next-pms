# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

from calendar import monthrange

import frappe
from frappe import _
from frappe.utils import add_months, flt, get_first_day, getdate, today


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Month"), "fieldname": "month", "fieldtype": "Data", "width": 110},
		{"label": _("Forecast (Opportunity)"), "fieldname": "forecast_amount", "fieldtype": "Currency", "width": 160},
		{"label": _("Weighted Forecast"), "fieldname": "weighted_forecast", "fieldtype": "Currency", "width": 150},
		{"label": _("Actual Revenue (SI)"), "fieldname": "actual_revenue", "fieldtype": "Currency", "width": 150},
		{"label": _("Variance"), "fieldname": "variance", "fieldtype": "Currency", "width": 120},
		{"label": _("Attainment %"), "fieldname": "attainment_pct", "fieldtype": "Percent", "width": 110},
		{"label": _("Open Opportunities"), "fieldname": "open_opps", "fieldtype": "Int", "width": 130},
		{"label": _("Invoices Posted"), "fieldname": "invoice_count", "fieldtype": "Int", "width": 120},
	]


def _month_key(d):
	d = getdate(d)
	return f"{d.year}-{d.month:02d}"


def get_data(filters):
	months = int(filters.get("months") or 6)
	company = filters.get("company")
	end = get_first_day(today())
	start = add_months(end, -(months - 1))

	# Build month buckets
	buckets = {}
	cursor = start
	for _ in range(months):
		key = _month_key(cursor)
		buckets[key] = {
			"month": key,
			"forecast_amount": 0.0,
			"weighted_forecast": 0.0,
			"actual_revenue": 0.0,
			"open_opps": 0,
			"invoice_count": 0,
		}
		cursor = add_months(cursor, 1)

	# Forecast from Opportunities expected_closing in range
	opp_filters = {
		"status": ["not in", ["Lost", "Closed"]],
		"expected_closing": ["between", [start, add_months(end, 1)]],
	}
	opps = frappe.get_all(
		"Opportunity",
		filters=opp_filters,
		fields=["name", "opportunity_amount", "probability", "expected_closing", "status", "company"],
		limit=5000,
	)
	for opp in opps:
		if company and opp.get("company") and opp.company != company:
			continue
		if not opp.expected_closing:
			continue
		key = _month_key(opp.expected_closing)
		if key not in buckets:
			continue
		amount = flt(opp.opportunity_amount)
		prob = flt(opp.probability) or 0
		buckets[key]["forecast_amount"] += amount
		buckets[key]["weighted_forecast"] += amount * (prob / 100.0)
		buckets[key]["open_opps"] += 1

	# Actual from submitted Sales Invoices
	si_filters = {
		"docstatus": 1,
		"posting_date": ["between", [start, getdate(f"{end.year}-{end.month:02d}-{monthrange(end.year, end.month)[1]}")]],
		"is_return": 0,
	}
	if company:
		si_filters["company"] = company
	invoices = frappe.get_all(
		"Sales Invoice",
		filters=si_filters,
		fields=["name", "posting_date", "base_grand_total", "grand_total"],
		limit=10000,
	)
	for inv in invoices:
		key = _month_key(inv.posting_date)
		if key not in buckets:
			continue
		buckets[key]["actual_revenue"] += flt(inv.base_grand_total or inv.grand_total)
		buckets[key]["invoice_count"] += 1

	data = []
	for key in sorted(buckets.keys()):
		row = buckets[key]
		forecast = row["weighted_forecast"] or row["forecast_amount"]
		variance = row["actual_revenue"] - forecast
		attainment = (row["actual_revenue"] / forecast * 100.0) if forecast else 0
		data.append(
			{
				"month": row["month"],
				"forecast_amount": flt(row["forecast_amount"], 2),
				"weighted_forecast": flt(row["weighted_forecast"], 2),
				"actual_revenue": flt(row["actual_revenue"], 2),
				"variance": flt(variance, 2),
				"attainment_pct": flt(attainment, 1),
				"open_opps": row["open_opps"],
				"invoice_count": row["invoice_count"],
			}
		)
	return data
