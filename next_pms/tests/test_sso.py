import frappe
from frappe.tests import IntegrationTestCase

from next_pms.integrations.sso.enforcement import sync_sso_only_setting
from next_pms.integrations.sso.jit import provision_user
from next_pms.integrations.sso.presets import get_oidc_preset, get_saml_preset, provider_key
from next_pms.integrations.sso.saml import extract_saml_profile, parse_idp_metadata


class TestSSO(IntegrationTestCase):
	def test_oidc_presets(self):
		google = get_oidc_preset("Google")
		self.assertIn("accounts.google.com", google["authorize_url"])

		azure = get_oidc_preset("Azure AD", "my-tenant-id")
		self.assertIn("my-tenant-id", azure["authorize_url"])
		self.assertIn("graph.microsoft.com", azure["api_endpoint"])

		okta = get_oidc_preset("Okta", "dev-123.okta.com")
		self.assertEqual(okta["base_url"], "https://dev-123.okta.com")
		self.assertIn("/oauth2/v1/authorize", okta["authorize_url"])

		onelogin = get_oidc_preset("OneLogin", "acme")
		self.assertEqual(onelogin["base_url"], "https://acme.onelogin.com")

	def test_saml_attribute_presets(self):
		azure = get_saml_preset("Azure AD")
		self.assertIn("emailaddress", azure["attribute_email"])
		okta = get_saml_preset("Okta")
		self.assertEqual(okta["attribute_email"], "email")

	def test_provider_key_scrub(self):
		self.assertEqual(provider_key("Azure AD Prod"), "azure_ad_prod")

	def test_parse_idp_metadata(self):
		metadata = """<?xml version="1.0"?>
<EntityDescriptor entityID="https://idp.example.com" xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="https://idp.example.com/sso"/>
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>ABC123</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
  </IDPSSODescriptor>
</EntityDescriptor>"""
		parsed = parse_idp_metadata(metadata)
		self.assertEqual(parsed["entity_id"], "https://idp.example.com")
		self.assertEqual(parsed["sso_url"], "https://idp.example.com/sso")
		self.assertEqual(parsed["certificate"], "ABC123")

	def test_extract_saml_profile(self):
		row = type(
			"Row",
			(),
			{
				"vendor": "Okta",
				"attribute_email": "email",
				"attribute_first_name": "firstName",
				"attribute_last_name": "lastName",
			},
		)()
		profile = extract_saml_profile(
			{"email": ["sso.user@example.com"], "firstName": ["Sam"], "lastName": ["User"]},
			None,
			row,
		)
		self.assertEqual(profile["email"], "sso.user@example.com")
		self.assertEqual(profile["first_name"], "Sam")
		self.assertEqual(profile["last_name"], "User")

	def test_sync_sso_only_setting(self):
		original = frappe.get_system_settings("disable_user_pass_login")
		self.addCleanup(frappe.db.set_single_value, "System Settings", "disable_user_pass_login", original)

		sync_sso_only_setting(1)
		self.assertEqual(frappe.get_system_settings("disable_user_pass_login"), 1)
		sync_sso_only_setting(0)
		self.assertEqual(frappe.get_system_settings("disable_user_pass_login"), 0)

	def test_jit_provisioning_creates_user(self):
		email = "jit-sso-user@example.com"
		if frappe.db.exists("User", email):
			frappe.delete_doc("User", email, force=1)

		settings = frappe.get_doc("PMS SSO Settings")
		settings.enable_jit_provisioning = 1
		settings.default_user_type = "System User"
		settings.save(ignore_permissions=True)

		provision_user(
			email,
			{"email": email, "first_name": "JIT", "last_name": "User"},
			"Test Provider",
		)

		self.assertTrue(frappe.db.exists("User", email))
		user = frappe.get_doc("User", email)
		self.assertEqual(user.first_name, "JIT")
		self.assertEqual(user.user_type, "System User")
