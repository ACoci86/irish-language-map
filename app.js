const express = require("express");
const app = express();
const PORT = 3000;
const abilityData = require("./data/ability.json");

app.set("view engine", "ejs");
app.use(express.static("public"));
// Serve the root data folder so the page can fetch data/ability.json the same
// way it does on the static (GitHub Pages) build.
app.use("/data", express.static("data"));

app.get(["/", "/index.html"], (req, res) => {
  const abilityYears = Object.keys(abilityData).sort(
    (a, b) => Number(a) - Number(b),
  );

  res.render("index", {
    title: "Irish language map",
    ogTitle: "Reported ability to speak Irish, 1851 to 2022",
    description:
      "Interactive map of the percentage of people able to speak Irish in each of Ireland's 32 counties, from the 1851 census to 2022.",
    canonical: "https://irishlanguagemap.org/",
    abilityYears,
    defaultYear: "1851",
  });
});

app.get("/about.html", (req, res) => {
  res.render("about", {
    title: "About - Irish language map",
    description:
      "About the Irish language map: what it shows, the census data sources, and credits.",
    canonical: "https://irishlanguagemap.org/about.html",
  });
});

app.get("/methodology.html", (req, res) => {
  res.render("methodology", {
    title: "Methodology - Irish language map",
    description:
      "How the Irish language map is built: what the census figures measure, comparability caveats, and the Northern Ireland data notes.",
    canonical: "https://irishlanguagemap.org/methodology.html",
  });
});

app.get("/api/ability", (req, res) => {
  res.json(abilityData);
});

app.get("/api/ability/:year", (req, res) => {
  const year = req.params.year;
  const data = abilityData[year];

  if (!data) {
    return res.status(404).json({ error: "Data not found" });
  }

  res.json(data);
});

app.listen(PORT, () => {
  console.log("Server on port " + PORT);
});
