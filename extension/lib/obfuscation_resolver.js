/* ============================================================
   Hayā — Obfuscation Resolver (Layer 1.5)

   Bridges the rule layer and the model in a HYBRID CASCADE:
   rules propose repair candidates for suspicious tokens, and the
   MODEL scores them (max toxicity wins). This is what lets the
   system catch evasions that neither layer catches alone —
   e.g. "منتاك" (نت↔تن transposition) → candidate "متناك" → model 1.00.

   PRECISION SAFETY — why this can't cause false positives:
   candidates are ONLY ever sent to the model, NEVER matched
   against the slur dictionary. Fuzzy-matching a slur list would
   flag innocent look-alikes ("عيره"→"عير"), but the model refuses
   to fire on those ("عير" scores 0.01). The model is the gate.

   Candidates are generated ONLY for tokens carrying an evasion
   signature, and the total is capped, so normal text produces
   few/no extra model calls.
   ============================================================ */

var HayaObfuscationResolver = (function () {

  // Bidirectional confusion pairs: phonetic + visual + keyboard-adjacent
  // Arabic substitutions people actually use to evade filters.
  var CONFUSION = {
    "ا": ["ع"], "ع": ["ا", "غ"], "غ": ["ع"],
    "ط": ["ت"], "ت": ["ط", "د"], "د": ["ت", "ض"],
    "ذ": ["ز", "د"], "ز": ["ذ", "س"],
    "ث": ["س", "ت"], "س": ["ث", "ص", "ز"], "ص": ["س", "ض"],
    "ض": ["ظ", "د", "ص"], "ظ": ["ض", "ز"],
    "ق": ["ك", "غ"], "ك": ["ق"],
    "ه": ["ة"], "ة": ["ه", "ت"],
    "ح": ["خ", "ه"], "خ": ["ح"],
    "ئ": ["ي"], "ؤ": ["و"], "ء": ["ا"],
    // Additional pairs (from the AraSpell confusion set) not covered above.
    "ى": ["ا", "ي"],           // ا↔ى — the classic alef/alef-maqsura slip
    "ف": ["ب"], "ب": ["ف"],    // ف↔ب
    "ج": ["ش"], "ش": ["ج"]     // ج↔ش
  };

  // Chars used as mid-word "fillers" to pad a slur (كىىىمك = كسمك).
  // A run of these between real letters is a strong evasion signal.
  var FILLER_RUN_RE = /[ىيـ]{2,}/g;

  // Mask symbols that survive into normalized text or hint at masking.
  var MASK_HINT_RE = /[.\-_*#$@!]/;

  // Cost control. Candidates that survive the DICTIONARY filter are nearly
  // free to generate (no model call), so the generation budget can be
  // generous; only the ones we actually send to the model are capped.
  var MAX_CANDIDATES = 40;      // generated per text (cheap — filtered below)
  var MAX_MODEL_CANDIDATES = 4; // sent to the model per text (the real cost)
  var MIN_TOKEN_LEN = 3;        // don't fuzz very short tokens

  // Strong evasion signatures — patterns that essentially NEVER occur in clean
  // Arabic, so a token carrying one is safe to fuzz against the dictionary.
  //
  // Deliberately NOT included: a merely doubled letter. Normal Arabic is full
  // of them ("كريهة" → normalizes to "كريهه"), and treating a doubled char as
  // hostile made the resolver rewrite "رائحة كريهة ومقرفة" into a hit — 9 false
  // positives on the corpus. The normalizer already collapses genuine padding
  // (3+ repeats) down to 2, so by this stage a double carries no signal.
  function hasEvasionSignature(token) {
    if (!token) return false;
    // A RUN of filler chars (2+), e.g. "كىىىمك" — padding, not orthography.
    if (FILLER_RUN_RE.test(token)) { FILLER_RUN_RE.lastIndex = 0; return true; }
    // Medial alef-maqsura: ى is valid ONLY word-final in Arabic.
    if (/.ى./.test(token)) return true;
    // A masking symbol wedged inside the token.
    if (/[؀-ۿ][.\-_*#$@!][؀-ۿ]/.test(token)) return true;
    return false;
  }

  // Worth generating candidates at all? We allow ANY token of reasonable
  // length — because the MODEL is the precision gate (it refuses innocent
  // near-neighbours), and MAX_CANDIDATES bounds the cost. This is what lets
  // "clean-looking" misspellings (منتاك, قحبنه, اير) get repaired, since they
  // carry no surface signature yet are still evasions.
  function isSuspicious(token) {
    return !!token && token.length >= MIN_TOKEN_LEN;
  }

  // Long vowels that evaders drop ("شرمطه" ← "شرموطه", "منيك" ← "منيوك").
  // Re-inserting one is how we recover an omitted-vowel evasion.
  var LONG_VOWELS = ["و", "ا", "ي"];

  // Structural repair candidates for ONE token, in PRIORITY order — the
  // highest-signal repairs come first so the model-call budget is spent on
  // them, not on low-value single-char deletions.
  function tokenCandidates(token) {
    var out = [];
    var seen = Object.create(null);
    function add(w) {
      if (!w || w.length < 2 || w === token || seen[w]) return;
      seen[w] = 1;
      out.push(w);
    }
    var i, s, subs;

    // 1. Filler-run repairs — the strongest signal (كىىىم → كسم / كم)
    add(token.replace(/[ى]{2,}/g, "س"));   // ى-run most often masks س
    add(token.replace(/[ىيـ]{2,}/g, ""));  // or is pure padding
    // 2. Collapse padded repeats (خخخخ → خ)
    add(token.replace(/(.)\1{1,}/g, "$1"));
    // 3. Confusion substitutions (طبون → تبون, اير → عير)
    for (i = 0; i < token.length; i++) {
      subs = CONFUSION[token[i]];
      if (!subs) continue;
      for (s = 0; s < subs.length; s++) {
        add(token.slice(0, i) + subs[s] + token.slice(i + 1));
      }
    }
    // 4. Omitted long vowel — insert و/ا/ي (شرمطه → شرموطه, منيك → منيوك)
    for (i = 1; i < token.length; i++) {
      for (s = 0; s < LONG_VOWELS.length; s++) {
        add(token.slice(0, i) + LONG_VOWELS[s] + token.slice(i));
      }
    }
    // 5. Adjacent transposition (منتاك → متناك)
    for (i = 0; i < token.length - 1; i++) {
      add(token.slice(0, i) + token[i + 1] + token[i] + token.slice(i + 2));
    }
    // 6. Delete one char — last resort (an inserted letter: قحبنه → قحبه)
    if (token.length > MIN_TOKEN_LEN) {
      for (i = 0; i < token.length; i++) {
        add(token.slice(0, i) + token.slice(i + 1));
      }
    }
    return out;
  }

  // Build up to MAX_CANDIDATES full-sentence variants of `normText`, each with
  // exactly one suspicious token replaced by a repair candidate. These are the
  // texts the caller sends to the model alongside the original.
  // Returns [] when nothing looks obfuscated (no extra model cost).
  function generateSentenceCandidates(normText) {
    if (!normText || typeof normText !== "string") return [];
    var words = normText.split(/\s+/).filter(Boolean);
    var out = [];
    var seen = Object.create(null);
    seen[normText] = 1;

    // Order token indices: signature-bearing tokens first, so genuine evasions
    // get the budget before it is spent on ordinary words.
    var order = [];
    var anySignature = false;
    var a, b;
    for (a = 0; a < words.length; a++) {
      if (hasEvasionSignature(words[a])) { order.push(a); anySignature = true; }
    }
    for (b = 0; b < words.length; b++) {
      if (!hasEvasionSignature(words[b])) order.push(b);
    }

    // Clean-looking text gets a smaller budget — it is far more likely to be
    // innocent, and these are the ones that may reach the model.
    var budget = anySignature ? MAX_CANDIDATES : MAX_MODEL_CANDIDATES;

    for (var oi = 0; oi < order.length && out.length < budget; oi++) {
      var i = order[oi];
      if (!isSuspicious(words[i])) continue;
      var cands = tokenCandidates(words[i]);
      for (var c = 0; c < cands.length && out.length < budget; c++) {
        var trial = words.slice();
        trial[i] = cands[c];
        var joined = trial.join(" ");
        if (!seen[joined]) {
          seen[joined] = 1;
          out.push(joined);
        }
      }
    }
    return out;
  }

  // ── Dictionary-filtered resolution (the cheap, high-precision path) ──
  //
  // This is the AraSpell insight applied to Hayā: don't spend a model call on
  // every guess — use a lexicon to filter the guesses first. Hayā's lexicon IS
  // the slur dictionary, so a candidate that turns an unmatched token INTO a
  // dictionary hit is a confirmed de-obfuscation ("كىىمك" → "كسمك" ✓).
  //
  // Precision is preserved because the rewritten token must land on a literal
  // dictionary entry AND still pass the matcher's normal context gating — the
  // same bar any plain text has to clear. Innocent near-neighbours ("عيره") do
  // not survive, because their repair lands on a gated word that is not
  // aimed at a person.
  //
  // `matchFn(text)` should be the caller's full matcher check (HayaMatcher.check
  // bound to its wordGroups). Returns the repaired text if a hit is confirmed,
  // else null.
  // Dictionary-confirmed de-obfuscation. Only tokens carrying an EVASION
  // SIGNATURE (filler run, medial ى, padded repeat) are repaired.
  //
  // WHY THE SIGNATURE GATE IS NON-NEGOTIABLE:
  // We measured the alternative. Allowing "clean-looking" tokens to be fuzzed
  // against the dictionary — even with only conservative, length-preserving
  // edits (transposition / confusion-substitution) — produced 96 false
  // positives on the 689-case hard-negative corpus:
  //     "معرض الكتاب"  (the book fair)  → معرص   ✗
  //     "عرض تقديمي"   (a presentation) → عرص    ✗
  //     "زبيب وتين"    (raisins & figs) → زببي   ✗
  // Ordinary Arabic words sit one confusable letter (ض↔ص) away from real
  // slurs. Distinguishing them needs a VOCABULARY ("عرض is a real word, leave
  // it") — which is exactly AraSpell's VocabularyManager gate. Hayā's Layer 1
  // runs client-side with no such lexicon, so it cannot make that call.
  //
  // Therefore: rules handle what rules can PROVE (a masked/padded token whose
  // repair lands on a literal slur), and clean-looking misspellings are left
  // to the MODEL, which has the contextual intelligence to judge them (it
  // already scores "قحبنه"/"منيك"/"منيكه" at 1.00 unaided). That division of
  // labour is the hybrid.
  function resolveViaDictionary(normText, matchFn) {
    if (!normText || typeof matchFn !== "function") return null;
    var words = normText.split(/\s+/).filter(Boolean);

    for (var i = 0; i < words.length; i++) {
      if (words[i].length < MIN_TOKEN_LEN) continue;
      if (!hasEvasionSignature(words[i])) continue;

      var cands = tokenCandidates(words[i]);
      var limit = Math.min(cands.length, MAX_CANDIDATES);
      for (var c = 0; c < limit; c++) {
        var trial = words.slice();
        trial[i] = cands[c];
        var joined = trial.join(" ");
        if (matchFn(joined)) return joined;
      }
    }
    return null;
  }

  // Candidates to hand to the MODEL — the residual, after the dictionary path
  // has had its chance.
  //
  // We only bother when the text carries an evasion signature. Measurement
  // showed that blindly fuzzing clean text cost 64 model calls across 16
  // innocent inputs and produced nothing but junk the model scored 0.00
  // ("جرعر", "اثت", "منداك") — pure waste. A clean-looking misspelling is
  // better served by the model reading the ORIGINAL text (it already scores
  // "قحبنه"/"منيك" at 1.00 unaided) than by us guessing at repairs.
  function modelCandidates(normText) {
    if (!normText) return [];
    var words = normText.split(/\s+/).filter(Boolean);
    var anySignature = false;
    for (var i = 0; i < words.length; i++) {
      if (hasEvasionSignature(words[i])) { anySignature = true; break; }
    }
    if (!anySignature) return [];  // clean text → no extra model calls at all
    return generateSentenceCandidates(normText).slice(0, MAX_MODEL_CANDIDATES);
  }

  return {
    isSuspicious: isSuspicious,
    hasEvasionSignature: hasEvasionSignature,
    tokenCandidates: tokenCandidates,
    generateSentenceCandidates: generateSentenceCandidates,
    resolveViaDictionary: resolveViaDictionary,
    modelCandidates: modelCandidates,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = HayaObfuscationResolver;
}
