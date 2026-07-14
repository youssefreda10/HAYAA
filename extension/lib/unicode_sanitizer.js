/* ============================================================
   Hayā — Unicode Sanitizer (Adversarial Defense)

   Attackers use invisible Unicode characters, BIDI overrides,
   variation selectors, and layout controls to split words
   apart. This prevents the dictionary from matching "كسمك"
   if it is written as "ك[ZWNJ]س[LRI]م[PDF]ك".

   This module aggressively strips ALL non-printing formatting
   characters and non-Arabic combining marks that can be used
   for obfuscation, before any other normalization happens.
   ============================================================ */

var HayaUnicodeSanitizer = (function () {

  // ── Invisible / Formatting Characters to Strip ───────────

  // Default Ignorable Code Points, Format characters, Control characters
  // U+200B - U+200F : Zero-width spaces, ZWNJ, ZWJ, LRM, RLM
  // U+202A - U+202E : LRE, RLE, PDF, LRO, RLO (BIDI overrides)
  // U+2060 - U+2069 : Word joiner, Invisible Math operators, LRI, RLI, FSI, PDI
  // U+FEFF : Byte Order Mark
  // U+00AD : Soft hyphen
  // U+034F : Combining grapheme joiner
  // U+061C : Arabic Letter Mark
  // U+115F, U+1160 : Hangul fillers
  // U+17B4, U+17B5 : Khmer vowel inherent
  // U+180E : Mongolian vowel separator
  // U+3164 : Hangul filler
  // U+FFA0 : Halfwidth Hangul filler
  var INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\u2028\u2029\uFEFF\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u3164\uFFA0]/g;

  // Variation selectors (U+FE00–FE0F and U+E0100–E01EF)
  var VARIATION_SEL_RE = /[\uFE00-\uFE0F]/g;

  // Combining marks that aren't Arabic diacritics (used to disguise text)
  // Arabic diacritics (0x064B-0x065F, 0x0670) are handled by the normalizer.
  // These are NON-Arabic combining marks used for obfuscation:
  // U+0300 - U+036F : Combining Diacritical Marks
  // U+0483 - U+0489 : Cyrillic combining
  // U+1AB0 - U+1AFF : Combining Diacritical Marks Extended
  // U+1DC0 - U+1DFF : Combining Diacritical Marks Supplement
  // U+20D0 - U+20FF : Combining Diacritical Marks for Symbols
  var COMBINING_ABUSE_RE = /[\u0300-\u036F\u0483-\u0489\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF]/g;

  function sanitize(text) {
    if (!text || typeof text !== "string") return text;

    // 1. Strip invisible formatting characters
    text = text.replace(INVISIBLE_RE, "");
    
    // 2. Strip variation selectors
    text = text.replace(VARIATION_SEL_RE, "");

    // 3. Strip non-Arabic combining marks (obfuscation via stacking)
    text = text.replace(COMBINING_ABUSE_RE, "");

    return text;
  }

  return { sanitize: sanitize };
})();
