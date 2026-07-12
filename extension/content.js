/* ============================================================
   Hayā — Content Script
   Extracts Arabic text from pages, classifies it, applies blur
   ============================================================ */

(() => {
  const ARABIC_REGEX = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  const MIN_TEXT_LENGTH = 3;
  const PROCESSED_ATTR = "data-haya-processed";
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "MATH", "CODE", "PRE",
    "INPUT", "TEXTAREA", "SELECT", "BUTTON", "IFRAME",
  ]);

  let settings = { enabled: true, mode: "blur", threshold: 0.75 };
  let toxicCount = 0;
  let pendingTexts = [];
  let pendingElements = [];
  let batchTimer = null;

  async function init() {
    console.log("[Hayā] Content script loaded");
    settings = await getSettings();
    console.log("[Hayā] Settings:", JSON.stringify(settings));

    if (!settings.enabled) { console.log("[Hayā] Disabled"); return; }

    const domain = window.location.hostname;
    if (settings.disabledDomains?.includes(domain)) { console.log("[Hayā] Domain disabled:", domain); return; }

    console.log("[Hayā] Scanning page...");
    scanPage();
    observeMutations();
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getSettings" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ enabled: true, mode: "blur", threshold: 0.75 });
          return;
        }
        resolve(response || { enabled: true, mode: "blur", threshold: 0.75 });
      });
    });
  }

  // ============================================================
  // DOM Scanning
  // ============================================================

  function scanPage() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.closest("[" + PROCESSED_ATTR + "]")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      processElement(node);
    }

    flushBatch();
  }

  function processElement(element) {
    if (element.getAttribute(PROCESSED_ATTR)) return;

    const text = getDirectText(element);
    if (!text || text.length < MIN_TEXT_LENGTH) return;
    if (!hasArabic(text)) return;

    element.setAttribute(PROCESSED_ATTR, "1");
    queueForClassification(text, element);
  }

  function getDirectText(element) {
    let text = "";
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      }
    }
    return text.trim();
  }

  function hasArabic(text) {
    const arabicChars = (text.match(new RegExp(ARABIC_REGEX.source, "g")) || []).length;
    const totalAlpha = (text.match(/[a-zA-Z؀-ۿ]/g) || []).length;
    if (totalAlpha === 0) return false;
    return arabicChars / totalAlpha >= 0.5;
  }

  // ============================================================
  // Batching & Classification
  // ============================================================

  function queueForClassification(text, element) {
    pendingTexts.push(text);
    pendingElements.push(element);

    if (pendingTexts.length >= 50) {
      flushBatch();
    } else {
      clearTimeout(batchTimer);
      batchTimer = setTimeout(flushBatch, 300);
    }
  }

  async function flushBatch() {
    if (pendingTexts.length === 0) return;

    const texts = [...pendingTexts];
    const elements = [...pendingElements];
    pendingTexts = [];
    pendingElements = [];

    console.log(`[Hayā] Sending ${texts.length} texts to API`);

    // Call API directly from content script (avoids service worker fetch issues)
      // Removed API key check since Modal backend handles authentication

      try {
        const response = await fetch("https://youssefreda9004--haya-text-classifier-fastapi-app.modal.run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inputs: texts }),
        });

        console.log(`[Hayā] API status: ${response.status}`);

        if (response.status === 503) {
          console.log("[Hayā] Model loading... retrying in 20s");
          setTimeout(() => {
            pendingTexts.push(...texts);
            pendingElements.push(...elements);
            flushBatch();
          }, 20000);
          return;
        }

        if (!response.ok) {
          console.error(`[Hayā] API error: ${response.status} ${await response.text()}`);
          return;
        }

        const responseData = await response.json();
        console.log(`[Hayā] API response:`, responseData.slice(0, 2));

        const results = responseData.map((result) => {
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

        applyResults(results, elements);
    } catch (error) {
      console.error("[Hayā] Fetch error:", error.message);
    }
  }

  // ============================================================
  // Applying Results
  // ============================================================

  function applyResults(results, elements) {
    let newToxic = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const element = elements[i];

      if (!element || !result) continue;

      if (result.label === "TOXIC" && result.score >= settings.threshold) {
        applyFilter(element);
        newToxic++;
      }
    }

    if (newToxic > 0) {
      toxicCount += newToxic;
      chrome.runtime.sendMessage({ type: "updateBadge", count: toxicCount });
      chrome.runtime.sendMessage({ type: "incrementStats", count: newToxic });
    }
  }

  function applyFilter(element) {
    const mode = settings.mode || "blur";

    switch (mode) {
      case "blur":
        element.classList.add("haya-blur");
        element.addEventListener("click", revealElement, { once: true });
        break;
      case "hide":
        element.classList.add("haya-hide");
        break;
      case "highlight":
        element.classList.add("haya-highlight");
        break;
    }
  }

  function revealElement(event) {
    const el = event.currentTarget;
    el.classList.remove("haya-blur");
    el.classList.add("haya-revealed");
  }

  // ============================================================
  // MutationObserver — Dynamic Content
  // ============================================================

  function observeMutations() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            processElement(node);
            const children = node.querySelectorAll("*");
            children.forEach(processElement);
          }
        }
      }

      clearTimeout(batchTimer);
      batchTimer = setTimeout(flushBatch, 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ============================================================
  // Start
  // ============================================================

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
