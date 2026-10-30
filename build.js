// Pre-renders the EJS page to static HTML and assembles a dist/ folder that can
// be served by GitHub Pages (no Node server needed at runtime). The EJS file
// stays the source of truth; only the rendered HTML is published.

const ejs = require("ejs");
const fs = require("fs");

const abilityData = require("./data/ability.json");
const { openerShapes, countyShapes } = require("./opener-shapes");
const abilityYears = Object.keys(abilityData).sort(
  (a, b) => Number(a) - Number(b),
);

async function build() {
  fs.rmSync("dist", { recursive: true, force: true });
  fs.mkdirSync("dist/data", { recursive: true });

  // 1. Render each page to static HTML.
  const SITE = "https://irishlanguagemap.org";
  // Stamped on the stylesheet and script URLs, so every build is fetched
  // afresh rather than served from a browser's cache.
  const assetVersion = Date.now().toString(36);

  const index = await ejs.renderFile("views/index.ejs", {
    assetVersion,
    title: "Irish language map",
    ogTitle: "Where did the Irish language go?",
    description:
      "A hand-drawn, scrolling story of who could speak Irish in each of Ireland's 32 counties, in every census from 1851 to 2022.",
    canonical: `${SITE}/`,
    abilityYears,
    defaultYear: "1851",
  });
  fs.writeFileSync("dist/index.html", index);

  const about = await ejs.renderFile("views/about.ejs", {
    assetVersion,
    title: "About - Irish language map",
    description:
      "About the Irish language map: who made it, what it shows, and thanks to the people behind the data.",
    canonical: `${SITE}/about.html`,
  });
  fs.writeFileSync("dist/about.html", about);

  const methodology = await ejs.renderFile("views/methodology.ejs", {
    assetVersion,
    title: "Methodology - Irish language map",
    description:
      "How the Irish language map is built: what the census figures measure, comparability caveats, and the Northern Ireland data notes.",
    canonical: `${SITE}/methodology.html`,
  });
  fs.writeFileSync("dist/methodology.html", methodology);

  // Sitemap + robots so search engines can discover and crawl every page.
  const pages = ["/", "/about.html", "/methodology.html"];
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  fs.writeFileSync("dist/sitemap.xml", sitemap);

  fs.writeFileSync(
    "dist/robots.txt",
    `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`,
  );

  // 2. Copy the static assets the page loads at runtime.
  fs.cpSync("public/css", "dist/css", { recursive: true });
  fs.cpSync("public/js", "dist/js", { recursive: true });
  fs.cpSync("public/img", "dist/img", { recursive: true });
  fs.cpSync("public/fonts", "dist/fonts", { recursive: true });
  fs.cpSync("public/vendor", "dist/vendor", { recursive: true });

  // 3. Copy only the data the site actually uses. The 92 MB raw geojson is
  //    deliberately excluded; the app only reads the 4 MB web version.
  fs.copyFileSync("data/ability.json", "dist/data/ability.json");
  // Thinned copies of the boundaries (see opener-shapes.js): the opener's,
  // so it draws at once, and the main map's.
  fs.writeFileSync("dist/data/opener.geojson", JSON.stringify(openerShapes()));
  fs.writeFileSync("dist/data/counties.geojson", JSON.stringify(countyShapes()));

  // 4. The social preview image referenced by the Open Graph tags.
  fs.copyFileSync("docs/social-preview.jpg", "dist/social-preview.jpg");

  // Brand logo used in the nav, and the tab favicon.
  fs.copyFileSync("public/logo.png", "dist/logo.png");
  fs.copyFileSync("public/favicon.png", "dist/favicon.png");

  // 5. Custom domain for GitHub Pages.
  fs.writeFileSync("dist/CNAME", "irishlanguagemap.org\n");

  // 6. Stop GitHub Pages from running the output through Jekyll.
  fs.writeFileSync("dist/.nojekyll", "");

  console.log("Built static site to dist/");
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
