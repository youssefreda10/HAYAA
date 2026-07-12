document.addEventListener("DOMContentLoaded", () => {
  // Tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  const optMode = document.getElementById("optMode");
  const optThreshold = document.getElementById("optThreshold");
  const optThresholdVal = document.getElementById("optThresholdVal");
  const optEnabled = document.getElementById("optEnabled");

  // Load general settings
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
    var msg = document.getElementById("generalSaved");
    msg.textContent = "تم الحفظ";
    setTimeout(() => { msg.textContent = ""; }, 2000);
  });

  // ─── Custom Words ───
  var wordInput = document.getElementById("newWord");
  var wordListEl = document.getElementById("wordList");

  function renderWords(words) {
    wordListEl.innerHTML = "";
    words.forEach((w) => {
      var li = document.createElement("li");
      li.innerHTML = '<span>' + w + '</span><button class="remove-btn">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        chrome.storage.local.get(["customWords"], (data) => {
          var arr = (data.customWords || []).filter((x) => x !== w);
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
      if (!arr.includes(val)) arr.push(val);
      chrome.storage.local.set({ customWords: arr }, () => {
        renderWords(arr);
        wordInput.value = "";
      });
    });
  });

  // ─── Allowlist ───
  var allowInput = document.getElementById("newAllow");
  var allowListEl = document.getElementById("allowList");

  function renderAllowlist(words) {
    allowListEl.innerHTML = "";
    words.forEach((w) => {
      var li = document.createElement("li");
      li.innerHTML = '<span>' + w + '</span><button class="remove-btn">&times;</button>';
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

  // ─── Domains ───
  var domainInput = document.getElementById("newDomain");
  var domainListEl = document.getElementById("domainList");

  function renderDomains(domains) {
    domainListEl.innerHTML = "";
    domains.forEach((d) => {
      var li = document.createElement("li");
      li.innerHTML = '<span dir="ltr">' + d + '</span><button class="remove-btn">&times;</button>';
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

  // ─── Test Area ───
  document.getElementById("testBtn").addEventListener("click", () => {
    var text = document.getElementById("testInput").value.trim();
    var resultEl = document.getElementById("testResult");
    if (!text) return;

    resultEl.className = "test-result loading";
    resultEl.textContent = "جاري الفحص...";

    chrome.runtime.sendMessage({ type: "classify", texts: [text] }, (results) => {
      if (chrome.runtime.lastError || !results || !results[0]) {
        resultEl.className = "test-result safe";
        resultEl.textContent = "خطأ في الاتصال";
        return;
      }
      var r = results[0];
      if (r.label === "TOXIC") {
        resultEl.className = "test-result toxic";
        resultEl.textContent = "سام (" + Math.round(r.score * 100) + "%)";
      } else {
        resultEl.className = "test-result safe";
        resultEl.textContent = "آمن";
      }
    });
  });
});
