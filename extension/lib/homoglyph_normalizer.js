/* ============================================================
   Hayā — Homoglyph Normalizer (Unicode Confusable Defense)

   Attackers substitute visually-identical characters from other
   scripts to bypass dictionary matching. This module maps all
   known Arabic-confusable glyphs back to their canonical Arabic
   form before any matching takes place.

   Sources:
   - Unicode TR39 (Confusable Detection)
   - Arabic Presentation Forms A/B (FB50–FDFF, FE70–FEFF)
   - Mathematical Arabic Letters (U+1EE00–U+1EEFF)
   - Extended Arabic-Indic Digits
   ============================================================ */

var HayaHomoglyphNormalizer = (function () {

  // ── Arabic look-alike characters from other scripts ──────
  // Each key is a confusable codepoint; the value is the
  // canonical Arabic letter it should map to.
  var CONFUSABLES = {
    // Cyrillic → Arabic (visually similar)
    "\u0430": "\u0627",   // а → ا
    "\u0435": "\u0647",   // е → ه
    "\u043E": "\u0647",   // о → ه
    "\u0440": "\u0631",   // р → ر
    "\u0441": "\u0633",   // с → س
    "\u0443": "\u0648",   // у → و
    "\u0445": "\u062E",   // х → خ

    // Latin → Arabic (when mixed into Arabic text)
    "o": "\u0647",        // o → ه
    "a": "\u0627",        // a → ا

    // Extended Arabic-B & rare forms
    "\u06A9": "\u0643",   // ک (Keheh) → ك
    "\u06CC": "\u064A",   // ی (Farsi Yeh) → ي
    "\u06C0": "\u0647",   // ۀ → ه
    "\u06D5": "\u0647",   // ە (Kurdish He) → ه
    "\u06BE": "\u0647",   // ھ (Heh Doachashmee) → ه
    "\u06C1": "\u0647",   // ہ (Heh Goal) → ه
    "\u06C2": "\u0647",   // ۂ → ه
    "\u0629": "\u0647",   // keep ة→ة  (intentionally NOT mapped; handled by foldVariants)

    // Pashto/Urdu letters
    "\u067E": "\u0628",   // پ → ب
    "\u0686": "\u062C",   // چ → ج  (keep for dialect fold)
    "\u06AF": "\u0642",   // گ → ق  (keep for dialect fold)
    "\u0698": "\u0632",   // ژ → ز
    "\u06A4": "\u0641",   // ڤ → ف

    // Urdu / Pashto / Kurdish letters that were NOT folded before. Each was a
    // live BYPASS — "كسمڑ", "خوڵ", "منيوڵ", "كسمے" all reached the dictionary
    // unmatched because these codepoints survived normalization unchanged.
    // They render near-identically to the base Arabic letter, so swapping one
    // in costs the evader nothing.
    "ے": "ي",   // ے (Urdu Barree Yeh)       → ي
    "ڵ": "ل",   // ڵ (Kurdish Lam)           → ل
    "ڕ": "ر",   // ڕ (Kurdish Reh)           → ر
    "ڎ": "د",   // ڎ                         → د
    "ڼ": "ن",   // ڼ (Pashto Noon)           → ن
    "ټ": "ت",   // ټ (Pashto Teh)            → ت
    "ډ": "د",   // ډ (Pashto Dal)            → د
    "ړ": "ر",   // ړ (Pashto Reh)            → ر
    "ڑ": "ر",   // ڑ (Urdu Rreh)             → ر
    "ۃ": "ة",   // ۃ (Urdu Teh Marbuta Goal) → ة

    // Arabic-Indic digits → stripped (normalizer already strips digits,
    // but if they're smuggled in via extended forms)
    "\u06F0": "0", "\u06F1": "1", "\u06F2": "2", "\u06F3": "3",
    "\u06F4": "4", "\u06F5": "5", "\u06F6": "6", "\u06F7": "7",
    "\u06F8": "8", "\u06F9": "9",
  };

  // ── Arabic Presentation Forms A (FB50–FDFF) ──────────────
  // These are positional variants (initial/medial/final/isolated)
  // of standard Arabic letters. Map each back to its base letter.
  var PRESENTATION_FORMS_A = {
    // Alef variants
    "\uFB50": "\u0671", "\uFB51": "\u0671",
    // Beh
    "\uFE8F": "\u0628", "\uFE90": "\u0628", "\uFE91": "\u0628", "\uFE92": "\u0628",
    // Teh
    "\uFE95": "\u062A", "\uFE96": "\u062A", "\uFE97": "\u062A", "\uFE98": "\u062A",
    // Theh
    "\uFE99": "\u062B", "\uFE9A": "\u062B", "\uFE9B": "\u062B", "\uFE9C": "\u062B",
    // Jeem
    "\uFE9D": "\u062C", "\uFE9E": "\u062C", "\uFE9F": "\u062C", "\uFEA0": "\u062C",
    // Hah
    "\uFEA1": "\u062D", "\uFEA2": "\u062D", "\uFEA3": "\u062D", "\uFEA4": "\u062D",
    // Khah
    "\uFEA5": "\u062E", "\uFEA6": "\u062E", "\uFEA7": "\u062E", "\uFEA8": "\u062E",
    // Dal
    "\uFEA9": "\u062F", "\uFEAA": "\u062F",
    // Thal
    "\uFEAB": "\u0630", "\uFEAC": "\u0630",
    // Reh
    "\uFEAD": "\u0631", "\uFEAE": "\u0631",
    // Zain
    "\uFEAF": "\u0632", "\uFEB0": "\u0632",
    // Seen
    "\uFEB1": "\u0633", "\uFEB2": "\u0633", "\uFEB3": "\u0633", "\uFEB4": "\u0633",
    // Sheen
    "\uFEB5": "\u0634", "\uFEB6": "\u0634", "\uFEB7": "\u0634", "\uFEB8": "\u0634",
    // Sad
    "\uFEB9": "\u0635", "\uFEBA": "\u0635", "\uFEBB": "\u0635", "\uFEBC": "\u0635",
    // Dad
    "\uFEBD": "\u0636", "\uFEBE": "\u0636", "\uFEBF": "\u0636", "\uFEC0": "\u0636",
    // Tah
    "\uFEC1": "\u0637", "\uFEC2": "\u0637", "\uFEC3": "\u0637", "\uFEC4": "\u0637",
    // Zah
    "\uFEC5": "\u0638", "\uFEC6": "\u0638", "\uFEC7": "\u0638", "\uFEC8": "\u0638",
    // Ain
    "\uFEC9": "\u0639", "\uFECA": "\u0639", "\uFECB": "\u0639", "\uFECC": "\u0639",
    // Ghain
    "\uFECD": "\u063A", "\uFECE": "\u063A", "\uFECF": "\u063A", "\uFED0": "\u063A",
    // Feh
    "\uFED1": "\u0641", "\uFED2": "\u0641", "\uFED3": "\u0641", "\uFED4": "\u0641",
    // Qaf
    "\uFED5": "\u0642", "\uFED6": "\u0642", "\uFED7": "\u0642", "\uFED8": "\u0642",
    // Kaf
    "\uFED9": "\u0643", "\uFEDA": "\u0643", "\uFEDB": "\u0643", "\uFEDC": "\u0643",
    // Lam
    "\uFEDD": "\u0644", "\uFEDE": "\u0644", "\uFEDF": "\u0644", "\uFEE0": "\u0644",
    // Meem
    "\uFEE1": "\u0645", "\uFEE2": "\u0645", "\uFEE3": "\u0645", "\uFEE4": "\u0645",
    // Noon
    "\uFEE5": "\u0646", "\uFEE6": "\u0646", "\uFEE7": "\u0646", "\uFEE8": "\u0646",
    // Heh
    "\uFEE9": "\u0647", "\uFEEA": "\u0647", "\uFEEB": "\u0647", "\uFEEC": "\u0647",
    // Waw
    "\uFEED": "\u0648", "\uFEEE": "\u0648",
    // Alef Maksura
    "\uFEEF": "\u0649", "\uFEF0": "\u0649",
    // Yeh
    "\uFEF1": "\u064A", "\uFEF2": "\u064A", "\uFEF3": "\u064A", "\uFEF4": "\u064A",
    // Lam-Alef ligatures
    "\uFEF5": "\u0644\u0627", "\uFEF6": "\u0644\u0627",
    "\uFEF7": "\u0644\u0627", "\uFEF8": "\u0644\u0627",
    "\uFEF9": "\u0644\u0627", "\uFEFA": "\u0644\u0627",
    "\uFEFB": "\u0644\u0627", "\uFEFC": "\u0644\u0627",
    // Alef
    "\uFE8D": "\u0627", "\uFE8E": "\u0627",
    // Alef with Hamza
    "\uFE83": "\u0623", "\uFE84": "\u0623",
    "\uFE87": "\u0625", "\uFE88": "\u0625",
    // Teh Marbuta
    "\uFE93": "\u0629", "\uFE94": "\u0629",
    // Hamza
    "\uFE80": "\u0621",
  };

  // ── Invisible / formatting characters to strip ───────────
  // BIDI overrides, variation selectors, interlinear annotations,
  // tag characters, word joiners, soft hyphens, etc.
  var INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\u2028\u2029\uFEFF\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u3164\uFFA0]/g;

  // Variation selectors (U+FE00–FE0F and U+E0100–E01EF)
  var VARIATION_SEL_RE = /[\uFE00-\uFE0F]/g;

  // Combining marks that aren't Arabic diacritics (used to disguise text)
  // Arabic diacritics (0x064B-0x065F, 0x0670) are handled by the normalizer.
  // These are NON-Arabic combining marks used for obfuscation:
  var COMBINING_ABUSE_RE = /[\u0300-\u036F\u0483-\u0489\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF]/g;

  function normalize(text) {
    if (!text || typeof text !== "string") return text;

    // 1. Strip invisible formatting characters
    text = text.replace(INVISIBLE_RE, "");
    text = text.replace(VARIATION_SEL_RE, "");

    // 2. Strip non-Arabic combining marks (obfuscation via stacking)
    text = text.replace(COMBINING_ABUSE_RE, "");

    // 3. Map presentation forms back to base letters
    var result = "";
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (PRESENTATION_FORMS_A[ch]) {
        result += PRESENTATION_FORMS_A[ch];
      } else if (CONFUSABLES[ch]) {
        result += CONFUSABLES[ch];
      } else {
        result += ch;
      }
    }

    return result;
  }

  return { normalize: normalize };
})();
