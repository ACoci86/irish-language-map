const map = L.map("map").setView([53.4, -8.0], 7);

const testData = {
  GALWAY: 50,
  MAYO: 38,
  DONEGAL: 34,
  DUBLIN: 8,
};

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

/*L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);*/

function addCountyInteraction(feature, layer) {
  //feature info about COUNTY, e.g. COUNTY: CORK - layer is county shape
  const countyName = feature.properties.COUNTY;

  layer.bindTooltip(countyName, {
    //layer puts that name onto the visible map shape
    sticky: true,
  });
}

function styleCounty(feature) {
  const countyName = feature.properties.COUNTY;
  const value = testData[countyName];

  return {
    color: "#ffffff",
    weight: 1,
    fillColor: getCountyColour(value),
    fillOpacity: 0.8,
  };
}

async function loadCountyBoundaries() {
  const response = await fetch("/data/ireland-counties-web.geojson");

  if (!response.ok) {
    throw new Error(`Could not load GeoJSON: ${response.status}`);
  }

  const geojson = await response.json();

  const countyLayer = L.geoJSON(geojson, {
    style: styleCounty,
    onEachFeature: addCountyInteraction,
  }).addTo(map);

  map.fitBounds(countyLayer.getBounds());
}

loadCountyBoundaries().catch((error) => {
  console.error(error);
});
