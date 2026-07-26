frappe.query_reports["Task Burndown"] = {
	filters: [
		{
			fieldname: "project",
			label: __("Project"),
			fieldtype: "Link",
			options: "Project",
		},
		{
			fieldname: "as_of",
			label: __("As Of"),
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
		},
	],
};
