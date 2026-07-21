const express = require("express");
const app = express();
const PORT = 3000;

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.render("index", {
    title: "A map of spoken Irish",
  });
});

app.listen(PORT, () => {
  console.log("Server on port " + PORT);
});
