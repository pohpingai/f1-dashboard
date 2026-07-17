"""Fetches JSON for every completed 2026 round that doesn't have data yet,
then rebuilds the season manifest.

This one script serves two jobs described in CLAUDE.md:
  - the one-time backfill (run once, fetches every past round in one go)
  - the routine "~3 hours after each session" update (run on a schedule;
    it just no-ops on rounds it already has, and picks up whichever race
    has newly finished)

Usage:
    python scripts/update_data.py <season>
    python scripts/update_data.py 2026
"""

import sys
from datetime import date, datetime, timedelta

import build_manifest
import fetch_race

# Give race results a day to be finalized (e.g. post-race penalties) before
# we treat a round as "completed" and fetch it.
COMPLETION_BUFFER = timedelta(days=1)


def completed_rounds(season: int) -> list:
    races = build_manifest.fetch_season_schedule(season)
    today = date.today()
    completed = []
    for race in races:
        race_date = datetime.strptime(race["date"], "%Y-%m-%d").date()
        if race_date + COMPLETION_BUFFER <= today:
            completed.append(int(race["round"]))
    return completed


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/update_data.py <season>")
        sys.exit(1)

    season = int(sys.argv[1])
    data_dir = fetch_race.REPO_ROOT / "data" / str(season)

    fetched = []
    for rnd in completed_rounds(season):
        out_path = data_dir / f"round-{rnd:02d}.json"
        if out_path.exists():
            continue
        print(f"Round {rnd} is missing data, fetching...")
        race_data = fetch_race.assemble_race_json(season, rnd)
        fetch_race.write_race_json(season, rnd, race_data)
        fetched.append(rnd)

    if fetched:
        print(f"Fetched {len(fetched)} round(s): {fetched}")
    else:
        print("No new completed rounds to fetch.")

    manifest = build_manifest.build_manifest(season)
    out_path = fetch_race.REPO_ROOT / "data" / "index.json"
    import json
    out_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"Manifest rebuilt: {out_path.relative_to(fetch_race.REPO_ROOT)}")


if __name__ == "__main__":
    main()
