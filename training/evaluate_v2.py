import os
import sys
import torch
import numpy as np
import pandas as pd
from transformers import AutoTokenizer, AutoModelForSequenceClassification, Trainer
from sklearn.metrics import (
    f1_score,
    precision_score,
    recall_score,
    accuracy_score,
    classification_report,
    confusion_matrix,
)
from torch.utils.data import Dataset

OLD_TEST_PATH = "data/splits/test.parquet"
NEW_VAL_PATH = "data/splits/new_val.parquet"
OLD_MODEL_DIR = "training/best_model"
NEW_MODEL_DIR = "training/best_model_v2"
MAX_LENGTH = 128

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

def evaluate_model(model_dir, test_df, tokenizer_dir=None):
    if tokenizer_dir is None:
        tokenizer_dir = model_dir
        
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_dir)
    model = AutoModelForSequenceClassification.from_pretrained(model_dir)
    
    dataset = HayaDataset(test_df["text"].tolist(), test_df["label"].tolist(), tokenizer, MAX_LENGTH)
    trainer = Trainer(model=model)
    
    preds_output = trainer.predict(dataset)
    preds = np.argmax(preds_output.predictions, axis=-1)
    labels = test_df["label"].tolist()
    
    acc = accuracy_score(labels, preds)
    f1 = f1_score(labels, preds, average="binary", pos_label=1)
    f1_safe = f1_score(labels, preds, average="binary", pos_label=0)
    
    return {
        "acc": acc,
        "f1_toxic": f1,
        "f1_safe": f1_safe,
        "labels": labels,
        "preds": preds
    }

def print_metrics(name, m):
    print(f"\n--- {name} ---")
    print(f"Accuracy:  {m['acc']:.4f}")
    print(f"F1 Toxic:  {m['f1_toxic']:.4f}")
    print(f"F1 Safe:   {m['f1_safe']:.4f}")
    
    print("\nConfusion Matrix (Safe, Toxic):")
    cm = confusion_matrix(m["labels"], m["preds"])
    print(f"  Safe:  {cm[0][0]:>5} {cm[0][1]:>5}")
    print(f"  Toxic: {cm[1][0]:>5} {cm[1][1]:>5}")

def main():
    print("Loading test sets...")
    old_test = pd.read_parquet(OLD_TEST_PATH)
    new_test = pd.read_parquet(NEW_VAL_PATH)
    print(f"Old Test: {len(old_test):,} rows")
    print(f"New Test: {len(new_test):,} rows")
    
    if not os.path.exists(NEW_MODEL_DIR):
        print(f"ERROR: Model directory {NEW_MODEL_DIR} not found. Did training finish?")
        return
        
    print("\n" + "="*50)
    print("EVALUATING OLD MODEL")
    print("="*50)
    print("Testing on Old Test Set...")
    old_metrics_old_test = evaluate_model(OLD_MODEL_DIR, old_test)
    print_metrics("OLD MODEL on OLD TEST SET", old_metrics_old_test)
    
    print("\nTesting on New Test Set...")
    old_metrics_new_test = evaluate_model(OLD_MODEL_DIR, new_test)
    print_metrics("OLD MODEL on NEW TEST SET", old_metrics_new_test)
    
    print("\n" + "="*50)
    print("EVALUATING NEW MODEL (Continued Finetune)")
    print("="*50)
    print("Testing on Old Test Set...")
    new_metrics_old_test = evaluate_model(NEW_MODEL_DIR, old_test, tokenizer_dir=OLD_MODEL_DIR)
    print_metrics("NEW MODEL on OLD TEST SET", new_metrics_old_test)
    
    print("\nTesting on New Test Set...")
    new_metrics_new_test = evaluate_model(NEW_MODEL_DIR, new_test, tokenizer_dir=OLD_MODEL_DIR)
    print_metrics("NEW MODEL on NEW TEST SET", new_metrics_new_test)
    
    print("\n" + "="*50)
    print("COMPARISON SUMMARY")
    print("="*50)
    print(f"{'Metric':<20} | {'Old Model':<10} | {'New Model':<10} | {'Diff':<10}")
    print("-" * 55)
    
    def print_diff(metric_name, old_val, new_val):
        diff = (new_val - old_val) * 100
        sign = "+" if diff >= 0 else ""
        print(f"{metric_name:<20} | {old_val:.4f}     | {new_val:.4f}     | {sign}{diff:.2f}%")
        
    print("Old Test Set (77K rows)")
    print_diff("Accuracy", old_metrics_old_test["acc"], new_metrics_old_test["acc"])
    print_diff("F1 Toxic", old_metrics_old_test["f1_toxic"], new_metrics_old_test["f1_toxic"])
    
    print("\nNew Test Set (~4K rows)")
    print_diff("Accuracy", old_metrics_new_test["acc"], new_metrics_new_test["acc"])
    print_diff("F1 Toxic", old_metrics_new_test["f1_toxic"], new_metrics_new_test["f1_toxic"])

if __name__ == "__main__":
    main()
