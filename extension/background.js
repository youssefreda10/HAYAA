/* ============================================================
   Hayā — Background Service Worker
   Handles HuggingFace API calls and message routing
   ============================================================ */

const API_URL = "https://youssefreda9004--haya-text-classifier-fastapi-app.modal.run";
const DEFAULT_THRESHOLD = 0.75;
const BATCH_SIZE = 50;
const RETRY_DELAY = 20000;
const MAX_RETRIES = 3;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    mode: "blur",
    threshold: DEFAULT_THRESHOLD,
    totalFiltered: 0,
    disabledDomains: [],
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "classify") {
    handleClassify(message.texts, sender.tab?.id).then(sendResponse);
    return true;
  }

  if (message.type === "getSettings") {
    chrome.storage.local.get(
      ["enabled", "mode", "threshold", "apiKey", "disabledDomains"],
      sendResponse
    );
    return true;
  }

  if (message.type === "updateBadge") {
    updateBadge(message.count, sender.tab?.id);
  }

  if (message.type === "incrementStats") {
    chrome.storage.local.get(["totalFiltered"], (data) => {
      chrome.storage.local.set({
        totalFiltered: (data.totalFiltered || 0) + message.count,
      });
    });
  }
});

async function handleClassify(texts, tabId) {
  const settings = await getSettings();
  // Removed API key check since Modal backend handles authentication

  const results = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchResults = await classifyBatch(batch, settings.apiKey);
    results.push(...batchResults);
  }

  return results;
}

async function classifyBatch(texts, apiKey, retries = 0) {
  console.log(`[Hayā] Classifying batch of ${texts.length} texts (retry=${retries})`);
  console.log(`[Hayā] First text: "${texts[0]?.substring(0, 50)}..."`);
  console.log(`[Hayā] API Key: ${apiKey ? apiKey.substring(0, 10) + "..." : "MISSING"}`);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: texts }),
    });

    console.log(`[Hayā] API Response status: ${response.status}`);

    if (response.status === 503) {
      if (retries < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
        return classifyBatch(texts, apiKey, retries + 1);
      }
      return texts.map(() => ({ label: "SAFE", score: 0 }));
    }

    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      return classifyBatch(texts, apiKey, retries + 1);
    }

    if (!response.ok) {
      console.error(`Hayā API error: ${response.status}`);
      return texts.map(() => ({ label: "SAFE", score: 0 }));
    }

    const data = await response.json();

    return data.map((result) => {
      if (Array.isArray(result)) {
        const toxic = result.find((r) => r.label === "Toxic" || r.label === "LABEL_1");
        const safe = result.find((r) => r.label === "Safe" || r.label === "LABEL_0");
        return {
          label: toxic && toxic.score > (safe?.score || 0) ? "TOXIC" : "SAFE",
          score: toxic?.score || 0,
        };
      }
      return { label: "SAFE", score: 0 };
    });
  } catch (error) {
    console.error("[Hayā] API fetch error:", error.message, error);
    return texts.map(() => ({ label: "SAFE", score: 0 }));
  }
}

function updateBadge(count, tabId) {
  if (!tabId) return;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count), tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#e74c3c", tabId });
  } else {
    chrome.action.setBadgeText({ text: "", tabId });
  }
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["enabled", "mode", "threshold", "apiKey", "disabledDomains"],
      resolve
    );
  });
}
