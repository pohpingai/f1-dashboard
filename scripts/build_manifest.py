"""Builds data/<season>/index.json - the season manifest the site's race
selector reads to know which rounds exist and which ones have data yet.

Usage:
    python scripts/build_manifest.py <season>
    python scripts/build_manifest.py 2026

Run this after fetch_race.py, or anytime, to refresh the manifest.
"""

import json
import sys
from pathlib import Path

import requests

from circuit_timezones import CIRCUIT_TIMEZONES

API_BASE = "https://api.jolpi.ca/ergast/f1"
REPO_ROOT = Path(__file__).resolve().parent.parent


def fetch_season_schedule(season: int) -> list:
    resp = requests.get(f"{API_BASE}/{season}.json", timeout=15)
    resp.raise_for_status()
    return resp.json()["MRData"]["RaceTable"]["Races"]


# Maps Jolpica's session field names to the camelCase keys we write out.
SESSION_FIELDS = {
    "FirstPractice": "firstPractice",
    "SecondPractice": "secondPractice",
    "ThirdPractice": "thirdPractice",
    "SprintQualifying": "sprintQualifying",
    "Sprint": "sprint",
    "Qualifying": "qualifying",
}


def build_sessions(race: dict) -> dict:
    """All of a round's session times (UTC), keyed by session name, plus
    the race itself. Sprint weekends have Sprint/SprintQualifying, normal
    weekends don't - only include sessions that are actually present."""
    sessions = {"race": {"date": race["date"], "time": race.get("time")}}
    for src_key, out_key in SESSION_FIELDS.items():
        if src_key in race:
            sessions[out_key] = race[src_key]
    return sessions


def build_manifest(season: int) -> dict:
    races = fetch_season_schedule(season)
    data_dir = REPO_ROOT / "data" / str(season)

    rounds = []
    for race in races:
        rnd = int(race["round"])
        has_data = (data_dir / f"round-{rnd:02d}.json").exists()
        rounds.append({
            "round": rnd,
            "raceName": race["raceName"],
            "circuitName": race["Circuit"]["circuitName"],
            "circuitTimezone": CIRCUIT_TIMEZONES.get(race["Circuit"]["circuitId"], "UTC"),
            "locality": race["Circuit"]["Location"]["locality"],
            "country": race["Circuit"]["Location"]["country"],
            "date": race["date"],
            "time": race.get("time"),
            "sessions": build_sessions(race),
            "hasData": has_data,
        })

    return {"season": season, "rounds": rounds}


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/build_manifest.py <season>")
        sys.exit(1)

    season = int(sys.argv[1])
    manifest = build_manifest(season)

    out_dir = REPO_ROOT / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "index.json"
    out_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    with_data = sum(1 for r in manifest["rounds"] if r["hasData"])
    print(f"Wrote {out_path.relative_to(REPO_ROOT)} ({with_data}/{len(manifest['rounds'])} rounds have data)")


if __name__ == "__main__":
    main()
