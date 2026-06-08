# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import base64
import hashlib
import os

ALGORITHM = "AES-256-GCM"
NONCE_SIZE = 12


def derive_aes256_key(master_material: str) -> bytes:
	"""Derive a 256-bit AES key from master key material."""
	return hashlib.sha256(master_material.encode("utf-8")).digest()


def fingerprint_key(master_material: str) -> str:
	return hashlib.sha256(master_material.encode("utf-8")).hexdigest()


def encrypt_aes256_gcm(plaintext: str, key: bytes) -> str:
	from cryptography.hazmat.primitives.ciphers.aead import AESGCM

	nonce = os.urandom(NONCE_SIZE)
	aesgcm = AESGCM(key)
	ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
	return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_aes256_gcm(payload: str, key: bytes) -> str:
	from cryptography.hazmat.primitives.ciphers.aead import AESGCM

	raw = base64.b64decode(payload.encode("ascii"))
	nonce, ciphertext = raw[:NONCE_SIZE], raw[NONCE_SIZE:]
	aesgcm = AESGCM(key)
	return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")


def generate_master_key_material() -> str:
	return base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
