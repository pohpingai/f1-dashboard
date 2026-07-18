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

// ---- Milestone 3: Rejoin Strip ----------------------------------------

const FLAG_CLASS = {
  "Rejoin clash": "flag-clash",
  "Dirty air": "flag-dirty",
  "Clean air": "flag-clean",
};

function renderRejoinStrip(race) {
  const section = document.getElementById("rejoin-strip-section");
  const rs = race.rejoinStrip;
  if (!rs || !rs.available || !rs.stops || rs.stops.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const clashes = rs.stops.filter((s) => s.flag === "Rejoin clash").length;
  const dirty = rs.stops.filter((s) => s.flag === "Dirty air").length;
  const bits = [];
  if (clashes) bits.push(`${clashes} into a rejoin clash`);
  if (dirty) bits.push(`${dirty} into dirty air`);
  const hook = bits.length
    ? `${rs.stops.length} stops — ${bits.join(", ")}.`
    : `${rs.stops.length} stops, all into clean air.`;

  // Group stops by driver, ordered by finishing position for relevance.
  const order = new Map(race.results.map((r, i) => [r.driverCode, i]));
  const byDriver = new Map();
  for (const s of rs.stops) {
    if (!byDriver.has(s.driverCode)) byDriver.set(s.driverCode, []);
    byDriver.get(s.driverCode).push(s);
  }
  const drivers = [...byDriver.keys()].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99)
  );

  const stopRow = (s) => {
    const near = [];
    if (s.ahead) near.push(`${s.ahead.gap.toFixed(1)}s behind ${s.ahead.code}`);
    if (s.behind) near.push(`${s.behind.code} ${s.behind.gap.toFixed(1)}s back`);
    const pit = s.pitLaneSeconds != null
      ? `<span class="rejoin-pit">${s.pitLaneSeconds.toFixed(1)}s pit lane</span>`
      : "";
    return `
      <li class="rejoin-stop">
        <span class="rejoin-lap">Lap ${s.inLap}</span>
        <span class="flag ${FLAG_CLASS[s.flag] || ""}">${s.flag}</span>
        <span class="rejoin-detail">${s.take}${
          near.length ? `<span class="rejoin-near">${near.join(" · ")}</span>` : ""
        }${pit}</span>
      </li>`;
  };

  const driverBlock = (code) => {
    const stops = byDriver.get(code);
    const constructor = stops[0].constructor;
    return `
      <div class="rejoin-driver" style="border-left-color:${teamColor(constructor)}">
        <div class="rejoin-driver-name">${code}</div>
        <ul class="rejoin-stops">${stops.map(stopRow).join("")}</ul>
      </div>`;
  };

  document.getElementById("rejoin-strip").innerHTML = `
    <details class="disclosure">
      <summary><span class="hook">${hook}</span><span class="chev">▾</span></summary>
      <p class="module-note">Gaps read at the first full lap after each stop, from actual lap data — pit-lane times are total pit-lane transit, not the stationary stop.</p>
      <div class="rejoin-grid">${drivers.map(driverBlock).join("")}</div>
    </details>`;
}

// ---- Milestone 3: Gap Trace (Pace + Gap views) ------------------------

// Laps whose time exceeds a driver's median green-lap pace by this much are
// treated as safety-car / VSC / slow (yellow-flag) laps and dropped from the
// Pace view, so they don't flatten the scale for the ~90s racing laps. Real
// green laps sit within a few percent of the median even with fuel/tyre/traffic
// spread; SC and yellow laps are 10%+ slower, so 1.08 cleanly separates them.
const SC_PACE_FACTOR = 1.08;

const CHART = { W: 360, H: 220, padT: 16, padB: 26 };

function driverIndex(gapTrace) {
  // code -> { constructor, pitLaps:Set, t: Map(lap -> seconds) }
  const idx = new Map();
  for (const d of gapTrace.drivers) {
    const t = new Map(d.laps.map((p) => [p.lap, p.t]));
    idx.set(d.code, {
      constructor: d.constructor,
      pitLaps: new Set(d.pitLaps || []),
      t,
    });
  }
  return idx;
}

function gapSeries(a, b) {
  // Positive gap = A is AHEAD of B (A crossed the line earlier => B.t - A.t > 0).
  const laps = [...a.t.keys()].filter((l) => b.t.has(l)).sort((x, y) => x - y);
  return laps.map((lap) => ({ lap, gap: b.t.get(lap) - a.t.get(lap) }));
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A single lap's time is the difference between consecutive cumulative crossing
// times (a "first difference"). Only defined for consecutive laps we have.
function computeLapTimes(t) {
  const laps = [...t.keys()].sort((x, y) => x - y);
  const out = new Map();
  for (let i = 1; i < laps.length; i++) {
    const L = laps[i], P = laps[i - 1];
    if (L - P === 1) out.set(L, t.get(L) - t.get(P));
  }
  return out;
}

// Keep only green-flag racing laps: drop pit in-laps (in pitLaps), out-laps
// (lap after a pit lap), and safety-car/VSC laps (well above median pace).
function racingLapTimes(lapTimes, pitLaps) {
  const nonPit = [...lapTimes.entries()].filter(([L]) => !pitLaps.has(L) && !pitLaps.has(L - 1));
  const med = median(nonPit.map(([, v]) => v));
  const cutoff = med > 0 ? med * SC_PACE_FACTOR : Infinity;
  const racing = new Map();
  let removed = 0;
  for (const [L, v] of lapTimes) {
    const isPit = pitLaps.has(L) || pitLaps.has(L - 1);
    if (isPit || v > cutoff) removed++;
    else racing.set(L, v);
  }
  return { racing, removed };
}

function scales(lapMin, lapMax, vMin, vMax, padL, padR) {
  const { W, H, padT, padB } = CHART;
  return {
    x: (lap) => padL + ((lap - lapMin) / (lapMax - lapMin || 1)) * (W - padL - padR),
    y: (v) => padT + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - padT - padB),
  };
}

function axisLabels(x, y, lapMin, lapMax, yVals, fmtY, padL) {
  const { H, padB } = CHART;
  const step = Math.max(1, Math.round((lapMax - lapMin) / 5));
  let out = "";
  for (let l = lapMin; l <= lapMax; l += step) {
    out += `<text x="${x(l).toFixed(1)}" y="${H - padB + 14}" class="ax-lbl" text-anchor="middle">${l}</text>`;
  }
  for (const v of yVals) {
    out += `<text x="${padL - 4}" y="${(y(v) + 3).toFixed(1)}" class="ax-lbl" text-anchor="end">${fmtY(v)}</text>`;
  }
  return out;
}

// "Gap" view: the single cumulative-gap line between two drivers.
function buildGapChart(aCode, a, bCode, b) {
  const series = gapSeries(a, b);
  if (series.length < 2) {
    return { html: `<p class="module-note">Not enough shared laps to compare these two.</p>`, model: null };
  }
  const { W, H, padT, padB } = CHART;
  const padL = 34, padR = 12;
  const laps = series.map((s) => s.lap);
  const gaps = series.map((s) => s.gap);
  const lapMin = Math.min(...laps), lapMax = Math.max(...laps);
  let gMin = Math.min(0, ...gaps), gMax = Math.max(0, ...gaps);
  const pad = Math.max((gMax - gMin) * 0.1, 0.5);
  gMin -= pad; gMax += pad;
  const { x, y } = scales(lapMin, lapMax, gMin, gMax, padL, padR);
  const aColor = teamColor(a.constructor), bColor = teamColor(b.constructor);

  const line = series.map((s, i) => `${i ? "L" : "M"}${x(s.lap).toFixed(1)},${y(s.gap).toFixed(1)}`).join(" ");
  const zeroY = y(0).toFixed(1);
  const pitMarks = (pitLaps, color) =>
    [...pitLaps].filter((l) => l >= lapMin && l <= lapMax)
      .map((l) => `<line x1="${x(l).toFixed(1)}" y1="${padT}" x2="${x(l).toFixed(1)}" y2="${H - padB}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/><circle cx="${x(l).toFixed(1)}" cy="${padT + 4}" r="3" fill="${color}"/>`)
      .join("");

  const lookup = new Map();
  for (const s of series) {
    const ahead = s.gap >= 0 ? aCode : bCode;
    const color = s.gap >= 0 ? aColor : bColor;
    lookup.set(s.lap, {
      rows: [{ label: `${ahead} ahead`, color, value: `${Math.abs(s.gap).toFixed(1)}s` }],
      points: [{ x: x(s.lap), y: y(s.gap), color }],
    });
  }

  const html = `
    <div class="gap-legend">
      <span><span class="dot" style="background:${aColor}"></span>${aCode} ahead ▲</span>
      <span><span class="dot" style="background:${bColor}"></span>${bCode} ahead ▼</span>
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="gap-svg" role="img" aria-label="Gap between ${aCode} and ${bCode} per lap">
        <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="var(--border)" stroke-width="1"/>
        ${axisLabels(x, y, lapMin, lapMax, [gMax - pad / 2, 0, gMin + pad / 2], (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`, padL)}
        ${pitMarks(a.pitLaps, aColor)}${pitMarks(b.pitLaps, bColor)}
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
        <line class="guide" y1="${padT}" y2="${H - padB}" stroke="var(--text-dim)" stroke-width="1" stroke-dasharray="2 2" style="display:none"/>
        <circle class="tip-marker" r="3.5" style="display:none"/>
      </svg>
      <div class="chart-tip" style="display:none"></div>
    </div>
    <p class="module-note">Dashed lines mark pit laps. When the trace crosses the centre after a stop, that's a completed undercut/overcut.</p>`;
  return { html, model: { W, padL, padR, lapMin, lapMax, laps, xOf: x, lookup } };
}

// "Pace" view: each driver's per-lap lap time, with a ribbon between them
// tinted by whoever leads on track that lap.
function buildPaceChart(aCode, a, bCode, b) {
  const aT = racingLapTimes(computeLapTimes(a.t), a.pitLaps);
  const bT = racingLapTimes(computeLapTimes(b.t), b.pitLaps);
  const aR = aT.racing, bR = bT.racing;
  const allVals = [...aR.values(), ...bR.values()];
  if (allVals.length < 2) {
    return { html: `<p class="module-note">Not enough green-flag laps to compare pace.</p>`, model: null };
  }
  const { W, H, padT, padB } = CHART;
  const padL = 40, padR = 12;
  const allLaps = [...new Set([...aR.keys(), ...bR.keys()])].sort((x, y) => x - y);
  const lapMin = allLaps[0], lapMax = allLaps[allLaps.length - 1];
  let vMin = Math.min(...allVals), vMax = Math.max(...allVals);
  const vpad = Math.max((vMax - vMin) * 0.08, 0.2);
  vMin -= vpad; vMax += vpad;
  const { x, y } = scales(lapMin, lapMax, vMin, vMax, padL, padR);
  const aColor = teamColor(a.constructor), bColor = teamColor(b.constructor);

  const toPts = (m) => [...m.entries()].sort((p, q) => p[0] - q[0]).map(([lap, v]) => ({ lap, x: x(lap), y: y(v) }));
  const pathWithGaps = (pts) => {
    let d = "", prev = null;
    for (const p of pts) { d += `${prev === null || p.lap - prev !== 1 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)} `; prev = p.lap; }
    return d.trim();
  };

  // Ribbon: one quad per lap interval where both drivers have a racing lap,
  // filled with the team color of whoever is ahead on track (lower cumulative t).
  let ribbon = "";
  for (const L of allLaps) {
    const L1 = L + 1;
    if (aR.has(L) && aR.has(L1) && bR.has(L) && bR.has(L1)) {
      const leaderColor = (a.t.get(L) ?? Infinity) < (b.t.get(L) ?? Infinity) ? aColor : bColor;
      const pts = `${x(L).toFixed(1)},${y(aR.get(L)).toFixed(1)} ${x(L1).toFixed(1)},${y(aR.get(L1)).toFixed(1)} ${x(L1).toFixed(1)},${y(bR.get(L1)).toFixed(1)} ${x(L).toFixed(1)},${y(bR.get(L)).toFixed(1)}`;
      ribbon += `<polygon points="${pts}" fill="${leaderColor}" opacity="0.16"/>`;
    }
  }

  const pitTicks = (pitLaps, color) =>
    [...pitLaps].filter((l) => l >= lapMin && l <= lapMax)
      .map((l) => `<line x1="${x(l).toFixed(1)}" y1="${H - padB}" x2="${x(l).toFixed(1)}" y2="${H - padB - 5}" stroke="${color}" stroke-width="2"/>`).join("");

  const lookup = new Map();
  for (const L of allLaps) {
    const rows = [], points = [];
    if (aR.has(L)) { rows.push({ label: aCode, color: aColor, value: `${aR.get(L).toFixed(1)}s` }); points.push({ x: x(L), y: y(aR.get(L)), color: aColor }); }
    if (bR.has(L)) { rows.push({ label: bCode, color: bColor, value: `${bR.get(L).toFixed(1)}s` }); points.push({ x: x(L), y: y(bR.get(L)), color: bColor }); }
    if (aR.has(L) && bR.has(L)) {
      const d = Math.abs(aR.get(L) - bR.get(L));
      const faster = aR.get(L) < bR.get(L) ? aCode : bCode;
      rows.push({ label: `${faster} faster by`, color: "var(--text-dim)", value: `${d.toFixed(1)}s` });
    }
    lookup.set(L, { rows, points });
  }

  const removed = aT.removed + bT.removed;
  const midV = (vMin + vMax) / 2;
  const html = `
    <div class="gap-legend">
      <span><span class="dot" style="background:${aColor}"></span>${aCode}</span>
      <span><span class="dot" style="background:${bColor}"></span>${bCode}</span>
      <span class="legend-note">lap time (s)</span>
    </div>
    <div class="chart-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="gap-svg" role="img" aria-label="Lap-time pace of ${aCode} and ${bCode}">
        ${ribbon}
        ${axisLabels(x, y, lapMin, lapMax, [vMax - vpad, midV, vMin + vpad], (v) => v.toFixed(1), padL)}
        ${pitTicks(a.pitLaps, aColor)}${pitTicks(b.pitLaps, bColor)}
        <path d="${pathWithGaps(toPts(aR))}" fill="none" stroke="${aColor}" stroke-width="2" stroke-linejoin="round"/>
        <path d="${pathWithGaps(toPts(bR))}" fill="none" stroke="${bColor}" stroke-width="2" stroke-linejoin="round"/>
        <line class="guide" y1="${padT}" y2="${H - padB}" stroke="var(--text-dim)" stroke-width="1" stroke-dasharray="2 2" style="display:none"/>
        <circle class="tip-marker" r="3.5" style="display:none"/>
        <circle class="tip-marker" r="3.5" style="display:none"/>
      </svg>
      <div class="chart-tip" style="display:none"></div>
    </div>
    <p class="module-note">Each line is a driver's lap time; the shaded band is the per-lap gap, tinted by whoever leads on track. ${removed} pit &amp; safety-car lap${removed === 1 ? "" : "s"} removed so the scale shows green-flag pace.</p>`;
  return { html, model: { W, padL, padR, lapMin, lapMax, laps: allLaps, xOf: x, lookup } };
}

// Hover (desktop) / tap (mobile) tooltip shared by both views.
function attachChartInteraction(wrap, model) {
  if (!model) return;
  const svg = wrap.querySelector("svg");
  const tip = wrap.querySelector(".chart-tip");
  const guide = svg.querySelector(".guide");
  const markers = [...svg.querySelectorAll(".tip-marker")];

  const nearestLap = (clientX) => {
    const r = svg.getBoundingClientRect();
    const vbX = ((clientX - r.left) / r.width) * model.W;
    const raw = model.lapMin + ((vbX - model.padL) / (model.W - model.padL - model.padR)) * (model.lapMax - model.lapMin);
    let best = null, bd = Infinity;
    for (const l of model.laps) { const d = Math.abs(l - raw); if (d < bd) { bd = d; best = l; } }
    return best;
  };

  const show = (clientX) => {
    const lap = nearestLap(clientX);
    const info = lap != null ? model.lookup.get(lap) : null;
    if (!info) return;
    const gx = model.xOf(lap);
    guide.setAttribute("x1", gx); guide.setAttribute("x2", gx); guide.style.display = "";
    markers.forEach((m, i) => {
      const p = info.points[i];
      if (p) { m.setAttribute("cx", p.x); m.setAttribute("cy", p.y); m.setAttribute("fill", p.color); m.style.display = ""; }
      else m.style.display = "none";
    });
    tip.innerHTML = `<div class="tip-lap">Lap ${lap}</div>` + info.rows.map((row) =>
      `<div class="tip-row"><span class="tip-dot" style="background:${row.color}"></span><span class="tip-label">${row.label}</span><span class="tip-val">${row.value}</span></div>`).join("");
    tip.style.display = "block";
    const svgRect = svg.getBoundingClientRect(), wrapRect = wrap.getBoundingClientRect();
    const px = (svgRect.left - wrapRect.left) + (gx / model.W) * svgRect.width;
    const left = Math.max(0, Math.min(px - tip.offsetWidth / 2, wrap.clientWidth - tip.offsetWidth));
    tip.style.left = `${left}px`;
    tip.style.top = "0px";
  };
  const hide = () => { tip.style.display = "none"; guide.style.display = "none"; markers.forEach((m) => (m.style.display = "none")); };

  svg.addEventListener("mousemove", (e) => show(e.clientX));
  svg.addEventListener("mouseleave", hide);
  svg.addEventListener("touchstart", (e) => show(e.touches[0].clientX), { passive: true });
  svg.addEventListener("touchmove", (e) => show(e.touches[0].clientX), { passive: true });
}

function renderGapTrace(race) {
  const section = document.getElementById("gap-trace-section");
  const gt = race.gapTrace;
  if (!gt || !gt.available || !gt.drivers || gt.drivers.length < 2) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const idx = driverIndex(gt);
  const codes = [...idx.keys()];
  // Default to a natural battle: winner vs runner-up when both have timing.
  const order = race.results.map((r) => r.driverCode).filter((c) => idx.has(c));
  const defA = order[0] ?? codes[0];
  const defB = order[1] ?? codes.find((c) => c !== defA) ?? codes[1];

  const opts = (sel) =>
    codes.map((c) => `<option value="${c}"${c === sel ? " selected" : ""}>${c}</option>`).join("");

  const hook = `${defA} vs ${defB} — compare their pace and race gap lap by lap.`;

  document.getElementById("gap-trace").innerHTML = `
    <details class="disclosure">
      <summary><span class="hook">${hook}</span><span class="chev">▾</span></summary>
      <div class="gap-controls">
        <select id="gap-a" aria-label="First driver">${opts(defA)}</select>
        <span class="gap-vs">vs</span>
        <select id="gap-b" aria-label="Second driver">${opts(defB)}</select>
      </div>
      <div class="view-toggle" role="tablist" aria-label="Chart view">
        <button type="button" class="vt-btn" data-view="pace" role="tab">Pace</button>
        <button type="button" class="vt-btn" data-view="gap" role="tab">Gap</button>
      </div>
      <div id="gap-chart"></div>
    </details>`;

  const selA = document.getElementById("gap-a");
  const selB = document.getElementById("gap-b");
  const toggle = document.querySelector("#gap-trace .view-toggle");
  let view = "pace"; // default to Pace

  const draw = () => {
    const aCode = selA.value, bCode = selB.value;
    const chart = document.getElementById("gap-chart");
    toggle.querySelectorAll(".vt-btn").forEach((btn) =>
      btn.classList.toggle("active", btn.dataset.view === view));
    if (aCode === bCode) {
      chart.innerHTML = `<p class="module-note">Pick two different drivers.</p>`;
      return;
    }
    const a = idx.get(aCode), b = idx.get(bCode);
    const built = view === "pace" ? buildPaceChart(aCode, a, bCode, b) : buildGapChart(aCode, a, bCode, b);
    chart.innerHTML = built.html;
    const wrap = chart.querySelector(".chart-wrap");
    if (wrap) attachChartInteraction(wrap, built.model);
  };

  selA.addEventListener("change", draw);
  selB.addEventListener("change", draw);
  toggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".vt-btn");
    if (!btn || btn.dataset.view === view) return;
    view = btn.dataset.view;
    draw();
  });
  draw();
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
  renderRejoinStrip(race);
  renderGapTrace(race);
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
