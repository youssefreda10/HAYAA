document.addEventListener("DOMContentLoaded", () => {
  // ─── Tabs ───
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  // ─── General settings ───
  const optMode = document.getElementById("optMode");
  const optThreshold = document.getElementById("optThreshold");
  const optThresholdVal = document.getElementById("optThresholdVal");
  const optEnabled = document.getElementById("optEnabled");

  chrome.storage.local.get(["enabled", "mode", "threshold"], (data) => {
    optEnabled.checked = data.enabled !== false;
    optMode.value = data.mode || "blur";
    optThreshold.value = (data.threshold || 0.75) * 100;
    optThresholdVal.textContent = optThreshold.value + "%";
  });

  optThreshold.addEventListener("input", () => {
    optThresholdVal.textContent = optThreshold.value + "%";
  });

  document.getElementById("saveGeneral").addEventListener("click", () => {
    chrome.storage.local.set({
      enabled: optEnabled.checked,
      mode: optMode.value,
      threshold: optThreshold.value / 100,
    });
    showMsg("generalSaved", "تم الحفظ");
  });

  // ─── Custom Words ───
  var wordInput = document.getElementById("newWord");
  var wordListEl = document.getElementById("wordList");

  function renderWords(words) {
    wordListEl.innerHTML = "";
    words.forEach((entry) => {
      var word = typeof entry === "string" ? entry : entry.word;

      var li = document.createElement("li");
      li.innerHTML = '<span>' + escapeHtml(word) + '</span>' +
        '<button class="remove-btn">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        chrome.storage.local.get(["customWords"], (data) => {
          var arr = (data.customWords || []).filter((x) => {
            var w = typeof x === "string" ? x : x.word;
            return w !== word;
          });
          chrome.storage.local.set({ customWords: arr }, () => renderWords(arr));
        });
      });
      wordListEl.appendChild(li);
    });
  }

  chrome.storage.local.get(["customWords"], (data) => {
    renderWords(data.customWords || []);
  });

  document.getElementById("addWord").addEventListener("click", () => {
    var val = wordInput.value.trim();
    if (!val) return;
    chrome.storage.local.get(["customWords"], (data) => {
      var arr = data.customWords || [];
      var exists = arr.some((x) => (typeof x === "string" ? x : x.word) === val);
      if (!exists) arr.push(val);
      chrome.storage.local.set({ customWords: arr }, () => {
        renderWords(arr);
        wordInput.value = "";
      });
    });
  });

  wordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addWord").click();
  });

  // ─── Allowlist ───
  var allowInput = document.getElementById("newAllow");
  var allowListEl = document.getElementById("allowList");

  function renderAllowlist(words) {
    allowListEl.innerHTML = "";
    words.forEach((w) => {
      var li = document.createElement("li");
      li.innerHTML = '<span>' + escapeHtml(w) + '</span><button class="remove-btn">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        chrome.storage.local.get(["allowlist"], (data) => {
          var arr = (data.allowlist || []).filter((x) => x !== w);
          chrome.storage.local.set({ allowlist: arr }, () => renderAllowlist(arr));
        });
      });
      allowListEl.appendChild(li);
    });
  }

  chrome.storage.local.get(["allowlist"], (data) => {
    renderAllowlist(data.allowlist || []);
  });

  document.getElementById("addAllow").addEventListener("click", () => {
    var val = allowInput.value.trim();
    if (!val) return;
    chrome.storage.local.get(["allowlist"], (data) => {
      var arr = data.allowlist || [];
      if (!arr.includes(val)) arr.push(val);
      chrome.storage.local.set({ allowlist: arr }, () => {
        renderAllowlist(arr);
        allowInput.value = "";
      });
    });
  });

  allowInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addAllow").click();
  });

  // ─── Domains ───
  var domainModeSelect = document.getElementById("domainModeSelect");
  var normalSection = document.getElementById("normalModeSection");
  var minimalSection = document.getElementById("minimalModeSection");
  var domainInput = document.getElementById("newDomain");
  var domainListEl = document.getElementById("domainList");
  var enabledDomainInput = document.getElementById("newEnabledDomain");
  var enabledDomainListEl = document.getElementById("enabledDomainList");

  chrome.storage.local.get(["domainMode"], (data) => {
    domainModeSelect.value = data.domainMode || "normal";
    toggleDomainSections(domainModeSelect.value);
  });

  domainModeSelect.addEventListener("change", () => {
    var mode = domainModeSelect.value;
    chrome.storage.local.set({ domainMode: mode });
    toggleDomainSections(mode);
  });

  function toggleDomainSections(mode) {
    if (mode === "minimal") {
      normalSection.style.display = "none";
      minimalSection.style.display = "block";
    } else {
      normalSection.style.display = "block";
      minimalSection.style.display = "none";
    }
  }

  function renderDomains(domains) {
    domainListEl.innerHTML = "";
    domains.forEach((d) => {
      var li = document.createElement("li");
      li.innerHTML = '<span dir="ltr">' + escapeHtml(d) + '</span><button class="remove-btn">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        chrome.storage.local.get(["disabledDomains"], (data) => {
          var arr = (data.disabledDomains || []).filter((x) => x !== d);
          chrome.storage.local.set({ disabledDomains: arr }, () => renderDomains(arr));
        });
      });
      domainListEl.appendChild(li);
    });
  }

  chrome.storage.local.get(["disabledDomains"], (data) => {
    renderDomains(data.disabledDomains || []);
  });

  document.getElementById("addDomain").addEventListener("click", () => {
    var val = domainInput.value.trim();
    if (!val) return;
    chrome.storage.local.get(["disabledDomains"], (data) => {
      var arr = data.disabledDomains || [];
      if (!arr.includes(val)) arr.push(val);
      chrome.storage.local.set({ disabledDomains: arr }, () => {
        renderDomains(arr);
        domainInput.value = "";
      });
    });
  });

  domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addDomain").click();
  });

  function renderEnabledDomains(domains) {
    enabledDomainListEl.innerHTML = "";
    domains.forEach((d) => {
      var li = document.createElement("li");
      li.innerHTML = '<span dir="ltr">' + escapeHtml(d) + '</span><button class="remove-btn">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        chrome.storage.local.get(["enabledDomains"], (data) => {
          var arr = (data.enabledDomains || []).filter((x) => x !== d);
          chrome.storage.local.set({ enabledDomains: arr }, () => renderEnabledDomains(arr));
        });
      });
      enabledDomainListEl.appendChild(li);
    });
  }

  chrome.storage.local.get(["enabledDomains"], (data) => {
    renderEnabledDomains(data.enabledDomains || []);
  });

  document.getElementById("addEnabledDomain").addEventListener("click", () => {
    var val = enabledDomainInput.value.trim();
    if (!val) return;
    chrome.storage.local.get(["enabledDomains"], (data) => {
      var arr = data.enabledDomains || [];
      if (!arr.includes(val)) arr.push(val);
      chrome.storage.local.set({ enabledDomains: arr }, () => {
        renderEnabledDomains(arr);
        enabledDomainInput.value = "";
      });
    });
  });

  enabledDomainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addEnabledDomain").click();
  });

  // ─── Helpers ───
  function showMsg(id, text) {
    var el = document.getElementById(id);
    el.textContent = text;
    el.style.color = "#10b981";
    setTimeout(() => { el.textContent = ""; }, 3000);
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
});
