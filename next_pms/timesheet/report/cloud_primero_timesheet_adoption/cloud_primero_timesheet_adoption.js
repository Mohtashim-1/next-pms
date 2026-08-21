frappe.query_reports["Cloud Primero Timesheet Adoption"] = {
	filters: [
		{
			fieldname: "company",
			label: __("Company"),
			fieldtype: "Link",
			options: "Company",
			default: "Cloud Primero Pvt. Ltd.",
			reqd: 1,
		},
		{
			fieldname: "employee_status",
			label: __("Employee Status"),
			fieldtype: "Select",
			options: "\nActive\nInactive\nSuspended\nLeft",
			default: "Active",
		},
		{
			fieldname: "login_status",
			label: __("Login Status"),
			fieldtype: "Select",
			options:
				"\nNever Logged In\nActive Login (<=7d)\nLogin Stale (8-14d)\nLogin Inactive (>14d)\nNo/Disabled User",
		},
		{
			fieldname: "timesheet_cadence",
			label: __("Timesheet Cadence"),
			fieldtype: "Select",
			options:
				"\nRegular / Daily-ish\nActive This Week\nWeekly-ish (8-14d)\nSporadic (15-30d)\nInactive (>30d)\nNo Timesheets Yet",
		},
		{
			fieldname: "department",
			label: __("Department"),
			fieldtype: "Link",
			options: "Department",
		},
	],
};
