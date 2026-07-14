/* ============================================================
   Hayā — Background Service Worker
   Handles API calls to Modal backend and message routing
   ============================================================ */

var API_URL = "https://youssefreda9004--haya-text-classifier-fastapi-app.modal.run";
var DEFAULT_THRESHOLD = 0.75;
var BATCH_SIZE = 50;
var RETRY_DELAY = 20000;
var MAX_RETRIES = 3;
// Modal scales to zero. A request that lands on a cold container waits for the
// container to boot AND for the model to load from HuggingFace — measured at
// 19–21s, against 0.8s once warm. The old 15s ceiling therefore aborted the
// FIRST request every time the app had gone idle, and the abort was swallowed
// into a SAFE verdict, so Layer 2 silently never ran. 60s clears a cold start
// with headroom; a timeout is now retried rather than treated as "not toxic".
var FETCH_TIMEOUT = 60000;

// Serialize PIN verification so concurrent requests can't bypass lockout
var pinQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason === "install") {
    // Settings → sync (cross-device) — only on first install
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
      pagesScanned: 0,
    });

    chrome.tabs.create({ url: "onboarding.html" });
  }

  // Context menus — recreate on every install/update (removeAll avoids duplicate-ID errors)
  chrome.contextMenus.removeAll(function () {
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
  });
});

// Reload the tab to apply the new word list, then toast once it has settled.
// (Toasting before the reload is pointless — the reload destroys the toast.)
function reloadAndToast(tabId, message) {
  function cleanup() {
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onRemoved);
    clearTimeout(timeout);
  }
  function onUpdated(updatedTabId, changeInfo) {
    if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
    cleanup();
    setTimeout(function () {
      chrome.tabs.sendMessage(tabId, { type: "showToast", message: message })
        .catch(function () {});
    }, 400);
  }
  function onRemoved(removedTabId) {
    if (removedTabId !== tabId) return;
    cleanup();
  }
  var timeout = setTimeout(cleanup, 10000);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onRemoved);
  chrome.tabs.reload(tabId);
}

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
          if (tab && tab.id) {
            reloadAndToast(tab.id, "تمت إضافة \"" + word + "\" للفلتر");
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
          if (tab && tab.id) {
            reloadAndToast(tab.id, "تمت إضافة \"" + word + "\" للقائمة البيضاء");
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
    if (!tabs[0] || !tabs[0].url || !tabs[0].url.startsWith("http")) return;
    var domain;
    try { domain = new URL(tabs[0].url).hostname; } catch (e) { return; }

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
    handleClassify(message.texts).then(sendResponse).catch(function () { sendResponse([]); });
    return true;
  }

  else if (message.type === "getSettings") {
    chrome.storage.sync.get(
      ["enabled", "mode", "threshold", "disabledDomains", "enabledDomains", "domainMode"],
      sendResponse
    );
    return true;
  }

  else if (message.type === "updateBadge") {
    updateBadge(message.count, sender.tab && sender.tab.id);
  }

  else if (message.type === "reportFalsePositive") {
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
  else if (message.type === "incrementStats") {
    chrome.storage.local.get(["totalFiltered"], function (data) {
      chrome.storage.local.set({ totalFiltered: (data.totalFiltered || 0) + message.count });
    });
  }

  else if (message.type === "pageScanned") {
    chrome.storage.local.get(["pagesScanned"], function (data) {
      chrome.storage.local.set({ pagesScanned: (data.pagesScanned || 0) + 1 });
    });
  }

  else if (message.type === "verifyPin") {
    pinQueue = pinQueue.then(function () {
      return handleVerifyPin(message.pin);
    }).then(sendResponse).catch(function () {
      sendResponse({ success: false });
    });
    return true;
  }

  else if (message.type === "setPin") {
    // Require current PIN if one is already set
    pinQueue = pinQueue.then(function () {
      return chrome.storage.sync.get(["parentalPin"]);
    }).then(function (data) {
      if (data.parentalPin) {
        if (!message.currentPin) return { success: false, error: "currentPin required" };
        return handleVerifyPin(message.currentPin).then(function (res) {
          if (!res.success) return res;
          return makePinRecord(message.pin).then(function (record) {
            return new Promise(function (resolve) {
              chrome.storage.sync.set({ parentalPin: record }, function () {
                resolve({ success: true });
              });
            });
          });
        });
      }
      return makePinRecord(message.pin).then(function (record) {
        return new Promise(function (resolve) {
          chrome.storage.sync.set({ parentalPin: record }, function () {
            resolve({ success: true });
          });
        });
      });
    }).then(sendResponse).catch(function () { sendResponse({ success: false }); });
    return true;
  }

  else if (message.type === "removePin") {
    // Require current PIN verification before removal
    pinQueue = pinQueue.then(function () {
      if (!message.currentPin) return { success: false, error: "currentPin required" };
      return handleVerifyPin(message.currentPin).then(function (res) {
        if (!res.success) return res;
        return new Promise(function (resolve) {
          chrome.storage.sync.remove(["parentalPin"], function () {
            resolve({ success: true });
          });
        });
      });
    }).then(sendResponse).catch(function () { sendResponse({ success: false }); });
    return true;
  }
});

async function handleClassify(texts) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
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

  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT);

    var response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: texts }),
      signal: controller.signal,
    });

    clearTimeout(timer);

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

    if (!Array.isArray(data)) {
      console.warn("[Hayā] Unexpected API response shape:", typeof data);
      return texts.map(function () { return { label: "SAFE", score: 0 }; });
    }

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
    clearTimeout(timer);
    // A cold-start abort or a transient network drop is not evidence the text
    // is safe — retry before giving up, so one slow boot doesn't wave a whole
    // page through unscored.
    var aborted = error && error.name === "AbortError";
    if (retries < MAX_RETRIES) {
      console.warn("[Hayā] " + (aborted ? "timeout" : "network error") +
        ", retry " + (retries + 1) + "/" + MAX_RETRIES + ": " + error.message);
      await new Promise(function (r) { setTimeout(r, aborted ? 1000 : RETRY_DELAY); });
      return classifyBatch(texts, retries + 1);
    }
    console.error("[Hayā] API error after retries:", error.message);
    return texts.map(function () { return { label: "SAFE", score: 0 }; });
  }
}

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
});

function updateBadge(count, tabId) {
  if (!tabId) return;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count), tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#e74c3c", tabId: tabId });
  } else {
    chrome.action.setBadgeText({ text: "", tabId: tabId });
  }
}

/* ============================================================
   Parental PIN hashing

   A 4-digit PIN has only 10,000 possible values, so a single
   round of SHA-256 can be brute-forced instantly. We derive the
   PIN with salted PBKDF2 instead, which makes each guess cost
   ~200ms — turning an instant break into a slow one.

   Stored shape: { v: 2, salt: <hex>, hash: <hex>, iterations: N }
   Legacy values are plain SHA-256 hex strings; those still verify
   and are transparently upgraded to v2 on the next correct entry.
   ============================================================ */

var PBKDF2_ITERATIONS = 1000000;

// Failed-attempt throttle. The realistic attack on a 4-digit PIN is a child
// typing guesses by hand, so make repeated failures progressively expensive.
var MAX_FREE_ATTEMPTS = 5;
var LOCKOUT_BASE_MS = 30000;

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");
}

function hexToBytes(hex) {
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Legacy (v1) — unsalted SHA-256. Kept only to verify old PINs.
async function legacySha256(text) {
  var buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bufToHex(buffer);
}

async function derivePin(pin, saltHex, iterations) {
  var key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]
  );
  var bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: iterations, hash: "SHA-256" },
    key,
    256
  );
  return bufToHex(bits);
}

async function makePinRecord(pin) {
  var saltHex = bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  var hash = await derivePin(pin, saltHex, PBKDF2_ITERATIONS);
  return { v: 2, salt: saltHex, hash: hash, iterations: PBKDF2_ITERATIONS };
}

// Length-constant comparison — avoids leaking match position via timing.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Verify with a lockout: after MAX_FREE_ATTEMPTS failures, each further
// failure locks the PIN for an exponentially longer window.
async function handleVerifyPin(pin) {
  var state = await chrome.storage.local.get(["pinFails", "pinLockUntil"]);
  var fails = state.pinFails || 0;
  var lockUntil = state.pinLockUntil || 0;
  var now = Date.now();

  if (now < lockUntil) {
    return { success: false, lockedFor: Math.ceil((lockUntil - now) / 1000) };
  }

  var record = (await chrome.storage.sync.get(["parentalPin"])).parentalPin;
  var ok = false;
  try { ok = await verifyPinAgainst(record, pin); } catch (e) { ok = false; }

  if (ok) {
    await chrome.storage.local.set({ pinFails: 0, pinLockUntil: 0 });
    return { success: true };
  }

  fails++;
  var update = { pinFails: fails };
  if (fails > MAX_FREE_ATTEMPTS) {
    var over = fails - MAX_FREE_ATTEMPTS;
    // 30s, 60s, 120s, 240s … capped at 15 min
    var wait = Math.min(LOCKOUT_BASE_MS * Math.pow(2, over - 1), 900000);
    update.pinLockUntil = now + wait;
    await chrome.storage.local.set(update);
    return { success: false, lockedFor: Math.ceil(wait / 1000) };
  }

  await chrome.storage.local.set(update);
  return { success: false, remaining: MAX_FREE_ATTEMPTS - fails };
}

async function verifyPinAgainst(record, pin) {
  if (!record) return false;

  // v1 legacy: plain SHA-256 string → verify, then upgrade in place.
  if (typeof record === "string") {
    var legacy = await legacySha256(pin);
    if (!safeEqual(legacy, record)) return false;
    var upgraded = await makePinRecord(pin);
    await chrome.storage.sync.set({ parentalPin: upgraded });
    return true;
  }

  if (!record.salt || !record.hash) return false;
  var candidate = await derivePin(pin, record.salt, record.iterations || PBKDF2_ITERATIONS);
  return safeEqual(candidate, record.hash);
}
