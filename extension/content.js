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

  var INITIALIZED = false;
  var settings = { enabled: true, mode: "blur", threshold: 0.75 };
  var toxicCount = 0;
  var pendingTexts = [];
  var pendingElements = [];
  var pendingOriginals = [];
  var batchTimer = null;
  var wordGroups = { exact: new Set(), partial: new Set(), regex: [] };
  var allowlist = new Set();
  var filteredTexts = [];
  var MAX_FILTERED_LOG = 50;
  var revealLocked = false;

  // API result cache (text → {label, score})
  var apiCache = new Map();
  var MAX_CACHE = 500;

  // Comment blocks already sent to the model. A block is scored ONCE even
  // though several of its child elements may each reach processElement.
  var queuedBlocks = new WeakSet();

  // Deferred elements (outside viewport)
  var viewportObserver = null;

  async function init() {
    if (INITIALIZED) return;
    INITIALIZED = true;
    settings = await getSettings();

    if (!settings.enabled) return;

    var domain = window.location.hostname;
    if (settings.domainMode === "minimal") {
      if (!settings.enabledDomains || settings.enabledDomains.indexOf(domain) === -1) {
        return;
      }
    } else {
      if (settings.disabledDomains && settings.disabledDomains.indexOf(domain) !== -1) {
        return;
      }
    }

    // Must resolve BEFORE scanning — otherwise reveal buttons exist while
    // revealLocked is still false and the lock can be bypassed.
    await new Promise(function (resolve) {
      chrome.storage.sync.get(["parentalPin"], function (data) {
        if (data.parentalPin) {
          revealLocked = true;
        }
        resolve();
      });
    });

    await loadWordLists();
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

        var contextualWords = new Set(HayaDictionary.contextual || []);
        var pejorativeWords = new Set(HayaDictionary.pejorative || []);

        allowlist = new Set(allow);
        var allowIter = allowlist.values();
        var ae = allowIter.next();
        while (!ae.done) {
          exactWords.delete(ae.value);
          partialWords.delete(ae.value);
          contextualWords.delete(ae.value);
          pejorativeWords.delete(ae.value);
          ae = allowIter.next();
        }

        wordGroups = {
          exact: exactWords,
          contextual: contextualWords,
          pejorative: pejorativeWords,
          partial: partialWords,
          regex: regexPatterns.concat(HayaDictionary.patterns || []),
          // Passed through so the matcher can veto regex/partial hits too —
          // deleting from the sets alone never protected against those.
          allow: allowlist,
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

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "sync") return;
    if (changes.enabled || changes.mode || changes.threshold ||
        changes.disabledDomains || changes.enabledDomains || changes.domainMode) {
      getSettings().then(function (s) { settings = s; });
    }
    if (changes.customWords || changes.allowlist) {
      loadWordLists();
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
              node.classList.contains("haya-report-btn") ||
              node.classList.contains("haya-password-overlay") ||
              node.classList.contains("haya-toast"))) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    var node;
    while ((node = walker.nextNode())) {
      if (viewportObserver && !isInViewport(node)) {
        var dt = getDirectText(node);
        if (!node.getAttribute(PROCESSED_ATTR) && dt && hasArabic(dt)) {
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

    // A trace is created for every element that clears the length gate. When
    // HayaDebug is off, trace/step/decide are no-ops that allocate nothing.
    var tr = HayaDebug.trace(text);

    if (!hasArabic(text)) {
      tr.step("hasArabic", "false — skipped").decide("PASS", "pre-filter", "مش عربي بما يكفي");
      return;
    }
    tr.step("hasArabic", "true");

    element.setAttribute(PROCESSED_ATTR, "1");

    // Layer 0.2: Emoji Analysis (before normalizer strips them)
    var emojiAnalysis = { isToxic: false, score: 0 };
    if (typeof HayaEmojiAnalyzer !== "undefined") {
      emojiAnalysis = HayaEmojiAnalyzer.analyze(text);
      tr.step("L0.2 emoji", { isToxic: emojiAnalysis.isToxic, flags: emojiAnalysis.flags, score: emojiAnalysis.score });
      if (emojiAnalysis.isToxic) {
        applyFilter(element);
        logFiltered(text, "emoji");
        toxicCount++;
        chrome.runtime.sendMessage({ type: "updateBadge", count: toxicCount });
        chrome.runtime.sendMessage({ type: "incrementStats", count: 1, source: "emoji" });
        tr.decide("BLOCK", "L0.2 emoji", "إيموجي مسيء: " + (emojiAnalysis.flags || []).join("، "));
        return;
      }
    }
    if (emojiAnalysis.extractedText) {
      text = text + " " + emojiAnalysis.extractedText;
      tr.step("emoji extract", emojiAnalysis.extractedText);
    }


    // Clean normalized form — this is what the MODEL must see. It mirrors the
    // Python normalizer the model was TRAINED on (utils/arabic_normalizer.py):
    // diacritics stripped, spaced letters stitched, repeats collapsed. Sending
    // raw text to the model instead (the old bug) let obfuscation like
    // "ك.س.م ميسي" score 0.00 SAFE, when the normalized "كسم ميسي" scores 1.00.
    var cleanNorm = HayaNormalizer.normalize(text);
    tr.step("L1 normalize", cleanNorm);

    // Dictionary form — morphology-expanded. This adds direction-marker tokens
    // that help the DICTIONARY matcher but would corrupt MODEL input, so it is
    // kept separate and never sent to Layer 2.
    var dictForm = cleanNorm;
    if (cleanNorm && typeof HayaMorphologyExpander !== "undefined") {
      dictForm = HayaMorphologyExpander.expand(cleanNorm);
      if (dictForm !== cleanNorm) tr.step("L0.8 morphology", dictForm);
    }

    // Layer 1: Dictionary check (instant, no network)
    var dictHit = dictForm && HayaMatcher.check(dictForm, wordGroups);
    tr.step("L1 dictionary", dictHit ? "HIT" : "miss");
    if (dictHit) {
      applyFilter(element);
      logFiltered(text, "dictionary");
      toxicCount++;
      chrome.runtime.sendMessage({ type: "updateBadge", count: toxicCount });
      chrome.runtime.sendMessage({ type: "incrementStats", count: 1, source: "dictionary" });
      tr.decide("BLOCK", "L1 dictionary", "طابق القاموس: " + (traceCulprit(dictForm) || "—"));
      return;
    }

    // Layer 1.5: Obfuscation resolver (instant, no network).
    // Repairs masked/padded tokens ("كىىىمك") and re-checks the dictionary.
    // Only fires on tokens with an evasion signature, so clean text is never
    // rewritten — verified at 0 false positives on the hard-negative corpus.
    if (cleanNorm && typeof HayaObfuscationResolver !== "undefined") {
      var resolved = HayaObfuscationResolver.resolveViaDictionary(
        cleanNorm,
        function (candidate) {
          return HayaMatcher.check(
            HayaMorphologyExpander.expand(candidate), wordGroups
          );
        }
      );
      tr.step("L1.5 deobfuscate", resolved ? "HIT" : "miss");
      if (resolved) {
        applyFilter(element);
        logFiltered(text, "deobfuscated");
        toxicCount++;
        chrome.runtime.sendMessage({ type: "updateBadge", count: toxicCount });
        chrome.runtime.sendMessage({ type: "incrementStats", count: 1, source: "dictionary" });
        tr.decide("BLOCK", "L1.5 deobfuscate", "نص متموّه اتفكّ لكلمة في القاموس");
        return;
      }
    }

    // Layer 2: the model needs the WHOLE comment, not this element's fragment
    // (see getBlockText — fragments score 0.00 on content that scores 0.97
    // intact). So we score the enclosing BLOCK, and if it comes back toxic we
    // blur the block — the whole comment the human reads, not the one <span>
    // that happened to trigger the scan. Sibling fragments of the same block
    // are skipped via queuedBlocks, so each comment costs exactly one call.
    var block = getBlockElement(element);
    var blockText = getBlockText(element);
    var modelText = HayaNormalizer.normalize(blockText) || cleanNorm;
    if (!modelText || modelText.length < MIN_TEXT_LENGTH) {
      tr.decide("PASS", "L2 skipped", "النص بعد التطبيع أقصر من الحد");
      return;
    }
    var modelWords = modelText.split(/\s+/).length;
    if (modelWords < 3) {
      tr.step("L2 block", short(modelText, 80) + " (" + modelWords + " كلمة)");
      tr.decide("PASS", "L2 skipped", "الكتلة أقل من ٣ كلمات — مش بتترسل للموديل");
      return;
    }
    tr.step("L2 block", modelText + " (" + modelWords + " كلمة)");

    var blockCached = apiCache.get(modelText);
    if (blockCached) {
      tr.step("L2 cache", { label: blockCached.label, score: blockCached.score });
      if (blockCached.label === "TOXIC" && blockCached.score >= settings.threshold) {
        applyFilter(block);
        logFiltered(blockText, "api-cache");
        toxicCount++;
        chrome.runtime.sendMessage({ type: "updateBadge", count: toxicCount });
        chrome.runtime.sendMessage({ type: "incrementStats", count: 1, source: "api" });
        tr.decide("BLOCK", "L2 model (cache)", "الموديل: " + blockCached.score.toFixed(2) +
          " ≥ عتبة " + settings.threshold);
      } else {
        tr.decide("PASS", "L2 model (cache)", "الموديل: " + blockCached.score.toFixed(2) +
          " < عتبة " + settings.threshold);
      }
      return;
    }

    if (queuedBlocks.has(block)) {
      tr.decide("PASS", "L2 dedup", "الكتلة دي مترسلة بالفعل — بتتحسب مرة واحدة");
      return; // already in flight for this comment
    }
    queuedBlocks.add(block);

    tr.decide("PASS", "L2 queued", "اترسلت للموديل — النتيجة بتوصل async (شوف [Hayā L2] لاحقاً)");
    HayaDebug.isOn() && attachQueueTrace(modelText, tr.id);
    queueForClassification(modelText, block, blockText);
  }

  // Small helper mirrored from the sim: name the token/phrase/pattern that
  // convicted the text, so a dictionary BLOCK says WHY in the trace.
  function traceCulprit(dictForm) {
    try {
      var words = dictForm.split(/\s+/).filter(Boolean);
      for (var i = 0; i < words.length; i++) {
        if (HayaMatcher.check(words[i], wordGroups)) return "الكلمة «" + words[i] + "»";
      }
      var phrase = null;
      wordGroups.exact.forEach(function (w) {
        if (!phrase && w.indexOf(" ") !== -1 && dictForm.indexOf(w) !== -1) phrase = w;
      });
      if (phrase) return "العبارة «" + phrase + "»";
      return "تطابق سياقي أو نمط";
    } catch (e) { return null; }
  }

  function short(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // Remember which text each queued model call was for, so the async result
  // handler can print a matching [Hayā L2] line when debug is on.
  var l2Pending = {};
  function attachQueueTrace(modelText, traceId) {
    l2Pending[modelText] = traceId;
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

  // ── Block text for the MODEL ────────────────────────────────
  //
  // getDirectText() returns only an element's OWN text nodes, so a comment
  // split across <span>/<b>/<a> children arrives as fragments. That is fine
  // for the dictionary (a slur is one word), but it CRIPPLES the model:
  // implicit toxicity needs context, and short fragments fall outside the
  // distribution the model was trained on (toxic examples averaged ~17 words).
  //
  // Measured on the real model — the same comment:
  //     whole            → 0.97 TOXIC
  //     split into 4 DOM fragments → 0.00 / 0.00 / 0.00 / 0.00  (missed)
  //
  // So for Layer 2 we climb to the nearest block-level container and send its
  // FULL text, which is what the human actually reads as one comment.
  var BLOCK_TAGS = new Set([
    "P", "DIV", "LI", "TD", "TH", "ARTICLE", "SECTION", "BLOCKQUOTE",
    "H1", "H2", "H3", "H4", "H5", "H6", "DD", "DT", "FIGCAPTION", "MAIN",
  ]);
  var MAX_BLOCK_CHARS = 1000; // keep well under the model's 128-token window

  function getBlockElement(element) {
    var node = element;
    var hops = 0;
    while (node && node !== document.body && hops < 6) {
      if (BLOCK_TAGS.has(node.tagName)) {
        var textLen = (node.textContent || "").length;
        if (textLen <= 2000) return node;
        return element;
      }
      node = node.parentElement;
      hops++;
    }
    return element;
  }

  function getBlockText(element) {
    var block = getBlockElement(element);
    var text = (block.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > MAX_BLOCK_CHARS) text = text.substring(0, MAX_BLOCK_CHARS);
    return text;
  }

  var ARABIC_REGEX_G = new RegExp(ARABIC_REGEX.source, "g");

  function hasArabic(text) {
    ARABIC_REGEX_G.lastIndex = 0;
    var arabicChars = (text.match(ARABIC_REGEX_G) || []).length;
    var totalAlpha = (text.match(/[a-zA-Z؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g) || []).length;
    if (totalAlpha === 0) return false;
    return arabicChars / totalAlpha >= 0.5;
  }

  // ============================================================
  // Batching & Classification (Layer 2 — via background.js)
  // ============================================================

  // text = clean normalized form sent to the model; original = human-readable
  // source text, carried only for the filtered log / cache display.
  function queueForClassification(text, element, original) {
    pendingTexts.push(text);
    pendingElements.push(element);
    pendingOriginals.push(original != null ? original : text);

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
    var originals = pendingOriginals.slice();
    pendingTexts = [];
    pendingElements = [];
    pendingOriginals = [];

    chrome.runtime.sendMessage({ type: "classify", texts: texts }, function (results) {
      if (chrome.runtime.lastError) {
        return;
      }
      if (results) {
        applyResults(results, elements, texts, originals);
      }
    });
  }

  // ============================================================
  // Applying Results
  // ============================================================

  function applyResults(results, elements, texts, originals) {
    var newToxic = 0;

    for (var i = 0; i < results.length; i++) {
      var result = results[i];
      var element = elements[i];

      if (!element || !result) continue;

      // texts[i] is already the clean normalized form the model scored — cache
      // directly on it (matches the lookup key in processElement). No re-normalize.
      if (apiCache.size >= MAX_CACHE) {
        var firstKey = apiCache.keys().next().value;
        apiCache.delete(firstKey);
      }
      apiCache.set(texts[i], result);

      var isToxic = result.label === "TOXIC" && result.score >= settings.threshold;

      if (HayaDebug.isOn()) {
        var sc = typeof result.score === "number" ? result.score.toFixed(3) : result.score;
        var css = isToxic ? "color:#e8697a;font-weight:700" : "color:#4fb28c;font-weight:700";
        console.log(
          "%c[Hayā L2 #" + (l2Pending[texts[i]] || "?") + "] " +
          (isToxic ? "BLOCK" : "PASS ") + "%c  model=" + result.label +
          " score=" + sc + " / عتبة " + settings.threshold + "  %c" +
          short((originals && originals[i]) || texts[i] || "", 60),
          css, "color:#909baf", "color:#8b95a6"
        );
        delete l2Pending[texts[i]];
      }

      if (isToxic) {
        applyFilter(element);
        logFiltered((originals && originals[i]) || texts[i] || "", "api");
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
    if (!element.parentNode || !element.isConnected) return;
    if (element.closest && element.closest(".haya-wrapper")) return;
    if (element.classList && element.classList.contains("haya-blur")) return;
    if (element.querySelector && element.querySelector(".haya-blur")) return;

    element.setAttribute(PROCESSED_ATTR, "1");

    var mode = settings.mode || "blur";
    var text = getDirectText(element) || "";

    switch (mode) {
      case "blur":
        var computedDisplay = "";
        try { computedDisplay = window.getComputedStyle(element).display; } catch (e) {}
        var isInline = computedDisplay === "inline" || computedDisplay === "";

        var wrapper = document.createElement(isInline ? "span" : "div");
        wrapper.className = "haya-wrapper";
        if (!isInline) wrapper.classList.add("haya-wrapper-block");

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
        '<h3>الكشف محمي</h3>' +
        '<p>أدخل رمز PIN للكشف عن المحتوى المخفي</p>' +
        '<input type="password" class="haya-pw-input" maxlength="4" inputmode="numeric" dir="ltr" placeholder="PIN" autofocus>' +
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
      var pin = input.value;
      if (!pin) return;

      chrome.runtime.sendMessage({ type: "verifyPin", pin: pin }, function (res) {
        if (res && res.success) {
          overlay.remove();
          onSuccess();
        } else if (res && res.lockedFor) {
          errorEl.textContent = "محاولات كثيرة — انتظر " + res.lockedFor + " ثانية";
          input.value = "";
        } else {
          errorEl.textContent = res && res.remaining
            ? "رمز PIN غير صحيح — متبقي " + res.remaining + " محاولات"
            : "رمز PIN غير صحيح";
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
            var added = addedNodes[j];
            if (added.classList &&
                (added.classList.contains("haya-wrapper") ||
                 added.classList.contains("haya-reveal-btn") ||
                 added.classList.contains("haya-report-btn") ||
                 added.classList.contains("haya-password-overlay") ||
                 added.classList.contains("haya-toast"))) continue;
            if (SKIP_TAGS.has(added.tagName)) continue;
            processElement(added);
            var children = added.querySelectorAll("*");
            for (var k = 0; k < children.length; k++) {
              if (!SKIP_TAGS.has(children[k].tagName)) {
                processElement(children[k]);
              }
            }
          }
        }
      }

      if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, 500);
      }
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
