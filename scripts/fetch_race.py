"""Fetches one race's results, standings, and schedule from Jolpica-F1
and writes it as data/<season>/round-<NN>.json for the site to read.

Usage:
    python scripts/fetch_race.py <season> <round>
    python scripts/fetch_race.py 2026 9

Run this from the repo root. Also updates data/<season>/index.json
(the season manifest the race selector reads) after writing the race file.
"""

import json
import re
import sys
import time
from pathlib import Path

import requests

from circuit_timezones import CIRCUIT_TIMEZONES

API_BASE = "https://api.jolpi.ca/ergast/f1"
REPO_ROOT = Path(__file__).resolve().parent.parent

# Statuses that mean the driver was classified as finishing (even if a lap
# or more down) - NOT a DNF for the Drama Log. Everything else ("Retired",
# "Collision", "Engine", "Gearbox", ...) is a real retirement reason.
LAPPED_PATTERN = re.compile(r"^(Lapped|\+\d+ Laps?)$")


def is_dnf(status: str) -> bool:
    return status != "Finished" and not LAPPED_PATTERN.match(status)


def fetch_json(url: str) -> dict:
    """GETs a URL and parses JSON, being polite to the free API (short
    pause + one retry) since we must not hammer it."""
    for attempt in range(2):
        resp = requests.get(url, timeout=15)
        if resp.status_code == 200:
            return resp.json()
        time.sleep(2)
    resp.raise_for_status()
    return {}


def fetch_race_results(season: int, rnd: int) -> dict:
    data = fetch_json(f"{API_BASE}/{season}/{rnd}/results.json")
    races = data["MRData"]["RaceTable"]["Races"]
    if not races:
        raise ValueError(f"No race found for {season} round {rnd}")
    return races[0]


def fetch_driver_standings(season: int, rnd: int) -> list:
    data = fetch_json(f"{API_BASE}/{season}/{rnd}/driverstandings.json")
    lists = data["MRData"]["StandingsTable"]["StandingsLists"]
    return lists[0]["DriverStandings"] if lists else []


def fetch_constructor_standings(season: int, rnd: int) -> list:
    data = fetch_json(f"{API_BASE}/{season}/{rnd}/constructorstandings.json")
    lists = data["MRData"]["StandingsTable"]["StandingsLists"]
    return lists[0]["ConstructorStandings"] if lists else []


def build_results_list(race: dict) -> list:
    results = []
    for r in race["Results"]:
        driver = r["Driver"]
        constructor = r["Constructor"]
        results.append({
            "position": int(r["position"]) if r["position"].isdigit() else None,
            "positionText": r["positionText"],
            "driverCode": driver.get("code"),
            "driverName": f"{driver['givenName']} {driver['familyName']}",
            "constructor": constructor["name"],
            "grid": int(r["grid"]) if r["grid"].isdigit() else None,
            "laps": int(r["laps"]),
            "status": r["status"],
            "points": float(r["points"]),
        })
    return results


def build_dnf_list(results: list) -> list:
    """The Drama Log: anyone who didn't classify as Finished, with the
    lap they went out on and why (honest reason, straight from the
    official status field - no guessing)."""
    dnfs = []
    for r in results:
        if is_dnf(r["status"]):
            dnfs.append({
                "driverCode": r["driverCode"],
                "driverName": r["driverName"],
                "lap": r["laps"],
                "reason": r["status"],
            })
    return dnfs


def build_standings_list(standings: list, key: str) -> list:
    out = []
    for s in standings:
        entry = {
            "position": int(s["position"]),
            "points": float(s["points"]),
            "wins": int(s["wins"]),
        }
        if key == "driver":
            d = s["Driver"]
            entry["driverCode"] = d.get("code")
            entry["driverName"] = f"{d['givenName']} {d['familyName']}"
            entry["constructor"] = s["Constructors"][0]["name"] if s.get("Constructors") else None
        else:
            entry["constructor"] = s["Constructor"]["name"]
        out.append(entry)
    return out


def assemble_race_json(season: int, rnd: int) -> dict:
    race = fetch_race_results(season, rnd)
    driver_standings = fetch_driver_standings(season, rnd)
    constructor_standings = fetch_constructor_standings(season, rnd)

    results = build_results_list(race)
    circuit_id = race["Circuit"]["circuitId"]

    return {
        "season": season,
        "round": rnd,
        "raceName": race["raceName"],
        "circuitName": race["Circuit"]["circuitName"],
        "circuitTimezone": CIRCUIT_TIMEZONES.get(circuit_id, "UTC"),
        "locality": race["Circuit"]["Location"]["locality"],
        "country": race["Circuit"]["Location"]["country"],
        "date": race["date"],
        "time": race.get("time"),
        "winner": results[0] if results else None,
        "results": results,
        "dnfs": build_dnf_list(results),
        "driverStandings": build_standings_list(driver_standings, "driver"),
        "constructorStandings": build_standings_list(constructor_standings, "constructor"),
        "editors_take": "",
    }


def write_race_json(season: int, rnd: int, race_data: dict) -> Path:
    out_dir = REPO_ROOT / "data" / str(season)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"round-{rnd:02d}.json"
    out_path.write_text(json.dumps(race_data, indent=2, ensure_ascii=False) + "\n")
    return out_path


def main():
    if len(sys.argv) != 3:
        print("Usage: python scripts/fetch_race.py <season> <round>")
        sys.exit(1)

    season = int(sys.argv[1])
    rnd = int(sys.argv[2])

    print(f"Fetching {season} round {rnd} from Jolpica-F1...")
    race_data = assemble_race_json(season, rnd)
    out_path = write_race_json(season, rnd, race_data)
    print(f"Wrote {out_path.relative_to(REPO_ROOT)}")
    print(f"Winner: {race_data['winner']['driverName']} ({race_data['winner']['constructor']})")
    print(f"DNFs: {len(race_data['dnfs'])}")


if __name__ == "__main__":
    main()
