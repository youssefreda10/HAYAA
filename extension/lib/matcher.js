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

  function check(normalizedText, words) {
    if (!normalizedText || !words || words.size === 0) return false;

    var textWords = normalizedText.split(/\s+/);

    // Exact word match
    for (var i = 0; i < textWords.length; i++) {
      if (words.has(textWords[i])) return true;
    }

    // Phrase / substring match (for multi-word dictionary entries)
    var iter = words.values();
    var entry = iter.next();
    while (!entry.done) {
      var w = entry.value;
      if (w.length >= 3 && w.indexOf(" ") !== -1 && normalizedText.indexOf(w) !== -1) {
        return true;
      }
      entry = iter.next();
    }

    // Separator-stripped match ("ع-ر-ص" → "عرص")
    var stripped = stripSeparators(normalizedText);
    if (stripped !== normalizedText) {
      var strippedWords = stripped.split(/\s+/);
      for (var j = 0; j < strippedWords.length; j++) {
        if (words.has(strippedWords[j])) return true;
      }
    }

    // Repeat-compressed match ("خوووول" after normalizer → "خوول" → compressed → "خول")
    var compressed = compressRepeats(normalizedText);
    if (compressed !== normalizedText) {
      var compWords = compressed.split(/\s+/);
      for (var k = 0; k < compWords.length; k++) {
        if (words.has(compWords[k])) return true;
      }
    }

    return false;
  }

  return { check: check, compressRepeats: compressRepeats, stripSeparators: stripSeparators };
})();
