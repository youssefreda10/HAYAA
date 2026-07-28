import os
import torch
import numpy as np
import pandas as pd
from transformers import AutoTokenizer, AutoModelForSequenceClassification, Trainer
from torch.utils.data import Dataset

OLD_TEST_PATH = "data/splits/test.parquet"
MODEL_DIR = "training/best_model_v2"
MAX_LENGTH = 128
SAMPLE_SIZE = 5000  # We'll sample 5k rows to make it fast

class HayaDataset(Dataset):
    def __init__(self, texts, tokenizer, max_length):
        self.texts = texts
        self.tokenizer = tokenizer
        self.max_length = max_length

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        encoding = self.tokenizer(
            self.texts[idx],
            max_length=self.max_length,
            padding="max_length",
            truncation=True,
            return_tensors="pt",
        )
        return {
            "input_ids": encoding["input_ids"].squeeze(),
            "attention_mask": encoding["attention_mask"].squeeze(),
        }

def main():
    print("Loading a random sample of Old Test Set...")
    df = pd.read_parquet(OLD_TEST_PATH).sample(n=SAMPLE_SIZE, random_state=42)
    texts = df["text"].tolist()
    labels = df["label"].tolist()

    print("Loading Model...")
    tokenizer = AutoTokenizer.from_pretrained("training/best_model")
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
    
    dataset = HayaDataset(texts, tokenizer, MAX_LENGTH)
    trainer = Trainer(model=model)
    
    print("Predicting...")
    preds_output = trainer.predict(dataset)
    preds = np.argmax(preds_output.predictions, axis=-1)
    
    df["prediction"] = preds
    df["label_name"] = df["label"].map({0: "Safe", 1: "Toxic"})
    df["pred_name"] = df["prediction"].map({0: "Safe", 1: "Toxic"})
    
    # Find errors
    errors = df[df["label"] != df["prediction"]].copy()
    
    false_positives = errors[(errors["label"] == 0) & (errors["prediction"] == 1)]
    false_negatives = errors[(errors["label"] == 1) & (errors["prediction"] == 0)]
    
    print(f"\nOut of {SAMPLE_SIZE} samples, found {len(errors)} errors.")
    print(f"Model said Toxic, but Label is Safe (False Positives): {len(false_positives)}")
    print(f"Model said Safe, but Label is Toxic (False Negatives): {len(false_negatives)}\n")
    
    os.makedirs("reports", exist_ok=True)
    errors.to_csv("reports/error_analysis.csv", index=False)
    
    print("--- 5 RANDOM FALSE POSITIVES (Model: Toxic | True Label: Safe) ---")
    for _, row in false_positives.sample(min(5, len(false_positives)), random_state=1).iterrows():
        print(f"TEXT: {row['text']}\n")
        
    print("--- 5 RANDOM FALSE NEGATIVES (Model: Safe | True Label: Toxic) ---")
    for _, row in false_negatives.sample(min(5, len(false_negatives)), random_state=1).iterrows():
        print(f"TEXT: {row['text']}\n")

if __name__ == "__main__":
    main()
