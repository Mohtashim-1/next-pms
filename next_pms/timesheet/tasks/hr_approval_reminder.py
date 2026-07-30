import frappe
from frappe import _
from frappe.utils import format_date, get_url


def notify_hr_for_approval(timesheet_name: str, notes: str | None = None):
	"""Email same-company HR after Line Manager approval."""
	frappe.enqueue(
		send_hr_approval_mail,
		timesheet_name=timesheet_name,
		notes=notes,
		queue="short",
		enqueue_after_commit=True,
		job_name=f"hr_approval_reminder::{timesheet_name}",
	)


def send_hr_approval_mail(timesheet_name: str, notes: str | None = None):
	settings = frappe.get_single("Timesheet Settings")
	if not settings.get("send_hr_approval_request"):
		return

	doc = frappe.get_doc("Timesheet", timesheet_name)
	employee = frappe.get_doc("Employee", doc.employee)
	company = employee.company
	if not company:
		return

	recipients = _get_hr_recipients(company=company, settings=settings)
	if not recipients:
		frappe.log_error(
			title=_("HR Approval Reminder skipped"),
			message=_("No HR recipients found for company {0} / timesheet {1}").format(company, timesheet_name),
		)
		return

	template_name = settings.get("hr_approval_reminder_template")
	approval_link = get_url("/next-pms/team/approvals")
	line_manager = None
	if doc.get("custom_timesheet_approver"):
		line_manager = frappe.db.get_value("Employee", doc.custom_timesheet_approver, "employee_name")
	elif doc.get("custom_line_manager_approved_by"):
		line_manager = frappe.db.get_value("User", doc.custom_line_manager_approved_by, "full_name")

	args = {
		"employee": employee,
		"start_date": doc.start_date,
		"end_date": doc.end_date,
		"timesheet": doc,
		"company": company,
		"notes": notes,
		"line_manager": line_manager,
		"approval_link": approval_link,
	}

	if template_name and frappe.db.exists("Email Template", template_name):
		template = frappe.get_doc("Email Template", template_name)
		body = template.response_html if template.use_html else template.response
		subject = frappe.render_template(template.subject or _("HR Approval Required"), args)
		message = frappe.render_template(body or "", args)
	else:
		subject = _("HR approval required: Timesheet for {0}").format(employee.employee_name)
		message = _(
			"{0} has completed Line Manager approval and is awaiting HR approval "
			"for {1} to {2}. <a href=\"{3}\">Open Approval Queue</a>."
		).format(
			employee.employee_name,
			format_date(doc.start_date),
			format_date(doc.end_date),
			approval_link,
		)

	frappe.sendmail(
		recipients=recipients,
		subject=subject,
		message=message,
		reference_doctype="Timesheet",
		reference_name=doc.name,
		delayed=True,
	)


def _get_hr_recipients(company: str, settings) -> list[str]:
	"""Configured HR employees (same company) + Human Resources dept + HR roles."""
	emails: set[str] = set()

	configured_ids = [row.employee for row in (settings.get("hr_approvers") or []) if row.employee]
	if configured_ids:
		for row in frappe.get_all(
			"Employee",
			filters={
				"name": ["in", configured_ids],
				"company": company,
				"status": "Active",
			},
			fields=["user_id", "company_email", "prefered_email", "personal_email"],
		):
			email = _employee_email(row)
			if email:
				emails.add(email)

	hr_departments = frappe.get_all(
		"Department",
		filters={
			"company": company,
			"department_name": "Human Resources",
			"disabled": 0,
		},
		pluck="name",
	)
	if hr_departments:
		for row in frappe.get_all(
			"Employee",
			filters={
				"company": company,
				"department": ["in", hr_departments],
				"status": "Active",
			},
			fields=["user_id", "company_email", "prefered_email", "personal_email"],
		):
			email = _employee_email(row)
			if email:
				emails.add(email)

	# Always include same-company users with HR roles.
	hr_users = frappe.get_all(
		"Has Role",
		filters={"role": ["in", ["HR Manager", "HR User"]], "parenttype": "User"},
		pluck="parent",
	)
	if hr_users:
		for row in frappe.get_all(
			"Employee",
			filters={
				"user_id": ["in", hr_users],
				"company": company,
				"status": "Active",
			},
			fields=["user_id", "company_email", "prefered_email", "personal_email"],
		):
			email = _employee_email(row)
			if email:
				emails.add(email)

	return sorted(emails)


def _employee_email(row) -> str | None:
	if row.get("user_id"):
		user_email = frappe.db.get_value("User", row.user_id, "email")
		if user_email:
			return user_email
	return row.get("company_email") or row.get("prefered_email") or row.get("personal_email")
