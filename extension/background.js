/* ============================================================
   Hayā — Background Service Worker
   Handles API calls to Modal backend and message routing
   ============================================================ */

var API_URL = "https://youssefreda9004--haya-text-classifier-fastapi-app.modal.run";
var DEFAULT_THRESHOLD = 0.75;
var BATCH_SIZE = 50;
var RETRY_DELAY = 20000;
var MAX_RETRIES = 3;

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.set({
    enabled: true,
    mode: "blur",
    threshold: DEFAULT_THRESHOLD,
    totalFiltered: 0,
    disabledDomains: [],
    enabledDomains: [],
    domainMode: "normal",
    customWords: [],
    allowlist: [],
  });

  chrome.contextMenus.create({
    id: "haya-add-word",
    title: "حياء: أضف \"%s\" للفلتر",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId !== "haya-add-word") return;
  var word = info.selectionText.trim();
  if (!word) return;

  chrome.storage.local.get(["customWords"], function (data) {
    var arr = data.customWords || [];
    var exists = arr.some(function (x) { return (typeof x === "string" ? x : x.word) === word; });
    if (!exists) {
      arr.push({ word: word, method: "exact" });
      chrome.storage.local.set({ customWords: arr }, function () {
        console.log("[Hayā] Added to filter:", word);
        if (tab && tab.id) {
          chrome.tabs.reload(tab.id);
        }
      });
    }
  });
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.type === "classify") {
    handleClassify(message.texts, sender.tab && sender.tab.id).then(sendResponse);
    return true;
  }

  if (message.type === "getSettings") {
    chrome.storage.local.get(
      ["enabled", "mode", "threshold", "disabledDomains", "enabledDomains", "domainMode"],
      sendResponse
    );
    return true;
  }

  if (message.type === "updateBadge") {
    updateBadge(message.count, sender.tab && sender.tab.id);
  }

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
      await new Promise(function (r) { setTimeout(r, 5000); });
      return classifyBatch(texts, retries + 1);
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
