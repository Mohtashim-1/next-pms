# Copyright (c) 2026, Next PMS and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import date_diff, flt, getdate, today


def execute(filters=None):
	filters = frappe._dict(filters or {})
	return get_columns(), get_data(filters)


def get_columns():
	return [
		{"label": _("Contract"), "fieldname": "contract", "fieldtype": "Link", "options": "Contract", "width": 140},
		{"label": _("Client"), "fieldname": "party_name", "fieldtype": "Data", "width": 160},
		{"label": _("Project"), "fieldname": "project", "fieldtype": "Link", "options": "Project", "width": 130},
		{"label": _("Start"), "fieldname": "start_date", "fieldtype": "Date", "width": 100},
		{"label": _("End"), "fieldname": "end_date", "fieldtype": "Date", "width": 100},
		{"label": _("Min Weekly Hours"), "fieldname": "min_weekly_hours", "fieldtype": "Float", "width": 130},
		{"label": _("Retainer Hours (Period)"), "fieldname": "retainer_hours", "fieldtype": "Float", "width": 150},
		{"label": _("Consumed Hours"), "fieldname": "consumed_hours", "fieldtype": "Float", "width": 130},
		{"label": _("Billable Consumed"), "fieldname": "billable_hours", "fieldtype": "Float", "width": 130},
		{"label": _("Variance Hours"), "fieldname": "variance_hours", "fieldtype": "Float", "width": 120},
		{"label": _("Utilization %"), "fieldname": "utilization_pct", "fieldtype": "Percent", "width": 110},
		{"label": _("Hourly Rate"), "fieldname": "hourly_rate", "fieldtype": "Currency", "width": 110},
		{"label": _("Est. Consumed Value"), "fieldname": "consumed_value", "fieldtype": "Currency", "width": 140},
	]


def get_data(filters):
	as_of = getdate(filters.get("as_of") or today())
	customer = filters.get("customer")

	contracts = frappe.get_all(
		"Contract",
		filters={"docstatus": ["<", 2], "status": ["not in", ["Inactive", "Cancelled", "Closed"]]},
		fields=[
			"name",
			"party_name",
			"party_full_name",
			"project",
			"start_date",
			"end_date",
			"custom_minimum_weekly_hours",
			"custom_hourly_rate",
			"custom_commencement_date",
		],
		limit=2000,
	)
	if customer:
		contracts = [c for c in contracts if (c.party_name or "") == customer]

	data = []
	for contract in contracts:
		min_weekly = flt(contract.custom_minimum_weekly_hours)
		if min_weekly <= 0:
			continue

		start = getdate(contract.custom_commencement_date or contract.start_date or as_of)
		end = getdate(contract.end_date or as_of)
		period_end = min(end, as_of)
		if period_end < start:
			continue
		weeks = max(date_diff(period_end, start) / 7.0, 0)
		retainer_hours = weeks * min_weekly

		project = contract.project
		# Also gather projects linked via custom_projects text if present
		consumed = 0.0
		billable = 0.0
		if project:
			row = frappe.db.sql(
				"""
				SELECT
					SUM(td.hours) AS hours,
					SUM(CASE WHEN IFNULL(td.is_billable,0)=1 THEN td.hours ELSE 0 END) AS billable
				FROM `tabTimesheet Detail` td
				INNER JOIN `tabTimesheet` t ON t.name = td.parent
				WHERE t.docstatus < 2
				  AND td.project = %(project)s
				  AND DATE(td.from_time) BETWEEN %(start)s AND %(end)s
				""",
				{"project": project, "start": start, "end": period_end},
				as_dict=True,
			)
			if row:
				consumed = flt(row[0].hours)
				billable = flt(row[0].billable)

		variance = consumed - retainer_hours
		util = (consumed / retainer_hours * 100.0) if retainer_hours else 0
		rate = flt(contract.custom_hourly_rate)

		data.append(
			{
				"contract": contract.name,
				"party_name": contract.party_full_name or contract.party_name,
				"project": project,
				"start_date": start,
				"end_date": end,
				"min_weekly_hours": flt(min_weekly, 2),
				"retainer_hours": flt(retainer_hours, 2),
				"consumed_hours": flt(consumed, 2),
				"billable_hours": flt(billable, 2),
				"variance_hours": flt(variance, 2),
				"utilization_pct": flt(util, 1),
				"hourly_rate": rate,
				"consumed_value": flt(billable * rate, 2),
			}
		)

	data.sort(key=lambda r: -abs(r["variance_hours"]))
	return data
