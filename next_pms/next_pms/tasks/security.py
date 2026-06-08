import frappe

from next_pms.integrations.security.rotation import check_due_rotation


def run_scheduled_key_rotation():
	try:
		check_due_rotation()
	except Exception:
		frappe.log_error(title="Scheduled PMS encryption key rotation failed")
