// Phones: the "Menu" pill opens the links as a full page over the site,
// growing out of the button (and locks the page behind it from scrolling).
// Loaded on every page.
(function () {
  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("nav-links");
  if (!navToggle || !navLinks) return;

  function setOpen(open) {
    // The menu grows as a circle out of the button, so start it there.
    const b = navToggle.getBoundingClientRect();
    navLinks.style.setProperty("--from-x", `${b.left + b.width / 2}px`);
    navLinks.style.setProperty("--from-y", `${b.top + b.height / 2}px`);
    navLinks.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.documentElement.classList.toggle("menu-open", open);
  }

  navToggle.addEventListener("click", () => setOpen(!navLinks.classList.contains("open")));

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });
})();
