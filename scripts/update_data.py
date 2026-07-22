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
from datetime import datetime, timedelta, timezone

import build_manifest
import fetch_race

# Wait this long after a race's scheduled start before fetching it: long enough
# for official results (including post-race penalties) to be finalized, short
# enough to still publish the same evening - matching the brief's "~3 hours
# after each session". A typical race starts ~13:00 UTC and finishes ~15:00, so
# 4h-after-start lands ~2h after the flag. Because we key off the real UTC start
# time (not just the date) and the workflow runs daily, a Sunday race becomes
# eligible on Sunday night - it no longer has to wait for the next weekend.
COMPLETION_BUFFER = timedelta(hours=4)


def race_start_utc(race: dict) -> datetime:
    """A race's scheduled start as an aware UTC datetime. Jolpica gives a date
    plus (usually) a UTC time like '13:00:00Z'; if the time is missing we assume
    end-of-day so we never fetch before the race could have happened."""
    time_str = (race.get("time") or "23:59:00Z").replace("Z", "+00:00")
    dt = datetime.fromisoformat(f"{race['date']}T{time_str}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def completed_rounds(season: int) -> list:
    races = build_manifest.fetch_season_schedule(season)
    now = datetime.now(timezone.utc)
    completed = []
    for race in races:
        if race_start_utc(race) + COMPLETION_BUFFER <= now:
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
