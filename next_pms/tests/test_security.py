import frappe
from frappe.tests import IntegrationTestCase

from next_pms.integrations.security.crypto import (
	ALGORITHM,
	decrypt_aes256_gcm,
	derive_aes256_key,
	encrypt_aes256_gcm,
	fingerprint_key,
)
from next_pms.integrations.security.storage import decrypt_secret, encrypt_secret


class TestSecurity(IntegrationTestCase):
	def test_aes256_gcm_roundtrip(self):
		key = derive_aes256_key("test-master-key-material")
		plaintext = "sensitive-budget-token-12345"
		ciphertext = encrypt_aes256_gcm(plaintext, key)
		self.assertNotEqual(ciphertext, plaintext)
		self.assertEqual(decrypt_aes256_gcm(ciphertext, key), plaintext)

	def test_key_fingerprint(self):
		fp = fingerprint_key("my-customer-key")
		self.assertEqual(len(fp), 64)

	def test_encrypt_secret_storage(self):
		settings = frappe.get_doc("PMS Security Settings")
		settings.enable_aes256_at_rest = 1
		settings.security_tier = "Standard"
		settings.save(ignore_permissions=True)

		owner = "TEST-SECRET-001"
		encrypt_secret("top-secret-value", "Project", owner, "share_token")
		decrypted = decrypt_secret("Project", owner, "share_token")
		self.assertEqual(decrypted, "top-secret-value")

		frappe.db.delete("PMS Encrypted Secret", {
			"owner_doctype": "Project",
			"owner_name": owner,
			"field_key": "share_token",
		})

	def test_algorithm_constant(self):
		self.assertEqual(ALGORITHM, "AES-256-GCM")
