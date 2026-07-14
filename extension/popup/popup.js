document.addEventListener("DOMContentLoaded", () => {
  const enableToggle = document.getElementById("enableToggle");
  const modeSelect = document.getElementById("modeSelect");
  var parentalUnlocked = false;
  // Set when the lock overlay was opened to gate a specific action (e.g. the
  // user clicked "open options"). After a correct PIN we run it, so the parent
  // is not silently dropped back with nothing happening.
  var pendingAfterUnlock = null;

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

  // ─── Load settings + Parental Lock check ───
  chrome.storage.sync.get(
    ["enabled", "mode", "disabledDomains", "enabledDomains", "domainMode", "parentalPin"],
    (data) => {
      modeSelect.value = data.mode || "blur";

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].url && tabs[0].url.startsWith("http")) {
          try {
            const url = new URL(tabs[0].url);
            const domain = url.hostname;
            const domainMode = data.domainMode || "normal";

            if (domainMode === "minimal") {
              const enabled = data.enabledDomains || [];
              enableToggle.checked = enabled.includes(domain);
            } else {
              const disabled = data.disabledDomains || [];
              enableToggle.checked = !disabled.includes(domain);
            }
          } catch (e) {}
        }
      });

      // Parental lock: if PIN is set, lock controls
      if (data.parentalPin) {
        document.getElementById("lockActiveView").style.display = "block";
        document.getElementById("lockSetupView").style.display = "none";
        lockControls();
      } else {
        document.getElementById("lockActiveView").style.display = "none";
        document.getElementById("lockSetupView").style.display = "block";
      }

      // Hide skeleton, show content
      document.getElementById("skeleton").style.display = "none";
      document.getElementById("mainContent").style.display = "block";
    }
  );

  // ─── Lock/Unlock Controls ───
  function lockControls() {
    if (parentalUnlocked) return;
    document.getElementById("lockedOverlay").style.display = "flex";
    enableToggle.disabled = true;
    modeSelect.disabled = true;
  }

  function unlockControls() {
    parentalUnlocked = true;
    document.getElementById("lockedOverlay").style.display = "none";
    enableToggle.disabled = false;
    modeSelect.disabled = false;
  }

  // Unlock PIN form
  document.getElementById("unlockPinBtn").addEventListener("click", () => {
    var pin = document.getElementById("unlockPinInput").value;
    var msg = document.getElementById("unlockPinMsg");
    if (!pin) return;

    chrome.runtime.sendMessage({ type: "verifyPin", pin: pin }, (res) => {
      if (res && res.success) {
        unlockControls();
        if (pendingAfterUnlock) {
          var action = pendingAfterUnlock;
          pendingAfterUnlock = null;
          action();
        }
      } else {
        msg.textContent = pinErrorText(res);
        document.getElementById("unlockPinInput").value = "";
      }
    });
  });

  // Shared wording for a rejected PIN (wrong, or temporarily locked out)
  function pinErrorText(res) {
    if (res && res.lockedFor) {
      return "محاولات كثيرة — انتظر " + res.lockedFor + " ثانية";
    }
    if (res && res.remaining) {
      return "رمز PIN غير صحيح — متبقي " + res.remaining + " محاولات";
    }
    return "رمز PIN غير صحيح";
  }

  document.getElementById("unlockPinInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("unlockPinBtn").click();
  });

  // ─── Toggle (guarded) ───
  enableToggle.addEventListener("change", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].url || !tabs[0].url.startsWith("http")) return;
      var url, domain;
      try { url = new URL(tabs[0].url); domain = url.hostname; } catch (e) { return; }

      chrome.storage.sync.get(["disabledDomains", "enabledDomains", "domainMode"], (data) => {
        const domainMode = data.domainMode || "normal";

        if (domainMode === "minimal") {
          let enabled = data.enabledDomains || [];
          if (enableToggle.checked) {
            if (!enabled.includes(domain)) enabled.push(domain);
          } else {
            enabled = enabled.filter((d) => d !== domain);
          }
          chrome.storage.sync.set({ enabledDomains: enabled });
        } else {
          let disabled = data.disabledDomains || [];
          if (enableToggle.checked) {
            disabled = disabled.filter((d) => d !== domain);
          } else {
            if (!disabled.includes(domain)) disabled.push(domain);
          }
          chrome.storage.sync.set({ disabledDomains: disabled });
        }

        chrome.tabs.reload(tabs[0].id);
      });
    });
  });

  // Mode change (guarded)
  modeSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ mode: modeSelect.value });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.reload(tabs[0].id);
    });
  });

  // Open options (guarded — if PIN set and not unlocked, ask for PIN first)
  document.getElementById("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.storage.sync.get(["parentalPin"], (data) => {
      if (data.parentalPin && !parentalUnlocked) {
        pendingAfterUnlock = function () { chrome.runtime.openOptionsPage(); };
        document.getElementById("lockedOverlay").style.display = "flex";
        document.getElementById("unlockPinInput").focus();
      } else {
        chrome.runtime.openOptionsPage();
      }
    });
  });

  // Open notification center
  document.getElementById("openNotifications").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: "notifications.html" });
  });

  // ─── Set PIN ───
  document.getElementById("setPinBtn").addEventListener("click", () => {
    var pin = document.getElementById("newPin").value.trim();
    var msg = document.getElementById("setPinMsg");
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      msg.textContent = "أدخل 4 أرقام";
      return;
    }
    msg.textContent = "";
    chrome.runtime.sendMessage({ type: "setPin", pin: pin }, () => {
      document.getElementById("newPin").value = "";
      document.getElementById("lockActiveView").style.display = "block";
      document.getElementById("lockSetupView").style.display = "none";
      parentalUnlocked = true; // parent just set it, they're authenticated
    });
  });

  document.getElementById("newPin").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("setPinBtn").click();
  });

  // ─── Lock Reveal ───
  document.getElementById("lockBtn").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "lockReveals" });
        document.getElementById("lockText").textContent = "وضع حماية الأطفال مفعّل";
      }
    });
  });

  // ─── Remove PIN ───
  document.getElementById("removePinBtn").addEventListener("click", () => {
    var form = document.getElementById("removePinForm");
    form.style.display = form.style.display === "none" ? "block" : "none";
    document.getElementById("removePinInput").value = "";
    document.getElementById("removePinMsg").textContent = "";
  });

  document.getElementById("removePinConfirm").addEventListener("click", () => {
    var pin = document.getElementById("removePinInput").value;
    var msg = document.getElementById("removePinMsg");
    if (!pin) { msg.textContent = "أدخل الرمز"; return; }

    chrome.runtime.sendMessage({ type: "verifyPin", pin: pin }, (res) => {
      if (res && res.success) {
        chrome.runtime.sendMessage({ type: "removePin" }, () => {
          document.getElementById("lockActiveView").style.display = "none";
          document.getElementById("lockSetupView").style.display = "block";
          document.getElementById("removePinForm").style.display = "none";
          unlockControls();
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "unlockReveals" });
          });
        });
      } else {
        msg.textContent = pinErrorText(res);
      }
    });
  });

  document.getElementById("removePinInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("removePinConfirm").click();
  });

  // ─── Achievements ───
  var ACHIEVEMENTS = [
    { threshold: 10, icon: "🛡️", title: "حارس مبتدئ", desc: "فلترت أول 10 عناصر" },
    { threshold: 50, icon: "⚔️", title: "محارب", desc: "فلترت 50 عنصر سام" },
    { threshold: 100, icon: "🏅", title: "بطل", desc: "فلترت 100 عنصر سام" },
    { threshold: 500, icon: "👑", title: "أسطورة", desc: "فلترت 500 عنصر سام" },
    { threshold: 1000, icon: "💎", title: "حيـاء ماسي", desc: "فلترت 1000 عنصر — مبروك!" },
  ];

  chrome.storage.local.get(["totalFiltered"], (data) => {
    var total = data.totalFiltered || 0;
    var current = null;
    for (var i = ACHIEVEMENTS.length - 1; i >= 0; i--) {
      if (total >= ACHIEVEMENTS[i].threshold) { current = ACHIEVEMENTS[i]; break; }
    }
    if (current) {
      document.getElementById("achievementCard").style.display = "block";
      document.getElementById("achievementIcon").textContent = current.icon;
      document.getElementById("achievementTitle").textContent = current.title;
      document.getElementById("achievementDesc").textContent = current.desc + " (" + total + " إجمالي)";
    }
  });
});
