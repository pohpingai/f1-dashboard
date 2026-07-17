"""Maps each 2026 circuitId (from Jolpica-F1) to its IANA timezone.

Used so the site can show session times in both "track local time" and
Malaysia time (MYT) without a paid geocoding API - this is a fixed lookup
table since the calendar's circuits are known ahead of time.
"""

CIRCUIT_TIMEZONES = {
    "albert_park": "Australia/Melbourne",
    "shanghai": "Asia/Shanghai",
    "suzuka": "Asia/Tokyo",
    "miami": "America/New_York",
    "villeneuve": "America/Toronto",
    "monaco": "Europe/Monaco",
    "catalunya": "Europe/Madrid",
    "red_bull_ring": "Europe/Vienna",
    "silverstone": "Europe/London",
    "spa": "Europe/Brussels",
    "hungaroring": "Europe/Budapest",
    "zandvoort": "Europe/Amsterdam",
    "monza": "Europe/Rome",
    "madring": "Europe/Madrid",
    "baku": "Asia/Baku",
    "marina_bay": "Asia/Singapore",
    "americas": "America/Chicago",
    "rodriguez": "America/Mexico_City",
    "interlagos": "America/Sao_Paulo",
    "vegas": "America/Los_Angeles",
    "losail": "Asia/Qatar",
    "yas_marina": "Asia/Dubai",
}
