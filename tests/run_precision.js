/* ============================================================
   Hayā — Precision Runner (Layer 1, hard negatives)

   Runs the SAFE corpus through the full Layer-1 pipeline and
   reports the false-positive rate per category. Everything here
   is expected safe, so ANY hit is a precision failure.

   NOTE: This exercises Layer 1 (rules) ONLY. The AI model
   (Layer 2) is not invoked. A Layer-1 false positive is
   unrecoverable — the model never gets a veto — so precision
   here is a hard ceiling on the shipped product's precision.
   ============================================================ */

const fs = require("fs");
const path = require("path");
const LIB = path.join(__dirname, "..", "extension", "lib");

eval(fs.readFileSync(path.join(LIB, "unicode_sanitizer.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "homoglyph_normalizer.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "arabizi_transliterator.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "emoji_analyzer.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "normalizer.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "morphology_expander.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "dictionary.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "matcher.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "obfuscation_resolver.js"), "utf8"));

const wordGroups = {
  exact: HayaDictionary.words,
  contextual: HayaDictionary.contextual || new Set(),
  pejorative: HayaDictionary.pejorative || new Set(),
  partial: new Set(),
  regex: HayaDictionary.patterns || [],
  allow: new Set(),
};

function matchFn(t) {
  return HayaMatcher.check(HayaMorphologyExpander.expand(t), wordGroups);
}

function predict(text) {
  const e = HayaEmojiAnalyzer.analyze(text);
  if (e.isToxic) return 1;
  if (e.extractedText) text += " " + e.extractedText;
  const norm = HayaNormalizer.normalize(text);
  if (!norm) return 0;
  if (matchFn(norm)) return 1;                                   // Layer 1
  if (HayaObfuscationResolver.resolveViaDictionary(norm, matchFn)) return 1; // Layer 1.5
  return 0;
}

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", x: "\x1b[0m" };

const corpusPath = path.join(__dirname, "safe_corpus.json");
let cases;
if (fs.existsSync(corpusPath)) {
  cases = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
} else {
  cases = require("./safe_corpus.js").build();
}

const byCat = {};
const failures = [];
let fp = 0;
let acceptedHits = 0;

for (const c of cases) {
  const cat = c.category;
  const accepted = (c.flags || []).indexOf("accepted") !== -1;
  if (!byCat[cat]) byCat[cat] = { n: 0, fp: 0, accepted: accepted };
  byCat[cat].n++;
  if (predict(c.text) === 1) {
    byCat[cat].fp++;
    if (accepted) { acceptedHits++; }
    else { fp++; failures.push(c); }
  }
}

console.log("\n" + "=".repeat(64));
console.log(`  Hayā — Precision Test (hard negatives, Layer 1 only)`);
console.log("=".repeat(64));
const scored = cases.length - acceptedHits; // exclude accepted traps from the score
console.log(`\nTotal safe cases: ${cases.length}  (scored: ${scored}, accepted traps hit: ${acceptedHits})`);
const prec = (scored - fp) / scored;
const col = fp === 0 ? C.g : (prec >= 0.98 ? C.y : C.r);
console.log(`Specificity (stayed safe): ${col}${(prec * 100).toFixed(2)}%${C.x}`);
console.log(`False positives (real):    ${fp === 0 ? C.g : C.r}${fp}${C.x}`);

console.log(`\nBY CATEGORY:`);
Object.keys(byCat).sort((a, b) => byCat[b].fp - byCat[a].fp).forEach(cat => {
  const s = byCat[cat];
  const mark = s.fp === 0 ? C.g + "✓" + C.x : C.r + "✗" + C.x;
  console.log(`  ${mark} ${cat.padEnd(24)} ${s.n - s.fp}/${s.n} safe  (${s.fp} FP)`);
});

if (failures.length) {
  console.log(`\n${C.r}FALSE POSITIVES (${failures.length}):${C.x}`);
  for (const f of failures.slice(0, 60)) {
    console.log(`  [${f.category}] "${f.text}"  → norm: "${HayaNormalizer.normalize(f.text)}"`);
  }
  if (failures.length > 60) console.log(`  … and ${failures.length - 60} more`);
}
console.log("");
process.exitCode = fp === 0 ? 0 : 1;
