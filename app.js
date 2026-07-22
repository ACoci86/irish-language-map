const express = require("express");
const app = express();
const PORT = 3000;
const abilityData = require("./data/ability.json");

app.set("view engine", "ejs");
app.use(express.static("public"));
// Serve the root data folder so the page can fetch data/ability.json the same
// way it does on the static (GitHub Pages) build.
app.use("/data", express.static("data"));

app.get("/", (req, res) => {
  const abilityYears = Object.keys(abilityData).sort(
    (a, b) => Number(a) - Number(b),
  );

  res.render("index", {
    title: "Reported ability to speak Irish",
    abilityYears,
    defaultYear: "1851",
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
