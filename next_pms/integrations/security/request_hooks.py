# Copyright (c) 2026, rtCamp and contributors
# For license information, please see license.txt

import frappe

from next_pms.integrations.security.tls import apply_security_headers, enforce_transit_security


def before_request():
	enforce_transit_security()


def after_request(response=None, request=None):
	if response is not None:
		apply_security_headers(response)
