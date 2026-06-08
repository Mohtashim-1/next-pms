from __future__ import annotations

import csv
import io
from typing import Any

import frappe


def slug_doctype(doctype: str) -> str:
    return doctype.lower().replace(" ", "-")


def can_read_document(doctype: str | None, name: str | None) -> bool:
    if not doctype or not name:
        return False
    if not frappe.db.exists(doctype, name):
        return False
    return bool(frappe.has_permission(doctype, "read", doc=name))


def apply_record_permissions(records: list[dict]) -> list[dict]:
    enriched: list[dict] = []
    for record in records:
        doctype = record.get("reference_doctype")
        name = record.get("reference_name")
        can_read = can_read_document(doctype, name)
        enriched.append(
            {
                **record,
                "can_read": can_read,
                "link": f"/app/{slug_doctype(doctype)}/{name}" if can_read and doctype and name else None,
            }
        )
    return enriched


def filter_readable_records(records: list[dict]) -> list[dict]:
    return [record for record in apply_record_permissions(records) if record.get("can_read")]


def format_filter_chips(filters: dict | None, labels: dict[str, str] | None = None) -> list[dict]:
    labels = labels or {}
    chips: list[dict] = []
    for key, value in (filters or {}).items():
        if value in (None, "", [], {}):
            continue
        if isinstance(value, (list, tuple)):
            if not value:
                continue
            display = ", ".join(str(item) for item in value)
        else:
            display = str(value)
        chips.append({"key": key, "label": labels.get(key, key.replace("_", " ").title()), "value": display})
    return chips


def records_to_csv(records: list[dict], columns: list[dict]) -> str:
    buffer = io.StringIO()
    fieldnames = [column["key"] for column in columns]
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for record in records:
        row = {column["key"]: record.get(column["key"], "") for column in columns}
        writer.writerow(row)
    return buffer.getvalue()


def build_drilldown_payload(
    *,
    view: str,
    filters: dict,
    filter_labels: dict[str, str] | None,
    context: dict,
    records: list[dict],
    columns: list[dict],
    summary: dict | None = None,
    apply_permissions: bool = True,
) -> dict:
    visible_records = apply_record_permissions(records) if apply_permissions else records
    return {
        "view": view,
        "filters": filters,
        "filter_chips": format_filter_chips(filters, filter_labels),
        "context": context,
        "records": visible_records,
        "columns": columns,
        "summary": summary or {},
        "record_count": len(visible_records),
        "readable_count": len([record for record in visible_records if record.get("can_read")]),
    }


def set_csv_download_response(csv_content: str, filename: str) -> None:
    frappe.response["filename"] = filename
    frappe.response["filecontent"] = csv_content
    frappe.response["type"] = "download"
