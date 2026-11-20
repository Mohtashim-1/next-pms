"""Daily EUR <-> USD Currency Exchange sync (skips weekends / bank holidays)."""

from __future__ import annotations

import frappe
import requests
from frappe.utils import add_days, flt, getdate, today

CURRENCY_PAIRS = (("EUR", "USD"), ("USD", "EUR"))
FRANKFURTER_URL = "https://api.frankfurter.dev/v1/{date}"


def sync_daily_eur_usd_rates(for_dates: list[str] | None = None):
    """
    Create Currency Exchange records for EUR/USD pairs.

    Runs daily via scheduler. Skips dates with no published ECB rate
    (weekends and bank holidays). Pass for_dates to backfill specific days.
    """
    dates = for_dates or [today()]
    created = []

    for date in dates:
        date = str(getdate(date))
        try:
            created.extend(_sync_for_date(date))
        except Exception:
            frappe.log_error(
                title=f"Currency exchange sync failed for {date}",
                message=frappe.get_traceback(),
            )

    return created


def sync_today_and_yesterday():
    """Backfill helper: sync today and yesterday."""
    return sync_daily_eur_usd_rates([today(), add_days(today(), -1)])


def _sync_for_date(date: str) -> list[str]:
    created = []
    for from_currency, to_currency in CURRENCY_PAIRS:
        rate, published_date = _fetch_frankfurter_rate(from_currency, to_currency, date)
        if not rate:
            continue

        # ECB publishes only on business days — skip holidays/weekends
        if str(getdate(published_date)) != str(getdate(date)):
            frappe.logger("currency_exchange_sync").info(
                f"Skipping {date} for {from_currency}->{to_currency}: "
                f"no published rate (nearest {published_date})"
            )
            continue

        name = _upsert_currency_exchange(date, from_currency, to_currency, rate)
        if name:
            created.append(name)

    return created


def _fetch_frankfurter_rate(from_currency: str, to_currency: str, date: str) -> tuple[float | None, str | None]:
    url = FRANKFURTER_URL.format(date=date)
    response = requests.get(
        url,
        params={"base": from_currency, "symbols": to_currency},
        timeout=15,
    )
    response.raise_for_status()
    payload = response.json()
    rate = payload.get("rates", {}).get(to_currency)
    return (flt(rate) if rate is not None else None, payload.get("date"))


def _upsert_currency_exchange(date: str, from_currency: str, to_currency: str, rate: float) -> str | None:
    existing = frappe.db.get_value(
        "Currency Exchange",
        {
            "date": date,
            "from_currency": from_currency,
            "to_currency": to_currency,
            "for_buying": 1,
            "for_selling": 1,
        },
        ["name", "exchange_rate"],
        as_dict=True,
    )

    if existing:
        if flt(existing.exchange_rate) != flt(rate):
            frappe.db.set_value("Currency Exchange", existing.name, "exchange_rate", flt(rate))
        return existing.name

    doc = frappe.get_doc(
        {
            "doctype": "Currency Exchange",
            "date": date,
            "from_currency": from_currency,
            "to_currency": to_currency,
            "exchange_rate": flt(rate),
            "for_buying": 1,
            "for_selling": 1,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name
