frappe.query_reports["Forecast vs Actual Revenue"] = {
	filters: [
		{
			fieldname: "months",
			label: __("Months"),
			fieldtype: "Int",
			default: 6,
			reqd: 1,
		},
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
		},
	],
};
