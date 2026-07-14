/* ============================================================
   Hayā — 1M-Case Stress Suite Generator (streaming JSONL)

   Balanced toxic/safe. Each toxic seed is exploded across
   morphology × obfuscation × carrier; each safe seed across
   framing × obfuscation. Contextual words are emitted in BOTH
   polarities (directed = toxic, undirected = safe) to exercise
   the context gate.

   Streams to JSONL (one object per line) so 1M rows never sit in
   memory at once. Each row: {text, expected, dialect, category,
   obf, morph}.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const { TOXIC, SAFE, CONTEXTUAL } = require("./seeds.js");

const OUT = path.join(__dirname, "suite_stress.jsonl");
const TARGET = parseInt(process.argv[2] || "100000", 10);

// ── Obfuscations (surface evasions) ─────────────────────────
const OBF = [
  ["plain", (w) => w],
  ["dots", (w) => w.split("").join(".")],
  ["spaces", (w) => w.split("").join(" ")],
  ["dashes", (w) => w.split("").join("-")],
  ["underscore", (w) => w.split("").join("_")],
  ["elongate", (w) => w.replace(/(.)/, "$1$1$1$1")],
  ["tatweel", (w) => w.split("").join("ـ")],
  ["diacritics", (w) => w.split("").join("َ")],
  ["alefswap", (w) => w.replace(/ا/g, "أ")],
  ["farsi", (w) => w.replace(/ي/g, "ی").replace(/ك/g, "ک")],
  ["tamarbuta", (w) => w.replace(/ه$/, "ة")],
  ["zerowidth", (w) => w.split("").join("​")],
  ["cyrillic", (w) => w.replace(/ا/g, "а").replace(/ر/g, "р").replace(/ه/g, "е")],
  ["filler", (w) => w.replace(/س/g, "ىىى").replace(/و/g, "ووو")],
  ["mask", (w) => w.split("").join("*")],
];

// ── Morphology (Arabic agglutination) ───────────────────────
const MORPH = [
  ["bare", (w) => w],
  ["al", (w) => "ال" + w],
  ["wa", (w) => "و" + w],
  ["waal", (w) => "وال" + w],
  ["bial", (w) => "بال" + w],
  ["lil", (w) => "لل" + w],
  ["plural_in", (w) => w + "ين"],
  ["plural_wn", (w) => w + "ون"],
  ["plural_at", (w) => w + "ات"],
  ["poss_hm", (w) => w + "هم"],
  ["poss_k", (w) => w + "ك"],
  ["poss_km", (w) => w + "كم"],
  ["poss_ha", (w) => w + "ها"],
  ["verb_b", (w) => "ب" + w],
  ["verb_bt", (w) => "بت" + w],
  ["verb_ht", (w) => "هت" + w],
];

// ── Carriers (embed the token in a realistic sentence) ──────
const CARRIERS = [
  (w) => w,
  (w) => "يا " + w,
  (w) => "انت " + w + " فعلا",
  (w) => "والله " + w + " مش اكتر",
  (w) => "ده " + w + " اوي بجد",
  (w) => "بص يا عم " + w + " خالص",
  (w) => w + " يا ابن الايه",
  (w) => "المفروض متبقاش " + w + " كده",
];

const SAFE_FRAMES = [
  (t) => t,
  (t) => "والله " + t,
  (t) => t + " يا جماعة",
  (t) => "قال لي صاحبي " + t,
  (t) => "انا شايف ان " + t,
];

// mulberry32 — deterministic RNG so the suite is reproducible.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const stream = fs.createWriteStream(OUT);
let written = 0;
const seen = new Set();

// allowDup=false while we still want unique variety; the driver flips it to
// true once a side's unique combinations are exhausted, so the suite fills to
// TARGET instead of deadlocking. Duplicate rows are harmless for a rate-
// estimation stress test — each (dialect × category × obf) cell just gets
// sampled more, which stabilises its pass/fail rate.
function emit(text, expected, dialect, category, obf, morph, allowDup) {
  if (!text || written >= TARGET) return false;
  if (!allowDup && seen.size < 3_000_000) {
    const k = expected + "|" + text;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  stream.write(JSON.stringify({ text, expected, dialect, category, obf, morph }) + "\n");
  written++;
  return true;
}

// Flatten toxic seeds into (dialect, category, word) triples.
const toxTriples = [];
for (const [dialect, cats] of Object.entries(TOXIC)) {
  for (const [cat, words] of Object.entries(cats)) {
    for (const w of words) toxTriples.push([dialect, cat, w]);
  }
}
// Flatten safe seeds.
const safePairs = [];
for (const [cat, arr] of Object.entries(SAFE)) {
  for (const t of arr) safePairs.push([cat, t]);
}

function genToxic(allowDup) {
  const [dialect, cat, w] = pick(toxTriples);
  const [mName, mFn] = pick(MORPH);
  const [oName, oFn] = pick(OBF);
  let form = oFn(mFn(w));
  if (rand() < 0.6) form = pick(CARRIERS)(form);
  return emit(form, 1, dialect, cat, oName, mName, allowDup);
}

// Extra safe frames — combined with seeds × obfuscations, these give the
// safe side enough unique combinations to balance a 1M suite. Every one must
// stay non-toxic.
const SAFE_CONTEXT_FRAMES = [
  (w) => "ال" + w + " موجود هنا", (w) => "شفت ال" + w + " امبارح",
  (w) => "ال" + w + " ده كبير", (w) => w + " كلمة عادية في القاموس",
  (w) => "اشتريت ال" + w + " من السوق", (w) => "ال" + w + " بتاعي جديد",
  (w) => "فين ال" + w + " اللي كان هنا", (w) => "ال" + w + " ده غالي شوية",
  (w) => "حطيت ال" + w + " في الدرج", (w) => "ال" + w + " اتكسر امبارح",
];

function genSafe(allowDup) {
  const roll = rand();
  if (roll < 0.3) {
    // Contextual word, UNDIRECTED → safe. Frame × word × optional obfuscation
    // gives plenty of unique combinations.
    const w = pick(CONTEXTUAL);
    let form = pick(SAFE_CONTEXT_FRAMES)(w);
    let obf = "plain";
    if (rand() < 0.3) {
      const [oName, oFn] = pick(OBF.slice(1, 9));
      form = oFn(form);
      obf = oName;
    }
    return emit(form, 0, "Universal", "Contextual_Undirected", obf, "bare", allowDup);
  }
  const [cat, t] = pick(safePairs);
  let form = pick(SAFE_FRAMES)(t);
  // Half of safe cases get obfuscated — obfuscation must NOT turn safe toxic,
  // and this also multiplies unique combinations for balance.
  let obf = "plain";
  if (rand() < 0.5) {
    const [oName, oFn] = pick(OBF.slice(1)); // any obf
    form = oFn(form);
    obf = oName;
  }
  return emit(form, 0, "SafeCorpus", cat, obf, "bare", allowDup);
}

console.log(`Generating ${TARGET.toLocaleString()} cases → ${OUT}`);
const t0 = Date.now();
// Track balance and steer toward 50/50 rather than coin-flipping, so dedupe
// drops don't skew the mix.
let nTox = 0, nSafe = 0;
// Per-side "exhausted" latch: once a side can no longer produce unique rows,
// it permanently switches to allowing duplicates. This avoids re-climbing a
// miss counter on every request (which was O(target × miss_limit) = minutes).
let toxDup = false, safeDup = false;
let toxMiss = 0, safeMiss = 0;
const MISS_LIMIT = 2000;
while (written < TARGET) {
  if (nTox <= nSafe) {
    if (genToxic(toxDup)) { nTox++; }
    else if (++toxMiss > MISS_LIMIT) { toxDup = true; }
  } else {
    if (genSafe(safeDup)) { nSafe++; }
    else if (++safeMiss > MISS_LIMIT) { safeDup = true; }
  }
  if (written % 100000 === 0 && written > 0) {
    process.stdout.write(`  ${written.toLocaleString()}...\r`);
  }
}
stream.end(() => {
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone: ${written.toLocaleString()} cases in ${dt}s`);
});
