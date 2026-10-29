<p align="center">
  <img src="public/logo.png" alt="Irish language map" width="160">
</p>

# Where did the Irish language go?

A hand-drawn, scrolling story of who could speak Irish in each of Ireland's 32 counties, in every census from 1851 to 2022.

**Live:** https://irishlanguagemap.org/

## Data

- **Republic of Ireland:** Central Statistics Office ([data.cso.ie](https://data.cso.ie/)).
- **Northern Ireland:** the Northern Ireland censuses, compiled by [Phelim Birch](https://bsky.app/profile/phelimbirch.bsky.social).
- **Boundaries:** Ordnance Survey Ireland and Ordnance Survey of Northern Ireland, simplified with [mapshaper](https://github.com/mbloch/mapshaper).

The figures are self-reported ability, and the census questions changed over time. The [methodology page](https://irishlanguagemap.org/methodology.html) covers the caveats, including Northern Ireland's gaps and estimates.

## Run it

Needs [Node.js](https://nodejs.org/) 18 or newer.

```bash
npm install
npm start        # http://localhost:3000
npm run build    # static site in dist/
```

Pushes to `main` are built and deployed to GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml).

Built with Express and EJS, D3, rough.js, Leaflet and GSAP; the drawings were made in VectorCraft.

## Thanks

To [Phelim Birch](https://bsky.app/profile/phelimbirch.bsky.social), who compiled the Northern Ireland figures for his degree project and generously shared them. Without his work the map would stop at the border.

## License

MIT, see [LICENSE](LICENSE). Census data © CSO and NISRA; boundaries © OSi and OSNI, under their open-data terms.
