// ─────────────────────────────────────────────
// 1. SETUP
// ─────────────────────────────────────────────

const map = L.map("map").setView([53.4, -8.0], 7);

/*L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);*/

// ─────────────────────────────────────────────
// 2. STATE
// ─────────────────────────────────────────────

let countyData = {};
let countyLayer;
const yearSelect = document.getElementById("year-select");

// ─────────────────────────────────────────────
// 3. DATA FETCHING
// ─────────────────────────────────────────────

async function loadAbilityData(year) {
  const response = await fetch(`/api/ability/${year}`);

  if (!response.ok) {
    throw new Error(`Could not load ability data: ${response.status}`);
  }

  countyData = await response.json();
}

// ─────────────────────────────────────────────
// 4. PRESENTATION
// ─────────────────────────────────────────────

function getCountyColour(value) {
  if (value === undefined) {
    return "#cccccc";
  }

  if (value >= 40) {
    return "#176b4d";
  }

  if (value >= 20) {
    return "#70ad8b";
  }

  return "#d8eadf";
}

function styleCounty(feature) {
  const countyName = feature.properties.COUNTY;
  const value = countyData[countyName];

  return {
    color: "#ffffff",
    weight: 1,
    fillColor: getCountyColour(value),
    fillOpacity: 0.8,
  };
}

function addCountyInteraction(feature, layer) {
  layer.bindTooltip(
    () => {
      const countyName = feature.properties.COUNTY;
      const value = countyData[countyName];

      const valueText = value === undefined ? "No data" : `${value}%`;

      return `<strong>${countyName}</strong><br>${valueText}`;
    },
    {
      sticky: true,
    },
  );
}

// ─────────────────────────────────────────────
// 5. RENDERING
// ─────────────────────────────────────────────

// Expects countyData to already be populated by loadAbilityData.
async function loadCountyBoundaries() {
  const response = await fetch("/data/ireland-counties-web.geojson");

  if (!response.ok) {
    throw new Error(`Could not load GeoJSON: ${response.status}`);
  }

  const geojson = await response.json();

  countyLayer = L.geoJSON(geojson, {
    style: styleCounty,
    onEachFeature: addCountyInteraction,
  }).addTo(map);

  map.fitBounds(countyLayer.getBounds());
}

// ─────────────────────────────────────────────
// 6. EVENTS
// ─────────────────────────────────────────────

yearSelect.addEventListener("change", async () => {
  const selectedYear = yearSelect.value;

  try {
    await loadAbilityData(selectedYear);

    countyLayer.setStyle(styleCounty);
  } catch (error) {
    console.error(error);
  }
});

// ─────────────────────────────────────────────
// 7. BOOTSTRAP
// ─────────────────────────────────────────────

async function initialiseMap() {
  await loadAbilityData(yearSelect.value);
  await loadCountyBoundaries();
}

initialiseMap().catch((error) => {
  console.error(error);
});
