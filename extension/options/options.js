document.addEventListener("DOMContentLoaded", () => {
  var undoStack = [];

  // ─── Theme ───
  chrome.storage.sync.get(["theme"], (data) => {
    applyTheme(data.theme || "dark");
  });

  document.getElementById("themeToggle").addEventListener("click", () => {
    var isLight = document.body.classList.contains("light");
    var newTheme = isLight ? "dark" : "light";
    chrome.storage.sync.set({ theme: newTheme });
    applyTheme(newTheme);
  });

  function applyTheme(theme) {
    var icon = document.getElementById("themeIcon");
    if (theme === "light") {
      document.body.classList.add("light");
      icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    } else {
      document.body.classList.remove("light");
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    }
  }

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
  const optEnabled = document.getElementById("optEnabled");

  chrome.storage.sync.get(["enabled", "mode"], (data) => {
    optEnabled.checked = data.enabled !== false;
    optMode.value = data.mode || "blur";
  });

  document.getElementById("saveGeneral").addEventListener("click", () => {
    chrome.storage.sync.set({ enabled: optEnabled.checked, mode: optMode.value });
    showMsg("generalSaved", "تم الحفظ");
  });

  // ─── Custom Words ───
  var wordInput = document.getElementById("newWord");
  var wordListEl = document.getElementById("wordList");

  function renderWords(words) {
    wordListEl.innerHTML = "";
    if (words.length === 0) {
      wordListEl.innerHTML = '<div class="empty-state"><svg viewBox="0 0 80 80" width="60" height="60" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="20" width="60" height="45" rx="6"/><line x1="25" y1="35" x2="55" y2="35"/><line x1="25" y1="45" x2="45" y2="45"/></svg><p>لا توجد كلمات مخصصة بعد</p></div>';
      return;
    }
    words.forEach((entry) => {
      var word = typeof entry === "string" ? entry : entry.word;
      var li = document.createElement("li");
      li.innerHTML = '<span>' + escapeHtml(word) + '</span><button class="remove-btn" title="حذف">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        if (!confirmDelete("حذف \"" + word + "\" من القاموس؟")) return;
        chrome.storage.sync.get(["customWords"], (data) => {
          var arr = (data.customWords || []).filter((x) => {
            var w = typeof x === "string" ? x : x.word;
            return w !== word;
          });
          pushUndo("customWords", data.customWords);
          chrome.storage.sync.set({ customWords: arr }, () => renderWords(arr));
        });
      });
      wordListEl.appendChild(li);
    });
  }

  chrome.storage.sync.get(["customWords"], (data) => { renderWords(data.customWords || []); });

  document.getElementById("addWord").addEventListener("click", () => {
    var val = wordInput.value.trim();
    if (!val) return;
    // Bulk add: split by newline or comma
    var items = val.split(/[,،\n]+/).map((s) => s.trim()).filter(Boolean);
    chrome.storage.sync.get(["customWords"], (data) => {
      var arr = data.customWords || [];
      var added = 0;
      items.forEach((item) => {
        var exists = arr.some((x) => (typeof x === "string" ? x : x.word) === item);
        if (!exists) { arr.push(item); added++; }
      });
      if (added > 0) {
        chrome.storage.sync.set({ customWords: arr }, () => {
          renderWords(arr);
          wordInput.value = "";
          showMsg("generalSaved", "تمت إضافة " + added + " كلمة");
        });
      }
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
    if (words.length === 0) {
      allowListEl.innerHTML = '<div class="empty-state"><svg viewBox="0 0 80 80" width="60" height="60" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="40" cy="40" r="28"/><path d="M30 42l7 7 13-16"/></svg><p>لا توجد كلمات في القائمة البيضاء</p></div>';
      return;
    }
    words.forEach((w) => {
      var li = document.createElement("li");
      li.innerHTML = '<span>' + escapeHtml(w) + '</span><button class="remove-btn" title="حذف">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        if (!confirmDelete("حذف \"" + w + "\" من القائمة البيضاء؟")) return;
        chrome.storage.sync.get(["allowlist"], (data) => {
          var arr = (data.allowlist || []).filter((x) => x !== w);
          pushUndo("allowlist", data.allowlist);
          chrome.storage.sync.set({ allowlist: arr }, () => renderAllowlist(arr));
        });
      });
      allowListEl.appendChild(li);
    });
  }

  chrome.storage.sync.get(["allowlist"], (data) => { renderAllowlist(data.allowlist || []); });

  document.getElementById("addAllow").addEventListener("click", () => {
    var val = allowInput.value.trim();
    if (!val) return;
    var items = val.split(/[,،\n]+/).map((s) => s.trim()).filter(Boolean);
    chrome.storage.sync.get(["allowlist"], (data) => {
      var arr = data.allowlist || [];
      var added = 0;
      items.forEach((item) => {
        if (!arr.includes(item)) { arr.push(item); added++; }
      });
      if (added > 0) {
        chrome.storage.sync.set({ allowlist: arr }, () => {
          renderAllowlist(arr);
          allowInput.value = "";
          showMsg("generalSaved", "تمت إضافة " + added + " كلمة");
        });
      }
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

  chrome.storage.sync.get(["domainMode"], (data) => {
    domainModeSelect.value = data.domainMode || "normal";
    toggleDomainSections(domainModeSelect.value);
  });

  domainModeSelect.addEventListener("change", () => {
    var mode = domainModeSelect.value;
    chrome.storage.sync.set({ domainMode: mode });
    toggleDomainSections(mode);
  });

  function toggleDomainSections(mode) {
    normalSection.style.display = mode === "minimal" ? "none" : "block";
    minimalSection.style.display = mode === "minimal" ? "block" : "none";
  }

  function renderDomains(domains) {
    domainListEl.innerHTML = "";
    if (domains.length === 0) {
      domainListEl.innerHTML = '<div class="empty-state"><svg viewBox="0 0 80 80" width="60" height="60" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="40" cy="40" r="28"/><line x1="15" y1="30" x2="65" y2="30"/><line x1="15" y1="50" x2="65" y2="50"/><ellipse cx="40" cy="40" rx="12" ry="28"/></svg><p>لا توجد مواقع معطّلة</p></div>';
      return;
    }
    domains.forEach((d) => {
      var li = document.createElement("li");
      li.innerHTML = '<span dir="ltr">' + escapeHtml(d) + '</span><button class="remove-btn" title="حذف">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        chrome.storage.sync.get(["disabledDomains"], (data) => {
          var arr = (data.disabledDomains || []).filter((x) => x !== d);
          chrome.storage.sync.set({ disabledDomains: arr }, () => renderDomains(arr));
        });
      });
      domainListEl.appendChild(li);
    });
  }

  chrome.storage.sync.get(["disabledDomains"], (data) => { renderDomains(data.disabledDomains || []); });

  document.getElementById("addDomain").addEventListener("click", () => {
    var val = domainInput.value.trim();
    if (!val) return;
    chrome.storage.sync.get(["disabledDomains"], (data) => {
      var arr = data.disabledDomains || [];
      if (!arr.includes(val)) arr.push(val);
      chrome.storage.sync.set({ disabledDomains: arr }, () => { renderDomains(arr); domainInput.value = ""; });
    });
  });

  domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addDomain").click();
  });

  function renderEnabledDomains(domains) {
    enabledDomainListEl.innerHTML = "";
    if (domains.length === 0) {
      enabledDomainListEl.innerHTML = '<div class="empty-state"><svg viewBox="0 0 80 80" width="60" height="60" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="40" cy="40" r="28"/><line x1="15" y1="30" x2="65" y2="30"/><line x1="15" y1="50" x2="65" y2="50"/><ellipse cx="40" cy="40" rx="12" ry="28"/></svg><p>لا توجد مواقع مفعّلة</p></div>';
      return;
    }
    domains.forEach((d) => {
      var li = document.createElement("li");
      li.innerHTML = '<span dir="ltr">' + escapeHtml(d) + '</span><button class="remove-btn" title="حذف">&times;</button>';
      li.querySelector(".remove-btn").addEventListener("click", () => {
        chrome.storage.sync.get(["enabledDomains"], (data) => {
          var arr = (data.enabledDomains || []).filter((x) => x !== d);
          chrome.storage.sync.set({ enabledDomains: arr }, () => renderEnabledDomains(arr));
        });
      });
      enabledDomainListEl.appendChild(li);
    });
  }

  chrome.storage.sync.get(["enabledDomains"], (data) => { renderEnabledDomains(data.enabledDomains || []); });

  document.getElementById("addEnabledDomain").addEventListener("click", () => {
    var val = enabledDomainInput.value.trim();
    if (!val) return;
    chrome.storage.sync.get(["enabledDomains"], (data) => {
      var arr = data.enabledDomains || [];
      if (!arr.includes(val)) arr.push(val);
      chrome.storage.sync.set({ enabledDomains: arr }, () => { renderEnabledDomains(arr); enabledDomainInput.value = ""; });
    });
  });

  enabledDomainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("addEnabledDomain").click();
  });

  // ─── Parental PIN Section ───
  chrome.storage.sync.get(["parentalPin"], (data) => {
    if (data.parentalPin) {
      document.getElementById("optLockActiveView").style.display = "block";
      document.getElementById("optLockSetupView").style.display = "none";
    } else {
      document.getElementById("optLockActiveView").style.display = "none";
      document.getElementById("optLockSetupView").style.display = "block";
    }
  });

  document.getElementById("optLockBtn").addEventListener("click", () => {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => { chrome.tabs.sendMessage(tab.id, { type: "lockReveals" }).catch(() => {}); });
    });
    document.getElementById("optLockText").textContent = "وضع حماية الأطفال مفعّل";
  });

  document.getElementById("optRemovePwBtn").addEventListener("click", () => {
    var form = document.getElementById("optRemovePwForm");
    form.style.display = form.style.display === "none" ? "block" : "none";
    document.getElementById("optRemovePwInput").value = "";
    document.getElementById("optRemovePwMsg").textContent = "";
  });

  document.getElementById("optRemovePwConfirm").addEventListener("click", () => {
    var pin = document.getElementById("optRemovePwInput").value;
    var msg = document.getElementById("optRemovePwMsg");
    if (!pin) { msg.textContent = "أدخل الرمز"; return; }
    chrome.runtime.sendMessage({ type: "verifyPin", pin: pin }, (res) => {
      if (res && res.success) {
        chrome.runtime.sendMessage({ type: "removePin" }, () => {
          document.getElementById("optLockActiveView").style.display = "none";
          document.getElementById("optLockSetupView").style.display = "block";
          document.getElementById("optRemovePwForm").style.display = "none";
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => { chrome.tabs.sendMessage(tab.id, { type: "unlockReveals" }).catch(() => {}); });
          });
        });
      } else {
        msg.textContent = "رمز PIN غير صحيح";
      }
    });
  });

  document.getElementById("optRemovePwInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("optRemovePwConfirm").click();
  });

  document.getElementById("optSetRevealPwBtn").addEventListener("click", () => {
    var pin = document.getElementById("optNewRevealPw").value.trim();
    var msg = document.getElementById("optSetPwMsg");
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      msg.textContent = "أدخل 4 أرقام";
      return;
    }
    msg.textContent = "";
    chrome.runtime.sendMessage({ type: "setPin", pin: pin }, () => {
      document.getElementById("optNewRevealPw").value = "";
      document.getElementById("optLockActiveView").style.display = "block";
      document.getElementById("optLockSetupView").style.display = "none";
    });
  });

  document.getElementById("optNewRevealPw").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("optSetRevealPwBtn").click();
  });

  // ─── Export / Import ───
  document.getElementById("exportBtn").addEventListener("click", () => {
    chrome.storage.sync.get(null, (data) => {
      var exportData = Object.assign({}, data);
      delete exportData.parentalPin;
      var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "haya-settings.json";
      a.click();
      URL.revokeObjectURL(url);
      showMsg("configMsg", "تم تصدير الإعدادات");
    });
  });

  document.getElementById("shareListBtn").addEventListener("click", () => {
    chrome.storage.sync.get(["customWords", "allowlist"], (data) => {
      var shareData = { customWords: data.customWords || [], allowlist: data.allowlist || [] };
      var encoded = btoa(unescape(encodeURIComponent(JSON.stringify(shareData))));
      var url = "data:text/plain;base64," + encoded;
      navigator.clipboard.writeText(encoded).then(() => {
        showMsg("configMsg", "تم نسخ رمز المشاركة — شاركه مع أي شخص");
      }).catch(() => {
        prompt("رمز المشاركة (انسخه):", encoded);
      });
    });
  });

  document.getElementById("importShareBtn").addEventListener("click", () => {
    var code = prompt("ألصق رمز المشاركة:");
    if (!code) return;
    try {
      var shareData = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
      chrome.storage.sync.get(["customWords", "allowlist"], (data) => {
        var words = data.customWords || [];
        var allow = data.allowlist || [];
        var addedW = 0, addedA = 0;
        (shareData.customWords || []).forEach((w) => {
          var val = typeof w === "string" ? w : w.word;
          if (!words.some((x) => (typeof x === "string" ? x : x.word) === val)) { words.push(w); addedW++; }
        });
        (shareData.allowlist || []).forEach((w) => {
          if (!allow.includes(w)) { allow.push(w); addedA++; }
        });
        chrome.storage.sync.set({ customWords: words, allowlist: allow }, () => {
          renderWords(words);
          renderAllowlist(allow);
          showMsg("configMsg", "تم استيراد " + addedW + " كلمة فلتر + " + addedA + " قائمة بيضاء");
        });
      });
    } catch (e) {
      showMsg("configMsg", "رمز غير صالح");
    }
  });

  document.getElementById("importFile").addEventListener("change", (e) => {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = (ev) => {
      try {
        var data = JSON.parse(ev.target.result);
        delete data.parentalPin;
        chrome.storage.sync.set(data, () => {
          showMsg("configMsg", "تم استيراد الإعدادات");
          setTimeout(() => { location.reload(); }, 1500);
        });
      } catch (err) {
        showMsg("configMsg", "ملف غير صالح");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ─── Undo (Ctrl+Z) ───
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (undoStack.length === 0) return;
      var last = undoStack.pop();
      var obj = {};
      obj[last.key] = last.value;
      chrome.storage.sync.set(obj, () => {
        if (last.key === "customWords") renderWords(last.value);
        if (last.key === "allowlist") renderAllowlist(last.value);
        showMsg("generalSaved", "تم التراجع");
      });
    }
  });

  // ─── Helpers ───
  function pushUndo(key, value) {
    undoStack.push({ key: key, value: value ? value.slice() : [] });
    if (undoStack.length > 20) undoStack.shift();
  }

  function confirmDelete(message) {
    return confirm(message);
  }

  function showMsg(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
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
