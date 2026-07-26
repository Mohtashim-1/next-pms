frappe.query_reports["Retainer vs Consumed Hours"] = {
	filters: [
		{
			fieldname: "as_of",
			label: __("As Of"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
		{
			fieldname: "customer",
			label: __("Customer"),
			fieldtype: "Link",
			options: "Customer",
		},
	],
};
