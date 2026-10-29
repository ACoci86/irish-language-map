// Lighter copies of the county boundaries for the home page. The source has
// far more detail than any map on the site can show, and reading and drawing
// it froze phones for about a second. So the pages load thinned copies:
//   opener.geojson   (a point every ~1.1 km) for the small opening map, so it
//                    appears at once;
//   counties.geojson (every ~330 m, still a few points per pixel) for the
//                    main map and the sketched maps, loaded behind it.
// Used by build.js and the dev server.
const fs = require("fs");

const SOURCE = "public/data/ireland-32-counties-web.geojson";
// Longitude is scaled by the cosine of Ireland's latitude, so the spacing
// is even in both directions.
const K = Math.cos((53.4 * Math.PI) / 180);
function thinRing(ring, minStep) {
  const kept = [ring[0]];
  for (const point of ring.slice(1, -1)) {
    const last = kept[kept.length - 1];
    if (Math.hypot((point[0] - last[0]) * K, point[1] - last[1]) >= minStep) kept.push(point);
  }
  kept.push(ring[ring.length - 1]);
  return kept.map(([lon, lat]) => [+lon.toFixed(4), +lat.toFixed(4)]);
}

// Thins every ring; specks too small to keep a shape are dropped.
function thinPolygon(rings, minStep) {
  return rings.map((ring) => thinRing(ring, minStep)).filter((ring) => ring.length >= 4);
}

// `minStep` is in degrees of latitude.
function thinnedShapes(minStep) {
  const geojson = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  geojson.features.forEach((feature) => {
    const geometry = feature.geometry;
    if (geometry.type === "Polygon") {
      geometry.coordinates = thinPolygon(geometry.coordinates, minStep);
    } else {
      geometry.coordinates = geometry.coordinates
        .map((polygon) => thinPolygon(polygon, minStep))
        .filter((polygon) => polygon.length);
    }
  });
  return geojson;
}

const openerShapes = () => thinnedShapes(0.01);
const countyShapes = () => thinnedShapes(0.003);

module.exports = { openerShapes, countyShapes };
