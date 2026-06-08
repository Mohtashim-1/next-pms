from datetime import datetime

import frappe
from frappe import _
from frappe.utils import get_datetime, getdate, time_diff_in_hours


def is_midnight(dt: datetime) -> bool:
	return dt.hour == 0 and dt.minute == 0 and dt.second == 0 and dt.microsecond == 0


def uses_time_range(from_time, to_time) -> bool:
	from_dt = get_datetime(from_time)
	to_dt = get_datetime(to_time)
	if not from_dt or not to_dt:
		return False
	return not is_midnight(from_dt) or not is_midnight(to_dt) or from_dt != to_dt


def combine_date_and_time(date_str, time_str):
	date = getdate(date_str)
	if not time_str:
		return get_datetime(date).replace(hour=0, minute=0, second=0, microsecond=0)

	parts = str(time_str).strip().split(":")
	if len(parts) != 2:
		frappe.throw(_("Time must be in HH:MM format."))

	hour = int(parts[0])
	minute = int(parts[1])
	if hour > 23 or minute > 59:
		frappe.throw(_("Invalid time value."))

	return get_datetime(date).replace(hour=hour, minute=minute, second=0, microsecond=0)


def parse_time_value(date_str, value):
	if not value:
		return None

	value = str(value).strip()
	if " " in value or "T" in value:
		return get_datetime(value)

	return combine_date_and_time(date_str, value)


def resolve_time_log_times(date, hours=0, from_time=None, to_time=None, input_mode="duration"):
	if input_mode == "range" and from_time and to_time:
		from_dt = parse_time_value(date, from_time)
		to_dt = parse_time_value(date, to_time)
		if to_dt <= from_dt:
			frappe.throw(_("End time must be after start time."))
		return from_dt, to_dt, time_diff_in_hours(to_dt, from_dt)

	day = getdate(date)
	midnight = get_datetime(day).replace(hour=0, minute=0, second=0, microsecond=0)
	return midnight, midnight, float(hours)


def normalize_time_log_entry(log):
	from_dt = get_datetime(log.from_time)
	to_dt = get_datetime(log.to_time)

	if uses_time_range(log.from_time, log.to_time):
		log.hours = time_diff_in_hours(to_dt, from_dt)
		return

	midnight = from_dt.replace(hour=0, minute=0, second=0, microsecond=0)
	log.from_time = midnight
	log.to_time = midnight
