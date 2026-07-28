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

print("Loading Old Model...")
tokenizer_old = AutoTokenizer.from_pretrained(OLD_MODEL_DIR)
model_old = AutoModelForSequenceClassification.from_pretrained(OLD_MODEL_DIR)

print("Loading New Model...")
tokenizer_new = AutoTokenizer.from_pretrained(OLD_MODEL_DIR) # Tokenizer is the same
model_new = AutoModelForSequenceClassification.from_pretrained(NEW_MODEL_DIR)

def predict(text, model, tokenizer):
    inputs = tokenizer(text, return_tensors="pt", max_length=MAX_LENGTH, padding="max_length", truncation=True)
    with torch.no_grad():
        logits = model(**inputs).logits
        probs = torch.nn.functional.softmax(logits, dim=1)
        pred = torch.argmax(logits, dim=1).item()
        confidence = probs[0][pred].item()
    
    label = "Toxic 🤬" if pred == 1 else "Safe 🟢"
    return label, confidence

print("\n" + "="*50)
print("🧠 HAYA Model Tester (Old vs New)")
print("="*50)
print("Type 'exit' to quit.\n")

while True:
    try:
        text = input("Enter a sentence in Arabic: ")
        if text.strip().lower() == 'exit':
            break
        if not text.strip():
            continue
            
        old_pred, old_conf = predict(text, model_old, tokenizer_old)
        new_pred, new_conf = predict(text, model_new, tokenizer_new)
        
        print(f"\n--- Results ---")
        print(f"Old Model: {old_pred} (Confidence: {old_conf:.2%})")
        print(f"New Model: {new_pred} (Confidence: {new_conf:.2%})")
        print("-"*15 + "\n")
        
    except KeyboardInterrupt:
        break
