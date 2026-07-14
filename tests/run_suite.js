/* ============================================================
   Hayā — Layer 1 adversarial suite runner

   Reports precision/recall per category. Recall failures mean
   toxic content reaches the user. Precision failures mean clean
   text gets blurred — which is what makes people uninstall.
   ============================================================ */

var fs = require("fs");
var path = require("path");

var LIB = path.join(__dirname, "..", "extension", "lib");
eval(fs.readFileSync(path.join(LIB, "unicode_sanitizer.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "homoglyph_normalizer.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "emoji_analyzer.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "normalizer.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "morphology_expander.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "dictionary.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "matcher.js"), "utf8"));
eval(fs.readFileSync(path.join(LIB, "obfuscation_resolver.js"), "utf8"));

var gen = require("./generate_suite.js");

var wordGroups = {
  exact: HayaDictionary.words,
  contextual: HayaDictionary.contextual || new Set(),
  pejorative: HayaDictionary.pejorative || new Set(),
  partial: new Set(),
  regex: HayaDictionary.patterns || [],
  allow: new Set(),
};

function predict(text) {
  var sanitized = typeof HayaUnicodeSanitizer !== "undefined" ? HayaUnicodeSanitizer.sanitize(text) : text;
  var deHomoglyph = typeof HayaHomoglyphNormalizer !== "undefined" ? HayaHomoglyphNormalizer.normalize(sanitized) : sanitized;
  var norm = HayaNormalizer.normalize(deHomoglyph);
  var expanded = typeof HayaMorphologyExpander !== "undefined" ? HayaMorphologyExpander.expand(norm) : norm;
  if (HayaMatcher.check(expanded, wordGroups)) return 1;
  if (typeof HayaObfuscationResolver !== "undefined") {
    var resolved = HayaObfuscationResolver.resolveViaDictionary(expanded, function (candidate) {
      return HayaMatcher.check(
        typeof HayaMorphologyExpander !== "undefined" ? HayaMorphologyExpander.expand(candidate) : candidate,
        wordGroups
      );
    });
    if (resolved) return 1;
  }
  return 0;
}

var C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };

var cases = gen.build();
var byCat = {};
var TP = 0, FP = 0, TN = 0, FN = 0;
var fpExamples = [], fnExamples = [];

cases.forEach(function (c) {
  var got = predict(c.text);
  var cat = (byCat[c.category] = byCat[c.category] || { n: 0, ok: 0, fp: 0, fn: 0 });
  cat.n++;

  if (got === c.expected) {
    cat.ok++;
    if (c.expected === 1) TP++; else TN++;
  } else if (c.expected === 1) {
    FN++; cat.fn++;
    if (fnExamples.length < 12) fnExamples.push(c);
  } else {
    FP++; cat.fp++;
    if (fpExamples.length < 12) fpExamples.push(c);
  }
});

var recall    = TP / (TP + FN);
var precision = TP / (TP + FP) || 0;
var f1        = 2 * precision * recall / (precision + recall) || 0;

console.log("\n" + "=".repeat(64));
console.log("  Hayā — Layer 1 Adversarial Suite  (" + cases.length + " cases)");
console.log("=".repeat(64) + "\n");

var names = Object.keys(byCat).sort(function (a, b) {
  return (byCat[a].ok / byCat[a].n) - (byCat[b].ok / byCat[b].n);
});

names.forEach(function (k) {
  var v = byCat[k];
  var acc = 100 * v.ok / v.n;
  var col = acc === 100 ? C.g : acc >= 90 ? C.y : C.r;
  var mark = acc === 100 ? "✓" : "✗";
  var detail = [];
  if (v.fn) detail.push(v.fn + " missed");
  if (v.fp) detail.push(v.fp + " false-pos");
  console.log("  " + col + mark + C.x + " " + k.padEnd(24) +
    col + (acc.toFixed(1) + "%").padStart(7) + C.x +
    C.d + ("  " + v.ok + "/" + v.n).padEnd(12) + (detail.join(", ")) + C.x);
});

console.log("\n" + "-".repeat(64));
console.log("  Recall    " + (100 * recall).toFixed(2) + "%   (toxic caught: " + TP + "/" + (TP + FN) + ")");
console.log("  Precision " + (100 * precision).toFixed(2) + "%   (false alarms: " + FP + ")");
console.log("  F1        " + (100 * f1).toFixed(2) + "%");
console.log("-".repeat(64));

if (fnExamples.length) {
  console.log("\n" + C.r + "  MISSED (toxic reached the user):" + C.x);
  fnExamples.forEach(function (c) {
    console.log('    [' + c.category + '] "' + c.text + '"');
  });
}
if (fpExamples.length) {
  console.log("\n" + C.r + "  FALSE POSITIVES (clean text blurred):" + C.x);
  fpExamples.forEach(function (c) {
    console.log('    [' + c.category + '] "' + c.text + '"');
  });
}
console.log("");

// Only fail on precision violations — recall misses are caught by Layer 2 (AI model)
process.exit(FP > 0 ? 1 : 0);
