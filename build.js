// Pre-renders the EJS page to static HTML and assembles a dist/ folder that can
// be served by GitHub Pages (no Node server needed at runtime). The EJS file
// stays the source of truth; only the rendered HTML is published.

const ejs = require("ejs");
const fs = require("fs");

const abilityData = require("./data/ability.json");
const abilityYears = Object.keys(abilityData).sort(
  (a, b) => Number(a) - Number(b),
);

async function build() {
  fs.rmSync("dist", { recursive: true, force: true });
  fs.mkdirSync("dist/data", { recursive: true });

  // 1. Render each page to static HTML.
  const index = await ejs.renderFile("views/index.ejs", {
    title: "Reported ability to speak Irish",
    abilityYears,
    defaultYear: "1851",
  });
  fs.writeFileSync("dist/index.html", index);

  const about = await ejs.renderFile("views/about.ejs", {
    title: "About - Irish language map",
  });
  fs.writeFileSync("dist/about.html", about);

  const methodology = await ejs.renderFile("views/methodology.ejs", {
    title: "Methodology - Irish language map",
  });
  fs.writeFileSync("dist/methodology.html", methodology);

  // 2. Copy the static assets the page loads at runtime.
  fs.cpSync("public/css", "dist/css", { recursive: true });
  fs.cpSync("public/js", "dist/js", { recursive: true });

  // 3. Copy only the data the site actually uses. The 92 MB raw geojson is
  //    deliberately excluded; the app only reads the 4 MB web version.
  fs.copyFileSync("data/ability.json", "dist/data/ability.json");
  fs.copyFileSync(
    "public/data/ireland-32-counties-web.geojson",
    "dist/data/ireland-32-counties-web.geojson",
  );

  // 4. The social preview image referenced by the Open Graph tags.
  fs.copyFileSync("docs/screenshot.png", "dist/screenshot.png");

  // Brand logo used in the nav.
  fs.copyFileSync("public/logo.png", "dist/logo.png");

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
