document.addEventListener("DOMContentLoaded", function () {
  function showSlide(id) {
    document.querySelectorAll(".slide").forEach(function (s) { s.classList.remove("active"); });
    document.getElementById(id).classList.add("active");
  }

  document.getElementById("next1").addEventListener("click", function () { showSlide("slide2"); });
  document.getElementById("next2").addEventListener("click", function () { showSlide("slide3"); });

  document.getElementById("start").addEventListener("click", function () {
    chrome.storage.sync.set({ onboardingDone: true });
    window.close();
  });

  document.getElementById("skip").addEventListener("click", function () {
    chrome.storage.sync.set({ onboardingDone: true });
    window.close();
  });
});
