document.addEventListener("DOMContentLoaded", () => {
  // ─── Password lock check ───
  chrome.storage.local.get(["passwordHash"], (data) => {
    if (data.passwordHash) {
      document.getElementById("lockOverlay").style.display = "flex";
      document.getElementById("removePassword").style.display = "inline-block";
    }
  });

  document.getElementById("unlockBtn").addEventListener("click", async () => {
    var input = document.getElementById("unlockPassword").value;
    var msg = document.getElementById("unlockMsg");
    if (!input) return;

    var hash = await hashPassword(input);
    chrome.storage.local.get(["passwordHash"], (data) => {
      if (hash === data.passwordHash) {
        document.getElementById("lockOverlay").style.display = "none";
        msg.textContent = "";
      } else {
        msg.textContent = "كلمة المرور غير صحيحة";
      }
    });
  });

  document.getElementById("unlockPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("unlockBtn").click();
  });

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
  var wordMethodSelect = document.getElementById("wordMethod");
  var wordListEl = document.getElementById("wordList");
  var METHOD_LABELS = { exact: "تامة", partial: "جزئية", regex: "regex" };

  function renderWords(words) {
    wordListEl.innerHTML = "";
    words.forEach((entry) => {
      var word, method;
      if (typeof entry === "string") {
        word = entry; method = "exact";
      } else {
        word = entry.word; method = entry.method || "exact";
      }

      var li = document.createElement("li");
      li.innerHTML = '<span>' + escapeHtml(word) + '</span>' +
        '<span class="method-badge method-' + method + '">' + (METHOD_LABELS[method] || method) + '</span>' +
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
    var method = wordMethodSelect.value;
    if (!val) return;
    chrome.storage.local.get(["customWords"], (data) => {
      var arr = data.customWords || [];
      var exists = arr.some((x) => (typeof x === "string" ? x : x.word) === val);
      if (!exists) arr.push({ word: val, method: method });
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

  // Disabled domains (Normal mode)
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

  // Enabled domains (Minimal mode)
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

  // ─── Stats ───
  function loadStats() {
    chrome.storage.local.get(["totalFiltered", "dictionaryHits", "apiHits", "pagesScanned"], (data) => {
      var total = data.totalFiltered || 0;
      var dict = data.dictionaryHits || 0;
      var api = data.apiHits || 0;
      var pages = data.pagesScanned || 0;

      document.getElementById("statTotal").textContent = total.toLocaleString("ar-EG");
      document.getElementById("statDict").textContent = dict.toLocaleString("ar-EG");
      document.getElementById("statApi").textContent = api.toLocaleString("ar-EG");
      document.getElementById("statPages").textContent = pages.toLocaleString("ar-EG");

      var dictPct = total > 0 ? (dict / total) * 100 : 0;
      var apiPct = total > 0 ? (api / total) * 100 : 0;
      document.getElementById("dictBar").style.width = dictPct + "%";
      document.getElementById("apiBar").style.width = apiPct + "%";
    });
  }

  loadStats();

  document.getElementById("resetStats").addEventListener("click", () => {
    if (!confirm("هل تريد إعادة تعيين جميع الإحصائيات؟")) return;
    chrome.storage.local.set({
      totalFiltered: 0,
      dictionaryHits: 0,
      apiHits: 0,
      pagesScanned: 0,
    }, loadStats);
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

  // ─── Password Protection ───
  document.getElementById("setPassword").addEventListener("click", async () => {
    var pw = document.getElementById("newPassword").value;
    var confirm = document.getElementById("confirmPassword").value;
    var msg = document.getElementById("passwordMsg");

    if (!pw) { msg.textContent = "أدخل كلمة مرور"; msg.style.color = "#e74c3c"; return; }
    if (pw.length < 4) { msg.textContent = "كلمة المرور قصيرة (4 أحرف على الأقل)"; msg.style.color = "#e74c3c"; return; }
    if (pw !== confirm) { msg.textContent = "كلمة المرور غير متطابقة"; msg.style.color = "#e74c3c"; return; }

    var hash = await hashPassword(pw);
    chrome.storage.local.set({ passwordHash: hash }, () => {
      msg.textContent = "تم تعيين كلمة المرور";
      msg.style.color = "#2ecc71";
      document.getElementById("newPassword").value = "";
      document.getElementById("confirmPassword").value = "";
      document.getElementById("removePassword").style.display = "inline-block";
      setTimeout(() => { msg.textContent = ""; }, 3000);
    });
  });

  document.getElementById("removePassword").addEventListener("click", () => {
    if (!confirm("هل تريد إزالة كلمة المرور؟")) return;
    chrome.storage.local.remove("passwordHash", () => {
      var msg = document.getElementById("passwordMsg");
      msg.textContent = "تم إزالة كلمة المرور";
      msg.style.color = "#2ecc71";
      document.getElementById("removePassword").style.display = "none";
      setTimeout(() => { msg.textContent = ""; }, 3000);
    });
  });

  // ─── Export / Import ───
  document.getElementById("exportBtn").addEventListener("click", () => {
    chrome.storage.local.get(null, (data) => {
      delete data.passwordHash;
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "haya-settings.json";
      a.click();
      URL.revokeObjectURL(url);
      showMsg("configMsg", "تم تصدير الإعدادات");
    });
  });

  document.getElementById("importFile").addEventListener("change", (e) => {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = (ev) => {
      try {
        var data = JSON.parse(ev.target.result);
        delete data.passwordHash;
        chrome.storage.local.set(data, () => {
          showMsg("configMsg", "تم استيراد الإعدادات — أعد تحميل الصفحة");
          loadStats();
          chrome.storage.local.get(["customWords"], (d) => renderWords(d.customWords || []));
          chrome.storage.local.get(["allowlist"], (d) => renderAllowlist(d.allowlist || []));
          chrome.storage.local.get(["disabledDomains"], (d) => renderDomains(d.disabledDomains || []));
        });
      } catch (err) {
        showMsg("configMsg", "ملف غير صالح");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ─── Helpers ───
  function showMsg(id, text) {
    var el = document.getElementById(id);
    el.textContent = text;
    el.style.color = "#2ecc71";
    setTimeout(() => { el.textContent = ""; }, 3000);
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
});

async function hashPassword(password) {
  var encoder = new TextEncoder();
  var data = encoder.encode(password);
  var buffer = await crypto.subtle.digest("SHA-256", data);
  var array = Array.from(new Uint8Array(buffer));
  return array.map((b) => b.toString(16).padStart(2, "0")).join("");
}
