document.addEventListener("DOMContentLoaded", function () {
  chrome.storage.sync.get(["theme"], function (data) {
    if (data.theme === "light") document.body.classList.add("light");
  });

  function showSlide(id) {
    document.querySelectorAll(".slide").forEach(function (s) { s.classList.remove("active"); });
    document.getElementById(id).classList.add("active");
  }

  document.getElementById("next1").addEventListener("click", function () { showSlide("slide2"); });
  document.getElementById("next2").addEventListener("click", function () { showSlide("slide3"); });

  document.getElementById("start").addEventListener("click", function () { window.close(); });
  document.getElementById("skip").addEventListener("click", function () { window.close(); });
});
