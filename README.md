# Hayā (حياء) — Arabic Toxic Content Moderation 🛡️

**Hayā** is an end-to-end Arabic content-moderation system: a fine-tuned deep-learning
model, a hybrid rule + neural detection pipeline, and a browser extension that blurs
toxic content in real time — built to protect people, especially children, from online
bullying, profanity, and hate across every major Arabic dialect.

---

## 🌟 Overview

Arabic toxicity detection is one of the hardest problems in NLP: rich morphology,
radically different dialects, and constant evasion of filters. Off-the-shelf tools fail
on Arabic — so Hayā was built from the ground up around it.

Hayā is **not** just a model. It is a **defense-in-depth pipeline** that combines
lightning-fast, context-aware rule matching for explicit profanity with a fine-tuned
**UBC-NLP/MARBERTv2** classifier for implicit toxicity and nuanced bullying.

### Every major dialect
Egyptian · Levantine (Syrian / Lebanese / Jordanian / Palestinian) · Gulf (Saudi /
Emirati / Kuwaiti …) · Maghrebi (Moroccan / Algerian / Tunisian) · Iraqi & Sudanese ·
Modern Standard Arabic.

### What it detects
Profanity & offensive language · hate speech · insults, harassment & cyberbullying ·
racism & religious hate · sexism & sexually explicit language · morphologically complex
and context-dependent expressions · intentional typos / obfuscation · plus custom,
user-defined filters.

---

## 🏗️ Architecture — Defense-in-Depth

Every piece of text passes through a layered pipeline. Cheap, instant layers run first;
the model is only consulted when the rules pass.

| Layer | Job |
|-------|-----|
| **L0 — Sanitize** | Unicode normalization, homoglyph folding (confusable scripts), and emoji analysis before anything is stripped |
| **L1 — Dictionary** | Instant, **context-aware** matching. Distinguishes descriptive use from a directed insult (e.g. "a bad decision" ≠ an insult aimed at a person) |
| **L1.5 — De-obfuscation** | Resolves masked/padded tokens (spaced or dotted evasions) and re-checks — only when an evasion signature is present, so clean text is never rewritten |
| **L2 — Model** | Fine-tuned MARBERTv2 scores the full comment for implicit toxicity and subtle bullying |

The rule layers are tuned for **100% precision (zero false positives)** on hundreds of
hard adversarial hard-negative cases, so clean text is never wrongly blurred.

---

## 🗂️ Data Pipeline

The hardest part of the project was the data, not the model.

- **Reviewed & collected 100+ public Arabic hate-speech / abuse datasets.**
- The raw data was noisy: every source used a different labeling scheme (3-class,
  5-class …), with duplicates and mislabeled examples.
- Standardized conflicting schemes into a single **binary** standard (Safe / Toxic),
  de-duplicated, removed flawed/duplicate sources, and cleaned annotations.
- Result: a clean corpus of **nearly 1 million comments, posts, and tweets** across
  social platforms and every dialect, split into train / validation / test.

See `data/Haya'_Dataset_Registry.*` for the full source registry and per-dataset notes.

---

## 🧠 The Model

Fine-tuned **UBC-NLP/MARBERTv2** for binary classification (Safe / Toxic):

- **~1M sentences**, `max_length=128`, weighted cross-entropy loss to handle class
  imbalance, warmup + weight decay, `fp16`, early stopping.
- Trained 4 epochs (early-stopped) on the curated corpus.

### Performance (held-out test set, 96,319 sentences)

| Metric | Score |
|--------|-------|
| Accuracy | **92.52%** |
| F1 (Weighted) | 92.48% |
| F1 (Toxic class) | **82.01%** |
| F1 (Safe class) | 95.28% |

> **Note on the numbers:** manual error analysis showed the model frequently
> *outperformed the original human annotations* — many counted "errors" were actually
> mislabels in the source datasets. Real-world performance on correctly-labeled data is
> therefore higher than the raw score suggests.

---

## 🧩 Browser Extension

The model ships as a **Chrome Extension (Manifest V3)** that runs the full pipeline on
any page:

- Blurs toxic comments / messages **in real time** as you browse.
- **PIN-protected parental controls** — a child cannot reveal hidden content or open the
  settings/event log without the PIN (PBKDF2, lockout throttling, per-page unlock).
- Works across sites and chats; per-domain enable/disable; custom word allow/block lists.
- Local rule layers run offline and instantly; the model is served by a serverless API.

---

## 📁 Repository Structure

```
extension/     Chrome extension (MV3): content script, background worker,
               popup, options, event log, and the JS detection pipeline (lib/)
pipeline/      Data standardization, merging, cleaning, and splitting
training/      train.py (MARBERT fine-tuning) + evaluate.py (metrics)
utils/         Arabic text normalization, label mapping, script detection
data/          Dataset registry, standardized sources, merged corpus, splits
reports/       Test results + false-positive / false-negative error analysis
tests/         Layer-1 precision & recall suites, adversarial corpora, manual demos
modal_api.py   Serverless inference API (Modal + FastAPI) serving the model
```

---

## 💻 How to Run

**Backend / model**
```bash
pip install -r requirements.txt

python training/train.py       # fine-tune MARBERTv2
python training/evaluate.py    # generate full metrics + error reports
modal deploy modal_api.py      # deploy the inference API (serverless)
```

**Extension**
1. Open `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. Browse any page with Arabic content — toxic text is blurred in real time.

**Tests**
```bash
npm test                 # Layer-1 adversarial suite (precision + recall)
npm run test:precision   # hard-negative precision (must stay 100%)
```

---

## 🔌 Reusable by Design

The model and pipeline are not locked into the extension. The same engine can be
integrated via API into social platforms, comment sections, kids' & EdTech apps, gaming
chat, and customer-support tooling — anywhere Arabic content moderation is needed.

---

## 🤝 Future Roadmap

- B2B moderation API / dashboard for creators and platforms.
- Firefox / Edge builds of the extension.
- Continuous error-analysis loop to keep raising real-world recall.

---

*Model weights and datasets are not committed to this repository (see `.gitignore`); the
model is hosted on the Hugging Face Hub.*
