# Reported Ability to Speak Irish

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![EJS](https://img.shields.io/badge/EJS-B4CA65?style=flat-square&logo=ejs&logoColor=black)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=flat-square&logo=leaflet&logoColor=white)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)

An interactive choropleth map showing the percentage of people who reported being able to speak Irish in each county, across every census from 1851 to 2022.

## Live demo

https://acoci86.github.io/irish-language-map/

## Overview

Each county is shaded on a single green scale (light for few speakers, dark for many), on a fixed 0 to 70 percent scale so a shade means the same thing in every year. Press Play to animate through the census years, or pick a year from the dropdown. Click any county to open a card with its exact percentage and a sparkline of its trend across all census years.

## Features

- Animated timeline: Play/Pause through every census from 1851 to 2022.
- Per-county trend: click a county to see its full history as a sparkline.
- Consistent colour scale: fixed 0 to 70 percent domain so years are comparable.
- Selected-county highlight: the clicked county is outlined on the map.
- Responsive: two-column layout on desktop, stacked with a horizontal legend on mobile.
- Static-first: pre-rendered to plain HTML and hosted on GitHub Pages.

## Data and sources

### Language ability statistics

The percentages come from the Central Statistics Office (CSO), [data.cso.ie](https://data.cso.ie/).

A note on comparability: census questions and definitions changed over time. Older censuses reported some areas separately from the modern 26-county set. For example, Tipperary was returned as two ridings (North and South), and cities were sometimes counted apart from their surrounding county. These historical sub-units were aggregated up to present-day county units so there is one consistent value per county in every year. The CSO also notes that results such as 1926 and 2022 are not directly comparable, and a new question series began in 1996.

### County boundaries

The map outlines come from the Ordnance Survey Ireland (OSi) open data portal. The raw GeoJSON was downloaded with:

```bash
curl -L \
  "https://data-osi.opendata.arcgis.com/api/download/v1/items/a2dd7924915e4c74ad6a417e33c394eb/geojson?layers=1" \
  -o public/data/ireland-counties.geojson
```

That file is about 92 MB, far too large to ship to a browser (or commit to Git). It was simplified and dissolved to one lightweight polygon per county using [mapshaper](https://github.com/mbloch/mapshaper):

```bash
npx mapshaper public/data/ireland-counties.geojson \
  -each 'COUNTY=ENG_NAME_VALUE.trim().toUpperCase()' \
  -dissolve COUNTY \
  -simplify 5% keep-shapes \
  -filter-fields COUNTY \
  -o format=geojson precision=0.0001 \
  public/data/ireland-counties-simplified.geojson
```

- `-each ... COUNTY=...` normalises the county name so it matches the keys in the statistics data.
- `-dissolve COUNTY` merges the many sub-polygons into a single shape per county.
- `-simplify 5% keep-shapes` cuts the point count dramatically while keeping every county intact.
- `-filter-fields COUNTY` and `precision=0.0001` drop unused attributes and trim coordinate precision.

The result is a small GeoJSON the browser can load quickly. The 92 MB source is not committed to the repository.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or newer

## Getting started

```bash
git clone https://github.com/ACoci86/irish-language-map.git
cd irish-language-map
npm install
npm start
```

Then open http://localhost:3000.

## Build and deploy

The site is fully static, so it is pre-rendered and published to GitHub Pages:

```bash
npm run build   # renders the EJS to dist/ and copies the assets it needs
```

Every push to `main` runs [`.github/workflows/pages.yml`](.github/workflows/pages.yml), which builds `dist/` and deploys it to GitHub Pages. (Repo Settings, Pages, Source must be set to GitHub Actions.)

## Tech stack

- [Leaflet](https://leafletjs.com/): interactive map rendering
- [Express](https://expressjs.com/) and [EJS](https://ejs.co/): local dev server and templating
- Node.js: build script (`build.js`) that pre-renders the page
- GeoJSON: county boundary data
- Vanilla JavaScript, HTML and CSS: no front-end framework

## License

Released under the MIT License. Census statistics are copyright the Central Statistics Office and boundary data copyright Ordnance Survey Ireland, each under their respective open-data terms.
