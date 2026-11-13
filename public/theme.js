// Set the theme before first paint so the window never flashes.
(function () {
  var t = null;
  try {
    t = localStorage.getItem("mdview.theme");
  } catch (e) {}
  if (t !== "light" && t !== "dark") {
    t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.dataset.theme = t;
})();
