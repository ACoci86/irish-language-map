// ─────────────────────────────────────────────
// 1. SETUP
// ─────────────────────────────────────────────

// The map shows a fixed view of Ireland fitted to the counties, so all zoom
// and pan interactions are disabled and the +/- control is removed. County
// hover and clicks still work.
const map = L.map("map", {
  zoomControl: false,
  dragging: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  touchZoom: false,
  keyboard: false,
  zoomSnap: 0, // fractional zoom so the island fills the box exactly
  attributionControl: false, // credited in the footer instead of on the map
}).setView([53.4, -8.0], 7);

// ─────────────────────────────────────────────
// 2. STATE
// ─────────────────────────────────────────────

// allData holds every census year keyed by year -> { COUNTY: value }. We load
// it once and slice out the selected year locally, so the map, the county
// detail and the table all read from a single in-memory source.
let allData = {};
let currentYear;
let years = [];
let countyLayer;

// pinnedCounty is set by a click and stays until clicked again; hoverCounty
// follows the pointer over the map or the table and gets a lighter outline.
let pinnedCounty = null;
let hoverCounty = null;
const layersByCounty = {};

const NI_COUNTIES = new Set([
  "ANTRIM",
  "ARMAGH",
  "DOWN",
  "FERMANAGH",
  "LONDONDERRY",
  "TYRONE",
]);

const PROVINCES = {
  Connacht: ["GALWAY", "LEITRIM", "MAYO", "ROSCOMMON", "SLIGO"],
  Munster: ["CLARE", "CORK", "KERRY", "LIMERICK", "TIPPERARY", "WATERFORD"],
  Ulster: [
    "ANTRIM", "ARMAGH", "CAVAN", "DONEGAL", "DOWN",
    "FERMANAGH", "LONDONDERRY", "MONAGHAN", "TYRONE",
  ],
};

function provinceOf(county) {
  const found = Object.keys(PROVINCES).find((p) => PROVINCES[p].includes(county));
  return found || "Leinster";
}

// Northern Ireland runs its own census, so a couple of its years sit a year or
// two off the Republic's. Those figures are shown under the nearest map year,
// and the panel says which NI census they actually come from.
const NI_CENSUS_YEAR = { 2002: "2001", 2022: "2021" };

const DISPLAY_NAMES = { LONDONDERRY: "DERRY / LONDONDERRY" };

function displayName(county) {
  return DISPLAY_NAMES[county] || county;
}

const INK = "#333634";
const BG = "#f4f4f2";
const GREEN = "#14774c";
// The tricolour's orange, for the few things the reader should look at.
const ORANGE = "#f0822e";

// Outlines for the pinned county and the one under the pointer.
const PINNED_STYLE = { color: INK, weight: 3 };
const HOVER_STYLE = { color: INK, weight: 1.5 };



// GSAP drives the scrolling, counters and small entrances. Everything still
// works without it (or with reduced motion), just without the animation.
const hasGsap = typeof gsap !== "undefined";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const animate = hasGsap && !reduceMotion;

if (hasGsap && typeof ScrollToPlugin !== "undefined") {
  gsap.registerPlugin(ScrollToPlugin);
}

// Counts an element's number from its last shown value to `to`.
function tweenPercent(el, from, to) {
  if (!animate || from == null || from === to) {
    el.textContent = `${to.toFixed(1)}%`;
    return;
  }
  const counter = { v: from };
  gsap.to(counter, {
    v: to,
    duration: 0.5,
    ease: "power2.out",
    onUpdate: () => {
      el.textContent = `${counter.v.toFixed(1)}%`;
    },
  });
}

const trackFill = document.getElementById("timeline-fill");
const yearLabel = document.getElementById("timeline-year");
const trackHandle = document.getElementById("timeline-handle");
const stops = Array.from(document.querySelectorAll(".timeline-stop"));
const timelineTrack = document.getElementById("timeline-track");

// The timeline is also a control: tap or drag along it to snap to the
// nearest census, or use the arrow keys. (The scroll steps still move it
// as the reader passes them.)
function yearAtPointer(event) {
  const box = timelineTrack.getBoundingClientRect();
  const pct = ((event.clientX - box.left) / box.width) * 100;
  let best = stops[0];
  stops.forEach((stop) => {
    if (Math.abs(parseFloat(stop.style.left) - pct) < Math.abs(parseFloat(best.style.left) - pct)) best = stop;
  });
  return best.dataset.year;
}

function pickYear(year) {
  if (!countyLayer || year === currentYear) return;
  storyHeadline = null;
  stopTravel();
  setYear(year);
}

timelineTrack.addEventListener("pointerdown", (event) => {
  timelineTrack.setPointerCapture(event.pointerId);
  timelineTrack.classList.add("is-dragging");
  pickYear(yearAtPointer(event));
});
timelineTrack.addEventListener("pointermove", (event) => {
  if (timelineTrack.hasPointerCapture(event.pointerId)) pickYear(yearAtPointer(event));
});
["pointerup", "pointercancel"].forEach((type) =>
  timelineTrack.addEventListener(type, () => timelineTrack.classList.remove("is-dragging")),
);
timelineTrack.addEventListener("keydown", (event) => {
  const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const i = years.indexOf(currentYear) + step;
  if (i >= 0 && i < years.length) pickYear(years[i]);
});
const findingEl = document.getElementById("finding");
const opener = document.getElementById("opener");


// "GALWAY" -> "Galway", "DERRY / LONDONDERRY" -> "Derry / Londonderry".
function prettyName(county) {
  return displayName(county)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// The value map for the year currently on the map.
function currentYearData() {
  return allData[currentYear] || {};
}

// ─────────────────────────────────────────────
// 3. DATA FETCHING
// ─────────────────────────────────────────────

async function loadAllData() {
  const response = await fetch("data/ability.json");

  if (!response.ok) {
    throw new Error(`Could not load ability data: ${response.status}`);
  }

  allData = await response.json();
  years = Object.keys(allData).sort((a, b) => Number(a) - Number(b));
}

// ─────────────────────────────────────────────
// 4. PRESENTATION
// ─────────────────────────────────────────────

const SCALE_MAX = 70;

// The data is skewed low (median ~27%, nothing above 70%), so raising the
// position to a power below 1 spreads the crowded low and middle range across
// more of the ramp while the domain still spans the true maximum.
const SCALE_EXPONENT = 0.6;
const NO_DATA_COLOUR = "#d3d4cf";

// Single-hue sequential ramp, pale -> deep green. Colours are interpolated
// between these evenly spaced stops so lightness falls steadily with no jumps.
const RAMP = ["#eef2dc", "#c6e3b5", "#86c98f", "#3fa46c", "#14774c", "#064530"];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const RAMP_RGB = RAMP.map(hexToRgb);

function rampRgb(value) {
  const ratio = Math.max(0, Math.min(1, value / SCALE_MAX));
  const t = Math.pow(ratio, SCALE_EXPONENT) * (RAMP_RGB.length - 1);
  const i = Math.min(Math.floor(t), RAMP_RGB.length - 2);
  const f = t - i;
  const [a, b] = [RAMP_RGB[i], RAMP_RGB[i + 1]];

  return a.map((c, k) => Math.round(c + (b[k] - c) * f));
}

function getCountyColour(value) {
  if (value == null) return NO_DATA_COLOUR;
  return `rgb(${rampRgb(value).join(",")})`;
}

// Text colour that stays readable on top of a county's fill.
function textOn(value) {
  if (value == null) return INK;
  const [r, g, b] = rampRgb(value);
  return 0.299 * r + 0.587 * g + 0.114 * b < 150 ? "#ffffff" : INK;
}

// ─────────────────────────────────────────────
// SKETCH STYLE: the charts are drawn with D3 and rough.js in ink and
// hatching, like the maps.
// ─────────────────────────────────────────────

// The frame shared by the D3 line charts (the story chart, the guess and a
// county's history): pencil gridlines, census years and ink axes sketched
// with rough.js. Drawn at the container's own width, so the text keeps its
// size on a phone instead of shrinking with a viewBox. `top` leaves room
// above the plot (the guess card puts its bars there).
function lineFrame(el, { h, top = 28 }) {
  const w = Math.max(280, el.clientWidth);
  const narrow = w < 520;
  const first = Number(years[0]);
  const last = Number(years[years.length - 1]);
  const x = d3.scaleLinear().domain([first, last]).range([34, w - (narrow ? 96 : 150)]);
  const y = d3.scaleLinear().domain([0, SCALE_MAX]).range([h - 30, top + 14]);

  el.querySelector(":scope > svg")?.remove();
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("class", "line-svg");

  const grid = svg.append("g").attr("class", "ns-grid");
  [0, 20, 40, 60].forEach((v) => {
    grid.append("line").attr("x1", x(first)).attr("x2", x(last)).attr("y1", y(v)).attr("y2", y(v));
    grid.append("text").attr("x", x(first) - 8).attr("y", y(v) + 4).attr("text-anchor", "end").text(v);
  });
  (narrow ? [1851, 1900, 1950, 2022] : [1851, 1900, 1950, 2000, 2022]).forEach((v) => {
    grid.append("text").attr("x", x(v)).attr("y", h - 8).attr("text-anchor", "middle").text(v);
  });
  svg.append("text").attr("class", "line-axis-title").attr("x", 8).attr("y", top - 4).text("% able to speak Irish");

  const axis = [[x(first), y(SCALE_MAX)], [x(first), y(0)], [x(last), y(0)]];
  if (typeof rough !== "undefined") {
    svg.node().appendChild(
      rough.svg(svg.node()).linearPath(axis, { stroke: INK, strokeWidth: 1.8, roughness: 0.9, bowing: 0.5, seed: 11 }),
    );
  } else {
    svg.append("path").attr("class", "line-axis").attr("d", `M${axis.join("L")}`);
  }
  return { svg, x, y, w, h, narrow, first, last };
}

// A census series as a smooth line. Northern Ireland has figures only in
// some years (1991, 2002, 2011, 2022), so the line joins across short runs
// of missing years and breaks only across a long gap like 1926 to 1986.
function linePath(view, values) {
  const line = d3
    .line()
    .x(([yr]) => view.x(Number(yr)))
    .y(([, v]) => view.y(v))
    .curve(d3.curveMonotoneX);
  const runs = [];
  let run = [];
  values
    .filter(([, v]) => v != null)
    .forEach((point) => {
      const last = run[run.length - 1];
      if (last && Number(point[0]) - Number(last[0]) > 20) {
        runs.push(run);
        run = [];
      }
      run.push(point);
    });
  if (run.length) runs.push(run);
  return runs.map((r) => line(r)).join(" ");
}

// Draws a path in like a pen stroke, left to right. With no duration it
// simply appears.
function drawPath(path, delay, duration) {
  path.interrupt("draw").interrupt("reveal");
  if (!duration) {
    path.attr("opacity", 1).attr("stroke-dasharray", null).attr("stroke-dashoffset", null);
    return;
  }
  const length = path.node().getTotalLength();
  path
    .attr("opacity", 1)
    .attr("stroke-dasharray", `${length} ${length}`)
    .attr("stroke-dashoffset", length)
    .transition("draw")
    .delay(delay)
    .duration(duration)
    .ease(d3.easeCubicInOut)
    .attr("stroke-dashoffset", 0);
}

// Names at the right-hand ends of lines, nudged apart so they never overlap.
// `labels` are [selection, last value] pairs.
function placeEndLabels(view, labels) {
  const placed = labels
    .filter(([, v]) => v != null)
    .map(([label, v]) => ({ label, y: view.y(v) + 5 }))
    .sort((a, b) => a.y - b.y);
  placed.forEach((p, i) => {
    if (i && p.y - placed[i - 1].y < 18) p.y = placed[i - 1].y + 18;
  });
  placed.forEach((p) => p.label.attr("x", view.x(view.last) + 8).attr("y", p.y));
}

// A county's line and the Republic average, with their names at the ends;
// used by the guess card and the county panel.
function addHistoryLines(view) {
  const g = view.svg.append("g");
  return {
    average: g.append("path").attr("class", "line is-average"),
    county: g.append("path").attr("class", "line is-county"),
    averageLabel: g.append("text").attr("class", "line-end is-average").text(view.narrow ? "average" : "Republic average"),
    countyLabel: g.append("text").attr("class", "line-end is-county"),
  };
}

function setHistory(view, lines, countyName) {
  const lastYear = years[years.length - 1];
  lines.average.attr("d", linePath(view, years.map((yr) => [yr, republicAverage(yr)])));
  lines.county.attr("d", linePath(view, years.map((yr) => [yr, allData[yr][countyName]])));
  // "Derry / Londonderry" is too long for a phone's margin.
  const name = prettyName(countyName);
  lines.countyLabel.text(view.narrow ? name.split(" / ")[0] : name);
  placeEndLabels(view, [
    [lines.countyLabel, allData[lastYear][countyName]],
    [lines.averageLabel, republicAverage(lastYear)],
  ]);
}

// An orange line sketched with rough.js that draws itself in: the site's
// one animated mark, used under chapter headings and on the jurisdictions
// chart. `nodes` are rough.js shape nodes; returns a function that plays them.
function sketchDraw(nodes, { duration = 0.9, delay = 0 } = {}) {
  const paths = nodes.flatMap((node) => [...node.querySelectorAll("path")]);
  paths.forEach((path) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = length;
    path.style.strokeDashoffset = length;
  });
  return () =>
    paths.forEach((path, i) => {
      if (!animate) {
        path.style.strokeDashoffset = 0;
        return;
      }
      gsap.to(path, { strokeDashoffset: 0, duration, delay: delay + i * 0.08, ease: "power2.out" });
    });
}

// Plays `play` once, the first time `el` scrolls into view.
function onceInView(el, play, threshold = 0.4) {
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      play();
    },
    { threshold },
  );
  observer.observe(el);
}

// The closing proverb gets an orange marker highlight, swept on by hand
// (RoughNotation) when it scrolls into view.
function buildClosing() {
  const el = document.getElementById("closing-proverb");
  if (!el || typeof RoughNotation === "undefined") return;
  const mark = RoughNotation.annotate(el, {
    type: "highlight",
    color: "#f8cfa6",
    multiline: true,
    iterations: 2,
    animate,
    animationDuration: 1200,
  });
  onceInView(el, () => mark.show(), 0.6);
}

// A small copy of the scroll cue on every step's text card (and so on the
// phone caption box, which copies the card): a hint to keep going where the
// graphic is pinned and the page can look as if it has stopped. Tapping it
// glides to the next step, or past the section after its last step.
const cueButton = (extra = "") =>
  `<button type="button" class="step-next ${extra}" aria-label="Next"><img src="img/scroll-cue.svg" alt=""></button>`;

// Step-by-step scrolling on touch screens: page-level snapping (style.css)
// is switched on only while a story section is on screen, so the ordinary
// parts of the page keep scrolling freely.
function buildSnapping() {
  if (!window.matchMedia("(hover: none)").matches) return;
  const inView = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? inView.add(e.target) : inView.delete(e.target)));
    document.documentElement.classList.toggle("snap-on", inView.size > 0);
  });
  document.querySelectorAll(".opener, .scrolly").forEach((section) => observer.observe(section));

  // The browser's snapping should stop a hard fling at the next step, but
  // not every browser does. So when the page comes to rest more than one
  // step from where the reader started, glide back to the step just after
  // the start (or just before it, going up): a fling can never skip.
  const html = document.documentElement;
  const phone = window.matchMedia("(max-width: 900px)");
  // Where the page rests at each step: the top of the page, then every
  // step in order (as in style.css).
  const stops = () => [
    0,
    ...[...document.querySelectorAll(".opener-step, .scrolly-steps .step")].map((step) => {
      const top = step.getBoundingClientRect().top + window.scrollY;
      if (step.classList.contains("opener-step")) return top;
      return phone.matches ? top - 0.7 * window.innerHeight : top + step.offsetHeight / 2 - window.innerHeight / 2;
    }),
  ];
  let last = null;
  let touching = false;
  let timer = null;
  const settle = () => {
    if (!html.classList.contains("snap-on") || cueScrolling) {
      last = null;
      return;
    }
    const y = window.scrollY;
    const points = stops();
    const here = points.findIndex((p) => Math.abs(p - y) <= 24);
    if (here < 0) return; // between points: the browser is still settling
    if (last !== null && Math.abs(here - last) > 1) {
      last += Math.sign(here - last);
      window.scrollTo({ top: points[last], behavior: animate ? "smooth" : "auto" });
      return;
    }
    last = here;
  };
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!touching) settle();
      }, 160);
    },
    { passive: true },
  );
  // Where the reader starts (the top of the page, or wherever a reload left
  // them) counts as a resting step too.
  setTimeout(settle, 600);
  window.addEventListener("touchstart", () => (touching = true), { passive: true });
  ["touchend", "touchcancel"].forEach((type) => window.addEventListener(type, () => (touching = false), { passive: true }));
}

// True while a scroll cue is gliding the page, so the step guard doesn't
// treat it as a fling.
let cueScrolling = false;
const glide = (y, duration) => {
  cueScrolling = true;
  const done = () => setTimeout(() => (cueScrolling = false), 250);
  if (animate) gsap.to(window, { scrollTo: y, duration, ease: "power2.inOut", onComplete: done });
  else {
    window.scrollTo(0, y);
    done();
  }
};

function buildStepCues() {
  document.querySelectorAll(".step:not(.opener-spacer)").forEach((step) => {
    const card = step.classList.contains("opener-step") ? step.querySelector("p") : step;
    card.insertAdjacentHTML("beforeend", cueButton());
  });

  // Pinned sections also get one at the foot of the graphic, shown while
  // none of the section's text cards is on screen (on phones, while its
  // caption box is still empty): as the section first comes into view, say.
  document.querySelectorAll(".scrolly").forEach((section) => {
    const graphic = section.querySelector(".scrolly-graphic");
    graphic.insertAdjacentHTML("beforeend", cueButton("graphic-next"));
    const caption = graphic.querySelector(".step-caption");
    const onScreen = new Set();
    section.updateIdle = () =>
      section.classList.toggle(
        "is-idle",
        phoneLayout.matches ? !caption || !caption.textContent.trim() : onScreen.size === 0,
      );
    const watch = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target)));
      section.updateIdle();
    });
    section.querySelectorAll(".step").forEach((step) => watch.observe(step));
    section.updateIdle();
  });

  // And the sections with no text box end with one that leads on.
  document.querySelectorAll(".north-south, .county-detail").forEach((section) => {
    section.insertAdjacentHTML("beforeend", cueButton("section-next"));
  });

  const steps = [...document.querySelectorAll(".step:not(.opener-spacer)")];
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".step-next");
    if (!button) return;
    // Land a step in its trigger band (lower on phones), or a section's top
    // just under the header.
    const band = phoneLayout.matches ? 0.72 : 0.45;
    let target;
    if (button.classList.contains("graphic-next")) {
      // The section's next step that hasn't reached the band yet.
      const section = button.closest(".scrolly");
      target =
        [...section.querySelectorAll(".step")].find(
          (s) => s.getBoundingClientRect().top > window.innerHeight * band + 10,
        ) || section.nextElementSibling;
    } else if (button.classList.contains("section-next")) {
      target = button.closest("section").nextElementSibling;
    } else {
      const step = button.closest(".step") || button.closest(".step-caption").step;
      const next = steps[steps.indexOf(step) + 1];
      const section = step.closest("section");
      // Is the next step in the same section? Otherwise go to the next section.
      target = next && next.closest("section") === section ? next : section.nextElementSibling;
    }
    if (!target) return;
    // Opener steps are a screen tall with the sentence at the foot: land
    // their top at the top of the screen.
    const offset = target.classList.contains("opener-step") ? 0 : target.classList.contains("step") ? window.innerHeight * band : 0;
    const y = target.getBoundingClientRect().top + window.scrollY - offset;
    glide(y, 1);
  });
}

// The opening screen's scroll cue. Tapping it glides to the first sentence.
// And if the reader hasn't scrolled after a few seconds, the screen lifts a
// little and settles back, once, a hint that there's more below.
function buildScrollHint() {
  const cue = document.getElementById("hero-scroll");
  const first = document.querySelector(".opener-step");
  if (!cue || !first) return;

  cue.addEventListener("click", () => {
    // An opener step is a full screen tall with its sentence at the foot,
    // so land its top at the top of the screen.
    const y = first.getBoundingClientRect().top + window.scrollY;
    glide(y, 1.2);
  });

  if (!animate) return;
  const opener = document.getElementById("opener");
  const timer = setTimeout(nudge, 3000);
  function nudge() {
    if (window.scrollY > 10) return;
    gsap
      .timeline()
      .to(opener, { y: -40, duration: 0.45, ease: "power2.out" })
      .to(opener, { y: 0, duration: 0.9, ease: "bounce.out" });
  }
  window.addEventListener(
    "scroll",
    function stop() {
      if (window.scrollY <= 10) return;
      clearTimeout(timer);
      gsap.killTweensOf(opener);
      gsap.set(opener, { y: 0 });
      window.removeEventListener("scroll", stop);
    },
    { passive: true },
  );
}

// The conclusion's three cards drop in one after another, settling at their
// slight tilt.
function buildFindings() {
  const cards = document.querySelectorAll(".finding-card");
  if (!animate || !cards.length) return;
  gsap.set(cards, { opacity: 0, y: 24 });
  onceInView(document.querySelector(".findings"), () => {
    gsap.to(cards, { opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.6)", stagger: 0.18 });
  }, 0.3);
}

// An orange pen underline under each chapter heading, drawn across when the
// heading first comes into view. It's a background on the heading's text
// (style.css), so it follows the words: one stroke per line, as long as the
// line, however the heading wraps.
function buildHeadingUnderlines() {
  document.querySelectorAll(".chapter-head .section-title").forEach((title) => {
    title.innerHTML = `<span class="title-ink">${title.innerHTML}</span>`;
    if (!animate) {
      title.classList.add("is-drawn");
      return;
    }
    onceInView(title, () => title.classList.add("is-drawn"), 0.5);
  });
}

// Diagonal hatch patterns for the map counties: a pale wash of the county's
// colour with pen strokes over it, like the sketched maps. One pattern per
// county and map, recoloured in place when the year changes.
const hatchDefs = document.getElementById("hatches");

function hatchFill(id, colour) {
  let pattern = document.getElementById(id);
  if (!pattern) {
    hatchDefs.insertAdjacentHTML(
      "beforeend",
      `<pattern id="${id}" patternUnits="userSpaceOnUse" width="4.5" height="4.5" patternTransform="rotate(-41)">` +
        `<rect width="4.5" height="4.5" fill-opacity="0.4" />` +
        `<line x1="2.25" y1="0" x2="2.25" y2="4.5" stroke-width="2.2" />` +
        `</pattern>`,
    );
    pattern = document.getElementById(id);
  }
  pattern.firstChild.setAttribute("fill", colour);
  pattern.lastChild.setAttribute("stroke", colour);
  return `url(#${id})`;
}

function styleCounty(feature) {
  const countyName = feature.properties.COUNTY;
  const value = currentYearData()[countyName];

  // Thin ink borders and hatched fills, as on the sketched maps.
  return {
    color: INK,
    weight: 0.7,
    opacity: 0.75,
    fillColor: hatchFill(`hatch-${countyName}`, getCountyColour(value)),
    fillOpacity: 1,
  };
}

const canHover = window.matchMedia("(hover: hover)").matches;

function addCountyInteraction(feature, layer) {
  const countyName = feature.properties.COUNTY;
  layersByCounty[countyName] = layer;

  // Touch screens have no hover, and on an iPhone anything that changes on
  // mouseover (the outline, the tooltip) turns the first tap into a "hover"
  // and swallows the click. So there a tap only pins, and the pinned label
  // shows the figure instead of a tooltip.
  if (canHover) {
    layer.bindTooltip(
      () => {
        const value = currentYearData()[countyName];
        const valueText = value == null ? "No data" : `${value.toFixed(1)}%`;
        return `<strong>${prettyName(countyName)}</strong>${valueText}`;
      },
      { sticky: true, direction: "top", offset: [0, -10], className: "county-tip" },
    );
    layer.on("mouseover", () => setHover(countyName));
    layer.on("mouseout", () => setHover(null));
  }
  layer.on("click", () => togglePin(countyName));
}

// Redraws the county outlines so only the pinned and hovered counties stand
// out, with both brought above their neighbours.
function refreshOutlines() {
  if (!countyLayer) return;

  countyLayer.setStyle(styleCounty);

  // Pinned last, so its heavier outline sits on top of a hovered neighbour.
  [hoverCounty, pinnedCounty].forEach((county) => {
    const layer = county && layersByCounty[county];
    if (layer) {
      layer.setStyle(county === pinnedCounty ? PINNED_STYLE : HOVER_STYLE);
      layer.bringToFront();
    }
  });
}

// Labels for the year's highest and lowest counties and the pinned one, so
// the extremes read without hovering. They sit beside the island, never on
// it, each joined to its county by a hand-drawn arrow: an overlay on the map
// (labels in a div, arrows in an svg), redrawn whenever the map changes.
const mapWrap = document.querySelector(".map-wrap");
mapWrap.insertAdjacentHTML(
  "beforeend",
  `<svg class="callout-arrows" aria-hidden="true"></svg><div class="callouts" aria-hidden="true"></div>`,
);
const calloutArrows = mapWrap.querySelector(".callout-arrows");
const calloutLabels = mapWrap.querySelector(".callouts");
// Room each side of the island for the labels.
const calloutRoom = () => (phoneLayout.matches ? 84 : 120);

// Where to anchor a county's label: the middle of its largest polygon, so
// offshore islands don't pull it out to sea.
function labelPoint(layer) {
  const latlngs = layer.getLatLngs();
  // A Polygon is [outer ring, ...holes]; a MultiPolygon is a list of those.
  const polygons = Array.isArray(latlngs[0][0]) ? latlngs : [latlngs];

  let best = null;
  let bestArea = -1;
  polygons.forEach((polygon) => {
    const b = L.latLngBounds(polygon[0]);
    const area = (b.getNorth() - b.getSouth()) * (b.getEast() - b.getWest());
    if (area > bestArea) {
      bestArea = area;
      best = b;
    }
  });

  return best.getCenter();
}

let previousLabels = new Set();

function updateLabels() {
  calloutLabels.innerHTML = "";
  calloutArrows.innerHTML = "";
  if (!countyLayer) return;

  const entries = Object.entries(currentYearData())
    .filter(([, v]) => v != null)
    .sort((a, b) => b[1] - a[1]);

  // Handwritten tags for the year's extremes, then the pinned county.
  const labelled = new Set();
  const notes = {};
  if (entries.length) {
    labelled.add(entries[0][0]);
    labelled.add(entries[entries.length - 1][0]);
    notes[entries[entries.length - 1][0]] = "fewest";
    notes[entries[0][0]] = "most";
  }
  if (pinnedCounty) labelled.add(pinnedCounty);

  const box = mapWrap.getBoundingClientRect();
  const mapBox = document.getElementById("map").getBoundingClientRect();
  const midX = mapBox.left - box.left + mapBox.width / 2;

  // Each label goes on the side of the island its county is on.
  const callouts = [...labelled]
    .filter((county) => county && layersByCounty[county] && map.getBounds().contains(labelPoint(layersByCounty[county])))
    .filter((county) => !focusCounties || focusCounties.includes(county) || county === pinnedCounty)
    .map((county) => {
      const point = map.latLngToContainerPoint(labelPoint(layersByCounty[county]));
      const anchor = [point.x + mapBox.left - box.left, point.y + mapBox.top - box.top];
      const value = currentYearData()[county];
      const el = document.createElement("div");
      el.className = "callout";
      el.innerHTML =
        (notes[county] ? `<i class="callout-note">${notes[county]}</i>` : "") +
        `<span class="callout-name">${phoneLayout.matches ? prettyName(county).split(" / ")[0] : prettyName(county)}</span>` +
        `<b>${value == null ? "no data" : `${value.toFixed(1)}%`}</b>`;
      calloutLabels.appendChild(el);
      return { county, anchor, el, side: anchor[0] < midX ? "left" : "right" };
    });

  // Stack each side's labels by their county's height, spaced so they
  // never overlap and kept inside the map's box.
  ["left", "right"].forEach((side) => {
    const group = callouts.filter((c) => c.side === side).sort((a, b) => a.anchor[1] - b.anchor[1]);
    let floor = mapBox.top - box.top;
    group.forEach((c) => {
      c.el.classList.add(`on-${side}`);
      const h = c.el.offsetHeight;
      c.top = Math.max(floor, c.anchor[1] - h / 2);
      floor = c.top + h + 8;
    });
    const bottom = mapBox.bottom - box.top;
    for (let k = group.length - 1; k >= 0; k--) {
      const c = group[k];
      const limit = k === group.length - 1 ? bottom : group[k + 1].top - 8;
      if (c.top + c.el.offsetHeight > limit) c.top = limit - c.el.offsetHeight;
    }
    group.forEach((c) => {
      c.el.style.top = `${c.top}px`;
    });
  });

  // The arrows: a wobbly curve from the label's inner edge into the county,
  // with an open head.
  calloutArrows.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  const rc = typeof rough !== "undefined" ? rough.svg(calloutArrows) : null;
  callouts.forEach((c, i) => {
    const r = c.el.getBoundingClientRect();
    const from = [c.side === "left" ? r.right - box.left + 4 : r.left - box.left - 4, r.top - box.top + r.height / 2];
    const [tx, ty] = c.anchor;
    // Stop just short of the county's middle, bending gently on the way.
    const dx = tx - from[0];
    const dy = ty - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const to = [tx - (dx / len) * 6, ty - (dy / len) * 6];
    const ctrl = [(from[0] + to[0]) / 2 - dy * 0.18, (from[1] + to[1]) / 2 + dx * 0.18];
    const dir = Math.atan2(to[1] - ctrl[1], to[0] - ctrl[0]);
    const arm = (turn) => [to[0] - 8 * Math.cos(dir + turn), to[1] - 8 * Math.sin(dir + turn)];
    const curve = `M${from[0]} ${from[1]} Q${ctrl[0]} ${ctrl[1]} ${to[0]} ${to[1]}`;
    if (rc) {
      const opts = { stroke: INK, strokeWidth: 1.6, roughness: 0.9, bowing: 0.8, seed: 40 + i };
      calloutArrows.appendChild(rc.path(curve, opts));
      calloutArrows.appendChild(rc.linearPath([arm(0.5), to, arm(-0.5)], { ...opts, roughness: 0.4 }));
    } else {
      calloutArrows.insertAdjacentHTML(
        "beforeend",
        `<path d="${curve} M${arm(0.5)} L${to} L${arm(-0.5)}" fill="none" stroke="${INK}" stroke-width="1.6"/>`,
      );
    }

    // Only counties that just gained a label fade in, so steps stay calm.
    if (animate && !previousLabels.has(c.county)) {
      gsap.from(c.el, { opacity: 0, duration: 0.2, ease: "power1.out" });
    }
  });

  previousLabels = labelled;
}

function setHover(countyName) {
  hoverCounty = countyName;
  refreshOutlines();
}

function togglePin(countyName) {
  pinnedCounty = pinnedCounty === countyName ? null : countyName;
  storyHeadline = null;
  lastFindingValue = null;
  refreshOutlines();
  updateLabels();
  updateContext();
}

// Renders the legend as a titled gradient bar matching the map's ramp, plus
// a swatch for counties with no data.
function buildLegend() {
  const legend = document.getElementById("legend");

  const gradientStops = [];
  for (let p = 0; p <= 100; p += 5) {
    gradientStops.push(`${getCountyColour((p / 100) * SCALE_MAX)} ${p}%`);
  }
  const gradient = `linear-gradient(to right, ${gradientStops.join(", ")})`;

  const ticks = [0, 10, 20, 40, 70]
    .map(
      (v) =>
        `<span class="tick" style="left:${(v / SCALE_MAX) * 100}%">${v}%</span>`,
    )
    .join("");

  legend.innerHTML =
    `<span class="legend-title">Share able to speak Irish</span>` +
    `<span class="legend-scale">` +
    `<span class="legend-bar hatched" style="background:${gradient}"></span>` +
    `<span class="legend-ticks">${ticks}</span>` +
    `</span>` +
    `<span class="legend-nodata"><i class="hatched"></i>No data</span>`;
}

let lastFindingValue = null;

// The line above the map: one lesson per step, with its figures worked out
// from the data (so they stay true if the data is corrected). Null once the
// reader takes the timeline or taps a county; then the line follows them.
let storyHeadline = null;
// The year the current step is travelling to: a step's line is always worked
// out for it, so its numbers don't change census by census on the way.
let storyYear = null;
let lastFindingHTML = "";

// Swaps the headline's text with a short fade, and only if it has changed.
function setFindingHTML(html) {
  if (html === lastFindingHTML) return;
  const first = !lastFindingHTML;
  lastFindingHTML = html;
  gsap.killTweensOf(findingEl);
  if (!animate || first) {
    findingEl.innerHTML = html;
    findingEl.style.opacity = 1;
    return;
  }
  gsap.to(findingEl, {
    opacity: 0,
    duration: 0.15,
    onComplete: () => {
      findingEl.innerHTML = html;
      gsap.to(findingEl, { opacity: 1, duration: 0.3 });
    },
  });
}

const hi = (text) => `<strong class="hi">${text}</strong>`;
const first = () => years[0];
// The counties that led in 1851: above 40% that year.
const heartland = () => Object.keys(allData[first()]).filter((c) => allData[first()][c] >= 40);
const mean = (list) => list.reduce((t, v) => t + v, 0) / list.length;
const MAP_HEADLINES = {
  west: () => `Irish lived in the ${hi("west")}: ${hi(`${heartland().length} counties`)} topped 40%.`,
  galway: () => `In Galway, ${hi(`${allData[first()].GALWAY.toFixed(1)}%`)} could speak Irish: two in three.`,
  mayo: (year) => {
    const then = mean(heartland().map((c) => allData[first()][c]));
    const now = mean(heartland().map((c) => allData[year][c]));
    return `The heartland fell from ${hi(`${Math.round(then)}%`)} to ${hi(`${Math.round(now)}%`)}.`;
  },
  "north-gap": () => `After partition, the North ${hi("stopped counting")}.`,
  dublin: (year) => {
    const up = allData[year].DUBLIN - allData["1911"].DUBLIN;
    const down = allData["1911"].GALWAY - allData[year].GALWAY;
    return `Ability moved east: Dublin ${hi(`up ${Math.round(up)}`)}, Galway ${hi(`down ${Math.round(down)}`)}.`;
  },
  slow: (year) => {
    const avg = (y) => Math.round(mean(Object.entries(allData[y]).filter(([c, v]) => v != null && !NI_COUNTIES.has(c)).map(([, v]) => v)));
    return `Slow years: the average crept from ${hi(`${avg("1961")}%`)} to ${hi(`${avg(year)}%`)}.`;
  },
  "north-returns": (year) => {
    const vals = (test) => Object.entries(allData[year]).filter(([c, v]) => v != null && test(c)).map(([, v]) => v);
    return `The North is back at ${hi(`${Math.round(Math.min(...vals((c) => NI_COUNTIES.has(c))))}–${Math.round(Math.max(...vals((c) => NI_COUNTIES.has(c))))}%`)}; the Republic averages ${hi(`${Math.round(mean(vals((c) => !NI_COUNTIES.has(c))))}%`)}.`;
  },
  jump: (year) => {
    const over = (y) => Object.entries(allData[y]).filter(([c, v]) => v != null && !NI_COUNTIES.has(c) && v >= 40).length;
    return `In five years, counties above 40% went from ${hi(over("1991"))} to ${hi(over(year))}.`;
  },
  wicklow: (year) => {
    const vals = (test) => Object.entries(allData[year]).filter(([c, v]) => v != null && test(c)).map(([, v]) => v);
    const rep = vals((c) => !NI_COUNTIES.has(c));
    const ni = vals((c) => NI_COUNTIES.has(c));
    return `The divide now runs north to south: ${hi(`${Math.floor(Math.min(...rep))}–${Math.ceil(Math.max(...rep))}%`)} against ${hi(`${Math.floor(Math.min(...ni))}–${Math.ceil(Math.max(...ni))}%`)}.`;
  },
};

function updateContext() {
  const year = currentYear;

  const entries = Object.entries(currentYearData()).filter(
    ([, v]) => v != null,
  );

  if (!entries.length) {
    findingEl.textContent = `No county data is available for ${year}.`;
    return;
  }

  entries.sort((a, b) => b[1] - a[1]);

  // A step's own line for the story (see MAP_HEADLINES), until the reader
  // takes over the timeline or taps a county.
  if (storyHeadline && MAP_HEADLINES[storyHeadline]) {
    const ty = storyYear || year;
    const tEntries = Object.entries(allData[ty]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
    setFindingHTML(MAP_HEADLINES[storyHeadline](ty, tEntries));
    findingEl.dataset.mode = `story-${storyHeadline}`;
    lastFindingValue = null;
    return;
  }
  lastFindingHTML = "";

  // Otherwise about the pinned county when there is one (the step's, or the
  // reader's tap), or else the year's whole range, low to high.
  const pinnedValue = pinnedCounty ? currentYearData()[pinnedCounty] : null;
  const mode = !pinnedCounty ? "range" : pinnedValue == null ? "none" : "pinned";
  if (mode === "range") {
    const [hiName, hiVal] = entries[0];
    const [loName, loVal] = entries[entries.length - 1];
    findingEl.innerHTML =
      `<strong>${year}</strong>: from <strong class="hi">${loVal.toFixed(1)}%</strong> ` +
      `in ${prettyName(loName).split(" / ")[0]} to <strong class="hi">${hiVal.toFixed(1)}%</strong> in ${prettyName(hiName).split(" / ")[0]}.`;
    findingEl.dataset.mode = mode;
    lastFindingValue = null;
    return;
  }
  const [name, value] = [pinnedCounty, pinnedValue];

  if (mode === "none") {
    findingEl.innerHTML =
      `In <strong>${year}</strong> there is no figure for <strong class="hi">${prettyName(name)}</strong>.`;
    findingEl.dataset.mode = mode;
    lastFindingValue = null;
    return;
  }

  // The sentence is built once per kind and then only its parts change, so
  // the counting number keeps its element between years.
  if (findingEl.dataset.mode !== mode) {
    findingEl.dataset.mode = mode;
    lastFindingValue = null;
    findingEl.innerHTML =
      `In <strong id="finding-year"></strong>, <strong class="hi" id="finding-value"></strong> ` +
      `of people in <strong class="hi" id="finding-county"></strong> could speak Irish.`;
  }
  document.getElementById("finding-year").textContent = year;
  tweenPercent(document.getElementById("finding-value"), lastFindingValue, value);
  lastFindingValue = value;
  document.getElementById("finding-county").textContent = prettyName(name);
}

// ─────────────────────────────────────────────
// 5. RENDERING
// ─────────────────────────────────────────────

let countyGeojson = null;
// The opener's light copy of the boundaries (data/opener.geojson), loaded
// with the census figures so the opening map draws at once.
let openerGeojson = null;

// A gentle, repeatable wobble for the county outlines, so they read as drawn
// by hand. It depends only on the point, so neighbouring counties move their
// shared borders together and no gaps open. Baked into the shapes once, it
// costs nothing when they move, unlike an SVG filter, which a phone has to
// redraw on every frame.
function wobble([lon, lat]) {
  const a = 0.018;
  return [
    lon + a * (Math.sin(lat * 23 + lon * 7) + 0.5 * Math.sin(lat * 51 - lon * 37)),
    lat + a * 0.6 * (Math.sin(lon * 19 - lat * 11) + 0.5 * Math.sin(lon * 43 + lat * 29)),
  ];
}

function wobbleGeojson(geojson) {
  const rings = (geometry) =>
    geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  geojson.features.forEach((feature) => {
    rings(feature.geometry).forEach((ring) => {
      ring.forEach((point, i) => {
        ring[i] = wobble(point);
      });
    });
  });
}

// Expects allData to already be loaded and currentYear to be set.
// `download` is the fetch of data/counties.geojson, started early.
async function loadCountyBoundaries(download) {
  const response = await download;

  if (!response.ok) {
    throw new Error(`Could not load GeoJSON: ${response.status}`);
  }

  const geojson = await response.json();
  wobbleGeojson(geojson);
  countyGeojson = geojson;

  countyLayer = L.geoJSON(geojson, {
    style: styleCounty,
    onEachFeature: addCountyInteraction,
  }).addTo(map);
  // Draw well beyond the screen (see redrawMapLayer), so the edges stay
  // covered between redraws.
  const renderer = countyLayer.getLayers()[0] && countyLayer.getLayers()[0]._renderer;
  if (renderer) renderer.options.padding = 0.4;

  fitIsland();
}

// If the map's box changes size (a rotated phone, a resized window), refit
// once it has settled, and never in the middle of a camera move.
let refitTimer = null;
new ResizeObserver(() => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(() => {
    if (countyLayer && !flying) fitIsland();
  }, 100);
}).observe(document.getElementById("map"));

// The camera moves with the story, on every screen size: each map step can
// name the counties it is about (data-focus), and the map flies in on them,
// then back out for the overview steps. The fly is one long, eased move of
// zoom and position together; the map never changes size meanwhile (nothing
// else on the page moves with a step), so nothing interrupts it.
let focusCounties = null;

function focusBounds() {
  const layers = (focusCounties || []).map((c) => layersByCounty[c]).filter(Boolean);
  if (!layers.length) return countyLayer.getBounds();
  return layers.reduce((b, l) => b.extend(l.getBounds()), L.latLngBounds([]));
}

// Room kept clear above the island for the line over the map (desktop).
const headlineRoom = () => (window.matchMedia("(min-width: 901px)").matches ? 52 : 8);

function fitIsland(animated = false) {
  map.invalidateSize();
  const room = calloutRoom();
  // A little more breathing room when framing a few counties.
  const air = focusCounties ? 24 : 8;
  const options = { paddingTopLeft: [room, Math.max(air, headlineRoom())], paddingBottomRight: [room, air] };
  if (animated && animate) {
    const bounds = focusBounds();
    const target = map._getBoundsCenterZoom(bounds, options);
    const size = map.getSize();
    const zoomGap = Math.abs(map.getZoom() - target.zoom);
    const drift = map.latLngToContainerPoint(target.center).distanceTo(size.divideBy(2)) / Math.min(size.x, size.y);
    // Already there (the section's first step, say): no move at all, so the
    // labels stay put instead of hiding for a move that never happens.
    if (zoomGap < 0.03 && drift < 0.01) return;
    // The labels wait for the camera to arrive (see the move events below).
    // A short hop is quick; a long one takes up to a second.
    const duration = Math.min(1.0, 0.55 + zoomGap * 0.2 + drift * 0.3);
    map.flyToBounds(bounds, { ...options, duration, easeLinearity: 0.25 });
    return;
  }
  map.stop();
  map.fitBounds(focusBounds(), { ...options, animate: false });
  updateLabels();
}

// The name labels hide while the camera moves, and come back, placed for
// the new view, when it stops.
let flying = false;

// While the camera flies, Leaflet only stretches the picture it drew when the
// move began: zooming in, that picture turns blurry (thick stripes, soft
// outlines); zooming out, it shrinks into a small block with nothing drawn
// around it until the very end. So the map layer is redrawn at the current
// zoom every so often during the move (a redraw is a few milliseconds), and
// the picture is never stretched far. Redraws pace themselves: never more
// often than twice their own cost, so a slow phone isn't swamped.
let drawnZoom = 0;
let drawnCenter = null;
let drawnAt = 0;
let drawCost = 8;

function redrawMapLayer() {
  const layer = countyLayer && countyLayer.getLayers()[0];
  const renderer = layer && layer._renderer;
  if (!renderer) return;
  const started = performance.now();
  renderer._reset(); // what Leaflet does after a zoom: re-project and redraw
  drawCost = performance.now() - started;
  drawnZoom = map.getZoom();
  drawnCenter = map.getCenter();
  drawnAt = performance.now();
}

map.on("move", () => {
  if (!flying || !drawnCenter) return;
  const now = performance.now();
  if (now - drawnAt < Math.max(60, drawCost * 3)) return;
  const size = map.getSize();
  const drift = map.latLngToContainerPoint(drawnCenter).distanceTo(size.divideBy(2));
  if (Math.abs(map.getZoom() - drawnZoom) > 0.14 || drift > Math.min(size.x, size.y) * 0.18) redrawMapLayer();
});

map.on("movestart", () => {
  flying = true;
  drawnZoom = map.getZoom();
  drawnCenter = map.getCenter();
  drawnAt = performance.now();
  calloutLabels.classList.add("is-moving");
  calloutArrows.classList.add("is-moving");
});
map.on("moveend", () => {
  flying = false;
  calloutLabels.classList.remove("is-moving");
  calloutArrows.classList.remove("is-moving");
  if (countyLayer) updateLabels();
});

// The map box changes size with the layout, so refit the island to it.
window.addEventListener("resize", () => {
  if (countyLayer) fitIsland();
  // The sketches scale with their viewBox; the D3 charts are drawn at their
  // width, so they're redrawn (without replaying their animations). Phones
  // fire resize as the address bar hides, so only a real width change counts.
  if (storyView && storyChart.clientWidth !== storyView.w) buildStoryChart();
  if (guessView && guessChart.clientWidth !== guessView.w) buildGuessChart();
  if (nsView && document.getElementById("north-south").clientWidth !== nsView.w) renderNorthSouth();
});

// ─────────────────────────────────────────────
// 6. EVENTS
// ─────────────────────────────────────────────

// Moves the whole page to the given census year. Used by the map's scroll
// steps.
// Moving between the map's steps travels through time: every census between
// the current year and the step's is shown in turn (forwards or backwards),
// so the map changes like a timeline rather than leaping decades. A long
// trip goes a little faster per census, so no step takes more than about
// two seconds. A new step, or the reader taking the timeline, stops a trip.
let travelTimer = null;
let travelling = false;

function stopTravel() {
  clearTimeout(travelTimer);
  travelTimer = null;
  travelling = false;
}

function travelTo(year) {
  stopTravel();
  const from = years.indexOf(currentYear);
  const to = years.indexOf(year);
  if (!animate || from < 0 || to < 0 || from === to) {
    setYear(year);
    return;
  }
  const dir = Math.sign(to - from);
  const count = Math.abs(to - from);
  const pace = Math.max(70, Math.min(180, 1000 / count));
  let i = from;
  travelling = true;
  const next = () => {
    i += dir;
    if (i === to) travelling = false;
    setYear(years[i]);
    if (i !== to) travelTimer = setTimeout(next, pace);
    else travelTimer = null;
  };
  next();
}

function setYear(year) {
  currentYear = year;
  yearLabel.textContent = year;
  timelineTrack.setAttribute("aria-valuenow", year);

  stops.forEach((stop) => {
    const isCurrent = stop.dataset.year === year;
    stop.classList.toggle("is-current", isCurrent);
    if (!isCurrent) return;

    // The fill and the handle follow the selected census.
    const pct = parseFloat(stop.style.left);
    if (animate) {
      // Short and even, so a trip through the years glides steadily.
      const tween = { duration: travelTimer ? 0.2 : 0.35, ease: travelTimer ? "none" : "power2.out" };
      gsap.to(trackFill, { width: `${pct}%`, ...tween });
      gsap.to(trackHandle, { left: `${pct}%`, ...tween });
    } else {
      trackFill.style.width = `${pct}%`;
      trackHandle.style.left = `${pct}%`;
    }
  });

  refreshOutlines();
  updateContext();
  // The name labels sit out the trip (they'd flicker at every census) and
  // come back, rebuilt, when the map arrives.
  calloutLabels.classList.toggle("is-travelling", travelling);
  calloutArrows.classList.toggle("is-travelling", travelling);
  if (!travelling) updateLabels();

  // Keep an open tooltip in step with the new year.
  if (hoverCounty && layersByCounty[hoverCounty].isTooltipOpen()) {
    layersByCounty[hoverCounty].getTooltip().update();
  }
}

// ─────────────────────────────────────────────
// 6b. SCROLL STEPS
// ─────────────────────────────────────────────

// Scroll steps, after the sticky-graphic stories on The Pudding: as each
// step reaches the trigger line it updates its graphic. Map steps (data-year)
// move the map to their census and pin their county (or none), so only the
// steps decide what's outlined; chart steps (data-story) switch the story
// chart to their stage.
const storySteps = Array.from(document.querySelectorAll(".step"));

// Phones: a fixed caption box at the bottom of each pinned graphic shows the
// active step's text, crossfading as the reader scrolls, so no card slides
// across the graphic it describes. The steps stay in the page, invisible, as
// the scroll triggers and for screen readers.
const phoneLayout = window.matchMedia("(max-width: 900px)");

document.querySelectorAll(".scrolly-graphic, .opener-graphic").forEach((graphic) => {
  const caption = document.createElement("div");
  caption.className = "step-caption";
  caption.setAttribute("aria-hidden", "true");
  graphic.appendChild(caption);
  // The box's height changes with each step's text; the graphic reserves
  // exactly that much room under its map or chart (--cap-h in style.css).
  new ResizeObserver(() => {
    if (caption.offsetHeight) graphic.style.setProperty("--cap-h", `${caption.offsetHeight}px`);
  }).observe(caption);
});

// Words marked in a step's text (class "rough-mark", with a data-colour)
// get a hand-swept RoughNotation highlight when the step comes up: on the
// card itself, or on phones in the caption box that shows it.
function markWords(container) {
  if (typeof RoughNotation === "undefined") return;
  container.querySelectorAll(".rough-mark:not(.is-marked)").forEach((el) => {
    el.classList.add("is-marked");
    RoughNotation.annotate(el, {
      type: "highlight",
      color: el.dataset.colour,
      multiline: true,
      iterations: 2,
      animate,
      animationDuration: 800,
    }).show();
  });
}

// The headline and the caption box change text at every step, and with it
// their height, which used to shove the map up and down. Both are now given
// the height of the tallest text they will hold, so nothing around them moves.
function measureHeight(host, texts) {
  const probe = host.cloneNode(false);
  probe.removeAttribute("id");
  probe.style.cssText += ";position:absolute;visibility:hidden;pointer-events:none;min-height:0;height:auto;opacity:1;transform:none;left:0;right:0;top:0;bottom:auto";
  probe.style.width = `${host.offsetWidth}px`;
  host.parentNode.appendChild(probe);
  let tallest = 0;
  texts.forEach((html) => {
    probe.innerHTML = html;
    tallest = Math.max(tallest, probe.offsetHeight);
  });
  probe.remove();
  return tallest;
}

function steadySizes() {
  // Not before the census data has loaded (a resize can fire during loading).
  if (!findingEl || !years.length) return;
  // The headline: every step's line, plus the lines for exploring.
  const lines = [...document.querySelectorAll(".scrolly:not(.scrolly-chart):not(.scrolly-people) .step[data-headline]")]
    .filter((step) => MAP_HEADLINES[step.dataset.headline])
    .map((step) => {
      const y = step.dataset.year;
      const entries = Object.entries(allData[y]).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);
      return MAP_HEADLINES[step.dataset.headline](y, entries);
    });
  lines.push(
    `<strong>2022</strong>: from <strong class="hi">4.1%</strong> in Down to <strong class="hi">48.8%</strong> in Galway.`,
    `In <strong>1911</strong>, <strong class="hi">38.0%</strong> of people in <strong class="hi">Derry / Londonderry</strong> could speak Irish.`,
  );
  findingEl.style.minHeight = "0px";
  findingEl.style.minHeight = `${Math.ceil(measureHeight(findingEl, lines))}px`;

  // Each caption box: its section's tallest step.
  document.querySelectorAll(".scrolly-graphic, .opener-graphic").forEach((graphic) => {
    const caption = graphic.querySelector(".step-caption");
    if (!caption) return;
    caption.style.minHeight = "";
    if (!phoneLayout.matches) return;
    const host = graphic.closest(".scrolly, .opener");
    const texts = [...host.querySelectorAll(".step:not(.opener-spacer)")].map((s) => s.innerHTML);
    caption.style.minHeight = `${Math.ceil(measureHeight(caption, texts))}px`;
  });
}

let steadyWidth = 0;
function refreshSteady() {
  steadyWidth = window.innerWidth;
  steadySizes();
}
window.addEventListener("resize", () => {
  if (window.innerWidth !== steadyWidth) refreshSteady();
});

function showCaption(step) {
  const host = step.closest(".scrolly, .opener");
  const caption = host && host.querySelector(".step-caption");
  if (!caption || caption.step === step) return;
  caption.step = step;
  const html = step.classList.contains("opener-spacer") ? "" : step.innerHTML;
  if (!animate || !phoneLayout.matches) {
    caption.innerHTML = html;
    host.updateIdle?.();
    if (phoneLayout.matches) markWords(caption);
    return;
  }
  gsap.killTweensOf(caption);
  gsap.to(caption, {
    opacity: 0,
    y: 8,
    duration: 0.15,
    ease: "power1.in",
    onComplete: () => {
      caption.innerHTML = html;
      host.updateIdle?.();
      gsap.to(caption, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", onComplete: () => markWords(caption) });
    },
  });
}

const stepObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const step = entry.target;
      // The opener can move as soon as it's drawn; the other steps need the
      // main map.
      if (!entry.isIntersecting || (!countyLayer && !step.dataset.opener)) return;
      const group = step.closest(".scrolly-steps, .opener-steps");
      group
        .querySelectorAll(".step")
        .forEach((other) => other.classList.toggle("is-active", other === step));
      showCaption(step);
      if (!phoneLayout.matches) markWords(step);

      if (step.dataset.opener) {
        opener.dataset.stage = step.dataset.opener;
        setOpenerStage(Number(step.dataset.opener));
        return;
      }
      if (step.dataset.people) {
        setPeopleStage(Number(step.dataset.people));
        return;
      }
      if (step.dataset.story) {
        setStoryStep(Number(step.dataset.story));
        return;
      }
      pinnedCounty = step.dataset.county || null;
      storyHeadline = step.dataset.headline || null;
      storyYear = step.dataset.year;
      focusCounties = step.dataset.focus ? step.dataset.focus.split(",") : null;
      travelTo(step.dataset.year);
      fitIsland(true);
    });
  },
  // The trigger band: a fifth of the screen around the middle on desktop,
  // so a fast flick can't skip a step; lower on phones, where the graphic
  // fills the top of the screen and the steps rest below it. The gaps
  // between steps (45svh) keep two from being in the band at once.
  window.matchMedia("(max-width: 900px)").matches
    ? { rootMargin: "-68% 0px -14% 0px" }
    : { rootMargin: "-40% 0px -40% 0px" },
);

storySteps.forEach((step) => stepObserver.observe(step));

// ─────────────────────────────────────────────
// 6c. THE GUESS
// ─────────────────────────────────────────────

// The reader picks a county and guesses its 1851 share before seeing any
// data (after the NYT's "You Draw It"). The card is drawn empty from the
// start: their guess as a bar and a dot, a "?" for the answer and blank axes.
// Revealing grows the real bar, then draws the county's line across every
// census. Their county then stays pinned on the map.
const guessCounty = document.getElementById("guess-county");
const guessRange = document.getElementById("guess-range");
const guessOutput = document.getElementById("guess-output");
const guessChart = document.getElementById("guess-chart");
const guessReaction = document.getElementById("guess-reaction");

// The county whose answer is showing, or null while the card is empty.
let revealedCounty = null;
// The drawn chart: its scales and the pieces the reveal animates.
let guessView = null;

const GUESS_HINT = "Tap Reveal to see how close you were.";

function buildGuess() {
  guessReaction.classList.add("is-hint");
  guessReaction.textContent = GUESS_HINT;
  guessCounty.innerHTML = Object.keys(layersByCounty)
    .sort((a, b) => prettyName(a).localeCompare(prettyName(b)))
    .map((county) => `<option value="${county}"${county === "DUBLIN" ? " selected" : ""}>${prettyName(county)}</option>`)
    .join("");
  buildGuessChart();
}

// Draws the card at its container's width, so the text stays readable on a
// phone. Called again on resize; a revealed answer is redrawn without
// replaying the animation.
function buildGuessChart() {
  if (typeof d3 === "undefined") return;
  const narrow = guessChart.clientWidth < 520;
  const view = lineFrame(guessChart, { h: narrow ? 372 : 440, top: 132 });
  const { svg, x, y, w, first } = view;
  svg.classed("guess-svg", true);
  const labelW = narrow ? 112 : 140;
  const valueW = 58;
  const barH = 18;
  const bx = d3.scaleLinear().domain([0, SCALE_MAX]).range([labelW, w - valueW]);

  // Two bars: the guess, and the answer as an empty dashed box with a "?".
  const bar = (rowY, cls) => {
    const g = svg.append("g").attr("class", `guess-row ${cls}`).attr("transform", `translate(0, ${rowY})`);
    g.append("text").attr("class", "guess-label").attr("y", barH * 0.75);
    g.append("line")
      .attr("class", "ns-guide")
      .attr("x1", bx(0)).attr("x2", bx(SCALE_MAX))
      .attr("y1", barH / 2).attr("y2", barH / 2);
    g.append("rect").attr("class", "guess-fill").attr("x", bx(0)).attr("height", barH).attr("width", 0);
    g.append("text").attr("class", "guess-value").attr("x", w).attr("text-anchor", "end").attr("y", barH * 0.75);
    return g;
  };
  const guessRow = bar(14, "is-guess");
  const realRow = bar(58, "is-real");
  guessRow.select(".guess-label").text("Your guess");
  guessRow.select(".guess-fill").attr("fill", hatchFill("ghatch-guess", ORANGE));
  realRow
    .insert("rect", ".guess-fill")
    .attr("class", "guess-empty")
    .attr("x", bx(0)).attr("width", bx(SCALE_MAX) - bx(0)).attr("height", barH);
  realRow.select(".guess-fill").attr("fill", hatchFill("ghatch-real", GREEN));
  realRow.select(".guess-value").text("?");

  // Shown while there's no answer yet.
  const mid = (x(first) + x(view.last)) / 2;
  const empty = svg.append("g").attr("class", "guess-placeholder");
  empty.append("text").attr("class", "guess-q").attr("x", mid).attr("y", y(SCALE_MAX * 0.5)).attr("text-anchor", "middle").text("?");
  empty.append("text")
    .attr("class", "guess-hint")
    .attr("x", mid).attr("y", y(SCALE_MAX * 0.5) + 30)
    .attr("text-anchor", "middle").text("Reveal to draw its history");

  const lines = addHistoryLines(view);
  const realDot = svg.append("circle").attr("class", "guess-dot is-real").attr("r", 6).attr("cx", x(first));

  // The guess on the chart: an orange dot at 1851 with a note.
  const guessDot = svg.append("g").attr("class", "guess-dot-group");
  guessDot.append("circle").attr("class", "guess-dot is-guess").attr("r", 7).attr("cx", x(first));
  guessDot.append("text").attr("class", "guess-note").attr("x", x(first) + 14).text("your guess");

  guessView = { ...view, bx, guessRow, realRow, empty, lines, realDot, guessDot };
  setGuessLabel();
  setGuessValue();
  [lines.average, lines.county, lines.averageLabel, lines.countyLabel, realDot].forEach((el) => el.attr("opacity", 0));
  if (revealedCounty) revealGuess(false);
}

function setGuessLabel() {
  if (!guessView) return;
  // "Derry / Londonderry" is too long for a phone's label column.
  const name = prettyName(guessCounty.value);
  guessView.realRow.select(".guess-label").text(`${guessView.narrow ? name.split(" / ")[0] : name}, ${years[0]}`);
}

// Follows the slider: no transition, so the bar and dot track the thumb.
function setGuessValue() {
  if (!guessView) return;
  const { bx, y, guessRow, guessDot } = guessView;
  const guess = Number(guessRange.value);
  guessRow.select(".guess-fill").attr("width", bx(guess) - bx(0));
  guessRow.select(".guess-value").text(`${guess}%`);
  guessDot.select("circle").attr("cy", y(guess));
  guessDot.select("text").attr("y", y(guess) + 5);
}

// The reveal, in order: the "?" fades, the real bar grows as its number
// counts up, the reaction appears, then the average and the county's line
// draw across every census. `play` false shows the end state at once.
function revealGuess(play = true) {
  if (!guessView) return;
  const countyName = guessCounty.value;
  const guess = Number(guessRange.value);
  const actual = allData[years[0]][countyName];
  const { bx, y, realRow, empty, lines, realDot } = guessView;
  const t = play && animate ? 1 : 0;

  empty.transition("reveal").duration(300 * t).attr("opacity", 0);

  realRow.select(".guess-fill")
    .transition("reveal").delay(200 * t).duration(1100 * t).ease(d3.easeCubicInOut)
    .attr("width", bx(actual) - bx(0));
  realRow.select(".guess-value")
    .transition("reveal").delay(200 * t).duration(1100 * t).ease(d3.easeCubicInOut)
    .tween("text", function () {
      const count = d3.interpolateNumber(0, actual);
      return (k) => { this.textContent = `${count(k).toFixed(1)}%`; };
    });

  const off = Math.abs(guess - actual);
  const reaction = off <= 5 ? "Spot on!" : off <= 15 ? "Not far off." : "Quite a gap!";
  guessReaction.classList.remove("is-hint");
  guessReaction.innerHTML =
    `<strong>${reaction}</strong> In ${years[0]}, ${actual.toFixed(1)}% of people in ` +
    `${prettyName(countyName)} could speak Irish; you guessed ${guess}%. ` +
    `Here is everything since, against the Republic&rsquo;s average.`;
  guessReaction.classList.remove("is-shown");
  setTimeout(() => guessReaction.classList.add("is-shown"), 1100 * t);

  setHistory(guessView, lines, countyName);
  // The bar above already says "Your guess"; the note would sit on the lines.
  guessView.guessDot.select("text").interrupt("reveal").transition("reveal").delay(1200 * t).duration(300 * t).attr("opacity", 0);
  realDot.attr("cy", y(actual)).attr("fill", hatchFill("ghatch-dot", GREEN));
  realDot.transition("reveal").delay(1200 * t).duration(300 * t).attr("opacity", 1);
  drawPath(lines.average, 1300 * t, 1700 * t);
  drawPath(lines.county, 1500 * t, 1700 * t);
  [lines.averageLabel, lines.countyLabel].forEach((label) =>
    label.transition("reveal").delay(3000 * t).duration(400 * t).attr("opacity", 1),
  );
  revealedCounty = countyName;
}

// Changing the county or the guess after a reveal empties the card again,
// ready for another go.
function resetGuess() {
  if (!revealedCounty || !guessView) return;
  revealedCounty = null;
  const { realRow, empty, lines, realDot } = guessView;
  const t = animate ? 1 : 0;
  realRow.select(".guess-fill").transition("reveal").duration(400 * t).ease(d3.easeCubicInOut).attr("width", 0);
  realRow.select(".guess-value").interrupt("reveal").text("?");
  [lines.average, lines.county, lines.averageLabel, lines.countyLabel, realDot].forEach((el) =>
    el.interrupt("draw").transition("reveal").duration(300 * t).attr("opacity", 0),
  );
  empty.transition("reveal").delay(200 * t).duration(300 * t).attr("opacity", 1);
  guessView.guessDot.select("text").interrupt("reveal").transition("reveal").duration(300 * t).attr("opacity", 1);
  guessReaction.classList.remove("is-shown");
  setTimeout(() => {
    if (revealedCounty) return;
    guessReaction.classList.add("is-hint");
    guessReaction.textContent = GUESS_HINT;
  }, 450 * t);
}

guessRange.addEventListener("input", () => {
  guessOutput.textContent = `${guessRange.value}%`;
  resetGuess();
  setGuessValue();
});

guessCounty.addEventListener("change", () => {
  resetGuess();
  setGuessLabel();
});

document.getElementById("guess-reveal").addEventListener("click", () => {
  if (!countyLayer) return;
  revealGuess();
});

// ─────────────────────────────────────────────
// 6d. STORY CHART (chapters 2 to 4)
// ─────────────────────────────────────────────

// A pinned D3 line chart that changes with each scroll step rather than
// being redrawn: the Republic average uncovers itself to 1911, then 2002;
// Galway and Wicklow draw in with an orange bracket for the gap between
// them, which slides from 1851 to 2022; then the 1991 to 1996 jump is
// picked out in orange.
const storyChart = document.getElementById("story-chart");
let storyStep = 1;
let storyView = null;

function republicAverage(year) {
  const values = Object.entries(allData[year])
    .filter(([county, v]) => !NI_COUNTIES.has(county) && v != null)
    .map(([, v]) => v);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

const STORY_STEPS = {
  1: { title: "1851: the average county, 22.1%", until: 1851 },
  2: { title: "Falling to its lowest: 13.9% in 1911", until: 1911 },
  3: { title: "Rising to 43.6% by 2002", until: 2002 },
  4: { title: "1851: Galway and Wicklow, 69 points apart", pair: 1851 },
  5: { title: "2022: Galway and Wicklow, 9.8 points apart", pair: 2022 },
  6: { title: "1991 to 1996: up 9.1 points in five years", jump: true },
};

// The height of a line at a given x, read off the drawn path, so a marker
// can ride along the curve.
function pathYAt(pathNode) {
  const length = pathNode.getTotalLength();
  const points = d3.range(0, length + 2, 2).map((l) => pathNode.getPointAtLength(l));
  const bisect = d3.bisector((p) => p.x).left;
  return (px) => points[Math.min(bisect(points, px), points.length - 1)].y;
}

function buildStoryChart() {
  if (typeof d3 === "undefined") return;
  let title = storyChart.querySelector(".story-title");
  if (!title) {
    title = document.createElement("p");
    title.className = "story-title";
    storyChart.prepend(title);
  }
  const view = lineFrame(storyChart, {
    // In the phone/tablet layout the chart takes the height left above the
    // caption box (title, axis labels and caption allowed for), up to a
    // comfortable 4:3, so a tall tablet doesn't leave it small.
    h: phoneLayout.matches
      ? Math.round(Math.max(240, Math.min(storyChart.clientWidth * 0.95, window.innerHeight - 76 - 216 - 170)))
      : 400,
  });
  const { svg, x, y, first } = view;
  const average = years.map((yr) => [yr, republicAverage(yr)]);

  // The average is uncovered by a clip that widens to the step's year.
  svg.append("clipPath").attr("id", "story-clip")
    .append("rect").attr("x", 0).attr("y", 0).attr("height", view.h).attr("width", x(first) + 4);
  const avgGroup = svg.append("g").attr("clip-path", "url(#story-clip)");
  const avg = avgGroup.append("path").attr("class", "line").attr("stroke", INK).attr("d", linePath(view, average));
  const points = avgGroup
    .selectAll("circle")
    .data(average)
    .join("circle")
    .attr("class", "line-point")
    .attr("r", 2.6)
    .attr("fill", INK)
    .attr("cx", ([yr]) => x(Number(yr)))
    .attr("cy", ([, v]) => y(v));

  const series = (county) => years.map((yr) => [yr, allData[yr][county]]);
  const galway = svg.append("path").attr("class", "line is-county").attr("d", linePath(view, series("GALWAY"))).attr("opacity", 0);
  const wicklow = svg.append("path").attr("class", "line is-teal").attr("d", linePath(view, series("WICKLOW"))).attr("opacity", 0);

  const ends = svg.append("g").attr("opacity", 0);
  const lastYear = years[years.length - 1];
  placeEndLabels(view, [
    [ends.append("text").attr("class", "line-end is-county").text("Galway"), allData[lastYear].GALWAY],
    [ends.append("text").attr("class", "line-end is-teal").text("Wicklow"), allData[lastYear].WICKLOW],
    [ends.append("text").attr("class", "line-end is-average").text("average"), republicAverage(lastYear)],
  ]);

  // The orange bracket for the gap between Galway and Wicklow.
  const gap = svg.append("g").attr("class", "story-gap").attr("opacity", 0).attr("transform", `translate(${x(first)},0)`);
  const gapLine = gap.append("line").attr("x1", 0).attr("x2", 0);
  const gapText = gap.append("text").attr("class", "story-note");

  // The 1991 to 1996 jump, over the average.
  const jump = svg.append("path")
    .attr("class", "line is-jump")
    .attr("d", linePath(view, average.filter(([yr]) => yr === "1991" || yr === "1996")))
    .attr("opacity", 0);
  const jumpText = svg.append("text")
    .attr("class", "story-note")
    .attr("x", x(1991) - 10)
    .attr("y", y(republicAverage("1996")) - 4)
    .attr("text-anchor", "end")
    .attr("opacity", 0)
    .text("+9.1 points");

  // The marker at the end of the uncovered average, with its value.
  const head = svg.append("g").attr("class", "story-head");
  head.append("circle").attr("r", 6);
  const headText = head.append("text").attr("class", "story-note").attr("x", 10).attr("y", -10);

  storyView = {
    ...view, title, avg, points, galway, wicklow, ends, gap, gapLine, gapText, jump, jumpText, head, headText,
    clip: svg.select("#story-clip rect"),
    yAt: pathYAt(avg.node()),
    headYear: null,
    pairShown: false,
    jumpShown: false,
  };
  applyStoryStep(false);
}

// Moves the chart to the current step. Every change is a transition from
// whatever is showing, so scrolling back up simply reverses it.
function applyStoryStep(play = true) {
  const v = storyView;
  if (!v) return;
  const step = STORY_STEPS[storyStep];
  const t = play && animate ? 900 : 0;
  const ease = d3.easeCubicInOut;
  const until = step.until ?? v.last;

  if (v.title.textContent !== step.title) {
    if (t) {
      gsap.to(v.title, {
        opacity: 0,
        duration: 0.2,
        onComplete: () => {
          v.title.textContent = step.title;
          gsap.to(v.title, { opacity: 1, duration: 0.3 });
        },
      });
    } else {
      v.title.textContent = step.title;
    }
  }

  // Uncover the average to the step's year, the marker riding its tip.
  v.clip.transition("story").duration(t).ease(ease).attr("width", v.x(until) + 4);
  const from = v.headYear ?? v.first;
  v.head
    .transition("story")
    .duration(t)
    .ease(ease)
    .attr("opacity", step.until ? 1 : 0)
    .tween("ride", () => {
      const year = d3.interpolateNumber(from, until);
      return (k) => {
        const px = v.x(year(k));
        const py = v.yAt(px);
        v.head.attr("transform", `translate(${px},${py})`);
        const value = k === 1 ? republicAverage(String(until)) : v.y.invert(py);
        v.headText.text(`${value.toFixed(1)}%`);
      };
    });
  v.headYear = until;

  // The average steps back to grey while Galway and Wicklow are shown.
  const avgColour = step.pair ? "#b3b5b0" : INK;
  v.avg.transition("story").duration(t).attr("stroke", avgColour);
  v.points.transition("story").duration(t).attr("fill", avgColour);

  if (step.pair && !v.pairShown) {
    drawPath(v.galway, 0.3 * t, 1.4 * t);
    drawPath(v.wicklow, 0.5 * t, 1.4 * t);
  } else if (!step.pair) {
    [v.galway, v.wicklow].forEach((p) => p.interrupt("draw").transition("story").duration(t / 2).attr("opacity", 0));
  }
  v.pairShown = Boolean(step.pair);
  v.ends.transition("story").delay(step.pair ? t * 1.6 : 0).duration(t / 2).attr("opacity", step.pair ? 1 : 0);

  if (step.pair) {
    const yr = String(step.pair);
    const hi = allData[yr].GALWAY;
    const lo = allData[yr].WICKLOW;
    const atEnd = step.pair === v.last;
    v.gap.transition("story").delay(step.pair === 1851 ? t : 0).duration(t).ease(ease)
      .attr("opacity", 1)
      .attr("transform", `translate(${v.x(step.pair)},0)`);
    v.gapLine.transition("story").duration(t).ease(ease).attr("y1", v.y(hi)).attr("y2", v.y(lo));
    // In 1851 the note sits beside the bracket, in the empty middle; in 2022
    // under it, clear of the lines and their names.
    v.gapText
      .text(`${+(hi - lo).toFixed(1)} points`)
      .attr("text-anchor", atEnd ? "end" : "start")
      .transition("story").duration(t).ease(ease)
      .attr("x", atEnd ? -4 : 12)
      .attr("y", atEnd ? v.y(lo) + 28 : v.y((hi + lo) / 2) + 6);
  } else {
    v.gap.transition("story").duration(t / 2).attr("opacity", 0);
  }

  if (step.jump && !v.jumpShown) drawPath(v.jump, 0.2 * t, 0.7 * t);
  if (!step.jump) v.jump.interrupt("draw").transition("story").duration(t / 2).attr("opacity", 0);
  v.jumpText.transition("story").delay(step.jump ? t : 0).duration(t / 2).attr("opacity", step.jump ? 1 : 0);
  v.jumpShown = Boolean(step.jump);
}

function setStoryStep(step) {
  if (step === storyStep) return;
  storyStep = step;
  storyChart.dataset.step = step;
  applyStoryStep();
}

// ─────────────────────────────────────────────
// 6e. NORTH AND SOUTH (chapter 5)
// ─────────────────────────────────────────────

// The two jurisdictions in the latest census: a big range for each, then
// every county as a ranked bar (Republic first, then Northern Ireland), in
// the map's colours. Bars share one 0 to 50% scale.
function buildNorthSouth() {
  const latest = allData[years[years.length - 1]];
  const groups = [
    { name: "Republic of Ireland", counties: Object.keys(layersByCounty).filter((c) => !NI_COUNTIES.has(c)) },
    { name: "Northern Ireland", counties: Object.keys(layersByCounty).filter((c) => NI_COUNTIES.has(c)) },
  ].map((group) => ({
    ...group,
    counties: group.counties.filter((c) => latest[c] != null).sort((a, b) => latest[b] - latest[a]),
  }));

  const range = (counties) => [latest[counties[counties.length - 1]], latest[counties[0]]];

  document.getElementById("ns-compare").innerHTML = groups
    .map((group) => {
      const [lo, hi] = range(group.counties);
      return (
        `<div class="ns-card">` +
        `<p class="ns-card-name">${group.name}</p>` +
        `<p class="ns-card-range">${Math.round(lo)}&ndash;${Math.round(hi)}%</p>` +
        `<p class="ns-card-note">across its ${group.counties.length} counties</p>` +
        `</div>`
      );
    })
    .join("");

  nsView = { groups, latest, w: 0 };
  renderNorthSouth();
}

// On phones the two jurisdictions are one pile of dots on a single floor
// (a phone can't hold 32 readable rows beside their names); on wider
// screens, the ranked rows. Redrawn if the width crosses between the two.
function renderNorthSouth() {
  const el = document.getElementById("north-south");
  if (!el || !nsView) return;
  nsView.w = el.clientWidth;
  el.closest("section").classList.toggle("ns-compact", el.clientWidth < 520);
  if (el.clientWidth < 520) drawNorthSouthPile(nsView.groups, nsView.latest, el);
  else drawNorthSouthBars(nsView.groups, nsView.latest, el);
}

// The callout arrow, drawn in VectorCraft (img/callout-arrow.svg): a hand-
// inked curve with an open head. Its tail is at
// (3, 20) and its tip at (42, 14) in its own 48 x 28 drawing. Loaded once,
// then placed, turned and scaled for each callout.
let calloutArrow = null;
const ARROW_TAIL = [3, 20];
const ARROW_TIP = [42, 14];

async function loadCalloutArrow() {
  try {
    const text = await (await fetch("img/callout-arrow.svg")).text();
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const part = (...ids) => ids.map((id) => doc.getElementById(id).outerHTML).join("");
    // The shaft stretches to reach a dot; the head keeps its own size.
    calloutArrow = { shaft: part("shaft"), head: part("head") };
  } catch (error) {
    calloutArrow = null; // the rough.js arrow below stands in
  }
}

// A short hand-inked arrow from a label to a dot: the VectorCraft drawing
// moved to `from`, turned toward the dot and scaled to reach it.
function inkArrow(svg, from, to, seed) {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  const end = [to[0] - (dx / len) * 9, to[1] - (dy / len) * 9];
  if (calloutArrow) {
    const own = [ARROW_TIP[0] - ARROW_TAIL[0], ARROW_TIP[1] - ARROW_TAIL[1]];
    const ownAngle = (Math.atan2(own[1], own[0]) * 180) / Math.PI;
    const target = (Math.atan2(end[1] - from[1], end[0] - from[0]) * 180) / Math.PI;
    const stretch = Math.hypot(end[0] - from[0], end[1] - from[1]) / Math.hypot(...own);
    const place = (markup, transform) => {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("transform", transform);
      g.innerHTML = markup;
      svg.node().appendChild(g);
      return g;
    };
    // Straighten the drawing along its own tail-to-tip line, stretch it to
    // the distance, then turn it toward the dot.
    return [
      place(calloutArrow.shaft, `translate(${from}) rotate(${target}) scale(${stretch} 1) rotate(${-ownAngle}) translate(${-ARROW_TAIL[0]} ${-ARROW_TAIL[1]})`),
      place(calloutArrow.head, `translate(${end}) rotate(${target}) rotate(${-ownAngle}) translate(${-ARROW_TIP[0]} ${-ARROW_TIP[1]})`),
    ];
  }
  const rc = rough.svg(svg.node());
  const ctrl = [(from[0] + end[0]) / 2 - dy * 0.15, (from[1] + end[1]) / 2 + dx * 0.15];
  const dir = Math.atan2(end[1] - ctrl[1], end[0] - ctrl[0]);
  const arm = (turn) => [end[0] - 7 * Math.cos(dir + turn), end[1] - 7 * Math.sin(dir + turn)];
  const opts = { stroke: INK, strokeWidth: 1.5, roughness: 0.8, bowing: 0.6, seed };
  const nodes = [
    rc.path(`M${from[0]} ${from[1]} Q${ctrl[0]} ${ctrl[1]} ${end[0]} ${end[1]}`, opts),
    rc.linearPath([arm(0.5), end, arm(-0.5)], { ...opts, roughness: 0.3 }),
  ];
  nodes.forEach((n) => svg.node().appendChild(n));
  return nodes;
}

// Every county as a dot. They drop onto one floor and pile up at their
// value on a 0 to 50% scale: the Republic's 26 on the right, Northern
// Ireland's 6 on the left, and the empty stretch between them, the gap,
// tinted orange. When the last dot has stopped, the highest and lowest of
// each pile are named, with their figures, on hand-drawn arrows; tap any
// dot for its own.
function drawNorthSouthPile(groups, latest, el) {
  if (typeof d3 === "undefined") return;
  const w = Math.max(300, el.clientWidth);
  const pad = 16;
  const r = 6.5;
  const x = d3.scaleLinear().domain([0, 50]).range([pad + 4, w - pad - 4]);

  // Each dot's resting place: its own value across, and the lowest free
  // spot up (the piles are built from the highest value down).
  const rest = [];
  groups.forEach((g, gi) => {
    const placed = [];
    [...g.counties]
      .sort((a, b) => latest[b] - latest[a])
      .forEach((county) => {
        const cx = x(latest[county]);
        let level = 0;
        for (;;) {
          const cy = -(r + level * (r * 1.8));
          if (placed.every((p) => Math.hypot(p.cx - cx, p.cy - cy) >= 2 * r + 1.2)) {
            const d = { county, group: gi, cx, cy, level };
            placed.push(d);
            rest.push(d);
            break;
          }
          level++;
        }
      });
  });
  const rise = (gi) => Math.max(...rest.filter((d) => d.group === gi).map((d) => -d.cy)) + r;

  // Layout: titles across the top, a row for the highest label, then the
  // tallest pile, the floor, and the scale.
  const titleY = 24;
  const bandTop = 40;
  const pileTop = 108;
  const floor = pileTop + Math.max(rise(0), rise(1)) + 4;
  const h = floor + 40;
  rest.forEach((d) => (d.y = floor + d.cy));

  el.innerHTML = "";
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("class", "ns-chart ns-pile");

  // The gap: a band from the north's highest county to the Republic's lowest.
  const northHi = d3.max(groups[1].counties, (c) => latest[c]);
  const southLo = d3.min(groups[0].counties, (c) => latest[c]);
  const gap = svg.append("g").attr("class", "ns-gap");
  gap.append("rect").attr("x", x(northHi)).attr("y", bandTop).attr("width", x(southLo) - x(northHi)).attr("height", floor - bandTop)
    .attr("fill", ORANGE).attr("opacity", 0);
  const gapMid = (x(northHi) + x(southLo)) / 2;
  const gapLabel = gap.append("text").attr("class", "ns-gap-label").attr("text-anchor", "middle").attr("opacity", 0);
  gapLabel.append("tspan").attr("x", gapMid).attr("y", bandTop + 26).text("no county between");
  gapLabel.append("tspan").attr("x", gapMid).attr("dy", 22).text(`${Math.round(northHi)}% and ${Math.round(southLo)}%`);

  // Gridlines, the floor and the scale.
  const grid = svg.append("g").attr("class", "ns-grid");
  [0, 10, 20, 30, 40, 50].forEach((v) => {
    grid.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", bandTop).attr("y2", floor);
    grid.append("text").attr("x", x(v)).attr("y", floor + 22).attr("text-anchor", v === 0 ? "start" : v === 50 ? "end" : "middle").text(`${v}%`);
  });
  svg.append("line").attr("class", "ns-baseline").attr("x1", x(0) - 4).attr("x2", x(50) + 4).attr("y1", floor).attr("y2", floor);

  // Group titles, one on each side, above the gap band.
  svg.append("text").attr("class", "ns-head").attr("x", pad).attr("y", titleY).text("Northern Ireland");
  svg.append("text").attr("class", "ns-head").attr("x", w - pad).attr("y", titleY).attr("text-anchor", "end").text("Republic of Ireland");

  // The dots, waiting above the pile.
  const readout = d3.select(el.parentNode).select(".ns-readout");
  const dots = rest
    .slice()
    .sort((a, b) => a.level - b.level || a.cx - b.cx)
    .map((d) => {
      const dot = svg.append("circle").attr("class", "ns-dot")
        .attr("cx", d.cx).attr("cy", bandTop - 14).attr("r", r).attr("opacity", 0)
        .attr("fill", hatchFill(`nshatch-${d.county}`, getCountyColour(latest[d.county])))
        .attr("role", "img").attr("aria-label", `${prettyName(d.county)} ${latest[d.county].toFixed(1)}%`)
        .style("cursor", "pointer");
      dot.on("click", () => {
        svg.selectAll(".ns-dot").classed("is-picked", false);
        dot.classed("is-picked", true);
        readout.html(`<strong>${prettyName(d.county)}</strong> ${latest[d.county].toFixed(1)}%`);
      });
      return { dot, d };
    });
  readout.html("Tap a dot for its county.");

  // The names: the highest and lowest of each pile, on arrows. Built now,
  // shown once the dots have stopped.
  const at = (county) => rest.find((d) => d.county === county);
  const hiS = groups[0].counties[0], loS = groups[0].counties[groups[0].counties.length - 1];
  const hiN = groups[1].counties[0], loN = groups[1].counties[groups[1].counties.length - 1];
  const callouts = svg.append("g").attr("class", "ns-callouts").attr("opacity", 0);
  const label = (text, county, lx, ly, anchor, arrowFrom, seed) => {
    const t = callouts.append("text").attr("class", "ns-callout").attr("x", lx).attr("y", ly).attr("text-anchor", anchor);
    // Name over figure: narrow, so it fits beside a pile.
    t.append("tspan").attr("class", "ns-callout-name").attr("x", lx).text(prettyName(county).split(" / ")[0]);
    t.append("tspan").attr("class", "ns-callout-value").attr("x", lx).attr("dy", 18).text(`${latest[county].toFixed(1)}%`);
    const d = at(county);
    return inkArrow(svg, arrowFrom, [d.cx, d.y], seed);
  };
  const edges = [];
  if (typeof rough !== "undefined") {
    const rc = rough.svg(svg.node());
    [northHi, southLo].forEach((v, i) => {
      const edge = rc.line(x(v), bandTop, x(v), floor, { stroke: ORANGE, strokeWidth: 2.4, roughness: 1.2, seed: 810 + i });
      svg.node().appendChild(edge);
      edges.push(edge);
    });
  }
  const arrows = [];
  if (typeof rough !== "undefined") {
    const s = at(hiS), l = at(loS), n = at(hiN), dn = at(loN);
    arrows.push(...label("hiS", hiS, w - pad, pileTop - 48, "end", [s.cx - 2, pileTop - 20], 11));
    arrows.push(...label("loS", loS, l.cx - 34, l.y - 4, "end", [l.cx - 32, l.y], 12));
    arrows.push(...label("hiN", hiN, n.cx + 40, n.y - 44, "start", [n.cx + 36, n.y - 20], 13));
    arrows.push(...label("loN", loN, pad, dn.y - 84, "start", [dn.cx, dn.y - 48], 14));
  }
  const drawInk = sketchDraw([...edges, ...arrows], { duration: 0.9 });

  // Dots fall in turn, lowest of the pile first, and bounce as they land.
  const play = () => {
    const quick = !animate || nsPlayed;
    nsPlayed = true;
    if (quick) {
      dots.forEach(({ dot, d }) => dot.attr("cy", d.y).attr("opacity", 1));
      gap.selectAll("rect").attr("opacity", 0.14);
      gapLabel.attr("opacity", 1);
      callouts.attr("opacity", 1);
      return;
    }
    const stagger = 38;
    let end = 0;
    dots.forEach(({ dot, d }, i) => {
      const fall = Math.round(380 + 38 * Math.sqrt(Math.max(0, d.y - bandTop)));
      end = Math.max(end, i * stagger + fall);
      dot.transition().delay(i * stagger).duration(60).attr("opacity", 1)
        .transition().duration(fall).ease(d3.easeBounceOut).attr("cy", d.y);
    });
    // When the last has stopped: the gap, then the names.
    gap.selectAll("rect").transition().delay(end).duration(450).attr("opacity", 0.14);
    gapLabel.transition().delay(end + 150).duration(450).attr("opacity", 1);
    callouts.transition().delay(end + 400).duration(500).attr("opacity", 1);
    setTimeout(drawInk, end + 150);
  };
  if (nsPlayed) play();
  else onceInView(el, play, 0.25);
}

// Drawn at the container's width so its labels keep their size on a phone;
// redrawn on resize, showing the end state if it has already played.
let nsView = null;
let nsPlayed = false;

function drawNorthSouthBars(groups, latest, el = document.getElementById("north-south")) {
  if (typeof d3 === "undefined" || !el) return;

  const w = Math.max(300, el.clientWidth);
  const narrow = w < 520;
  const nameW = narrow ? 118 : 150;
  const valueW = 48;
  const rowH = narrow ? 22 : 20;
  const headH = 40;
  const top = 34;
  // Room between the names and 0% for the labels left of the low dots.
  const x = d3.scaleLinear().domain([0, 50]).range([nameW + 34, w - valueW]);
  const played = nsPlayed;

  // Lay the rows out: a heading per group, then its counties.
  const rows = [];
  let y = top;
  groups.forEach((group) => {
    rows.push({ head: group.name, y: y + headH - 12 });
    y += headH;
    group.counties.forEach((county) => {
      rows.push({ county, value: latest[county], y });
      y += rowH;
    });
  });
  const h = y + 16;
  const bars = rows.filter((r) => r.county);

  el.innerHTML = "";
  const svg = d3
    .select(el)
    .append("svg")
    .attr("viewBox", `0 0 ${w} ${h}`)
    .attr("class", "ns-chart");

  // The gap: from the north's highest county to the Republic's lowest.
  const northHi = d3.max(groups[1].counties, (c) => latest[c]);
  const southLo = d3.min(groups[0].counties, (c) => latest[c]);
  const gap = svg.append("g").attr("class", "ns-gap");
  gap
    .append("rect")
    .attr("x", x(northHi))
    .attr("y", top)
    .attr("width", x(southLo) - x(northHi))
    .attr("height", h - top - 10)
    .attr("fill", ORANGE)
    .attr("opacity", 0);
  gap
    .append("text")
    .attr("x", (x(northHi) + x(southLo)) / 2)
    .attr("y", 20)
    .attr("text-anchor", "middle")
    .attr("class", "ns-gap-label")
    .attr("opacity", 0)
    .text(`no county between ${Math.round(northHi)}% and ${Math.round(southLo)}%`);

  // Pencil gridlines and their labels.
  const grid = svg.append("g").attr("class", "ns-grid");
  [0, 10, 20, 30, 40, 50].forEach((v) => {
    grid.append("line").attr("x1", x(v)).attr("x2", x(v)).attr("y1", top).attr("y2", h - 10);
    grid.append("text").attr("x", x(v)).attr("y", h).attr("text-anchor", "middle").text(`${v}%`);
  });

  svg
    .selectAll(".ns-head")
    .data(rows.filter((r) => r.head))
    .join("text")
    .attr("class", "ns-head")
    .attr("x", 0)
    .attr("y", (r) => r.y)
    .text((r) => r.head);

  const row = svg
    .selectAll(".ns-row")
    .data(bars)
    .join("g")
    .attr("class", "ns-row")
    .attr("transform", (r) => `translate(0, ${r.y})`);
  row
    .append("text")
    .attr("class", "ns-name")
    .attr("y", rowH * 0.7)
    .text((r) => prettyName(r.county));
  row
    .append("line")
    .attr("class", "ns-guide")
    .attr("x1", x(0))
    .attr("x2", x(50))
    .attr("y1", rowH / 2)
    .attr("y2", rowH / 2);
  const dot = row
    .append("circle")
    .attr("class", "ns-dot")
    .attr("cx", x(0))
    .attr("cy", rowH / 2)
    .attr("r", 7)
    .attr("opacity", 0)
    .attr("fill", (r) => hatchFill(`nshatch-${r.county}`, getCountyColour(r.value)));
  const value = row
    .append("text")
    .attr("class", "ns-value")
    // Labels sit outside the gap: right of the Republic's dots, left of the north's.
    .attr("x", (r) => (r.value > northHi ? x(r.value) + 12 : x(r.value) - 12))
    .attr("text-anchor", (r) => (r.value > northHi ? "start" : "end"))
    .attr("y", rowH * 0.7)
    .attr("opacity", 0)
    .text((r) => `${r.value.toFixed(1)}%`);

  // The orange edges of the gap, sketched with rough.js so they can draw in.
  const edges = [];
  if (typeof rough !== "undefined") {
    const rc = rough.svg(svg.node());
    [northHi, southLo].forEach((v, i) => {
      const edge = rc.line(x(v), top - 4, x(v), h - 10, { stroke: ORANGE, strokeWidth: 2.4, roughness: 1.2, seed: 800 + i });
      svg.node().appendChild(edge);
      edges.push(edge);
    });
  }
  const drawEdges = edges.length ? sketchDraw(edges, { duration: 0.9 }) : () => {};

  const play = () => {
    const quick = !animate || nsPlayed;
    nsPlayed = true;
    const stagger = quick ? 0 : 35;
    const t = quick ? 0 : 650;
    dot
      .transition()
      .delay((r, i) => i * stagger)
      .duration(t)
      .ease(d3.easeCubicOut)
      .attr("opacity", 1)
      .attr("cx", (r) => x(r.value));
    value
      .transition()
      .delay((r, i) => i * stagger + t * 0.6)
      .duration(t * 0.5)
      .attr("opacity", 1);
    const after = bars.length * stagger + t;
    gap.select("rect").transition().delay(after).duration(t).attr("opacity", 0.14);
    gap.select("text").transition().delay(after + 200).duration(t).attr("opacity", 1);
    // A redraw (a resize) shows the edges at once.
    if (quick) drawEdges();
    else setTimeout(drawEdges, after);
  };
  if (played) play();
  else onceInView(el, play, 0.25);
}

// ─────────────────────────────────────────────
// 6f. OPENER (chapter 01), drawn with D3
// ─────────────────────────────────────────────

// The 32 counties start as a map whose ink outlines sketch themselves in.
// As the reader scrolls they fly apart into a grid ranked by their 1851
// answer, fill with colour (the top of the ranking, then the bottom), and
// finally fly back together as the coloured 1851 map. Every stage is a D3
// transition to a fixed state, so scrolling back up simply reverses it.
const OPENER_BLANK = "#e6e7e3";
let openerCounties = null;

function buildOpenerMap() {
  const el = document.getElementById("opener-map");
  if (!el || typeof d3 === "undefined" || !openerGeojson) return;

  const first = years[0];
  // Phones, and tablets held upright, get a tall 4 x 8 grid, so the names
  // stay readable and the grid fills the tall screen.
  const narrow = window.matchMedia("(max-width: 520px), (max-width: 900px) and (orientation: portrait)").matches;
  const OPENER_W = narrow ? 400 : 900;
  const OPENER_H = narrow ? 600 : 520;
  const cols = narrow ? 4 : 8;
  const gridRows = 32 / cols;
  // A flat projection (x scaled by the cosine of Ireland's latitude), fitted
  // to the box by hand. D3's spherical projections would need every ring
  // wound clockwise; this GeoJSON's aren't, and a planar transform doesn't
  // care.
  const k = Math.cos((53.4 * Math.PI) / 180);
  const flat = d3.geoTransform({
    point(lon, lat) {
      this.stream.point(lon * k, -lat);
    },
  });
  const [[fx0, fy0], [fx1, fy1]] = d3.geoPath(flat).bounds(openerGeojson);
  const fit = Math.min((narrow ? 360 : 400) / (fx1 - fx0), (OPENER_H - 20) / (fy1 - fy0));
  const ox = OPENER_W / 2 - ((fx0 + fx1) / 2) * fit;
  const oy = OPENER_H / 2 - ((fy0 + fy1) / 2) * fit;
  // Points closer than a pixel to the last one are dropped: the outlines
  // keep their shape with a few thousand points instead of 150,000, which
  // is what lets a phone move all 32 smoothly.
  const projection = d3.geoTransform({
    lineStart() {
      this.last = null;
      this.stream.lineStart();
    },
    point(lon, lat) {
      const px = lon * k * fit + ox;
      const py = -lat * fit + oy;
      if (this.last && Math.hypot(px - this.last[0], py - this.last[1]) < 1.2) return;
      this.last = [px, py];
      this.stream.point(px, py);
    },
  });
  const path = d3.geoPath(projection);

  // Grid cells ranked by 1851 share.
  const cellW = OPENER_W / cols;
  const cellH = OPENER_H / gridRows;
  const ranked = openerGeojson.features
    .map((f) => f.properties.COUNTY)
    .sort((a, b) => allData[first][b] - allData[first][a]);

  openerCounties = openerGeojson.features.map((feature) => {
    const county = feature.properties.COUNTY;
    const value = allData[first][county];
    const [[x0, y0], [x1, y1]] = path.bounds(feature);
    const rank = ranked.indexOf(county);
    const cx = (rank % cols) * cellW + cellW / 2;
    const cy = Math.floor(rank / cols) * cellH + cellH * 0.38;
    const size = Math.min((cellW * 0.62) / (x1 - x0), (cellH * 0.55) / (y1 - y0));
    const bx = (x0 + x1) / 2;
    const by = (y0 + y1) / 2;
    return {
      county,
      value,
      d: path(feature),
      band: value >= 40 ? "high" : value < 5 ? "low" : "mid",
      // Same transform shape in every place, so D3 can tween between them.
      mapAt: `translate(${bx},${by}) scale(1) translate(${-bx},${-by})`,
      // Scattered out from the middle of the island, for the opening gather.
      scatterAt: `translate(${bx + (bx - OPENER_W / 2) * 0.9 + (rank % 3 - 1) * 24},${by + (by - OPENER_H / 2) * 0.9 + (rank % 4 - 1.5) * 18}) scale(0.6) translate(${-bx},${-by})`,
      gridAt: `translate(${cx},${cy}) scale(${size}) translate(${-bx},${-by})`,
      labelX: cx,
      labelY: cy + cellH * 0.42,
    };
  });

  const svg = d3
    .select(el)
    .append("svg")
    .attr("viewBox", `0 0 ${OPENER_W} ${OPENER_H}`)
    .attr("class", "opener-svg");

  const shapes = svg
    .selectAll(".oc")
    .data(openerCounties)
    .join("path")
    .attr("class", "oc")
    .attr("d", (c) => c.d)
    .attr("transform", (c) => c.mapAt)
    .attr("fill", (c) => hatchFill(`ohatch-${c.county}`, OPENER_BLANK));

  const labels = svg
    .selectAll(".oc-label")
    .data(openerCounties)
    .join("g")
    .attr("class", "oc-label")
    .attr("transform", (c) => `translate(${c.labelX},${c.labelY})`)
    .attr("opacity", 0);
  labels.append("text").attr("class", "oc-name").attr("text-anchor", "middle").text((c) => prettyName(c.county));
  labels
    .append("text")
    .attr("class", "oc-value")
    .attr("text-anchor", "middle")
    .attr("y", 16)
    .attr("opacity", 0)
    .text((c) => `${c.value.toFixed(1)}%`);

  // As soon as the page opens, the counties fly in from around the screen
  // and come together as the island (the reverse of the later move into the
  // ranked grid). Further down the page there's nothing to gather. Returns
  // a promise that settles when the gather is over.
  const stage = Number(document.getElementById("opener").dataset.stage) || 0;
  if (animate && stage === 0) {
    return shapes
      .attr("transform", (c) => c.scatterAt)
      .attr("opacity", 0)
      .transition("gather")
      .delay((c, i) => i * 18)
      .duration(1100)
      .ease(d3.easeCubicOut)
      .attr("transform", (c) => c.mapAt)
      .attr("opacity", 1)
      .end()
      .catch(() => {}); // interrupted by a scroll: fine
  }
  setOpenerStage(stage);
  return Promise.resolve();
}

// Moves the counties to a stage: 0 the blank map, 1 the blank ranked grid,
// 2 grid with the high counties coloured, 3 with the low ones too, 4 back
// to the map with every county coloured.
function setOpenerStage(stage) {
  if (!openerCounties) return;
  const svg = d3.select("#opener-map svg");
  const t = animate ? 900 : 0;
  const inGrid = stage >= 1 && stage <= 3;
  const coloured = (c) =>
    stage >= 4 || (stage >= 2 && c.band === "high") || (stage >= 3 && c.band === "low");

  svg
    .selectAll(".oc")
    .interrupt("gather")
    .attr("opacity", 1)
    .transition()
    .duration(t)
    .delay((c, i) => (animate ? i * 12 : 0))
    .ease(d3.easeCubicInOut)
    .attr("transform", (c) => (inGrid ? c.gridAt : c.mapAt));

  svg.selectAll(".oc-label").transition().duration(t / 2).delay(inGrid ? t * 0.7 : 0).attr("opacity", inGrid ? 1 : 0);
  svg
    .selectAll(".oc-value")
    .transition()
    .duration(t / 2)
    .attr("opacity", (c) => (inGrid && coloured(c) ? 1 : 0));

  // Recolour each county's hatch pattern (the fill itself stays the same url).
  openerCounties.forEach((c) => {
    const colour = coloured(c) ? getCountyColour(c.value) : OPENER_BLANK;
    d3.select(`#ohatch-${c.county}`)
      .selectAll("rect, line")
      .transition()
      .duration(t)
      .delay(animate ? 200 : 0)
      .attr("fill", function () {
        return this.tagName === "rect" ? colour : null;
      })
      .attr("stroke", function () {
        return this.tagName === "line" ? colour : null;
      });
  });
}

// ─────────────────────────────────────────────
// 6g. WHAT COUNTS AS SPEAKING IRISH (chapter 04)
// ─────────────────────────────────────────────

// 100 figures stand for 100 people aged 3 and over, 2022. Groups follow the
// CSO's Census 2022 summary: 40% could speak Irish (1,873,997); a quarter of
// those never speak it (472,887, about 10 figures); a third speak it daily
// (623,961, about 13 figures), mostly in school; 71,968 speak it daily
// outside the education system (about 1.5 figures, drawn as 2).
const PEOPLE_GROUPS = [
  { key: "outside", count: 2 },
  { key: "school", count: 11 },
  { key: "less", count: 17 },
  { key: "never", count: 10 },
  { key: "no", count: 60 },
];

const PEOPLE_READOUTS = {
  1: "<strong>40 in 100</strong> said they can speak Irish",
  2: "<strong>10</strong> of them never speak it",
  3: "<strong>13</strong> speak it every day, mostly at school",
  4: "<strong>fewer than 2</strong> speak it daily outside school",
};

// Body hand-drawn in VectorCraft (public/img/person.svg), with a plain round
// head (roughening a circle this small turns it into a diamond); filled by
// the CSS.
const PERSON =
  '<svg viewBox="0 0 20 32" aria-hidden="true">' +
  '<circle cx="10" cy="6.2" r="5" />' +
  '<path d="M3.1 31.2 C2 30.3 3.4 27.4 3.3 25.3 C3.3 23.2 2.6 20.5 2.8 18.7 C3.1 16.8 3.7 15.1 4.9 14.2 C6.1 13.2 8.1 13 9.8 13.1 C11.5 13.1 14.1 13.4 15.2 14.4 C16.4 15.4 16.5 17.3 16.8 19.1 C17.1 20.8 17 22.8 17 24.7 C17 26.7 18 29.7 16.8 30.8 C15.7 31.8 12.3 31.1 10 31.2 C7.7 31.2 4.2 32.2 3.1 31.2 Z" />' +
  "</svg>";

function buildPeople() {
  const el = document.getElementById("people");
  // --i lets the CSS ripple each change across the grid instead of
  // switching all 100 figures at once.
  let i = 0;
  el.innerHTML = PEOPLE_GROUPS.flatMap((group) =>
    Array.from({ length: group.count }, () => `<span class="person is-${group.key}" style="--i:${i++}">${PERSON}</span>`),
  ).join("");
  setPeopleStage(1);
}

function setPeopleStage(stage) {
  document.getElementById("people").dataset.stage = stage;
  document.getElementById("people-readout").innerHTML = PEOPLE_READOUTS[stage];
}

// ─────────────────────────────────────────────
// 6h. THEN AND NOW (conclusion)
// ─────────────────────────────────────────────

// 1851 and the latest census side by side, sketched with rough.js from the
// county shapes: hatched counties in the map's colours, pencil borders, a
// hand-drawn arrow between them, and a hatched key.
function buildSketchMaps() {
  const el = document.getElementById("sketch-maps");
  if (!el || !countyGeojson || typeof rough === "undefined") return;

  const rings = (geometry) =>
    geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();

  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  countyGeojson.features.forEach((feature) =>
    rings(feature.geometry).forEach((ring) =>
      ring.forEach(([lon, lat]) => {
        minX = Math.min(minX, lon);
        maxX = Math.max(maxX, lon);
        minY = Math.min(minY, lat);
        maxY = Math.max(maxY, lat);
      }),
    ),
  );
  const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const mapW = 250;
  const scale = mapW / ((maxX - minX) * k);
  const mapH = Math.round((maxY - minY) * scale);

  // Thin each ring to points at least 2 units apart and drop specks: rough.js
  // redraws every segment by hand, so detail beyond that is just noise.
  const countyPath = (feature, ox, oy) =>
    rings(feature.geometry)
      .map((ring) => {
        const pts = [];
        ring.forEach(([lon, lat]) => {
          const p = [(lon - minX) * k * scale + ox, (maxY - lat) * scale + oy];
          const last = pts[pts.length - 1];
          if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2) pts.push(p);
        });
        if (pts.length < 4) return "";
        return `M${pts.map((p) => p.map((n) => n.toFixed(1)).join(" ")).join("L")}Z`;
      })
      .join("");

  const gap = 120;
  const w = mapW * 2 + gap;
  const h = mapH + 50;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.classList.add("sketch-svg");
  const rc = rough.svg(svg);
  const text = (tx, ty, str, cls) => {
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", tx);
    t.setAttribute("y", ty);
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("class", cls);
    t.textContent = str;
    svg.appendChild(t);
  };

  [years[0], years[years.length - 1]].forEach((year, m) => {
    const ox = m * (mapW + gap);
    countyGeojson.features.forEach((feature, i) => {
      const d = countyPath(feature, ox, 0);
      if (!d) return;
      const value = allData[year][feature.properties.COUNTY];
      svg.appendChild(
        rc.path(d, {
          stroke: INK,
          strokeWidth: 0.9,
          roughness: 0.8,
          fill: getCountyColour(value),
          fillStyle: "hachure",
          hachureGap: 2.6,
          hachureAngle: -41,
          fillWeight: 1.3,
          seed: 100 + m * 50 + i,
        }),
      );
    });
    text(ox + mapW / 2, mapH + 38, year, "sketch-year");
  });

  // A hand-drawn arrow from 1851 to the latest census (VectorCraft).
  const ay = mapH * 0.45;
  const ax0 = mapW + 18;
  const ax1 = mapW + gap - 18;
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "image");
  arrow.setAttribute("href", "img/arrow-170.svg");
  arrow.setAttribute("x", ax0);
  arrow.setAttribute("y", ay - 34);
  arrow.setAttribute("width", ax1 - ax0);
  arrow.setAttribute("height", (ax1 - ax0) / 2);
  svg.appendChild(arrow);
  text((ax0 + ax1) / 2, ay - 40, "170 years", "sketch-note");

  el.innerHTML = "";
  el.appendChild(svg);

  // A hatched key on the same colour scale.
  const key = document.getElementById("sketch-key");
  const keySvg = document.createElementNS(svgNS, "svg");
  const stops = [0, 5, 20, 40, 60];
  keySvg.setAttribute("viewBox", `0 0 ${stops.length * 96} 34`);
  keySvg.classList.add("sketch-key-svg");
  const krc = rough.svg(keySvg);
  stops.forEach((v, i) => {
    keySvg.appendChild(
      krc.rectangle(i * 96 + 4, 4, 22, 16, {
        stroke: INK, strokeWidth: 1, roughness: 1, fill: getCountyColour(v + 2),
        fillStyle: "hachure", hachureGap: 2.6, hachureAngle: -41, fillWeight: 1.3, seed: 200 + i,
      }),
    );
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("x", i * 96 + 31);
    t.setAttribute("y", 17);
    t.setAttribute("class", "sketch-key-label");
    t.textContent = i === stops.length - 1 ? "over 60%" : i === 0 ? "under 5%" : `${v}–${stops[i + 1]}%`;
    keySvg.appendChild(t);
  });
  key.innerHTML = "";
  key.appendChild(keySvg);
}

// ─────────────────────────────────────────────
// 7. BOOTSTRAP
// ─────────────────────────────────────────────

async function initialiseMap() {
  // The census figures and the opener's light shapes load together, and the
  // opening map draws as soon as both are in, before the full boundaries.
  const [, opener] = await Promise.all([
    loadAllData(),
    fetch("data/opener.geojson").then((response) => response.json()),
    loadCalloutArrow(),
  ]);
  // The main map's boundaries start downloading now, behind the opener.
  const boundaries = fetch("data/counties.geojson");
  wobbleGeojson(opener);
  openerGeojson = opener;
  const gathered = buildOpenerMap() || Promise.resolve();
  buildScrollHint();
  buildStepCues();
  buildSnapping();

  // The rest of the page is screens away. It's built once the opening has
  // played (so the counties never freeze mid-flight), and one piece per
  // task, so the page never locks up for long if the reader scrolls early.
  await gathered;
  const nextTask = () => new Promise((resolve) => setTimeout(resolve));
  currentYear = years[0];
  buildLegend();
  await loadCountyBoundaries(boundaries);
  await nextTask();
  setYear(currentYear);
  for (const build of [
    buildHeadingUnderlines,
    buildStoryChart,
    buildPeople,
    buildNorthSouth,
    buildGuess,
    buildSketchMaps,
    buildFindings,
    buildClosing,
  ]) {
    await nextTask();
    build();
  }
  refreshSteady();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshSteady);

  // A reload partway down restores the scroll position before the data has
  // loaded, so the step already on screen was skipped; observing the steps
  // afresh reports it again.
  storySteps.forEach((step) => {
    stepObserver.unobserve(step);
    stepObserver.observe(step);
  });
}

initialiseMap().catch((error) => {
  console.error(error);
});
