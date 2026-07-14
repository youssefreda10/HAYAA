"""
Hybrid thesis test: does the MARBERTv2 model catch obfuscated toxicity BETTER
when the rule layer normalizes the text first?

Compares model prediction on:
  (A) raw evasion text
  (B) Python-normalized text (existing utils/arabic_normalizer.py)
This is the evidence for a preprocess->model hybrid vs the current raw->model path.
"""
import sys, os, torch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from utils.arabic_normalizer import normalize_arabic

MODEL_DIR = "training/best_model"
tok = AutoTokenizer.from_pretrained(MODEL_DIR)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model.to(device).eval()

def predict(text):
    if not text or not text.strip():
        return 0, 0.0
    enc = tok(text, return_tensors="pt", truncation=True, max_length=128).to(device)
    with torch.no_grad():
        probs = torch.softmax(model(**enc).logits, dim=-1)[0]
    p = probs[1].item()
    return (1 if p >= 0.5 else 0), p

BATCH = ["خخخخخخخخخ","كىىىمك","قحبنه","كىىىخت البصُان","شرمطه","منيكه","منيك","كحبة",
"منتاك","ظوبر","عير","اير","يحُول","كىىىىم الضحك","منتاك اخت العيشة","طبون امك",
"ترمة","است","جرار","كسخت اليهود","كىىىم ميسي","كىىىمين ام ميسي","ك.س.م ميسي","ك$م ميسي"]

INNOCENT = ["يحول المبلغ","الجرار في المزرعة","كسر الزجاج","است اذن استاذي",
"قحط ومجاعة","شرطه المرور","منتج جديد","عيره من الذهب","صباح الخير","الحمد لله"]

def run(name, items, want):
    raw_hit = norm_hit = 0
    print(f"\n=== {name} (want label={want}) ===")
    print(f"{'raw':>4} {'norm':>4}  {'p_raw':>6} {'p_norm':>6} | text -> normalized")
    for t in items:
        rl, rp = predict(t)
        n = normalize_arabic(t)
        nl, np_ = predict(n)
        raw_hit += (rl == want)
        norm_hit += (nl == want)
        flag = "" if rl == nl else ("  <== FLIP" if nl == want else "  <== worse")
        print(f"{rl:>4} {nl:>4}  {rp:>6.2f} {np_:>6.2f} | {t}  ->  {n}{flag}")
    print(f"  RAW correct : {raw_hit}/{len(items)}")
    print(f"  NORM correct: {norm_hit}/{len(items)}")

run("TOXIC evasions", BATCH, 1)
run("INNOCENT controls", INNOCENT, 0)
