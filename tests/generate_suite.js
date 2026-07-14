/* ============================================================
   Hayā — Adversarial Suite Generator (in-memory)

   Builds ~2000 cases from seeds × morphology × obfuscation.
   Returns an array of {text, expected, category} for run_suite.js.
   ============================================================ */

const { TOXIC, SAFE, CONTEXTUAL } = require("./seeds.js");

// mulberry32 — deterministic RNG so results are reproducible.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var rand = rng(42);
var pick = function (arr) { return arr[Math.floor(rand() * arr.length)]; };

var OBF = [
  ["plain", function (w) { return w; }],
  ["dots", function (w) { return w.split("").join("."); }],
  ["spaces", function (w) { return w.split("").join(" "); }],
  ["elongate", function (w) { return w.replace(/(.)/, "$1$1$1$1"); }],
  ["tatweel", function (w) { return w.split("").join("ـ"); }],
  ["diacritics", function (w) { return w.split("").join("َ"); }],
  ["alefswap", function (w) { return w.replace(/ا/g, "أ"); }],
  ["tamarbuta", function (w) { return w.replace(/ه$/, "ة"); }],
];

var MORPH = [
  ["bare", function (w) { return w; }],
  ["al", function (w) { return "ال" + w; }],
  ["wa", function (w) { return "و" + w; }],
  ["waal", function (w) { return "وال" + w; }],
  ["bial", function (w) { return "بال" + w; }],
  ["poss_k", function (w) { return w + "ك"; }],
  ["poss_hm", function (w) { return w + "هم"; }],
  ["plural_in", function (w) { return w + "ين"; }],
];

var CARRIERS = [
  function (w) { return w; },
  function (w) { return "يا " + w; },
  function (w) { return "انت " + w; },
  function (w) { return "والله " + w + " بجد"; },
];

var SAFE_FRAMES = [
  function (t) { return t; },
  function (t) { return "والله " + t; },
  function (t) { return t + " يا جماعة"; },
];

var SAFE_CONTEXT_FRAMES = [
  function (w) { return "ال" + w + " موجود هنا"; },
  function (w) { return "شفت ال" + w + " امبارح"; },
  function (w) { return "ال" + w + " ده كبير"; },
  function (w) { return w + " كلمة عادية"; },
];

function build() {
  var cases = [];
  var seen = new Set();

  function add(text, expected, category) {
    if (!text) return;
    var key = expected + "|" + text;
    if (seen.has(key)) return;
    seen.add(key);
    cases.push({ text: text, expected: expected, category: category });
  }

  // Toxic cases from seeds
  for (var dialect in TOXIC) {
    var cats = TOXIC[dialect];
    for (var cat in cats) {
      var words = cats[cat];
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var label = dialect + "/" + cat;
        // Plain
        add(w, 1, label);
        // With carrier
        add(pick(CARRIERS)(w), 1, label);
        // With morphology
        var m = pick(MORPH);
        add(m[1](w), 1, label);
        // With obfuscation
        var o = pick(OBF.slice(1));
        add(o[1](w), 1, label);
        // Morphology + obfuscation
        add(o[1](m[1](w)), 1, label);
      }
    }
  }

  // Safe cases from seeds
  for (var safeCat in SAFE) {
    var items = SAFE[safeCat];
    for (var j = 0; j < items.length; j++) {
      var t = items[j];
      add(t, 0, safeCat);
      add(pick(SAFE_FRAMES)(t), 0, safeCat);
      // Safe cases with obfuscation must stay safe
      var so = pick(OBF.slice(1));
      add(so[1](t), 0, safeCat);
    }
  }

  // Contextual words undirected = safe
  for (var k = 0; k < CONTEXTUAL.length; k++) {
    var cw = CONTEXTUAL[k];
    for (var f = 0; f < SAFE_CONTEXT_FRAMES.length; f++) {
      add(SAFE_CONTEXT_FRAMES[f](cw), 0, "Contextual_Undirected");
    }
  }

  return cases;
}

module.exports = { build: build };
