/* Hayā — Word Matching Engine */

var HayaMatcher = (function () {
  var SEP_RE;
  try {
    SEP_RE = new RegExp("(?<=[\\u0600-\\u06FF])[\\s\\-_.,\\u060C\\/\\\\]+(?=[\\u0600-\\u06FF])", "g");
  } catch (e) {
    SEP_RE = null;
  }

  function compressRepeats(text) {
    return text.replace(/(.)\1+/g, "$1");
  }

  function stripSeparators(text) {
    if (!SEP_RE) return text;
    return text.replace(SEP_RE, "");
  }

  function matchesAny(text, exact, partial, regex) {
    var words = text.split(/\s+/);

    for (var i = 0; i < words.length; i++) {
      if (exact.has(words[i])) return true;
    }

    var eIter = exact.values();
    var e = eIter.next();
    while (!e.done) {
      if (e.value.indexOf(" ") !== -1 && text.indexOf(e.value) !== -1) return true;
      e = eIter.next();
    }

    var pIter = partial.values();
    var p = pIter.next();
    while (!p.done) {
      if (p.value.length >= 2 && text.indexOf(p.value) !== -1) return true;
      p = pIter.next();
    }

    for (var r = 0; r < regex.length; r++) {
      try { if (regex[r].test(text)) return true; } catch (err) {}
    }

    return false;
  }

  function check(normalizedText, wordGroups) {
    if (!normalizedText) return false;

    var exact, partial, regex;
    if (wordGroups instanceof Set) {
      exact = wordGroups;
      partial = new Set();
      regex = [];
    } else {
      exact = wordGroups.exact || new Set();
      partial = wordGroups.partial || new Set();
      regex = wordGroups.regex || [];
    }

    if (exact.size === 0 && partial.size === 0 && regex.length === 0) return false;

    if (matchesAny(normalizedText, exact, partial, regex)) return true;

    var stripped = stripSeparators(normalizedText);
    if (stripped !== normalizedText && matchesAny(stripped, exact, partial, regex)) return true;

    var compressed = compressRepeats(normalizedText);
    if (compressed !== normalizedText && matchesAny(compressed, exact, partial, regex)) return true;

    return false;
  }

  return { check: check, compressRepeats: compressRepeats, stripSeparators: stripSeparators };
})();
