"""Fetches lap-by-lap timing and pit data from OpenF1 and turns it into the
two Milestone 3 modules: the Gap Trace and the Rejoin Strip.

Why OpenF1 (and not Jolpica) for this: Jolpica gives us the finishing order,
but only OpenF1 publishes per-lap timestamps (`/v1/laps`) and pit-lane events
(`/v1/pit`). Everything here is computed from *actual* post-race lap data - we
have hindsight, so we never project or estimate where a car "would" be.

Important operational note: OpenF1's free tier LOCKS the whole API (even old
data) whenever a live session is running on track, to push heavy users onto a
paid key. Our pipeline runs ~3 hours after a session, by which point the lock
is gone - but to be safe, every function here degrades gracefully: if OpenF1
is unreachable or locked, we return blocks marked unavailable and the rest of
the race JSON (results, standings, drama log) is unaffected.

Raw responses are cached under .cache/openf1/ (git-ignored) so re-running the
maths offline never hits the API again - polite to the free service, and handy
for development while the live lock is on.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

import requests

OPENF1_BASE = "https://api.openf1.org/v1"
REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / ".cache" / "openf1"

# Rejoin flag thresholds (seconds), straight from the brief.
DIRTY_AIR_AHEAD = 2.0     # rival 0-2s ahead at rejoin -> stuck in dirty air
REJOIN_CLASH_BEHIND = 1.5  # rival 0-1.5s behind at rejoin -> under immediate threat


class OpenF1Locked(Exception):
    """Raised when OpenF1 returns its 'live session in progress' 401 lock."""


def _cache_path(cache_key: str) -> Path:
    return CACHE_DIR / f"{cache_key}.json"


def openf1_get(endpoint: str, params: dict, cache_key: str) -> list:
    """GET one OpenF1 endpoint, caching the raw JSON to disk. Being polite to
    the free API: serve from cache when we can, otherwise one gentle retry."""
    cached = _cache_path(cache_key)
    if cached.exists():
        return json.loads(cached.read_text())

    url = f"{OPENF1_BASE}/{endpoint}"
    last_status = None
    for attempt in range(2):
        resp = requests.get(url, params=params, timeout=30)
        last_status = resp.status_code
        if resp.status_code == 200:
            data = resp.json()
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cached.write_text(json.dumps(data))
            return data
        if resp.status_code == 401 and "session in progress" in resp.text.lower():
            raise OpenF1Locked(
                "OpenF1 is locked because a live F1 session is in progress; "
                "historical data returns once the session ends."
            )
        time.sleep(2)
    raise RuntimeError(f"OpenF1 {endpoint} failed (HTTP {last_status})")


def parse_ts(value: str) -> float | None:
    """OpenF1 timestamps look like '2026-07-05T14:03:12.345000+00:00'. Return
    epoch seconds as a float, or None if missing/unparseable."""
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def find_race_session(season: int, race_date: str) -> dict | None:
    """Match a Jolpica race to the OpenF1 'Race' session so we get the right
    session_key. We match on calendar date, but tolerate a 1-day slip: OpenF1
    dates are UTC while Jolpica's is the track-local date, and a late-night race
    (e.g. Las Vegas) can straddle midnight UTC. Closest date wins."""
    sessions = openf1_get(
        "sessions",
        {"year": season, "session_name": "Race"},
        cache_key=f"sessions-{season}",
    )
    target = datetime.strptime(race_date, "%Y-%m-%d").date()
    best, best_diff = None, None
    for s in sessions:
        start = s.get("date_start", "")[:10]
        if not start:
            continue
        try:
            diff = abs((datetime.strptime(start, "%Y-%m-%d").date() - target).days)
        except ValueError:
            continue
        if diff <= 1 and (best_diff is None or diff < best_diff):
            best, best_diff = s, diff
    return best


def _driver_number_to_code(drivers: list) -> dict:
    """OpenF1's name_acronym (e.g. 'VER') matches Jolpica's driver code, so we
    key all timing data by code to stay consistent with the rest of the JSON."""
    mapping = {}
    for d in drivers:
        num = d.get("driver_number")
        code = d.get("name_acronym")
        if num is not None and code:
            mapping[num] = code
    return mapping


def _laps_by_driver(laps: list) -> dict:
    """Nest raw lap rows as {driver_number: {lap_number: row}} for easy lookup."""
    by_driver: dict = {}
    for lap in laps:
        num = lap.get("driver_number")
        ln = lap.get("lap_number")
        if num is None or ln is None:
            continue
        by_driver.setdefault(num, {})[ln] = lap
    return by_driver


def _crossing_epoch(driver_laps: dict, lap_number: int) -> float | None:
    """Absolute time (epoch seconds) at which a driver crossed the line to
    COMPLETE the given lap. Preferred source is the start of the next lap
    (that crossing is the same event); we fall back to this lap's start plus
    its duration when there is no next lap (e.g. the final lap)."""
    nxt = driver_laps.get(lap_number + 1)
    if nxt:
        t = parse_ts(nxt.get("date_start"))
        if t is not None:
            return t
    cur = driver_laps.get(lap_number)
    if cur:
        start = parse_ts(cur.get("date_start"))
        dur = cur.get("lap_duration")
        if start is not None and dur is not None:
            return start + dur
    return None


def build_gap_trace(laps_by_driver: dict, num_to_code: dict,
                    code_to_constructor: dict, pit_laps_by_code: dict) -> dict:
    """Per-driver timeline of when they crossed the line each lap, expressed as
    seconds since the race's first crossing (t0). The browser draws the gap
    between any two drivers at lap L as simply A.t(L) - B.t(L)."""
    # t0 = earliest crossing in the race (~race start), so stored numbers stay
    # small. It cancels out of any driver-vs-driver subtraction anyway.
    all_epochs = []
    for driver_laps in laps_by_driver.values():
        for ln in driver_laps:
            e = _crossing_epoch(driver_laps, ln)
            if e is not None:
                all_epochs.append(e)
    if not all_epochs:
        return {"available": False}
    t0 = min(all_epochs)

    drivers_out = []
    for num, driver_laps in laps_by_driver.items():
        code = num_to_code.get(num)
        if not code:
            continue
        points = []
        for ln in sorted(driver_laps):
            e = _crossing_epoch(driver_laps, ln)
            if e is not None:
                points.append({"lap": ln, "t": round(e - t0, 3)})
        if not points:
            continue
        drivers_out.append({
            "code": code,
            "constructor": code_to_constructor.get(code),
            "pitLaps": sorted(pit_laps_by_code.get(code, [])),
            "laps": points,
        })

    drivers_out.sort(key=lambda d: d["code"])
    if not drivers_out:
        return {"available": False}
    return {"available": True, "drivers": drivers_out}


def _rejoin_flag(ahead_gap: float | None, behind_gap: float | None) -> str:
    """A car right behind at rejoin (a threat) is the spicier story, so it wins
    over dirty air when both apply."""
    if behind_gap is not None and behind_gap <= REJOIN_CLASH_BEHIND:
        return "Rejoin clash"
    if ahead_gap is not None and ahead_gap <= DIRTY_AIR_AHEAD:
        return "Dirty air"
    return "Clean air"


def _rejoin_take(flag: str, ahead: dict | None, behind: dict | None) -> str:
    """Deterministic one-liner - no LLM, per project rules."""
    if flag == "Rejoin clash" and behind:
        return (f"Rejoined only {behind['gap']:.1f}s ahead of {behind['code']} "
                f"— right in the firing line.")
    if flag == "Dirty air" and ahead:
        return (f"Dropped into {ahead['code']}'s dirty air, {ahead['gap']:.1f}s "
                f"behind — hard to follow, harder to pass.")
    if ahead:
        return f"Clean air out of the box — nearest car {ahead['gap']:.1f}s up the road."
    return "Clean air out of the box — track clear ahead."


def build_rejoin_strip(laps_by_driver: dict, pits: list, num_to_code: dict,
                       code_to_constructor: dict) -> dict:
    """For each pit stop, use the first full lap AFTER the stop to read - from
    real data - which cars the driver rejoined among, and how close they were.

    'Rejoin' happens mid out-lap, which lap-granularity data can't pinpoint; so
    we measure at the driver's first green crossing after the stop (the end of
    the out-lap). That is the earliest honest, comparable datapoint we have, and
    it is labelled as such on the site."""
    # A global, time-sorted list of every line crossing. Two crossings adjacent
    # in time are cars physically adjacent on track at that line - exactly the
    # dirty-air / clash signal we want.
    events = []  # (epoch, code, lap)
    for num, driver_laps in laps_by_driver.items():
        code = num_to_code.get(num)
        if not code:
            continue
        for ln in driver_laps:
            e = _crossing_epoch(driver_laps, ln)
            if e is not None:
                events.append((e, code, ln))
    events.sort(key=lambda x: x[0])

    stops = []
    for pit in pits:
        num = pit.get("driver_number")
        in_lap = pit.get("lap_number")
        code = num_to_code.get(num)
        if code is None or in_lap is None:
            continue
        out_lap = in_lap + 1
        driver_laps = laps_by_driver.get(num, {})
        rejoin_t = _crossing_epoch(driver_laps, out_lap)
        if rejoin_t is None:
            continue

        # Find this driver's own out-lap crossing event, then its temporal
        # neighbours (skip any other crossing by the same driver).
        idx = next((i for i, ev in enumerate(events)
                    if ev[1] == code and ev[2] == out_lap), None)
        ahead = behind = None
        if idx is not None:
            for j in range(idx - 1, -1, -1):
                if events[j][1] != code:
                    ahead = {"code": events[j][1],
                             "gap": round(events[idx][0] - events[j][0], 3)}
                    break
            for j in range(idx + 1, len(events)):
                if events[j][1] != code:
                    behind = {"code": events[j][1],
                              "gap": round(events[j][0] - events[idx][0], 3)}
                    break

        ahead_gap = ahead["gap"] if ahead else None
        behind_gap = behind["gap"] if behind else None
        flag = _rejoin_flag(ahead_gap, behind_gap)
        stops.append({
            "driverCode": code,
            "constructor": code_to_constructor.get(code),
            "inLap": in_lap,
            "outLap": out_lap,
            "pitLaneSeconds": (round(pit["pit_duration"], 1)
                               if pit.get("pit_duration") is not None else None),
            "ahead": ahead,
            "behind": behind,
            "flag": flag,
            "take": _rejoin_take(flag, ahead, behind),
        })

    stops.sort(key=lambda s: (s["driverCode"], s["inLap"]))
    if not stops:
        return {"available": False}
    return {"available": True, "stops": stops}


def build_timing_blocks(season: int, race_date: str, results: list) -> dict:
    """Top-level entry: returns {"gapTrace": ..., "rejoinStrip": ...}. Any
    failure (lock, no session, network) degrades to unavailable blocks rather
    than breaking the race JSON."""
    unavailable = {
        "gapTrace": {"available": False},
        "rejoinStrip": {"available": False},
    }
    try:
        session = find_race_session(season, race_date)
        if not session:
            print(f"  OpenF1: no Race session matched {race_date}; skipping timing.")
            return unavailable
        key = session["session_key"]

        laps = openf1_get("laps", {"session_key": key}, cache_key=f"laps-{key}")
        pits = openf1_get("pit", {"session_key": key}, cache_key=f"pit-{key}")
        drivers = openf1_get("drivers", {"session_key": key}, cache_key=f"drivers-{key}")
    except OpenF1Locked as e:
        print(f"  OpenF1 locked: {e}")
        return unavailable
    except (requests.RequestException, RuntimeError, KeyError) as e:
        print(f"  OpenF1 timing unavailable ({e}); writing race without it.")
        return unavailable

    num_to_code = _driver_number_to_code(drivers)
    code_to_constructor = {r["driverCode"]: r["constructor"]
                           for r in results if r.get("driverCode")}
    laps_by_driver = _laps_by_driver(laps)

    pit_laps_by_code: dict = {}
    for pit in pits:
        code = num_to_code.get(pit.get("driver_number"))
        if code and pit.get("lap_number") is not None:
            pit_laps_by_code.setdefault(code, []).append(pit["lap_number"])

    return {
        "gapTrace": build_gap_trace(laps_by_driver, num_to_code,
                                    code_to_constructor, pit_laps_by_code),
        "rejoinStrip": build_rejoin_strip(laps_by_driver, pits, num_to_code,
                                          code_to_constructor),
    }
