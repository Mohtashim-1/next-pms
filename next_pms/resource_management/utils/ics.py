from __future__ import annotations

from datetime import timedelta

import frappe
from frappe.utils import get_datetime, now_datetime


def _format_ics_datetime(date_value: str, is_end: bool = False) -> str:
    date_time = get_datetime(date_value)
    if is_end:
        date_time = date_time + timedelta(days=1)
    return date_time.strftime("%Y%m%dT%H%M%SZ")


def _escape_ics_text(value: str | None) -> str:
    if not value:
        return ""
    return (
        str(value)
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def build_allocations_ics(allocations: list[dict], calendar_name: str = "PMS Assignments") -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Next PMS//Resource Allocations//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape_ics_text(calendar_name)}",
    ]

    now_stamp = now_datetime().strftime("%Y%m%dT%H%M%SZ")

    for allocation in allocations:
        uid = f"{allocation.get('name')}@next-pms"
        summary = allocation.get("project_name") or allocation.get("project") or "Assignment"
        description_parts = [
            f"Hours/Day: {allocation.get('hours_allocated_per_day') or 0}",
            f"Status: {allocation.get('status') or ''}",
            f"Billable: {'Yes' if allocation.get('is_billable') else 'No'}",
        ]
        if allocation.get("note"):
            description_parts.append(str(allocation.get("note")))

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTAMP:{now_stamp}",
                f"DTSTART:{_format_ics_datetime(allocation.get('allocation_start_date'))}",
                f"DTEND:{_format_ics_datetime(allocation.get('allocation_end_date'), is_end=True)}",
                f"SUMMARY:{_escape_ics_text(summary)}",
                f"DESCRIPTION:{_escape_ics_text(' | '.join(description_parts))}",
                "TRANSP:OPAQUE",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
