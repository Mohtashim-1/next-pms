import frappe
from frappe.tests import IntegrationTestCase

from next_pms.integrations.mfa.policy import mfa_required_for_user
from next_pms.integrations.mfa.recovery import _generate_code, _hash_code, generate_recovery_codes, verify_recovery_code
from next_pms.integrations.mfa.sms import get_login_verification_method, should_use_sms_fallback
from next_pms.integrations.mfa.sync import sync_frappe_two_factor_settings


class TestMFA(IntegrationTestCase):
	def setUp(self):
		self.settings = frappe.get_doc("PMS MFA Settings")
		self._original_mode = self.settings.enforcement_mode
		self._original_roles = [row.role for row in self.settings.enforced_roles or []]

	def tearDown(self):
		self.settings.enforcement_mode = self._original_mode
		self.settings.enforced_roles = [{"role": role} for role in self._original_roles]
		self.settings.save(ignore_permissions=True)

	def test_global_enforcement(self):
		self.settings.enforcement_mode = "Global"
		self.settings.save(ignore_permissions=True)
		self.assertTrue(mfa_required_for_user("next-employee@example.com"))
		self.assertFalse(mfa_required_for_user("Administrator"))

	def test_per_role_enforcement(self):
		self.settings.enforcement_mode = "Per Role"
		self.settings.enforced_roles = []
		self.settings.append("enforced_roles", {"role": "Projects Manager"})
		self.settings.save(ignore_permissions=True)

		self.assertTrue(mfa_required_for_user("next-project-manager@example.com"))
		self.assertFalse(mfa_required_for_user("next-employee@example.com"))

	def test_sync_frappe_two_factor_settings(self):
		original = frappe.get_system_settings("enable_two_factor_auth")
		self.addCleanup(frappe.db.set_single_value, "System Settings", "enable_two_factor_auth", original)

		self.settings.enforcement_mode = "Global"
		sync_frappe_two_factor_settings(self.settings)
		self.assertEqual(frappe.get_system_settings("enable_two_factor_auth"), 1)

		self.settings.enforcement_mode = "Off"
		sync_frappe_two_factor_settings(self.settings)
		self.assertEqual(frappe.get_system_settings("enable_two_factor_auth"), 0)

	def test_recovery_codes_single_use(self):
		user = "next-employee@example.com"
		if frappe.db.exists("PMS User MFA", user):
			frappe.delete_doc("PMS User MFA", user, force=1)

		codes = generate_recovery_codes(user, force=True)
		self.assertEqual(len(codes), int(self.settings.recovery_code_count or 10))
		self.assertTrue(verify_recovery_code(user, codes[0]))
		self.assertFalse(verify_recovery_code(user, codes[0]))

	def test_recovery_code_format(self):
		code = _generate_code()
		self.assertEqual(len(code.split("-")), 4)
		self.assertEqual(len(_hash_code(code)), 64)

	def test_sms_fallback_only_without_primary(self):
		user = "next-employee@example.com"
		self.settings.allow_sms_fallback = 1
		method = get_login_verification_method(user)
		# Without TOTP/WebAuthn enrolled, may fall back to SMS if phone exists
		if should_use_sms_fallback(user):
			self.assertEqual(method, "SMS")
		else:
			self.assertEqual(method, "OTP App")
