"""
FULL hybrid evaluation with the real model + the JS obfuscation_resolver
candidate generator (invoked via node), mirroring the shipped pipeline:

  dictionary(JS)  ->  model(clean_norm)  ->  model(each resolver candidate)
  final toxic = dictionary_hit OR max(model scores) >= 0.5

Measures recall on the evasion batch and false positives on innocent controls,
and reports how many extra model calls the candidates cost on innocent text.
"""
import sys, os, json, subprocess, torch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from transformers import AutoTokenizer, AutoModelForSequenceClassification

MODEL_DIR = "training/best_model"
tok = AutoTokenizer.from_pretrained(MODEL_DIR)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model.to(device).eval()

def p_toxic(text):
    if not text or not text.strip():
        return 0.0
    enc = tok(text, return_tensors="pt", truncation=True, max_length=128).to(device)
    with torch.no_grad():
        return torch.softmax(model(**enc).logits, dim=-1)[0][1].item()

# One node process to normalize + dict-check + generate candidates for a batch.
NODE = r"""
const fs=require("fs"),path=require("path"),LIB=path.join(process.cwd(),"extension","lib");
["unicode_sanitizer","homoglyph_normalizer","arabizi_transliterator","emoji_analyzer","normalizer","morphology_expander","dictionary","matcher","obfuscation_resolver"].forEach(f=>{global.eval(fs.readFileSync(path.join(LIB,f+".js"),"utf8"));});
const wg={exact:HayaDictionary.words,contextual:HayaDictionary.contextual,pejorative:HayaDictionary.pejorative,partial:new Set(),regex:HayaDictionary.patterns,allow:new Set()};
const matchFn=t=>HayaMatcher.check(HayaMorphologyExpander.expand(t),wg);
const inp=JSON.parse(fs.readFileSync(0,"utf8"));
const out=inp.map(t=>{
  const clean=HayaNormalizer.normalize(t);
  const dictHit=!!(clean&&matchFn(clean));
  // Layer 1.5: dictionary-filtered de-obfuscation (free, no model call)
  const resolved=dictHit?null:HayaObfuscationResolver.resolveViaDictionary(clean,matchFn);
  // Residual candidates for the model (tightly capped)
  const cands=(dictHit||resolved)?[]:HayaObfuscationResolver.modelCandidates(clean);
  return {clean, dictHit, resolved, cands};
});
process.stdout.write(JSON.stringify(out));
"""

def analyze_batch(texts):
    p = subprocess.run(["node","-e",NODE], input=json.dumps(texts).encode("utf-8"),
                       capture_output=True, cwd=os.path.join(os.path.dirname(__file__),".."))
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode("utf-8"))
    return json.loads(p.stdout.decode("utf-8"))

def hybrid(texts):
    """Full cascade: dict -> resolver(free) -> model(clean) -> model(candidates)."""
    meta = analyze_batch(texts)
    results = []
    extra_calls = 0
    for t, m in zip(texts, meta):
        if m["dictHit"]:
            results.append((1, 1.0, "dict", 0)); continue
        if m["resolved"]:
            results.append((1, 1.0, "resolver:" + m["resolved"], 0)); continue
        best = p_toxic(m["clean"]); source = "model_clean"; calls = 0
        for c in m["cands"]:
            calls += 1
            s = p_toxic(c)
            if s > best:
                best = s; source = "model_cand:" + c
        extra_calls += calls
        results.append((1 if best >= 0.5 else 0, best, source, calls))
    return results, extra_calls

BATCH = ["خخخخخخخخخ","كىىىمك","قحبنه","كىىىخت البصُان","شرمطه","منيكه","منيك","كحبة",
"منتاك","ظوبر","عير","اير","يحُول","كىىىىم الضحك","منتاك اخت العيشة","طبون امك",
"ترمة","است","جرار","كسخت اليهود","كىىىم ميسي","كىىىمين ام ميسي","ك.س.م ميسي","ك$م ميسي"]
INNOCENT = ["يحول المبلغ","الجرار في المزرعة","كسر الزجاج","است اذن استاذي",
"قحط ومجاعة","شرطه المرور","منتج جديد","عيره من الذهب","صباح الخير يا جماعة",
"الحمد لله رب العالمين","الطالب في الفصل","كتب الدرس بخط جميل","الشرطة نظمت المرور",
"عمل رائع يا بطل","المدرسة تفتح صباحا","احب القراءة كثيرا"]

def run(name, items, want):
    res, extra = hybrid(items)
    hit = sum(1 for (lab,_,_,_) in res if lab==want)
    print(f"\n=== {name} (want toxic={want==1}) — extra model calls: {extra} ===")
    for t,(lab,p,src,calls) in zip(items,res):
        mark = "TOXIC" if lab else "safe "
        print(f"  {mark} p={p:.2f} [{src[:28]}] | {t}")
    print(f"  correct: {hit}/{len(items)}")
    return hit, len(items)

th,tn = run("TOXIC evasions", BATCH, 1)
ih,ic = run("INNOCENT controls", INNOCENT, 0)
print(f"\nSUMMARY: recall {th}/{tn} = {th/tn*100:.0f}% | innocent kept safe {ih}/{ic} = {ih/ic*100:.0f}%")
