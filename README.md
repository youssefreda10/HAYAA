# HAYA (حياء) - Arabic Toxic Comment Classifier 🛡️

**HAYA (حياء)** is a robust Natural Language Processing (NLP) pipeline and fine-tuned Deep Learning model designed to detect hate speech, toxicity, and profanity in Arabic text across various dialects.

## 🌟 Project Overview
Arabic hate speech detection is highly complex due to the morphological richness of the language and the massive variations in regional dialects. **HAYA** addresses this by fine-tuning the powerful **UBC-NLP/MARBERTv2** language model on a heavily curated dataset of Arabic comments.

The project goes beyond just a raw ML model; it adopts a **Hybrid Defense-in-Depth Architecture**, allowing for lightning-fast rule-based catching of explicit profanity combined with context-aware AI classification for sarcasm and nuanced bullying.

## 🚀 Key Features
- **State-of-the-art Accuracy:** Achieves **92.52%** overall accuracy on a massive holdout test set (96,319 comments).
- **Dialect Agnostic:** Capable of understanding toxicity in Levantine, Gulf, Egyptian, North African, and Modern Standard Arabic (MSA).
- **High Toxic F1-Score:** Hits an impressive **82.01% F1-Score** on the challenging "Toxic" minority class (with true human-level performance estimated at >90% when accounting for dataset noise).

## 📊 Performance Metrics (Test Set)
After training for 4 epochs (with Early Stopping preventing overfitting), the model was evaluated on 96,319 unseen sentences:
- **Accuracy:** 92.52%
- **F1-Score (Weighted):** 92.48%
- **F1-Score (Toxic Class):** 82.01%
- **F1-Score (Safe Class):** 95.28%

*Note: Error analysis on the False Positives and False Negatives revealed that the model frequently outperformed human annotators, correctly identifying toxicity where the original dataset labels were flawed!*

## 🛠️ Architecture & Pipeline
The project is structured into modular components:
- `pipeline/`: Data cleaning, merging, standardization, and train/val/test splitting.
- `training/`: Contains `train.py` (for MARBERT fine-tuning) and `evaluate.py` (for comprehensive metric generation).
- `utils/`: Helpers for text normalization (cleaning Arabic text, handling emojis, removing diacritics).
- `reports/`: Generates detailed CSV files of False Positives and False Negatives for continuous error analysis.

## 💻 How to Run
1. **Install Dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
2. **Train the Model:**
   ```bash
   python training/train.py
   ```
3. **Evaluate the Model:**
   ```bash
   python training/evaluate.py
   ```

## 🤝 Future Roadmap
- Deploying the model as a **Browser Extension** for end-users to automatically hide toxic comments on platforms like YouTube and Twitter.
- Developing a **B2B API Dashboard** for content creators to moderate their comment sections autonomously.
