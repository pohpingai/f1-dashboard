// Landing page logic. Only ever fetches pre-computed static JSON files
// written by the GitHub Actions pipeline - no client-side API calls,
// no computation that isn't just formatting/display.

const SEASON = 2026;
const MYT_ZONE = "Asia/Kuala_Lumpur";

const SESSION_ORDER = [
  ["firstPractice", "Practice 1"],
  ["sprintQualifying", "Sprint Qualifying"],
  ["sprint", "Sprint"],
  ["secondPractice", "Practice 2"],
  ["thirdPractice", "Practice 3"],
  ["qualifying", "Qualifying"],
  ["race", "Race"],
];

let manifest = null;

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

function formatSessionTime(date, time, timeZone) {
  if (!date || !time) return null;
  const dt = new Date(`${date}T${time}`);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(dt);
  return formatted;
}

function renderWinnerHero(race) {
  const el = document.getElementById("winner-hero");
  if (!race.winner) {
    el.innerHTML = "<p>No result data for this round yet.</p>";
    return;
  }
  const w = race.winner;
  el.style.borderLeftColor = teamColor(w.constructor);
  el.innerHTML = `
    <div class="winner-meta">${race.raceName} &middot; ${race.circuitName}</div>
    <div class="winner-name">🏆 ${w.driverName}</div>
    <div class="winner-meta">${w.constructor} &middot; Started P${w.grid} &middot; ${w.laps} laps</div>
  `;
}

function renderStandingsList(container, entries, topN) {
  const makeItem = (s) => `
    <li>
      <span class="pos">${s.position ?? "-"}</span>
      <span class="team-swatch" style="background:${teamColor(s.constructor)}"></span>
      <span class="name">${s.driverName ?? s.constructor}</span>
      <span class="points">${s.points} pts</span>
    </li>
  `;

  const visible = entries.slice(0, topN);
  const rest = entries.slice(topN);

  container.innerHTML = `
    <ul class="standings-list">${visible.map(makeItem).join("")}</ul>
    ${rest.length ? `<button class="show-more" type="button">Show all ${entries.length}</button>
    <ul class="standings-list hidden">${rest.map(makeItem).join("")}</ul>` : ""}
  `;

  const btn = container.querySelector(".show-more");
  if (btn) {
    btn.addEventListener("click", () => {
      container.querySelector("ul.hidden").classList.remove("hidden");
      btn.remove();
    });
  }
}

function renderStandings(race) {
  renderStandingsList(document.getElementById("driver-standings"), race.driverStandings, 5);
  renderStandingsList(document.getElementById("constructor-standings"), race.constructorStandings, 5);
}

function renderDramaLog(race) {
  const el = document.getElementById("drama-log");
  if (!race.dnfs || race.dnfs.length === 0) {
    el.innerHTML = `<p class="no-dnfs">Everyone finished. A clean race.</p>`;
    return;
  }
  el.innerHTML = `
    <ul class="dnf-list">
      ${race.dnfs.map((d) => `
        <li>
          <span>${d.driverName}<span class="dnf-lap"> &middot; Lap ${d.lap}</span></span>
          <span class="dnf-reason">${d.reason}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderMovementEntry(entry, kind) {
  const arrow = kind === "hero" ? "▲" : "▼";
  return `
    <li class="movement-entry" style="border-left-color:${teamColor(entry.constructor)}">
      <span class="movement-arrow movement-arrow-${kind}">${arrow}</span>
      <div class="movement-body">
        <div class="movement-name">${entry.driverName}</div>
        <div class="movement-take">${entry.take}</div>
      </div>
    </li>
  `;
}

function renderHeroesZeroes(race) {
  const section = document.getElementById("heroes-zeroes-section");
  const hz = race.heroesZeroes;
  if (!hz || (!hz.hero && !hz.zero)) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const items = [
    hz.hero ? renderMovementEntry(hz.hero, "hero") : "",
    hz.zero ? renderMovementEntry(hz.zero, "zero") : "",
  ].join("");
  document.getElementById("heroes-zeroes").innerHTML = `<ul class="movement-list">${items}</ul>`;
}

function renderEditorsTake(race) {
  const section = document.getElementById("editors-take-section");
  if (!race.editors_take || !race.editors_take.trim()) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  document.getElementById("editors-take").innerHTML = `<p>${race.editors_take}</p>`;
}

function findNextRace() {
  const now = new Date();
  for (const round of manifest.rounds) {
    const raceDt = new Date(`${round.sessions.race.date}T${round.sessions.race.time}`);
    if (raceDt > now) return round;
  }
  return null;
}

function renderNextRace() {
  const section = document.getElementById("next-race-section");
  const next = findNextRace();
  if (!next) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const raceDt = new Date(`${next.sessions.race.date}T${next.sessions.race.time}`);
  const msLeft = raceDt - new Date();
  const days = Math.floor(msLeft / (1000 * 60 * 60 * 24));
  const hours = Math.floor((msLeft / (1000 * 60 * 60)) % 24);

  const sessionRows = SESSION_ORDER
    .filter(([key]) => next.sessions[key])
    .map(([key, label]) => {
      const s = next.sessions[key];
      const track = formatSessionTime(s.date, s.time, next.circuitTimezone);
      const myt = formatSessionTime(s.date, s.time, MYT_ZONE);
      return `
        <li>
          <span class="session-name">${label}</span>
          <span class="session-time">${track}<span class="myt">${myt} MYT</span></span>
        </li>
      `;
    })
    .join("");

  document.getElementById("next-race").innerHTML = `
    <div class="winner-meta">Round ${next.round} &middot; ${next.raceName}</div>
    <div class="countdown">${days}d ${hours}h</div>
    <div class="winner-meta">${next.circuitName}, ${next.locality}</div>
    <ul class="session-times">${sessionRows}</ul>
  `;
}

function populateSelector() {
  const select = document.getElementById("race-selector");
  const withData = manifest.rounds.filter((r) => r.hasData);
  select.innerHTML = withData
    .map((r) => `<option value="${r.round}">Round ${r.round} &mdash; ${r.raceName}</option>`)
    .join("");

  select.addEventListener("change", () => loadRound(Number(select.value)));

  // Default to the most recently completed round.
  const latest = withData[withData.length - 1];
  if (latest) {
    select.value = latest.round;
    loadRound(latest.round);
  } else {
    document.getElementById("winner-hero").innerHTML = "<p>No races backfilled yet.</p>";
  }
}

async function loadRound(round) {
  const padded = String(round).padStart(2, "0");
  const race = await loadJSON(`data/${SEASON}/round-${padded}.json`);
  renderWinnerHero(race);
  renderStandings(race);
  renderDramaLog(race);
  renderHeroesZeroes(race);
  renderEditorsTake(race);
}

async function init() {
  manifest = await loadJSON("data/index.json");
  populateSelector();
  renderNextRace();
}

init().catch((err) => {
  console.error(err);
  document.querySelector("main").innerHTML = `<p>Something went wrong loading race data: ${err.message}</p>`;
});
