"""
Ceiling analysis: run the FULL system (rules + model) on the stress suite,
and for every FALSE NEGATIVE classify the cause so we know whether we've hit
the model's ceiling or there is still rule headroom.

Miss buckets:
  RULE_HEADROOM  — plain (un-obfuscated) text the dictionary could catch with
                   more coverage (the clean-normalized token is a near-miss)
  MODEL_CEILING  — obfuscated OR implicit text: rules structurally can't, and
                   the model scored it < threshold. This is the real limit.
"""
import sys, os, json, subprocess, time
import torch
from collections import defaultdict
from transformers import AutoTokenizer, AutoModelForSequenceClassification

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..")
SUITE = os.path.join(HERE, "suite_stress.jsonl")
THRESHOLD = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5
MODEL_DIR = os.path.join(ROOT, "training", "best_model")
BATCH = 512

# Node emits, per case: whether rules fired, the clean norm, and whether the
# case was obfuscated (obf != plain) so we can bucket misses.
NODE = r"""
const readline=require("readline"),fs=require("fs"),path=require("path");
const LIB=path.join(process.cwd(),"extension","lib");
["unicode_sanitizer","homoglyph_normalizer","emoji_analyzer","normalizer","morphology_expander","dictionary","matcher","obfuscation_resolver"].forEach(f=>{global.eval(fs.readFileSync(path.join(LIB,f+".js"),"utf8"));});
const D=HayaDictionary;
const wg={exact:D.words,contextual:D.contextual,pejorative:D.pejorative,partial:new Set(),regex:D.patterns,allow:new Set()};
const m=t=>HayaMatcher.check(HayaMorphologyExpander.expand(t),wg);
const rl=readline.createInterface({input:process.stdin});
rl.on("line",(line)=>{
  if(!line)return;
  const c=JSON.parse(line);
  let text=c.text;
  const em=HayaEmojiAnalyzer.analyze(text);
  let hit=false;
  if(em.isToxic)hit=true;
  if(em.extractedText)text+=" "+em.extractedText;
  const norm=HayaNormalizer.normalize(text);
  if(!hit&&norm&&m(norm))hit=true;
  if(!hit&&norm&&HayaObfuscationResolver.resolveViaDictionary(norm,m))hit=true;
  process.stdout.write(JSON.stringify({e:c.expected,cat:c.category,dia:c.dialect,obf:c.obf,hit,norm:hit?"":(norm||"")})+"\n");
});
"""

def run_nodes():
    p=subprocess.Popen(["node","-e",NODE],stdin=open(SUITE,"rb"),stdout=subprocess.PIPE,cwd=ROOT)
    rows=[json.loads(l) for l in p.stdout]; p.wait(); return rows

def main():
    t0=time.time()
    rows=run_nodes()
    print(f"rules done: {len(rows):,} cases in {time.time()-t0:.1f}s")

    residual=[(i,r["norm"]) for i,r in enumerate(rows) if not r["hit"] and r["norm"]]
    tok=AutoTokenizer.from_pretrained(MODEL_DIR)
    model=AutoModelForSequenceClassification.from_pretrained(MODEL_DIR,dtype=torch.float16).cuda().eval()
    print(f"model scoring {len(residual):,} residual…")
    with torch.inference_mode():
        for s in range(0,len(residual),BATCH):
            chunk=residual[s:s+BATCH]
            enc=tok([t for _,t in chunk],return_tensors="pt",padding=True,truncation=True,max_length=64).to("cuda")
            probs=torch.softmax(model(**enc).logits,dim=-1)[:,1].tolist()
            for (idx,_),p in zip(chunk,probs): rows[idx]["mp"]=p

    # Per-category recall + miss buckets
    cat=defaultdict(lambda:{"tot":0,"caught":0,"rule_hr":0,"model_ceil":0})
    for r in rows:
        if r["e"]!=1: continue
        c=r["cat"]; cat[c]["tot"]+=1
        pred = r["hit"] or r.get("mp",0.0)>=THRESHOLD
        if pred: cat[c]["caught"]+=1; continue
        # a miss: classify
        if r["obf"]=="plain" and not r["hit"]:
            # plain text the model still missed → mostly rule headroom (dict gap)
            cat[c]["rule_hr"]+=1
        else:
            cat[c]["model_ceil"]+=1

    print("\n"+"="*78)
    print(f"  PER-CATEGORY CEILING ANALYSIS  (threshold {THRESHOLD})")
    print("="*78)
    print(f"{'category':22} {'recall':>7}  {'miss:rule-fixable':>18}  {'miss:model-ceiling':>19}")
    tot_hr=tot_mc=0
    for c in sorted(cat, key=lambda k: cat[k]["caught"]/max(cat[k]["tot"],1)):
        s=cat[c]; rec=s["caught"]/max(s["tot"],1)*100
        tot_hr+=s["rule_hr"]; tot_mc+=s["model_ceil"]
        print(f"{c:22} {rec:6.1f}%  {s['rule_hr']:>18,}  {s['model_ceil']:>19,}")
    print("-"*78)
    print(f"{'TOTAL misses':22} {'':>7}  {tot_hr:>18,}  {tot_mc:>19,}")
    print(f"\nrule-fixable misses (plain text, dict gap): {tot_hr:,}")
    print(f"model-ceiling misses (obfuscated/implicit): {tot_mc:,}")

    # Sample the rule-fixable ones — these are the actionable gaps
    print("\nSAMPLE rule-fixable misses (plain toxic the dict missed):")
    shown=defaultdict(int)
    for r in rows:
        if r["e"]==1 and not r["hit"] and r.get("mp",0)<THRESHOLD and r["obf"]=="plain":
            if shown[r["cat"]]<3:
                shown[r["cat"]]+=1
                print(f"  [{r['cat']:16} {r['dia']:20}] {r['norm'][:45]}")

if __name__=="__main__":
    main()
