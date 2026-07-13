/* ============================================================
   Hayā — Content Script
   Layer 1: Dictionary (instant) → Layer 2: AI Model (via background)
   Features: Cache, Lazy Viewport Scan, Toast Notifications
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
  var revealLocked = false;

  // API result cache (text → {label, score})
  var apiCache = new Map();
  var MAX_CACHE = 500;

  // Deferred elements (outside viewport)
  var viewportObserver = null;

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

    chrome.storage.sync.get(["parentalPin"], function (data) {
      if (data.parentalPin) {
        revealLocked = true;
        console.log("[Hayā] Reveal locked (parental PIN set)");
      }
    });

    await loadWordLists();
    console.log("[Hayā] Dictionary:", wordGroups.exact.size, "exact +", wordGroups.partial.size, "partial +", wordGroups.regex.length, "regex");
    chrome.runtime.sendMessage({ type: "pageScanned" });
    setupViewportObserver();
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
      chrome.storage.sync.get(["customWords", "allowlist"], function (data) {
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

        wordGroups = {
          exact: exactWords,
          partial: partialWords,
          regex: regexPatterns.concat(HayaDictionary.patterns || []),
        };
        resolve();
      });
    });
  }

  // ============================================================
  // Message Handling
  // ============================================================

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.type === "getFilteredTexts") {
      sendResponse(filteredTexts);
    }
    if (msg.type === "lockReveals") {
      revealLocked = true;
      reblurAll();
    }
    if (msg.type === "unlockReveals") {
      revealLocked = false;
    }
    if (msg.type === "showToast") {
      showToast(msg.message);
    }
  });

  // ============================================================
  // Lazy Viewport Scanning (IntersectionObserver)
  // ============================================================

  function setupViewportObserver() {
    if (!window.IntersectionObserver) return;

    viewportObserver = new IntersectionObserver(function (entries) {
      var toProcess = [];
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          toProcess.push(entries[i].target);
          viewportObserver.unobserve(entries[i].target);
        }
      }
      if (toProcess.length > 0) {
        for (var j = 0; j < toProcess.length; j++) {
          processElement(toProcess[j]);
        }
        flushBatch();
      }
    }, { rootMargin: "200px" });
  }

  function isInViewport(element) {
    var rect = element.getBoundingClientRect();
    var windowHeight = window.innerHeight || document.documentElement.clientHeight;
    return rect.top < windowHeight + 200 && rect.bottom > -200;
  }

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
          if (node.classList && (node.classList.contains("haya-wrapper") ||
              node.classList.contains("haya-reveal-btn") ||
              node.classList.contains("haya-password-overlay") ||
              node.classList.contains("haya-toast"))) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    var node;
    while ((node = walker.nextNode())) {
      if (viewportObserver && !isInViewport(node)) {
        if (!node.getAttribute(PROCESSED_ATTR) && getDirectText(node) && hasArabic(getDirectText(node))) {
          viewportObserver.observe(node);
        }
      } else {
        processElement(node);
      }
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

    // Check cache before queuing for API
    var cached = apiCache.get(normalized || text);
    if (cached) {
      if (cached.label === "TOXIC" && cached.score >= settings.threshold) {
        applyFilter(element);
        logFiltered(text, "api-cache");
        toxicCount++;
        chrome.runtime.sendMessage({ type: "updateBadge", count: toxicCount });
      }
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

      // Cache the result
      var normalized = HayaNormalizer.normalize(texts[i]) || texts[i];
      if (apiCache.size >= MAX_CACHE) {
        var firstKey = apiCache.keys().next().value;
        apiCache.delete(firstKey);
      }
      apiCache.set(normalized, result);

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
    var text = getDirectText(element) || "";

    switch (mode) {
      case "blur":
        var wrapper = document.createElement("span");
        wrapper.className = "haya-wrapper";
        element.parentNode.insertBefore(wrapper, element);
        wrapper.appendChild(element);
        element.classList.add("haya-blur");

        var btn = document.createElement("button");
        btn.className = "haya-reveal-btn";
        btn.textContent = "🔒 اكشف";
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          e.preventDefault();
          handleRevealClick(element, btn, wrapper);
        });
        wrapper.appendChild(btn);

        var reportBtn = document.createElement("button");
        reportBtn.className = "haya-report-btn";
        reportBtn.textContent = "⚑";
        reportBtn.title = "بلاغ: ده مش سام";
        reportBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          e.preventDefault();
          chrome.runtime.sendMessage({
            type: "reportFalsePositive",
            text: text.substring(0, 200),
            domain: window.location.hostname,
          });
          reportBtn.textContent = "✓";
          reportBtn.disabled = true;
          showToast("شكراً — تم إرسال البلاغ");
        });
        wrapper.appendChild(reportBtn);
        break;
      case "hide":
        element.classList.add("haya-hide");
        break;
      case "highlight":
        element.classList.add("haya-highlight");
        break;
    }
  }

  // ============================================================
  // Reveal / Re-blur Toggle + Password Protection
  // ============================================================

  function handleRevealClick(element, btn, wrapper) {
    if (revealLocked) {
      showPasswordPrompt(function () {
        toggleBlur(element, btn, wrapper);
      });
    } else {
      toggleBlur(element, btn, wrapper);
    }
  }

  function toggleBlur(element, btn, wrapper) {
    if (element.classList.contains("haya-blur")) {
      element.classList.remove("haya-blur");
      element.classList.add("haya-revealed");
      wrapper.classList.add("haya-revealed-state");
      btn.textContent = "🔓 أخفِ";
    } else {
      element.classList.remove("haya-revealed");
      element.classList.add("haya-blur");
      wrapper.classList.remove("haya-revealed-state");
      btn.textContent = "🔒 اكشف";
    }
  }

  function reblurAll() {
    var revealed = document.querySelectorAll(".haya-revealed");
    for (var i = 0; i < revealed.length; i++) {
      revealed[i].classList.remove("haya-revealed");
      revealed[i].classList.add("haya-blur");
    }
    var wrappers = document.querySelectorAll(".haya-wrapper.haya-revealed-state");
    for (var j = 0; j < wrappers.length; j++) {
      wrappers[j].classList.remove("haya-revealed-state");
      var btn = wrappers[j].querySelector(".haya-reveal-btn");
      if (btn) btn.textContent = "🔒 اكشف";
    }
  }

  function showPasswordPrompt(onSuccess) {
    if (document.querySelector(".haya-password-overlay")) return;

    var overlay = document.createElement("div");
    overlay.className = "haya-password-overlay";
    overlay.innerHTML =
      '<div class="haya-password-box">' +
        '<h3>🔒 الكشف محمي</h3>' +
        '<p>أدخل كلمة المرور للكشف عن المحتوى المخفي</p>' +
        '<input type="password" class="haya-pw-input" placeholder="كلمة المرور..." autofocus>' +
        '<div class="haya-pw-btns">' +
          '<button class="haya-pw-submit">فتح</button>' +
          '<button class="haya-pw-cancel">إلغاء</button>' +
        '</div>' +
        '<div class="haya-pw-error"></div>' +
      '</div>';

    document.body.appendChild(overlay);

    var input = overlay.querySelector(".haya-pw-input");
    var errorEl = overlay.querySelector(".haya-pw-error");

    function tryUnlock() {
      var pw = input.value;
      if (!pw) return;

      chrome.runtime.sendMessage({ type: "verifyRevealPassword", password: pw }, function (res) {
        if (res && res.success) {
          revealLocked = false;
          overlay.remove();
          onSuccess();
        } else {
          errorEl.textContent = "كلمة المرور غير صحيحة";
          input.value = "";
          input.focus();
        }
      });
    }

    overlay.querySelector(".haya-pw-submit").addEventListener("click", tryUnlock);
    overlay.querySelector(".haya-pw-cancel").addEventListener("click", function () {
      overlay.remove();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") tryUnlock();
      if (e.key === "Escape") overlay.remove();
    });

    setTimeout(function () { input.focus(); }, 100);
  }

  // ============================================================
  // Toast Notifications
  // ============================================================

  function showToast(message) {
    var existing = document.querySelectorAll(".haya-toast");
    if (existing.length >= 3) existing[0].remove();

    var toast = document.createElement("div");
    toast.className = "haya-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(function () {
      toast.classList.add("haya-toast-show");
    });

    setTimeout(function () {
      toast.classList.remove("haya-toast-show");
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
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
            if (addedNodes[j].classList &&
                (addedNodes[j].classList.contains("haya-wrapper") ||
                 addedNodes[j].classList.contains("haya-reveal-btn") ||
                 addedNodes[j].classList.contains("haya-password-overlay") ||
                 addedNodes[j].classList.contains("haya-toast"))) continue;
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
