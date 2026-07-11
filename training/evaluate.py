"""
HAYA Evaluation Script — Run on Test Set after training
"""
import os
import json
import numpy as np
import pandas as pd
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from torch.utils.data import Dataset, DataLoader
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    accuracy_score,
)

MODEL_DIR = "training/best_model"
TEST_PATH = "data/splits/test.parquet"
MAX_LENGTH = 128
BATCH_SIZE = 32


class HayaDataset(Dataset):
    def __init__(self, texts, labels, tokenizer, max_length):
        self.texts = texts
        self.labels = labels
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
            "labels": torch.tensor(self.labels[idx], dtype=torch.long),
        }


def main():
    print("=" * 60)
    print("HAYA Evaluation — Test Set")
    print("=" * 60)

    # Load model
    print("\nLoading model...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_DIR)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    model.eval()
    print(f"  Device: {device}")

    # Load test data
    print("Loading test data...")
    test_df = pd.read_parquet(TEST_PATH)
    texts = test_df["text"].tolist()
    labels = test_df["label"].tolist()
    print(f"  Test rows: {len(texts):,}")

    # Predict
    print("Running predictions...")
    dataset = HayaDataset(texts, labels, tokenizer, MAX_LENGTH)
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=False)

    all_preds = []
    all_probs = []
    with torch.no_grad():
        for batch in loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            probs = torch.softmax(outputs.logits, dim=-1)
            preds = torch.argmax(probs, dim=-1)
            all_preds.extend(preds.cpu().numpy())
            all_probs.extend(probs.cpu().numpy())

    preds = np.array(all_preds)
    probs = np.array(all_probs)

    # Metrics
    print("\n" + "=" * 60)
    print("RESULTS")
    print("=" * 60)

    print(f"\nAccuracy: {accuracy_score(labels, preds):.4f}")
    print(f"F1 (weighted): {f1_score(labels, preds, average='weighted'):.4f}")
    print(f"F1 (Toxic): {f1_score(labels, preds, pos_label=1):.4f}")
    print(f"F1 (Safe): {f1_score(labels, preds, pos_label=0):.4f}")
    print(f"Precision (weighted): {precision_score(labels, preds, average='weighted'):.4f}")
    print(f"Recall (weighted): {recall_score(labels, preds, average='weighted'):.4f}")

    print("\nClassification Report:")
    print(classification_report(labels, preds, target_names=["Safe", "Toxic"]))

    cm = confusion_matrix(labels, preds)
    print(f"Confusion Matrix:")
    print(f"               Predicted")
    print(f"              Safe    Toxic")
    print(f"  Actual Safe:  {cm[0][0]:>6,}  {cm[0][1]:>6,}")
    print(f"  Actual Toxic: {cm[1][0]:>6,}  {cm[1][1]:>6,}")

    # Error analysis — save wrong predictions
    print("\nError Analysis...")
    wrong_mask = preds != np.array(labels)
    wrong_df = test_df[wrong_mask].copy()
    wrong_df["predicted"] = preds[wrong_mask]
    wrong_df["confidence"] = probs[wrong_mask].max(axis=1)

    # Split by error type
    false_pos = wrong_df[wrong_df["predicted"] == 1]  # predicted Toxic, actually Safe
    false_neg = wrong_df[wrong_df["predicted"] == 0]  # predicted Safe, actually Toxic

    print(f"  Total errors: {len(wrong_df):,} / {len(test_df):,} ({len(wrong_df)/len(test_df)*100:.1f}%)")
    print(f"  False Positives (Safe→Toxic): {len(false_pos):,}")
    print(f"  False Negatives (Toxic→Safe): {len(false_neg):,}")

    # Save error samples
    os.makedirs("reports", exist_ok=True)
    false_pos.sample(min(100, len(false_pos)), random_state=42).to_csv(
        "reports/errors_false_positives.csv", index=False, encoding="utf-8"
    )
    false_neg.sample(min(100, len(false_neg)), random_state=42).to_csv(
        "reports/errors_false_negatives.csv", index=False, encoding="utf-8"
    )
    print(f"  Saved: reports/errors_false_positives.csv")
    print(f"  Saved: reports/errors_false_negatives.csv")

    # Save full results
    results = {
        "accuracy": float(accuracy_score(labels, preds)),
        "f1_weighted": float(f1_score(labels, preds, average="weighted")),
        "f1_toxic": float(f1_score(labels, preds, pos_label=1)),
        "f1_safe": float(f1_score(labels, preds, pos_label=0)),
        "precision_weighted": float(precision_score(labels, preds, average="weighted")),
        "recall_weighted": float(recall_score(labels, preds, average="weighted")),
        "total_errors": int(wrong_mask.sum()),
        "false_positives": int(len(false_pos)),
        "false_negatives": int(len(false_neg)),
    }
    with open("reports/test_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"  Saved: reports/test_results.json")

    print("\nDone!")


if __name__ == "__main__":
    main()
