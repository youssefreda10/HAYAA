/* ============================================================
   Hayā — Morphology Expander (Layer 0.8)

   Arabic is highly derivational. Instead of putting every
   single verb conjugation into the dictionary, this module
   uses regex patterns to detect prefixes (ب، مت، هي، etc.)
   and suffixes (ك، هم، ين، etc.) attached to known profanity
   roots, and reduces them to their base form.
   ============================================================ */

var HayaMorphologyExpander = (function () {

  // Core verbal roots that take standard prefixes and suffixes.
  var VERB_ROOTS = [
    "نيك", "ناك", "نيچ",
    "فشخ",
    "عرص", "عرس",
    "تناك",
    "قتل", "ذبح", "دمر", "فضح", "حرق", "ولع", "شرمط", "قحب", "طيز"
  ];

  // Prefixes that attach to verbs (longest-first inside the alternation
  // doesn't matter — the regex is anchored and we only need to detect a
  // suffix that implies direction).
  var VERB_PREFIXES = "(ب|بت|بي|بن|ها|هت|هي|هن|يت|ات|نت|مت|س|ست|سي|سن)";

  // Suffixes that attach to verbs.
  var VERB_SUFFIXES = "(ك|ه|ها|هم|كم|ني|وا|ون|ين|كو|هو|ي)";

  var VERB_REGEX = new RegExp("^" + VERB_PREFIXES + "?(" + VERB_ROOTS.join("|") + ")" + VERB_SUFFIXES + "?$");

  // 2nd-person suffixes mark the word as aimed at a person.
  var DIRECTED_SUFFIXES = { "ك": 1, "كم": 1, "كو": 1, "ني": 1, "هم": 1 };

  // Was this word already a dictionary-directed insult before expansion?
  // Non-destructive: we ONLY append a direction marker (never replace the
  // token). The matcher's own stemCandidates() is strictly stronger than the
  // old root-replacement — it strips affixes AND verifies the stem is a real
  // dictionary word — so replacing the token here only ever DESTROYED catches
  // (e.g. "متناكين" → "ناك", which isn't in the dict, when the matcher would
  // have reached "متناك"). We keep the original token intact and merely add a
  // standalone "ك" when a directional suffix is present, so isDirectedAtPerson
  // can see the direction even after the matcher strips the suffix.
  function directionMarker(word) {
    if (!word || word.length < 3) return "";
    var match = word.match(VERB_REGEX);
    if (match && match[3] && DIRECTED_SUFFIXES[match[3]]) return " ك";
    return "";
  }

  function expand(text) {
    if (!text || typeof text !== "string") return text;
    var words = text.split(/\s+/);
    var out = [];
    for (var i = 0; i < words.length; i++) {
      out.push(words[i]);            // original token — always preserved
      var mark = directionMarker(words[i]);
      if (mark) out.push(mark.trim()); // additive direction hint only
    }
    return out.join(" ");
  }

  return { expand: expand };
})();
