// Phones: the "Menu" button opens the links as a full page over the site
// (and locks the page behind it from scrolling). Loaded on every page.
(function () {
  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("nav-links");
  if (!navToggle || !navLinks) return;

  function setOpen(open) {
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
