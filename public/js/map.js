// ─────────────────────────────────────────────
// 1. SETUP
// ─────────────────────────────────────────────

// The map shows a fixed view of Ireland fitted to the counties, so all zoom
// and pan interactions are disabled and the +/- control is removed. County
// clicks still work.
const map = L.map("map", {
  zoomControl: false,
  dragging: false,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  boxZoom: false,
  touchZoom: false,
  keyboard: false,
  zoomSnap: 0, // allow fractional zoom so the island fills the box exactly
}).setView([53.4, -8.0], 7);

/*L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);*/

// ─────────────────────────────────────────────
// 2. STATE
// ─────────────────────────────────────────────

// allData holds every census year keyed by year -> { COUNTY: value }. We load
// it once and slice out the selected year locally, so both the map and the
// county panel read from a single in-memory source.
let allData = {};
let currentYear;
let selectedCounty = null;
let selectedLayer = null;
let countyLayer;

// Outline used to mark the county whose card is open.
const HIGHLIGHT_STYLE = { color: "#0b3d2c", weight: 3 };

let playTimer = null;

const yearSelect = document.getElementById("year-select");
const playButton = document.getElementById("play-button");
const panel = document.getElementById("county-panel");
const panelBody = document.getElementById("county-panel-body");
const panelClose = document.getElementById("county-panel-close");

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
}

// ─────────────────────────────────────────────
// 4. PRESENTATION
// ─────────────────────────────────────────────

// Fixed domain across all census years so a shade means the same % in every
// year. Max historic value is ~69%, so 70 keeps the darkest greens in reach
// without ever clipping.
const SCALE_MAX = 70;

// Continuous single-hue (green) sequential ramp, light -> dark. Interpolating
// in HSL gives every county a distinct shade even when values bunch together
// (as they do from 1961 onwards), instead of collapsing into a few buckets.
function getCountyColour(value) {
  if (value === undefined) {
    return "#cccccc";
  }

  const t = Math.max(0, Math.min(1, value / SCALE_MAX));

  const hue = 150;
  const saturation = 45 + t * 20; // 45% -> 65%
  const lightness = 92 - t * 70; // 92% (near zero) -> 22% (darkest)

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function styleCounty(feature) {
  const countyName = feature.properties.COUNTY;
  const value = currentYearData()[countyName];

  return {
    color: "#ffffff",
    weight: 1,
    fillColor: getCountyColour(value),
    fillOpacity: 0.8,
  };
}

function addCountyInteraction(feature, layer) {
  const countyName = feature.properties.COUNTY;

  layer.bindTooltip(
    () => {
      const value = currentYearData()[countyName];
      const valueText = value === undefined ? "No data" : `${value}%`;

      return `<strong>${countyName}</strong><br>${valueText}`;
    },
    {
      sticky: true,
    },
  );

  layer.on("click", () => {
    showCountyPanel(countyName);
    highlightCounty(layer);
  });
}

// Marks the given county layer with a bold outline and clears any previous one.
function highlightCounty(layer) {
  clearHighlight();
  selectedLayer = layer;
  layer.setStyle(HIGHLIGHT_STYLE);
  layer.bringToFront();
}

function clearHighlight() {
  if (selectedLayer && countyLayer) {
    countyLayer.resetStyle(selectedLayer);
    selectedLayer = null;
  }
}

// ─────────────────────────────────────────────
// 4b. COUNTY PANEL
// ─────────────────────────────────────────────

// Sorted list of census years, e.g. ["1851", "1861", ...].
function sortedYears() {
  return Object.keys(allData).sort((a, b) => Number(a) - Number(b));
}

// Builds an inline SVG sparkline of one county across every census year.
// Y is scaled to the same 0..SCALE_MAX domain as the map, so the line's
// height means the same thing as a county's colour. The selected year's
// point is emphasised.
function buildSparkline(countyName) {
  const years = sortedYears();
  const w = 244;
  const h = 96;
  const padX = 6;
  const padTop = 8;
  const padBottom = 18;

  const x = (i) => padX + (i * (w - 2 * padX)) / (years.length - 1);
  const y = (value) =>
    h - padBottom - (Math.min(value, SCALE_MAX) / SCALE_MAX) * (h - padTop - padBottom);

  const points = years
    .map((year, i) => ({ year, i, value: allData[year][countyName] }))
    .filter((p) => p.value !== undefined);

  const line = points.map((p) => `${x(p.i)},${y(p.value)}`).join(" ");

  const dots = points
    .map((p) => {
      const isCurrent = p.year === currentYear;
      const r = isCurrent ? 4 : 2.5;
      const fill = isCurrent ? "#176b4d" : "#70ad8b";
      return (
        `<circle cx="${x(p.i)}" cy="${y(p.value)}" r="${r}" fill="${fill}">` +
        `<title>${p.year}: ${p.value}%</title></circle>`
      );
    })
    .join("");

  const baselineY = h - padBottom;
  const firstYear = years[0];
  const lastYear = years[years.length - 1];

  return (
    `<svg viewBox="0 0 ${w} ${h}" role="img" ` +
    `aria-label="${countyName} Irish ability from ${firstYear} to ${lastYear}">` +
    `<line x1="${padX}" y1="${baselineY}" x2="${w - padX}" y2="${baselineY}" ` +
    `stroke="#d8ded9" stroke-width="1" />` +
    `<polyline points="${line}" fill="none" stroke="#176b4d" stroke-width="2" ` +
    `stroke-linejoin="round" stroke-linecap="round" />` +
    dots +
    `<text x="${padX}" y="${h - 4}" font-size="10" fill="#6b756f">${firstYear}</text>` +
    `<text x="${w - padX}" y="${h - 4}" font-size="10" fill="#6b756f" ` +
    `text-anchor="end">${lastYear}</text>` +
    `</svg>`
  );
}

function renderPanel(countyName) {
  const value = currentYearData()[countyName];
  const currentText =
    value === undefined
      ? `No data <span>in ${currentYear}</span>`
      : `${value}%<span> in ${currentYear}</span>`;

  panelBody.innerHTML =
    `<h2>${countyName}</h2>` +
    `<p class="panel-year">Percentage able to speak Irish</p>` +
    `<p class="panel-current">${currentText}</p>` +
    `<p class="panel-trend-label">Trend, ${sortedYears()[0]} to ${
      sortedYears()[sortedYears().length - 1]
    }</p>` +
    buildSparkline(countyName);
}

function showCountyPanel(countyName) {
  selectedCounty = countyName;
  renderPanel(countyName);
  panel.hidden = false;

  // On phones the panel sits below the map, so bring it into view on tap.
  if (window.matchMedia("(max-width: 600px)").matches) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function hideCountyPanel() {
  selectedCounty = null;
  panel.hidden = true;
  clearHighlight();
}

// Renders the legend into its own element beside the map, rather than as an
// overlay on top of it.
function buildLegend() {
  const legend = document.getElementById("legend");
  const stops = [0, 10, 20, 30, 40, 50, 60, 70];

  legend.innerHTML =
    "<strong>% with Irish</strong>" +
    stops
      .map(
        (value) =>
          `<span class="legend-row">` +
          `<i style="background:${getCountyColour(value)}"></i>` +
          `${value}%` +
          `</span>`,
      )
      .join("") +
    `<span class="legend-row">` +
    `<i style="background:#cccccc"></i>No data</span>`;
}

// ─────────────────────────────────────────────
// 5. RENDERING
// ─────────────────────────────────────────────

// Expects allData to already be loaded and currentYear to be set.
async function loadCountyBoundaries() {
  const response = await fetch("data/ireland-counties-web.geojson");

  if (!response.ok) {
    throw new Error(`Could not load GeoJSON: ${response.status}`);
  }

  const geojson = await response.json();

  countyLayer = L.geoJSON(geojson, {
    style: styleCounty,
    onEachFeature: addCountyInteraction,
  }).addTo(map);

  map.fitBounds(countyLayer.getBounds(), { padding: [10, 10] });
}

// ─────────────────────────────────────────────
// 6. EVENTS
// ─────────────────────────────────────────────

// Applies whatever year is currently in the selector to the map and any open
// panel. Used by the selector, and by playback below.
function applyYear() {
  currentYear = yearSelect.value;
  countyLayer.setStyle(styleCounty);

  // setStyle repaints every county, so restore the selected outline on top.
  if (selectedLayer) {
    selectedLayer.setStyle(HIGHLIGHT_STYLE);
    selectedLayer.bringToFront();
  }

  // Keep an open panel in sync with the newly selected year.
  if (selectedCounty) {
    renderPanel(selectedCounty);
  }
}

function stopPlayback() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
  playButton.innerHTML = '<span aria-hidden="true">▶</span> Play';
  playButton.setAttribute("aria-pressed", "false");
}

// Animates from the first census year through to the latest, one step at a
// time, then stops on the last year.
function startPlayback() {
  const years = sortedYears();

  yearSelect.value = years[0];
  applyYear();

  playButton.innerHTML = '<span aria-hidden="true">⏸</span> Pause';
  playButton.setAttribute("aria-pressed", "true");

  playTimer = setInterval(() => {
    const current = sortedYears();
    const nextIndex = current.indexOf(yearSelect.value) + 1;

    if (nextIndex >= current.length) {
      stopPlayback();
      return;
    }

    yearSelect.value = current[nextIndex];
    applyYear();
  }, 900);
}

yearSelect.addEventListener("change", () => {
  // A manual year change interrupts playback.
  stopPlayback();
  applyYear();
});

playButton.addEventListener("click", () => {
  if (playTimer) {
    stopPlayback();
  } else {
    startPlayback();
  }
});

panelClose.addEventListener("click", hideCountyPanel);

// ─────────────────────────────────────────────
// 7. BOOTSTRAP
// ─────────────────────────────────────────────

async function initialiseMap() {
  currentYear = yearSelect.value;
  await loadAllData();
  buildLegend();
  await loadCountyBoundaries();
}

initialiseMap().catch((error) => {
  console.error(error);
});
