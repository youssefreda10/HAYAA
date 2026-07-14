"""
Hayā — FULL-SYSTEM stress runner (the whole pipeline, model included).

For every case in suite_stress.jsonl:
  1. Node runs Layer 1 (dictionary) + Layer 1.5 (obfuscation resolver).
     If either fires → predicted TOXIC (no model call needed).
  2. Everything that survives Layer 1/1.5 is scored by the MODEL
     (MARBERTv2, fp16, GPU batches) on the clean-normalized text.
  final prediction = L1_or_L1.5_hit OR (model_p >= THRESHOLD)

Reports precision / recall / accuracy overall and broken down by
dialect, category, and obfuscation type — so every gap is attributable.

Usage: python tests/run_stress_full.py [threshold]
"""
import sys, os, json, subprocess, time
import torch
from collections import defaultdict
from transformers import AutoTokenizer, AutoModelForSequenceClassification

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
SUITE = os.path.join(HERE, "suite_stress.jsonl")
THRESHOLD = float(sys.argv[1]) if len(sys.argv) > 1 else 0.75
MODEL_DIR = os.path.join(ROOT, "training", "best_model")
BATCH = 512

# ── Layer 1 + 1.5 in Node, streamed over stdin/stdout as JSONL ──────────
NODE = r"""
const readline = require("readline");
const fs = require("fs"), path = require("path");
const LIB = path.join(process.cwd(), "extension", "lib");
["unicode_sanitizer","homoglyph_normalizer","emoji_analyzer","normalizer","morphology_expander","dictionary","matcher","obfuscation_resolver"]
  .forEach(f => { global.eval(fs.readFileSync(path.join(LIB, f + ".js"), "utf8")); });
const D = HayaDictionary;
const wg = {exact:D.words, contextual:D.contextual, pejorative:D.pejorative, partial:new Set(), regex:D.patterns, allow:new Set()};
const matchFn = t => HayaMatcher.check(HayaMorphologyExpander.expand(t), wg);
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line) return;
  const c = JSON.parse(line);
  const t = c.text;
  // Layer 0.2 emoji
  const em = HayaEmojiAnalyzer.analyze(t);
  let hit = false, layer = "-";
  let text = t;
  if (em.isToxic) { hit = true; layer = "emoji"; }
  if (em.extractedText) text += " " + em.extractedText;
  const norm = HayaNormalizer.normalize(text);
  if (!hit && norm && matchFn(norm)) { hit = true; layer = "dict"; }
  if (!hit && norm && HayaObfuscationResolver.resolveViaDictionary(norm, matchFn)) { hit = true; layer = "resolver"; }
  // clean text for the model (only needed if not already a hit)
  process.stdout.write(JSON.stringify({
    expected: c.expected, dialect: c.dialect, category: c.category, obf: c.obf,
    hit, layer, norm: hit ? "" : (norm || "")
  }) + "\n");
});
"""

def run_layers():
    """Stream the suite through Node; return list of per-case dicts."""
    print("Layer 1 + 1.5 (Node)…", flush=True)
    p = subprocess.Popen(["node", "-e", NODE], stdin=open(SUITE, "rb"),
                         stdout=subprocess.PIPE, cwd=ROOT)
    rows = []
    for line in p.stdout:
        rows.append(json.loads(line))
    p.wait()
    return rows

def main():
    if not os.path.exists(SUITE):
        sys.exit(f"Suite not found: {SUITE} — run generate_stress_suite.js first")

    t0 = time.time()
    rows = run_layers()
    n = len(rows)
    print(f"  {n:,} cases through rules in {time.time()-t0:.1f}s")

    # Model on the residual (everything the rules did not already catch)
    residual = [(i, r["norm"]) for i, r in enumerate(rows) if not r["hit"] and r["norm"]]
    print(f"Model scoring {len(residual):,} residual cases (fp16 GPU)…", flush=True)

    tok = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR, dtype=torch.float16).cuda().eval()

    t1 = time.time()
    with torch.inference_mode():
        for s in range(0, len(residual), BATCH):
            chunk = residual[s:s+BATCH]
            texts = [t for _, t in chunk]
            enc = tok(texts, return_tensors="pt", padding=True, truncation=True, max_length=64).to("cuda")
            probs = torch.softmax(model(**enc).logits, dim=-1)[:, 1].tolist()
            for (idx, _), p in zip(chunk, probs):
                rows[idx]["model_p"] = p
            if s % (BATCH*40) == 0:
                print(f"  {s:,}/{len(residual):,}\r", end="", flush=True)
    print(f"\n  model done in {time.time()-t1:.1f}s")

    # Final prediction + bucketed confusion counts
    overall = defaultdict(int)
    by = {"dialect": defaultdict(lambda: defaultdict(int)),
          "category": defaultdict(lambda: defaultdict(int)),
          "obf": defaultdict(lambda: defaultdict(int))}
    src = defaultdict(int)   # which layer produced each toxic prediction

    for r in rows:
        pred = 1 if (r["hit"] or r.get("model_p", 0.0) >= THRESHOLD) else 0
        exp = r["expected"]
        cell = "TP" if (pred and exp) else "TN" if (not pred and not exp) else "FP" if (pred and not exp) else "FN"
        overall[cell] += 1
        by["dialect"][r["dialect"]][cell] += 1
        by["category"][r["category"]][cell] += 1
        by["obf"][r["obf"]][cell] += 1
        if pred:
            src[r["layer"] if r["hit"] else "model"] += 1

    def metrics(c):
        tp, fp, tn, fn = c["TP"], c["FP"], c["TN"], c["FN"]
        rec = tp/(tp+fn) if tp+fn else 0
        prec = tp/(tp+fp) if tp+fp else 0
        acc = (tp+tn)/max(tp+fp+tn+fn, 1)
        return rec, prec, acc, tp+fp+tn+fn

    print("\n" + "="*72)
    print(f"  Hayā FULL-SYSTEM stress test — {n:,} cases, threshold {THRESHOLD}")
    print("="*72)
    rec, prec, acc, _ = metrics(overall)
    print(f"\nOVERALL:  recall {rec*100:.2f}%  |  precision {prec*100:.2f}%  |  accuracy {acc*100:.2f}%")
    print(f"          TP={overall['TP']:,} FP={overall['FP']:,} TN={overall['TN']:,} FN={overall['FN']:,}")
    print(f"\nToxic predictions by layer: " + "  ".join(f"{k}={v:,}" for k, v in sorted(src.items(), key=lambda x:-x[1])))

    for dim in ("dialect", "category", "obf"):
        print(f"\n{dim.upper()} BREAKDOWN (sorted by recall):")
        items = []
        for k, c in by[dim].items():
            rec, prec, acc, tot = metrics(c)
            items.append((rec, prec, k, tot, c))
        for rec, prec, k, tot, c in sorted(items):
            # precision only meaningful where there are safe cases
            pstr = f"prec {prec*100:5.1f}%" if (c["FP"]+c["TP"]) else "prec   —  "
            print(f"  {k:26} rec {rec*100:5.1f}%  {pstr}  (n={tot:,}, FN={c['FN']:,}, FP={c['FP']:,})")

    # Save machine-readable
    out = os.path.join(ROOT, "reports", "stress_full.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"overall": dict(overall), "threshold": THRESHOLD, "n": n,
                   "by": {d: {k: dict(v) for k, v in by[d].items()} for d in by},
                   "src": dict(src)}, f, ensure_ascii=False, indent=2)
    print(f"\nSaved → {out}")

if __name__ == "__main__":
    main()
