/* ============================================================
   Hayā — Word Matching Engine (Layer 1)

   Layer 1 has to carry far more weight than a dictionary
   normally would. The MARBERTv2 model (Layer 2) scores 92.5%
   on its held-out test set but only ~40% on adversarial edge
   cases, and 94% of its misses are >=99% confident SAFE — so
   it is *confidently* wrong on short profanity, sexism, racism
   and obfuscation. No threshold can rescue those. The rules
   below are the only thing standing between the user and that
   whole class of content.

   Recall comes from: affix stripping + variant folding +
   obfuscation folding (separators / repeats).
   Precision comes from: contextual gating — ambiguous words
   fire only when they are aimed at a person.
   ============================================================ */

var HayaMatcher = (function () {
  // Fold punctuation-separated obfuscation ("ك.س.م" → "كسم"). Note: PLAIN
  // SPACE is deliberately NOT in this class. The normalizer already collapses
  // single-letter spacing ("ك س م ك" → "كسمك") via SPACED_LETTERS_RE, so the
  // only thing a "\s" here would do to normalized text is merge two real
  // multi-word tokens into one — which then reads as an "isolated" word and
  // wrongly trips the pejorative/standing-alone branch (e.g. the fiqh phrase
  // "الماء نجس شرعا ولا طاهر" collapsing to one token and firing on "نجس").
  var SEP_RE;
  try {
    SEP_RE = new RegExp("(?<=[\\u0600-\\u06FF])[\\-_.,\\u060C\\/\\\\]+(?=[\\u0600-\\u06FF])", "g");
  } catch (e) {
    SEP_RE = null;
  }

  // Arabic is agglutinative: conjunctions, prepositions and the
  // definite article all glue onto the front of a word.
  // "والعرص" / "بالخول" / "للشرموطة" must reach the same stem.
  // Longest first, so "وبال" is tried before "و".
  var PREFIXES = [
    "وبال", "فبال", "وكال", "ولل", "فلل",
    "وال", "فال", "بال", "كال", "لال",
    // Present/future verb-prefix clusters ("بتمعرص" → "معرص",
    // "هتكشخه" → "كشخه", "بيلوطي" → "لوطي"). These carry more
    // false-positive risk than nominal prefixes, so they are only
    // ever accepted when the stripped stem lands on a literal
    // dictionary word (tokenHits requires inSet) — stripping alone
    // never convicts. Longest-first so "بت" beats "ب".
    "بت", "هت", "بي", "هي", "بن", "هن", "يت", "نت", "مت", "ست", "سي", "سن",
    "لل", "ال",
    // Bare single-letter verb prefixes (ه/ي/ن/ت) are deliberately NOT here.
    // They strip to a 2-letter stem that dialect-folding can map onto a slur
    // (e.g. "نجس" → strip ن → "جس" → ج→ك → "كس"), and the multi-letter verb
    // clusters above already cover the real conjugations we need.
    "و", "ف", "ب", "ك", "ل", "س"
  ];

  // Two classes, because they carry different false-positive risk.
  //
  // Pronoun clitics ("كسهم") almost never turn an innocent word into a
  // dictionary word, so they may reduce to a 2-letter stem.
  // Nominal plural markers are dangerous: "الزبون" (the customer) ends in
  // "ون", and reducing it to 2 letters lands on "زب". Those keep a floor of 3.
  var PRONOUN_SUFFIXES = ["هما", "كما", "هم", "هن", "كم", "كن", "نا", "ها", "ك", "ي", "ه"];
  var NOMINAL_SUFFIXES = ["ين", "ون", "ات"];

  // 2, not 3: the shortest dictionary stems are two letters
  // ("كس", "زب"), so a stricter floor made "الكس" / "وكس" unreachable.
  // Safe because a stripped stem is only accepted if it is literally
  // in the dictionary — stripping alone never convicts.
  var MIN_STEM = 2;

  // Suffix stripping needs a longer floor than prefix stripping.
  // With a floor of 2, "الزبون" (the customer) strips ال then ون and
  // lands on "زب" — an innocent word convicted. Requiring 3 after a
  // suffix keeps "الزبون" intact while still reaching "شرموط" from
  // "شرموطات".
  var MIN_STEM_AFTER_SUFFIX = 3;

  // Words that mark the NEXT token as being aimed at a person.
  var ADDRESS_CUES = new Set(["يا", "انت", "انتي", "انتى", "انتم", "انتو", "انتوا", "يااا"]);
  var ATTACHED_PRONOUN = /(ك|كم|كي)$/;

  // Proper-name gazetteer. These are common Arabic names/surnames/places
  // that stem onto a profanity root and would otherwise be convicted:
  //   خوله / خولة (the female name Khawla) → strips ه → خول (a slur)
  //   الخولي (a common surname)            → strips ال → خول
  // A name is exempt everywhere, exactly like an allowlisted word. This is
  // a genuine homograph: the slur خول never takes a trailing ه, so treating
  // خوله as the name is the correct disambiguation. Kept deliberately small.
  var NAME_EXCEPTIONS = new Set(["خوله", "خولة", "الخولي", "خولي", "شركه", "شركة"]);

  function compressRepeats(text) {
    return text.replace(/(.)\1+/g, "$1");
  }

  function stripSeparators(text) {
    if (!SEP_RE) return text;
    return text.replace(SEP_RE, "");
  }

  // Fold spelling variants that carry no semantic weight, so
  // "قحبى"/"قحبة"/"قحبه" all collapse to one comparable form.
  // Done at match time only — the corpus form is left untouched.
  function foldVariants(word) {
    return word
      .replace(/ة/g, "ه")
      .replace(/[ىی]/g, "ي")
      .replace(/[ۃہ]/g, "ه");
  }

  function reverseFold(word) {
    return word.replace(/ه$/, "ة");
  }

  // Dialectal phoneme folding.
  //
  // Several dialects realise the same consonant differently, and people
  // spell what they say. These are systematic SHIFTS, not new vocabulary:
  //
  //   Iraqi / Gulf   ك → چ / ج      "منيوج" = منيوك,  "جلب" = كلب
  //   Iraqi          ق → گ / ج
  //   Egy / Sudanese ج → g-sound, written ق by some
  //   emphatic drift س ↔ ص           "كصة" = كسة
  //   ث ↔ ت/س,  ذ ↔ د/ز,  ظ ↔ ض     (MSA → dialect)
  //
  // Folding them means we catch the dialect spelling without having to
  // enumerate every variant per dialect. It is safe because a folded form
  // only counts if it lands on a literal dictionary word — so "جلب"
  // ("he brought") folds to "كلب", which is a Tier-1 noun and therefore
  // still needs to be aimed at a person before it fires.
  function foldDialect(word) {
    return word
      .replace(/[چڜ]/g, "ك")
      .replace(/[گڤڨ]/g, "ق")
      .replace(/ص/g, "س")
      .replace(/ث/g, "س")
      .replace(/ذ/g, "ز")
      .replace(/ظ/g, "ض");
  }

  // ك↔ج is ambiguous in both directions, so try each rather than
  // committing: "منيوج"→"منيوك" (want) but "جلب"→"كلب" (want).
  function dialectForms(word) {
    var out = [];
    var base = foldDialect(word);
    if (base !== word) out.push(base);

    var jToK = base.replace(/ج/g, "ك");
    if (jToK !== base) out.push(jToK);

    var kToJ = base.replace(/ك/g, "ج");
    if (kToJ !== base) out.push(kToJ);

    return out;
  }

  function stripGroup(word, list, floor, out) {
    for (var j = 0; j < list.length; j++) {
      var s = list[j];
      if (word.length - s.length >= floor &&
          word.lastIndexOf(s) === word.length - s.length) {
        out.push(word.substring(0, word.length - s.length));
      }
    }
  }

  function stripSuffixesInto(word, out) {
    stripGroup(word, PRONOUN_SUFFIXES, MIN_STEM, out);
    stripGroup(word, NOMINAL_SUFFIXES, MIN_STEM_AFTER_SUFFIX, out);
  }

  // Every plausible stem of a token, cheapest first.
  function stemCandidates(word) {
    var out = [word];
    var seeds = [word];

    // Elongation can collide with a real doubled letter at the prefix
    // boundary: "لبوه" + "ال" → "اللبوه", elongated → "ااااللبوه". A blanket
    // collapse yields "البوه" and loses the second ل. So also try the form
    // with only the *leading* run reduced, which restores "اللبوه".
    var leadCollapsed = word.replace(/^(.)\1+/, "$1");
    if (leadCollapsed !== word && leadCollapsed.length >= MIN_STEM) {
      out.push(leadCollapsed);
      seeds.push(leadCollapsed);
    }

    for (var k = 0; k < seeds.length; k++) {
      var w = seeds[k];

      for (var i = 0; i < PREFIXES.length; i++) {
        var p = PREFIXES[i];
        if (w.length - p.length >= MIN_STEM && w.indexOf(p) === 0) {
          var stripped = w.substring(p.length);
          out.push(stripped);
          stripSuffixesInto(stripped, out); // "وشرموطات"
          break; // one prefix cluster is enough
        }
      }

      stripSuffixesInto(w, out);
    }

    return out;
  }

  function inSet(set, word) {
    if (set.has(word)) return true;

    var folded = foldVariants(word);
    if (folded !== word && set.has(folded)) return true;

    // Check if the dictionary has the 'ة' version instead of 'ه'
    if (set.has(reverseFold(word))) return true;
    if (set.has(reverseFold(folded))) return true;

    if (/[يى]$/.test(folded)) {
      var alt = folded.replace(/[يى]$/, "ه");
      if (set.has(alt)) return true;
    }

    var dial = dialectForms(folded);
    for (var i = 0; i < dial.length; i++) {
      if (set.has(dial[i])) return true;
      if (/[يى]$/.test(dial[i]) && set.has(dial[i].replace(/[يى]$/, "ه"))) return true;
      if (set.has(reverseFold(dial[i]))) return true;
    }

    return false;
  }

  // Does this token hit `set`, allowing for affixes and variants?
  function tokenHits(set, token) {
    if (set.size === 0) return false;
    var cands = stemCandidates(token);
    for (var i = 0; i < cands.length; i++) {
      if (inSet(set, cands[i])) return true;
    }
    return false;
  }

  // Is THIS token aimed at a person?
  //
  // The cue must be ADJACENT. Scanning the whole sentence for "يا" is
  // wrong: in "شيل الوسخ من الشارع يا جماعة" the "يا جماعة" is a
  // friendly address to the room, and must not retroactively turn
  // "الوسخ" (literal dirt) into an insult. Likewise "عبد الرحمن ... يا
  // جماعة" must stay a name.
  //
  //   يا وسخ        → directed   (cue immediately before)
  //   انت وسخ       → directed
  //   وسخك          → directed   (2nd-person pronoun on the word)
  //   شيل الوسخ ... → NOT directed
  function isDirectedAtPerson(words, i) {
    var token = words[i];
    if (i > 0 && ADDRESS_CUES.has(words[i - 1])) return true;
    // "يا ابن الوسخ" — cue two back, with a construct noun between
    if (i > 1 && ADDRESS_CUES.has(words[i - 2]) &&
        (words[i - 1] === "ابن" || words[i - 1] === "بنت")) return true;
    if (ATTACHED_PRONOUN.test(token) && token.length > MIN_STEM) return true;

    // A neighbouring word may carry the addressee instead: "شكلك مقرف".
    // Kept strictly adjacent — a sentence-wide scan would drag
    // "شيل الوسخ من شارعك" back in as a false positive.
    var near = [words[i - 1], words[i + 1]];
    for (var n = 0; n < near.length; n++) {
      var w = near[n];
      if (w && w.length > 3 && ATTACHED_PRONOUN.test(w)) return true;
    }
    return false;
  }

  // A token is exempt if the user allowlisted it, or it is a known proper
  // name that merely collides with a profanity stem. Both veto a would-be hit.
  function isExempt(allow, token) {
    if (allow && tokenHits(allow, token)) return true;
    if (tokenHits(NAME_EXCEPTIONS, token)) return true;
    return false;
  }

  function matchesAny(text, exact, contextual, pejorative, partial, regex, allow) {
    var words = text.split(/\s+/).filter(Boolean);
    var i;

    // Unconditional dictionary — fires regardless of context.
    for (i = 0; i < words.length; i++) {
      if (isExempt(allow, words[i])) continue; // user override / proper name wins
      if (tokenHits(exact, words[i])) return true;
    }

    // Tier 1 (literal nouns) — only when aimed at a person.
    if (contextual && contextual.size) {
      for (i = 0; i < words.length; i++) {
        if (isExempt(allow, words[i])) continue;
        if (tokenHits(contextual, words[i]) && isDirectedAtPerson(words, i)) {
          return true;
        }
      }
    }

    // Tier 2 (pejorative adjectives) — aimed at a person, OR standing alone
    // with no sentence around it to make it descriptive.
    if (pejorative && pejorative.size) {
      var isolated = words.length === 1;
      for (i = 0; i < words.length; i++) {
        if (isExempt(allow, words[i])) continue;
        if (tokenHits(pejorative, words[i]) &&
            (isolated || isDirectedAtPerson(words, i))) {
          return true;
        }
      }
    }

    // Multi-word phrases from the dictionary ("ابن الكلب").
    // Fold BOTH sides: the incoming text is normalized (ة→ه, ى→ي …) but the
    // stored phrase may still carry ة/ة-forms ("ابن الشرموطة"). Comparing the
    // raw entry against folded text silently never matched — fold the entry too.
    var foldedText = foldVariants(text);
    var eIter = exact.values();
    var e = eIter.next();
    while (!e.done) {
      if (e.value.indexOf(" ") !== -1 &&
          (text.indexOf(e.value) !== -1 ||
           foldedText.indexOf(foldVariants(e.value)) !== -1)) return true;
      e = eIter.next();
    }

    // User "partial" entries — substring anywhere.
    var pIter = partial.values();
    var p = pIter.next();
    while (!p.done) {
      if (p.value.length >= 2 && text.indexOf(p.value) !== -1) {
        if (!(allow && allow.has(p.value))) return true;
      }
      p = pIter.next();
    }

    // Regex patterns. The allowlist must be able to veto these too —
    // previously an allowlisted word could still be caught by a pattern.
    for (var r = 0; r < regex.length; r++) {
      try {
        if (regex[r].test(text) && !allowVetoes(allow, words, regex[r])) return true;
        for (var w = 0; w < words.length; w++) {
          if (isExempt(allow, words[w])) continue;
          if (regex[r].test(words[w])) return true;
        }
      } catch (err) {}
    }

    return false;
  }

  // A whole-text regex hit is vetoed only if every token it could
  // have matched is allowlisted.
  function allowVetoes(allow, words, re) {
    if (!allow || allow.size === 0) return false;
    for (var i = 0; i < words.length; i++) {
      try {
        if (re.test(words[i]) && !tokenHits(allow, words[i])) return false;
      } catch (e) { return false; }
    }
    return true;
  }

  function check(normalizedText, wordGroups) {
    if (!normalizedText) return false;

    var exact, contextual, pejorative, partial, regex, allow;
    if (wordGroups instanceof Set) {
      exact = wordGroups;
      contextual = new Set();
      pejorative = new Set();
      partial = new Set();
      regex = [];
      allow = new Set();
    } else {
      exact = wordGroups.exact || new Set();
      contextual = wordGroups.contextual || new Set();
      pejorative = wordGroups.pejorative || new Set();
      partial = wordGroups.partial || new Set();
      regex = wordGroups.regex || [];
      allow = wordGroups.allow || new Set();
    }

    if (exact.size === 0 && contextual.size === 0 && pejorative.size === 0 &&
        partial.size === 0 && regex.length === 0) {
      return false;
    }

    var forms = [normalizedText];

    function addForm(f) {
      if (f && forms.indexOf(f) === -1) forms.push(f);
    }

    // Obfuscation folding: "ك.س.م" and "خوووول" must reach the plain form.
    var stripped = stripSeparators(normalizedText);
    addForm(stripped);
    addForm(compressRepeats(normalizedText));
    addForm(compressRepeats(stripped)); // both at once: "خ.و.وووول"

    // Variant-folded whole text. Multi-word phrases are matched with
    // indexOf against the raw text, so without this a ة/ى swap anywhere
    // in the sentence ("مش ةسيبك") would slip past every phrase entry.
    addForm(foldVariants(normalizedText));
    addForm(foldVariants(compressRepeats(stripped)));

    for (var i = 0; i < forms.length; i++) {
      if (matchesAny(forms[i], exact, contextual, pejorative, partial, regex, allow)) return true;
    }

    return false;
  }

  return {
    check: check,
    compressRepeats: compressRepeats,
    stripSeparators: stripSeparators,
    foldVariants: foldVariants,
    stemCandidates: stemCandidates,
    isDirectedAtPerson: isDirectedAtPerson,
  };
})();
