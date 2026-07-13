/* ============================================================
   Hayā — Background Service Worker
   Handles API calls to Modal backend and message routing
   ============================================================ */

var API_URL = "https://youssefreda9004--haya-text-classifier-fastapi-app.modal.run";
var DEFAULT_THRESHOLD = 0.75;
var BATCH_SIZE = 50;
var RETRY_DELAY = 20000;
var MAX_RETRIES = 3;

chrome.runtime.onInstalled.addListener(function (details) {
  // Settings → sync (cross-device)
  chrome.storage.sync.set({
    enabled: true,
    mode: "blur",
    threshold: DEFAULT_THRESHOLD,
    disabledDomains: [],
    enabledDomains: [],
    domainMode: "normal",
    customWords: [],
    allowlist: [],
  });

  // Stats → local (per-device)
  chrome.storage.local.set({
    totalFiltered: 0,
    dictionaryHits: 0,
    apiHits: 0,
    pagesScanned: 0,
  });

  chrome.contextMenus.create({
    id: "haya-add-word",
    title: "حياء: أضف \"%s\" للفلتر",
    contexts: ["selection"],
  });

  chrome.contextMenus.create({
    id: "haya-add-allowlist",
    title: "حياء: أضف \"%s\" للقائمة البيضاء",
    contexts: ["selection"],
  });

  // Show onboarding on first install
  if (details.reason === "install") {
    chrome.tabs.create({ url: "onboarding.html" });
  }
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  var word = (info.selectionText || "").trim();
  if (!word) return;

  if (info.menuItemId === "haya-add-word") {
    chrome.storage.sync.get(["customWords"], function (data) {
      var arr = data.customWords || [];
      var exists = arr.some(function (x) { return (typeof x === "string" ? x : x.word) === word; });
      if (!exists) {
        arr.push(word);
        chrome.storage.sync.set({ customWords: arr }, function () {
          console.log("[Hayā] Added to filter:", word);
          if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "showToast", message: "تمت إضافة \"" + word + "\" للفلتر" });
            chrome.tabs.reload(tab.id);
          }
        });
      }
    });
  }

  if (info.menuItemId === "haya-add-allowlist") {
    chrome.storage.sync.get(["allowlist"], function (data) {
      var arr = data.allowlist || [];
      if (arr.indexOf(word) === -1) {
        arr.push(word);
        chrome.storage.sync.set({ allowlist: arr }, function () {
          console.log("[Hayā] Added to allowlist:", word);
          if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: "showToast", message: "تمت إضافة \"" + word + "\" للقائمة البيضاء" });
            chrome.tabs.reload(tab.id);
          }
        });
      }
    });
  }
});

// ─── Keyboard Shortcut (Alt+H) ───
chrome.commands.onCommand.addListener(function (command) {
  if (command !== "toggle-extension") return;
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    var domain = new URL(tabs[0].url).hostname;

    chrome.storage.sync.get(["disabledDomains", "enabledDomains", "domainMode"], function (data) {
      var domainMode = data.domainMode || "normal";

      if (domainMode === "minimal") {
        var enabled = data.enabledDomains || [];
        var idx = enabled.indexOf(domain);
        if (idx === -1) { enabled.push(domain); } else { enabled.splice(idx, 1); }
        chrome.storage.sync.set({ enabledDomains: enabled });
      } else {
        var disabled = data.disabledDomains || [];
        var dIdx = disabled.indexOf(domain);
        if (dIdx === -1) { disabled.push(domain); } else { disabled.splice(dIdx, 1); }
        chrome.storage.sync.set({ disabledDomains: disabled });
      }

      chrome.tabs.reload(tabs[0].id);
    });
  });
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "classify") {
    handleClassify(message.texts).then(sendResponse);
    return true;
  }

  if (message.type === "getSettings") {
    chrome.storage.sync.get(
      ["enabled", "mode", "threshold", "disabledDomains", "enabledDomains", "domainMode"],
      sendResponse
    );
    return true;
  }

  if (message.type === "updateBadge") {
    updateBadge(message.count, sender.tab && sender.tab.id);
  }

  if (message.type === "reportFalsePositive") {
    chrome.storage.local.get(["reports"], function (data) {
      var reports = data.reports || [];
      reports.push({
        text: message.text,
        domain: message.domain,
        timestamp: new Date().toISOString(),
        type: "false_positive",
      });
      if (reports.length > 200) reports = reports.slice(-200);
      chrome.storage.local.set({ reports: reports });
    });
  }

  // Stats stay on LOCAL (per-device, high-frequency)
  if (message.type === "incrementStats") {
    chrome.storage.local.get(["totalFiltered", "dictionaryHits", "apiHits"], function (data) {
      var update = { totalFiltered: (data.totalFiltered || 0) + message.count };
      if (message.source === "dictionary") {
        update.dictionaryHits = (data.dictionaryHits || 0) + message.count;
      } else if (message.source === "api") {
        update.apiHits = (data.apiHits || 0) + message.count;
      }
      chrome.storage.local.set(update);
    });
  }

  if (message.type === "pageScanned") {
    chrome.storage.local.get(["pagesScanned"], function (data) {
      chrome.storage.local.set({ pagesScanned: (data.pagesScanned || 0) + 1 });
    });
  }

  if (message.type === "verifyRevealPassword") {
    hashPassword(message.password).then(function (hash) {
      chrome.storage.sync.get(["parentalPin"], function (data) {
        sendResponse({ success: data.parentalPin && hash === data.parentalPin });
      });
    });
    return true;
  }

  if (message.type === "verifyPin") {
    hashPassword(message.pin).then(function (hash) {
      chrome.storage.sync.get(["parentalPin"], function (data) {
        sendResponse({ success: data.parentalPin === hash });
      });
    });
    return true;
  }

  if (message.type === "setPin") {
    hashPassword(message.pin).then(function (hash) {
      chrome.storage.sync.set({ parentalPin: hash }, function () {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.type === "removePin") {
    chrome.storage.sync.remove(["parentalPin"], function () {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function handleClassify(texts) {
  var results = [];
  for (var i = 0; i < texts.length; i += BATCH_SIZE) {
    var batch = texts.slice(i, i + BATCH_SIZE);
    var batchResults = await classifyBatch(batch);
    results.push.apply(results, batchResults);
  }
  return results;
}

async function classifyBatch(texts, retries) {
  if (retries === undefined) retries = 0;

  console.log("[Hayā] Classifying batch of", texts.length, "texts (retry=" + retries + ")");

  try {
    var response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: texts }),
    });

    console.log("[Hayā] API response:", response.status);

    if (response.status === 503) {
      if (retries < MAX_RETRIES) {
        await new Promise(function (r) { setTimeout(r, RETRY_DELAY); });
        return classifyBatch(texts, retries + 1);
      }
      return texts.map(function () { return { label: "SAFE", score: 0 }; });
    }

    if (response.status === 429) {
      if (retries < MAX_RETRIES) {
        await new Promise(function (r) { setTimeout(r, 5000); });
        return classifyBatch(texts, retries + 1);
      }
      return texts.map(function () { return { label: "SAFE", score: 0 }; });
    }

    if (!response.ok) {
      return texts.map(function () { return { label: "SAFE", score: 0 }; });
    }

    var data = await response.json();

    return data.map(function (result) {
      if (Array.isArray(result)) {
        var toxic = result.find(function (r) { return r.label === "Toxic" || r.label === "LABEL_1"; });
        var safe = result.find(function (r) { return r.label === "Safe" || r.label === "LABEL_0"; });
        return {
          label: toxic && toxic.score > (safe ? safe.score : 0) ? "TOXIC" : "SAFE",
          score: toxic ? toxic.score : 0,
        };
      }
      return { label: "SAFE", score: 0 };
    });
  } catch (error) {
    console.error("[Hayā] API error:", error.message);
    return texts.map(function () { return { label: "SAFE", score: 0 }; });
  }
}

function updateBadge(count, tabId) {
  if (!tabId) return;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count), tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#e74c3c", tabId: tabId });
  } else {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
}

async function hashPassword(password) {
  var encoder = new TextEncoder();
  var data = encoder.encode(password);
  var buffer = await crypto.subtle.digest("SHA-256", data);
  var array = Array.from(new Uint8Array(buffer));
  return array.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}
