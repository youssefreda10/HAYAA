/* ============================================================
   Hayā — Content Script
   Layer 1: Dictionary (instant) → Layer 2: AI Model (via background)
   ============================================================ */

(() => {
  var ARABIC_REGEX = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  var MIN_TEXT_LENGTH = 3;
  var PROCESSED_ATTR = "data-haya-processed";
  var SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "MATH", "CODE", "PRE",
    "INPUT", "TEXTAREA", "SELECT", "BUTTON", "IFRAME",
  ]);

  var settings = { enabled: true, mode: "blur", threshold: 0.75 };
  var toxicCount = 0;
  var pendingTexts = [];
  var pendingElements = [];
  var batchTimer = null;
  var wordGroups = { exact: new Set(), partial: new Set(), regex: [] };
  var allowlist = new Set();
  var filteredTexts = [];
  var MAX_FILTERED_LOG = 50;

  async function init() {
    console.log("[Hayā] Content script loaded");
    settings = await getSettings();
    console.log("[Hayā] Settings:", JSON.stringify(settings));

    if (!settings.enabled) { console.log("[Hayā] Disabled"); return; }

    var domain = window.location.hostname;
    if (settings.domainMode === "minimal") {
      if (!settings.enabledDomains || settings.enabledDomains.indexOf(domain) === -1) {
        console.log("[Hayā] Minimal mode — domain not enabled:", domain);
        return;
      }
    } else {
      if (settings.disabledDomains && settings.disabledDomains.indexOf(domain) !== -1) {
        console.log("[Hayā] Domain disabled:", domain);
        return;
      }
    }

    await loadWordLists();
    console.log("[Hayā] Dictionary:", wordGroups.exact.size, "exact +", wordGroups.partial.size, "partial +", wordGroups.regex.length, "regex");
    chrome.runtime.sendMessage({ type: "pageScanned" });
    scanPage();
    observeMutations();
  }

  function getSettings() {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: "getSettings" }, function (response) {
        if (chrome.runtime.lastError) {
          resolve({ enabled: true, mode: "blur", threshold: 0.75 });
          return;
        }
        resolve(response || { enabled: true, mode: "blur", threshold: 0.75 });
      });
    });
  }

  function loadWordLists() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(["customWords", "allowlist"], function (data) {
        var customArr = data.customWords || [];
        var allow = data.allowlist || [];

        var exactWords = new Set(HayaDictionary.words);
        var partialWords = new Set();
        var regexPatterns = [];

        for (var i = 0; i < customArr.length; i++) {
          var entry = customArr[i];
          var word, method;
          if (typeof entry === "string") {
            word = entry; method = "exact";
          } else {
            word = entry.word; method = entry.method || "exact";
          }
          if (method === "partial") {
            partialWords.add(word);
          } else if (method === "regex") {
            try { regexPatterns.push(new RegExp(word)); } catch (e) {}
          } else {
            exactWords.add(word);
          }
        }

        allowlist = new Set(allow);
        var allowIter = allowlist.values();
        var ae = allowIter.next();
        while (!ae.done) {
          exactWords.delete(ae.value);
          partialWords.delete(ae.value);
          ae = allowIter.next();
        }

        wordGroups = { exact: exactWords, partial: partialWords, regex: regexPatterns };
        resolve();
      });
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === "getFilteredTexts") {
      sendResponse(filteredTexts);
    }
  });

  // ============================================================
  // DOM Scanning
  // ============================================================

  function scanPage() {
    var walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: function (node) {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.closest("[" + PROCESSED_ATTR + "]")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    var node;
    while ((node = walker.nextNode())) {
      processElement(node);
    }

    flushBatch();
  }

  function processElement(element) {
    if (element.getAttribute(PROCESSED_ATTR)) return;

    var text = getDirectText(element);
    if (!text || text.length < MIN_TEXT_LENGTH) return;
    if (!hasArabic(text)) return;

    element.setAttribute(PROCESSED_ATTR, "1");

    // Layer 1: Dictionary check (instant, no network)
    var normalized = HayaNormalizer.normalize(text);
    if (normalized && HayaMatcher.check(normalized, wordGroups)) {
      console.log("[Hayā] Dictionary match (Layer 1):", text.substring(0, 50));
      applyFilter(element);
      logFiltered(text, "dictionary");
      toxicCount++;
      chrome.runtime.sendMessage({ type: "updateBadge", count: toxicCount });
      chrome.runtime.sendMessage({ type: "incrementStats", count: 1, source: "dictionary" });
      return;
    }

    // Layer 2: Queue for AI model (via background.js)
    queueForClassification(text, element);
  }

  function getDirectText(element) {
    var text = "";
    for (var i = 0; i < element.childNodes.length; i++) {
      if (element.childNodes[i].nodeType === Node.TEXT_NODE) {
        text += element.childNodes[i].textContent;
      }
    }
    return text.trim();
  }

  function hasArabic(text) {
    var arabicChars = (text.match(new RegExp(ARABIC_REGEX.source, "g")) || []).length;
    var totalAlpha = (text.match(/[a-zA-Z؀-ۿ]/g) || []).length;
    if (totalAlpha === 0) return false;
    return arabicChars / totalAlpha >= 0.5;
  }

  // ============================================================
  // Batching & Classification (Layer 2 — via background.js)
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

  function flushBatch() {
    if (pendingTexts.length === 0) return;

    var texts = pendingTexts.slice();
    var elements = pendingElements.slice();
    pendingTexts = [];
    pendingElements = [];

    console.log("[Hayā] Sending", texts.length, "texts to API (Layer 2)");

    chrome.runtime.sendMessage({ type: "classify", texts: texts }, function (results) {
      if (chrome.runtime.lastError) {
        console.error("[Hayā]", chrome.runtime.lastError.message);
        return;
      }
      if (results) {
        applyResults(results, elements, texts);
      }
    });
  }

  // ============================================================
  // Applying Results
  // ============================================================

  function applyResults(results, elements, texts) {
    var newToxic = 0;

    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      var element = elements[i];

      if (!element || !result) continue;

      if (result.label === "TOXIC" && result.score >= settings.threshold) {
        applyFilter(element);
        logFiltered(texts[i] || "", "api");
        newToxic++;
      }
    }

    if (newToxic > 0) {
      toxicCount += newToxic;
      chrome.runtime.sendMessage({ type: "updateBadge", count: toxicCount });
      chrome.runtime.sendMessage({ type: "incrementStats", count: newToxic, source: "api" });
    }
  }

  function applyFilter(element) {
    var mode = settings.mode || "blur";

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
    var el = event.currentTarget;
    el.classList.remove("haya-blur");
    el.classList.add("haya-revealed");
  }

  function logFiltered(text, source) {
    filteredTexts.push({ text: text.substring(0, 80), source: source });
    if (filteredTexts.length > MAX_FILTERED_LOG) filteredTexts.shift();
  }

  // ============================================================
  // MutationObserver — Dynamic Content
  // ============================================================

  function observeMutations() {
    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var addedNodes = mutations[i].addedNodes;
        for (var j = 0; j < addedNodes.length; j++) {
          if (addedNodes[j].nodeType === Node.ELEMENT_NODE) {
            processElement(addedNodes[j]);
            var children = addedNodes[j].querySelectorAll("*");
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
