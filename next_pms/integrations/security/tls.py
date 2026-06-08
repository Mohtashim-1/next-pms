# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import get_url, now_datetime


def get_request_tls_version() -> str | None:
	"""Best-effort TLS version from reverse-proxy headers."""
	headers = frappe.local.request.headers if frappe.local.request else {}
	for header in ("X-SSL-Protocol", "SSL-Protocol", "X-TLS-Version", "X-Forwarded-Ssl-Protocol"):
		value = headers.get(header)
		if value:
			return value.strip()
	return None


def is_secure_request() -> bool:
	if not frappe.local.request:
		return True
	if frappe.local.request.scheme == "https":
		return True
	if frappe.get_request_header("X-Forwarded-Proto") == "https":
		return True
	return bool(frappe.conf.developer_mode)


def enforce_transit_security():
	if not getattr(frappe.local, "request", None):
		return
	if not frappe.db.exists("DocType", "PMS Security Settings"):
		return

	settings = frappe.get_single("PMS Security Settings")
	if not settings.enforce_https and not settings.require_tls_13:
		return

	if settings.enforce_https and not is_secure_request():
		if _is_local_host():
			return
		target = get_url(frappe.local.request.path, https=1)
		frappe.local.response["type"] = "redirect"
		frappe.local.response["location"] = target
		frappe.local.flags.redirect_location = target
		raise frappe.Redirect

	if settings.require_tls_13:
		tls_version = get_request_tls_version()
		if tls_version and not tls_version.upper().startswith("TLSV1.3"):
			frappe.throw(
				_("This site requires TLS 1.3. Detected: {0}").format(tls_version),
				frappe.AuthenticationError,
			)


def apply_security_headers(response=None):
	if response is None or not frappe.db.exists("DocType", "PMS Security Settings"):
		return

	settings = frappe.get_single("PMS Security Settings")
	if not settings.enforce_https:
		return

	max_age = int(settings.hsts_max_age_seconds or 31536000)
	response.headers["Strict-Transport-Security"] = f"max-age={max_age}; includeSubDomains"
	response.headers["X-Content-Type-Options"] = "nosniff"
	response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"


def probe_external_tls(host: str | None = None, port: int = 443) -> dict:
	import socket
	import ssl

	host = host or frappe.local.site
	result = {"host": host, "checked_on": now_datetime(), "tls_version": None, "tls_13": False, "error": None}
	try:
		context = ssl.create_default_context()
		with socket.create_connection((host, port), timeout=8) as sock:
			with context.wrap_socket(sock, server_hostname=host) as ssock:
				result["tls_version"] = ssock.version()
				result["tls_13"] = ssock.version() == "TLSv1.3"
	except Exception as exc:
		result["error"] = str(exc)

	frappe.db.set_single_value(
		"PMS Security Settings",
		{
			"last_tls_check_on": now_datetime(),
			"last_tls_version": result.get("tls_version") or result.get("error"),
		},
	)
	return result


def _is_local_host() -> bool:
	host = (frappe.local.request.host or "").split(":")[0]
	return host in {"localhost", "127.0.0.1", "0.0.0.0"}
