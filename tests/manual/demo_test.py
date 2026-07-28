import sys
import torch
import warnings
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import logging

warnings.filterwarnings("ignore")
logging.getLogger("transformers").setLevel(logging.ERROR)

OLD_MODEL_DIR = "training/best_model"
NEW_MODEL_DIR = "training/best_model_v2"
MAX_LENGTH = 128

print("Loading Models...")
tokenizer = AutoTokenizer.from_pretrained(OLD_MODEL_DIR)
model_old = AutoModelForSequenceClassification.from_pretrained(OLD_MODEL_DIR)
model_new = AutoModelForSequenceClassification.from_pretrained(NEW_MODEL_DIR)

def predict(text, model):
    inputs = tokenizer(text, return_tensors="pt", max_length=MAX_LENGTH, padding="max_length", truncation=True)
    with torch.no_grad():
        logits = model(**inputs).logits
        probs = torch.nn.functional.softmax(logits, dim=1)
        pred = torch.argmax(logits, dim=1).item()
        confidence = probs[0][pred].item()
    return "Toxic 🤬" if pred == 1 else "Safe 🟢", confidence

test_sentences = [
    "يا اخي روح الله يسامحك", # Safe
    "والله مافي مشكله ولا مصيبه الا وراها مره ،، اسكتي بس", # Sexism
    "شكلهم زي القرود في الملعب", # Racism
    "الوزير صرح بتصريحات قوية النهارده", # Safe news
    "لا يفلح قوم ولوا امرهم امراة", # Sexism
    "إنت إنسان غبي ومبتفهمش حاجة" # Direct insult
]

print("\n" + "="*60)
print(f"{'TEXT':<50} | {'OLD MODEL':<12} | {'NEW MODEL':<12}")
print("="*60)

for text in test_sentences:
    old_pred, _ = predict(text, model_old)
    new_pred, _ = predict(text, model_new)
    
    # Just to align text in terminal
    short_text = text if len(text) <= 47 else text[:44] + "..."
    print(f"{short_text:<47} | {old_pred:<12} | {new_pred:<12}")
