/* ============================================================
   Hayā — Arabizi Transliterator (Layer 0.5)

   Arabizi (Arabic written in Latin script) is ubiquitous on
   social media across all Arabic-speaking countries. Users write
   "ya 7mar" instead of "يا حمار", completely bypassing both the
   dictionary and the Arabic-only model.

   This module detects Arabizi text and transliterates it to
   Arabic script so downstream layers can process it normally.

   Handles:
   - Number-letter substitutions (7→ح, 3→ع, 5→خ, 2→ء, etc.)
   - Standard Latin-to-Arabic mappings
   - Dialect-specific conventions
   - Common compound digraphs (sh→ش, kh→خ, gh→غ, etc.)
   ============================================================ */

var HayaArabiziTransliterator = (function () {

  // ── Arabizi Detection ──────────────────────────────────────
  // Returns true if text looks like Arabizi (Latin script with
  // Arabic number-letter patterns, no pure English words)
  var ARABIZI_NUMBERS = /[2345679]/;
  var HAS_LATIN = /[a-zA-Z]/;
  var PURE_ENGLISH_WORDS = /\b(the|is|are|was|were|have|has|been|this|that|with|from|and|for|not|but|you|all|can|her|his|how|its|may|our|out|who|get|let|say|she|too|use)\b/gi;
  var URL_RE = /https?:\/\/\S+|www\.\S+/g;

  function isArabizi(text) {
    if (!text || typeof text !== "string") return false;
    // Must contain Latin characters
    if (!HAS_LATIN.test(text)) return false;
    // Already has Arabic? Probably not Arabizi
    if (/[\u0600-\u06FF]/.test(text)) return false;

    var cleaned = text.replace(URL_RE, "").trim();
    if (cleaned.length < 3) return false;

    // Strong signal: numbers used as Arabic letters
    if (ARABIZI_NUMBERS.test(cleaned)) return true;

    // Check for common Arabizi patterns
    var arabiziPatterns = /\b(ya|yala|w?allah|insha|7a[br]|ma3a|3ala|kos|7mar|a5|el|el-|al-|ibn|bnt|kel[bm]|shar?m|na?yek|5awal|ta7t|ksmk|a7a|metnak|dayooth|gawaad|m3rs|zamel|gandara|sarsari|kadeesa|kooz|zool|masid|msa5)\b/i;
    if (arabiziPatterns.test(cleaned)) return true;

    // Common Arabizi profanity WITHOUT a number signal — these are otherwise
    // pure-Latin and would be rejected here, then stripped to "" by the Arabic
    // normalizer ("nik"/"teez" vanished entirely). Detect them explicitly.
    var arabiziProfanity = /\b(nik|neek|nayek|teez|tez|teezy|sharmout[a]?|sharmoota|manyook[a]?|taboun|kahba|qa?7ba|9a?hba|kharrat|zanim|kosom[m]?ak|zamla|7alouf|n3al|3abeed|3ars[a]?|q7ba|zeby|zb|5ara|5ra|man[iy]ak)\b/i;
    if (arabiziProfanity.test(cleaned)) return true;

    return false;
  }

  // ── Transliteration Maps ───────────────────────────────────

  // Digraphs (must be checked BEFORE single characters)
  // Ordered longest-first to prevent partial matches
  var DIGRAPHS = [
    // Trigraphs
    ["sha", "\u0634"],    // sha → ش
    ["shi", "\u0634\u064A"],
    ["shu", "\u0634\u0648"],
    ["kha", "\u062E"],    // kha → خ
    ["khi", "\u062E\u064A"],
    ["khu", "\u062E\u0648"],
    ["gha", "\u063A"],    // gha → غ
    ["ghi", "\u063A\u064A"],
    ["ghu", "\u063A\u0648"],
    ["tha", "\u062B"],    // tha → ث
    ["dha", "\u0630"],    // dha → ذ (or ظ context-dependent)

    // Digraphs
    ["sh", "\u0634"],     // sh → ش
    ["kh", "\u062E"],     // kh → خ
    ["gh", "\u063A"],     // gh → غ
    ["th", "\u062B"],     // th → ث
    ["dh", "\u0630"],     // dh → ذ
    ["ch", "\u062A\u0634"], // ch → تش
    ["ou", "\u0648"],     // ou → و
    ["oo", "\u0648"],     // oo → و
    ["ee", "\u064A"],     // ee → ي
    ["aa", "\u0627"],     // aa → ا
    ["ii", "\u064A"],     // ii → ي
    ["ph", "\u0641"],     // ph → ف
  ];

  // Number-to-letter mappings (the hallmark of Arabizi)
  var NUMBER_MAP = {
    "2": "\u0621",        // 2 → ء (hamza)
    "3": "\u0639",        // 3 → ع
    "5": "\u062E",        // 5 → خ
    "6": "\u0637",        // 6 → ط
    "7": "\u062D",        // 7 → ح
    "8": "\u0642",        // 8 → ق
    "9": "\u0635",        // 9 → ص
    "4": "\u0630",        // 4 → ذ (less common)
  };

  // Combined number-letter patterns
  var NUMBER_COMBOS = [
    ["3a", "\u0639"],     // 3a → ع
    ["3e", "\u0639"],
    ["3i", "\u0639\u064A"],
    ["7a", "\u062D"],     // 7a → ح
    ["7e", "\u062D"],
    ["7i", "\u062D\u064A"],
    ["5a", "\u062E"],     // 5a → خ
    ["5e", "\u062E"],
    ["9a", "\u0635"],     // 9a → ص
    ["6a", "\u0637"],     // 6a → ط
    ["2a", "\u0623"],     // 2a → أ
    ["2i", "\u0625"],     // 2i → إ
    ["2o", "\u0624"],     // 2o → ؤ
  ];

  // Single character mappings
  var SINGLE_MAP = {
    "a": "\u0627",        // a → ا
    "b": "\u0628",        // b → ب
    "t": "\u062A",        // t → ت
    "g": "\u062C",        // g → ج (Egyptian)
    "j": "\u062C",        // j → ج
    "d": "\u062F",        // d → د
    "r": "\u0631",        // r → ر
    "z": "\u0632",        // z → ز
    "s": "\u0633",        // s → س
    "f": "\u0641",        // f → ف
    "q": "\u0642",        // q → ق
    "k": "\u0643",        // k → ك
    "l": "\u0644",        // l → ل
    "m": "\u0645",        // m → م
    "n": "\u0646",        // n → ن
    "h": "\u0647",        // h → ه
    "w": "\u0648",        // w → و
    "y": "\u064A",        // y → ي
    "i": "\u064A",        // i → ي
    "e": "\u0627",        // e → ا (approximation)
    "o": "\u0648",        // o → و
    "u": "\u0648",        // u → و
    "p": "\u0628",        // p → ب (no p in Arabic)
    "v": "\u0641",        // v → ف
    "x": "\u0643\u0633",  // x → كس

    // Uppercase same mapping
    "A": "\u0627", "B": "\u0628", "T": "\u062A",
    "G": "\u062C", "J": "\u062C", "D": "\u062F",
    "R": "\u0631", "Z": "\u0632", "S": "\u0633",
    "F": "\u0641", "Q": "\u0642", "K": "\u0643",
    "L": "\u0644", "M": "\u0645", "N": "\u0646",
    "H": "\u0647", "W": "\u0648", "Y": "\u064A",
    "I": "\u064A", "E": "\u0627", "O": "\u0648",
    "U": "\u0648", "P": "\u0628", "V": "\u0641",
    "X": "\u0643\u0633",
  };

  // ── Common Arabizi Profanity Quick-Map ──────────────────────
  // These are WHOLE WORD transliterations for the most common
  // Arabizi profanity across all dialects. Catches cases where
  // the character-by-character transliteration might be ambiguous.
  var WORD_MAP = {
    // Egyptian
    "ksmk": "\u0643\u0633\u0645\u0643",          // كسمك
    "kosomak": "\u0643\u0633\u0645\u0643",
    "kosommak": "\u0643\u0633\u0645\u0643",
    "kos": "\u0643\u0633",                        // كس
    "a7a": "\u0627\u062D\u0627",                  // احا
    "ya7mar": "\u064A\u0627 \u062D\u0645\u0627\u0631", // يا حمار
    "7mar": "\u062D\u0645\u0627\u0631",           // حمار
    "7mara": "\u062D\u0645\u0627\u0631\u0629",    // حمارة
    "5awal": "\u062E\u0648\u0644",                // خول
    "5awalat": "\u062E\u0648\u0644\u0627\u062A",  // خولات
    "sharmoota": "\u0634\u0631\u0645\u0648\u0637\u0629", // شرموطة
    "sharmoot": "\u0634\u0631\u0645\u0648\u0637",  // شرموط
    "sharmouta": "\u0634\u0631\u0645\u0648\u0637\u0629",
    "3ars": "\u0639\u0631\u0635",                 // عرص
    "3arsa": "\u0639\u0631\u0635\u0629",
    "metnak": "\u0645\u062A\u0646\u0627\u0643",    // متناك
    "metnaka": "\u0645\u062A\u0646\u0627\u0643\u0629",
    "ibn el sharmoota": "\u0627\u0628\u0646 \u0627\u0644\u0634\u0631\u0645\u0648\u0637\u0629",
    "ibn el kalb": "\u0627\u0628\u0646 \u0627\u0644\u0643\u0644\u0628",
    "ebn el kalb": "\u0627\u0628\u0646 \u0627\u0644\u0643\u0644\u0628",
    "bnt el kalb": "\u0628\u0646\u062A \u0627\u0644\u0643\u0644\u0628",
    "bnt mtnaka": "\u0628\u0646\u062A \u0645\u062A\u0646\u0627\u0643\u0629",

    // Gulf
    "dayooth": "\u062F\u064A\u0648\u062B",        // ديوث
    "gawaad": "\u0642\u0648\u0627\u062F",          // قواد
    "m3rs": "\u0645\u0639\u0631\u0635",            // معرص
    "m3ras": "\u0645\u0639\u0631\u0635",
    "q7ba": "\u0642\u062D\u0628\u0629",
    "qa7ba": "\u0642\u062D\u0628\u0629",
    "zft": "\u0632\u0641\u062A",

    // Levantine
    "kos o5tak": "\u0643\u0633 \u0627\u062E\u062A\u0643",
    "kos ommak": "\u0643\u0633 \u0627\u0645\u0643",
    "manyook": "\u0645\u0646\u064A\u0648\u0643",   // منيوك
    "manyooka": "\u0645\u0646\u064A\u0648\u0643\u0629",
    "ya kalb": "\u064A\u0627 \u0643\u0644\u0628",
    "ya kelb": "\u064A\u0627 \u0643\u0644\u0628",
    "shleka": "\u0634\u0644\u0643\u0629",
    "sharmout": "\u0634\u0631\u0645\u0648\u0637",
    
    // Maghrebi
    "n3al bouk": "\u0646\u0639\u0644 \u0628\u0648\u0643",
    "na3al bouk": "\u0646\u0639\u0644 \u0628\u0648\u0643",
    "zamel": "\u0632\u0627\u0645\u0644",           // زامل
    "zamla": "\u0632\u0627\u0645\u0644\u0629",
    "9armouta": "\u0634\u0631\u0645\u0648\u0637\u0629",
    "7alouf": "\u062D\u0644\u0648\u0641",          // حلوف
    "9a7bi": "\u0635\u0627\u062D\u0628\u064A",
    "taboun": "\u062A\u0628\u0648\u0646",
    "kahba": "\u0642\u062D\u0628\u0629",
    "9ahba": "\u0642\u062D\u0628\u0629",

    // General insults
    "ya 8abee": "\u064A\u0627 \u063A\u0628\u064A",
    "ya ghabi": "\u064A\u0627 \u063A\u0628\u064A",
    "3abeet": "\u0639\u0628\u064A\u0637",          // عبيط
    "ahbal": "\u0627\u0647\u0628\u0644",           // اهبل
    "5anzeera": "\u062E\u0646\u0632\u064A\u0631\u0629",
    "5anzeer": "\u062E\u0646\u0632\u064A\u0631",

    // Threats
    "ha2tlak": "\u0647\u0642\u062A\u0644\u0643",   // هقتلك
    "ha2tolk": "\u0647\u0642\u062A\u0644\u0643",
    "haotlak": "\u0647\u0642\u062A\u0644\u0643",
    "haktolak": "\u0647\u0642\u062A\u0644\u0643",
    "hadba7ak": "\u0647\u0630\u0628\u062D\u0643",
    "hfda7ak": "\u0647\u0641\u0636\u062D\u0643",

    // Sexual
    "nik": "\u0646\u064A\u0643",                   // نيك
    "nayek": "\u0646\u0627\u064A\u0643",            // نايك
    "anik": "\u0627\u0646\u064A\u0643",
    "zb": "\u0632\u0628",                          // زب
    "zeby": "\u0632\u0628\u064A",
    "teez": "\u0637\u064A\u0632",                  // طيز
    "tez": "\u0637\u064A\u0632",
    "teezy": "\u0637\u064A\u0632\u064A",
    
    // Additional dialects for high recall
    "gandara": "\u0642\u0646\u062F\u0631\u0629",   // قندرة
    "sarsari": "\u0633\u0631\u0633\u0631\u064A",   // سرسري
    "kadeesa": "\u0643\u062F\u064A\u0633\u0647",   // كديسه
    "kooz": "\u0643\u0648\u0632",                  // كوز
    "zool ghabi": "\u0632\u0648\u0644 \u063A\u0628\u064A", // زول غبي
    "zool": "\u0632\u0648\u0644",
    "masid": "\u0645\u0633\u064A\u062F",           // مسيد
    "kharrat": "\u062E\u0631\u0627\u0637",         // خراط
    "msa5": "\u0645\u0633\u062E",                  // مسخ
    "zanim": "\u0632\u0646\u064A\u0645",           // زنيم
    "zanga": "\u0632\u0646\u062C\u064A",           // زنجي (racism)
    "zanji": "\u0632\u0646\u062C\u064A",           // زنجي
    "3abeed": "\u0639\u0628\u064A\u062F",          // عبيد
  };

  function transliterateWord(word) {
    if (!word) return word;

    var lower = word.toLowerCase();

    // Check whole-word map first
    if (WORD_MAP[lower]) return WORD_MAP[lower];

    var result = "";
    var i = 0;

    while (i < lower.length) {
      var matched = false;

      // Try number-letter combos first (longest match)
      for (var nc = 0; nc < NUMBER_COMBOS.length; nc++) {
        var combo = NUMBER_COMBOS[nc];
        if (lower.substring(i, i + combo[0].length) === combo[0]) {
          result += combo[1];
          i += combo[0].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Try digraphs (longest first)
      for (var d = 0; d < DIGRAPHS.length; d++) {
        var dg = DIGRAPHS[d];
        if (lower.substring(i, i + dg[0].length) === dg[0]) {
          result += dg[1];
          i += dg[0].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Try number map
      var ch = lower[i];
      if (NUMBER_MAP[ch]) {
        result += NUMBER_MAP[ch];
        i++;
        continue;
      }

      // Try single character map
      if (SINGLE_MAP[ch]) {
        result += SINGLE_MAP[ch];
        i++;
        continue;
      }

      // Passthrough (space, punctuation, etc.)
      result += ch;
      i++;
    }

    return result;
  }

  function transliterate(text) {
    if (!text || typeof text !== "string") return text;
    if (!isArabizi(text)) return text;

    // Check multi-word phrases in WORD_MAP first
    var lower = text.toLowerCase().trim();
    if (WORD_MAP[lower]) return WORD_MAP[lower];

    // Word-by-word transliteration
    var words = text.split(/\s+/);
    var translated = [];
    for (var i = 0; i < words.length; i++) {
      translated.push(transliterateWord(words[i]));
    }
    return translated.join(" ");
  }

  return {
    isArabizi: isArabizi,
    transliterate: transliterate,
    transliterateWord: transliterateWord,
  };
})();
