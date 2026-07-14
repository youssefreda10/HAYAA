"""
Hybrid cascade test: rules generate repair candidates, model scores each,
MAX toxicity wins. Measures the full preprocess+candidates -> model design
against raw->model, and checks it does NOT break the innocent controls.
"""
import sys, os, re, torch
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from utils.arabic_normalizer import normalize_arabic

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

# --- rule-based candidate generators (no dictionary, purely structural) ---
CONF = {  # confusion pairs, both directions (subset from AraSpell + Arabic phonetics)
    'ا':'ع','ع':'ا','ط':'ت','ت':'ط','ذ':'ز','ز':'ذ','ث':'س','س':'ث',
    'ض':'ظ','ظ':'ض','ص':'س','ق':'ك','ك':'ق','ه':'ة','ة':'ه',
}
FILLER = 'ىي'  # chars used as vowel-fillers mid word

def strip_fillers(w):
    # collapse medial long-vowel fillers: كىىىم -> كم / كسم ambiguous -> also yield removal
    return re.sub(r'[ىي]{2,}', '', w)

def candidates(word):
    outs = {word}
    # 1. remove medial filler runs
    outs.add(strip_fillers(word))
    # 2. single confusion substitution at each position
    for i,ch in enumerate(word):
        if ch in CONF:
            outs.add(word[:i]+CONF[ch]+word[i+1:])
    # 3. adjacent transposition
    for i in range(len(word)-1):
        outs.add(word[:i]+word[i+1]+word[i]+word[i+2:])
    # 4. delete one char (handles inserted letters)
    for i in range(len(word)):
        if len(word) > 2:
            outs.add(word[:i]+word[i+1:])
    return {o for o in outs if o}

def hybrid_score(text):
    norm = normalize_arabic(text)
    best = p_toxic(norm)
    words = norm.split()
    for i,w in enumerate(words):
        for cand in candidates(w):
            if cand == w: continue
            trial = words.copy(); trial[i] = cand
            best = max(best, p_toxic(' '.join(trial)))
    return best

BATCH = ["خخخخخخخخخ","كىىىمك","قحبنه","كىىىخت البصُان","شرمطه","منيكه","منيك","كحبة",
"منتاك","ظوبر","عير","اير","يحُول","كىىىىم الضحك","منتاك اخت العيشة","طبون امك",
"ترمة","است","جرار","كسخت اليهود","كىىىم ميسي","كىىىمين ام ميسي","ك.س.م ميسي","ك$م ميسي"]
INNOCENT = ["يحول المبلغ","الجرار في المزرعة","كسر الزجاج","است اذن استاذي",
"قحط ومجاعة","شرطه المرور","منتج جديد","عيره من الذهب","صباح الخير","الحمد لله",
"الطالب في الفصل","كتب الدرس","الشرطة نظمت المرور","عمل رائع يا بطل"]

def run(name, items, want):
    hit=0
    print(f"\n=== {name} (want toxic={want==1}) ===")
    for t in items:
        s = hybrid_score(t)
        lab = 1 if s>=0.5 else 0
        hit += (lab==want)
        print(f"  {'TOXIC' if lab else 'safe ':5} p={s:.2f} | {t}")
    print(f"  correct: {hit}/{len(items)}")
    return hit

run("TOXIC evasions", BATCH, 1)
run("INNOCENT controls", INNOCENT, 0)
