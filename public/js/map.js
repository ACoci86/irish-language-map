const map = L.map("map").setView([53.4, -8.0], 7);

/*L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);*/

function addCountyInteraction(feature, layer) {
  const countyName = feature.properties.COUNTY;

  layer.bindTooltip(countyName, {
    sticky: true,
  });
}

async function loadCountyBoundaries() {
  const response = await fetch("/data/ireland-counties-web.geojson");

  if (!response.ok) {
    throw new Error(`Could not load GeoJSON: ${response.status}`);
  }

  const geojson = await response.json();

  const countyLayer = L.geoJSON(geojson, {
    style: {
      color: "#ffffff",
      weight: 0.5,
      fillColor: "#2f7658",
      fillOpacity: 0.35,
    },
    onEachFeature: addCountyInteraction,
  }).addTo(map);

  map.fitBounds(countyLayer.getBounds());
}

loadCountyBoundaries().catch((error) => {
  console.error(error);
});
