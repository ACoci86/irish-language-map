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

All 32 counties are shaded on a single green scale, light for few speakers, dark for many. The scale is fixed across every year, so a shade always means the same percentage. Press Play to animate through the census years, or pick a year from the dropdown. Click any county for its exact percentage and a sparkline of its trend.

## Features

- Animated timeline: Play/Pause through every census from 1851 to 2022.
- Per-county trend: click a county to see its full history as a sparkline.
- All 32 counties: the Republic plus the six Northern Ireland counties.
- Consistent colour scale: fixed across all years, so shades are comparable.
- Selected-county highlight: the clicked county is outlined on the map.
- Responsive: two-column layout on desktop, stacked with a horizontal legend on mobile.
- Static-first: pre-rendered to plain HTML and hosted on GitHub Pages.

## Data and sources

### Language ability statistics

The percentages come from the Central Statistics Office (CSO), [data.cso.ie](https://data.cso.ie/).

A note on comparability: census questions and definitions changed over time. Older censuses reported some areas separately from the modern 26-county set. For example, Tipperary was returned as two ridings (North and South), and cities were sometimes counted apart from their surrounding county. These historical sub-units were aggregated up to present-day county units so there is one consistent value per county in every year. The CSO also notes that results such as 1926 and 2022 are not directly comparable, and a new question series began in 1996.

### Northern Ireland

The map covers all 32 counties. The Northern Ireland figures come from the Northern Ireland censuses and were compiled by **phelimbirch**, who kindly shared them.

Because the North runs its own census, this creates three wrinkles, all handled explicitly:

- **Coverage gap.** Irish was recorded in the all-island censuses of 1851 to 1911, then not again until 1991. The six counties therefore show as "no data" for 1926 through 1986, and for 1996, 2006 and 2016. The trend sparkline breaks its line across that gap rather than drawing a misleading straight segment.
- **Offset census years.** The NI censuses of 2001 and 2021 are displayed under the Republic's 2002 and 2022. The county card states which NI census a figure actually comes from.
- **Estimated values.** Antrim and Down have no published full-county figure for 1851, 1861 and 1901, because Belfast straddles both counties and was not split between them in those returns. Those six values are estimated by reassigning Belfast's population and speakers between the two counties. Every other value is as published.

The NI percentages were validated against the underlying speaker counts and population totals before use, and match exactly.

### County boundaries

Republic of Ireland outlines come from the Ordnance Survey Ireland (OSi) open data portal, and the six Northern Ireland counties from the Ordnance Survey of Northern Ireland (OSNI). The raw OSi GeoJSON was downloaded with:

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

The Northern Ireland counties were pulled from the OSNI feature service and put through the same pipeline:

```bash
curl -sL "https://services-eu1.arcgis.com/kswen6BYexuc1SUk/arcgis/rest/services/OSNI_County_Boundaries/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson" \
  -o ni_counties.geojson

npx mapshaper ni_counties.geojson \
  -each 'COUNTY=CountyName.trim().toUpperCase()' \
  -dissolve COUNTY \
  -simplify 5% keep-shapes \
  -filter-fields COUNTY \
  -o format=geojson precision=0.0001 ni-simplified.geojson
```

The two were then merged into a single 32-county file, `public/data/ireland-32-counties-web.geojson`, which is what the map loads. The result is a small GeoJSON the browser can load quickly. The 92 MB source is not committed to the repository.

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

Released under the MIT License, see [LICENSE](LICENSE). Census statistics are copyright the Central Statistics Office and the Northern Ireland Statistics and Research Agency, and boundary data copyright Ordnance Survey Ireland and Ordnance Survey of Northern Ireland, each under their respective open-data terms.
