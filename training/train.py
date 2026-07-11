"""
HAYA Training Script — MARBERT Fine-tuning for Arabic Content Moderation
Binary Classification: Safe (0) / Toxic (1)
"""
import os
import sys
import json
import time
import torch
import numpy as np
import pandas as pd
from datetime import datetime
from torch.nn import CrossEntropyLoss
from torch.utils.data import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    EarlyStoppingCallback,
)
from sklearn.metrics import (
    f1_score,
    precision_score,
    recall_score,
    accuracy_score,
    classification_report,
    confusion_matrix,
)

# ============================================================
# Config
# ============================================================
MODEL_NAME = "UBC-NLP/MARBERTv2"
MAX_LENGTH = 128
EPOCHS = 5
BATCH_SIZE = 16
GRADIENT_ACCUMULATION = 2
LEARNING_RATE = 2e-5
WARMUP_RATIO = 0.1
WEIGHT_DECAY = 0.01
FP16 = True
SEED = 42
EARLY_STOPPING_PATIENCE = 2

TRAIN_PATH = "data/splits/train.parquet"
VAL_PATH = "data/splits/val.parquet"
OUTPUT_DIR = "training/checkpoints"
BEST_MODEL_DIR = "training/best_model"
LOG_DIR = "training/logs"


# ============================================================
# Dataset
# ============================================================
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


# ============================================================
# Custom Trainer with Weighted Loss
# ============================================================
class WeightedTrainer(Trainer):
    def __init__(self, class_weights, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.class_weights = class_weights

    def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
        labels = inputs.pop("labels")
        outputs = model(**inputs)
        logits = outputs.logits
        weight = torch.tensor(self.class_weights, dtype=torch.float32).to(logits.device)
        loss_fn = CrossEntropyLoss(weight=weight)
        loss = loss_fn(logits, labels)
        return (loss, outputs) if return_outputs else loss


# ============================================================
# Metrics
# ============================================================
def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)

    f1_w = f1_score(labels, preds, average="weighted")
    f1_toxic = f1_score(labels, preds, average="binary", pos_label=1)
    f1_safe = f1_score(labels, preds, average="binary", pos_label=0)
    precision = precision_score(labels, preds, average="weighted")
    recall = recall_score(labels, preds, average="weighted")
    acc = accuracy_score(labels, preds)

    return {
        "accuracy": acc,
        "f1_weighted": f1_w,
        "f1_toxic": f1_toxic,
        "f1_safe": f1_safe,
        "precision": precision,
        "recall": recall,
    }


# ============================================================
# Main
# ============================================================
def main():
    start_time = time.time()
    print("=" * 60)
    print("HAYA Training — MARBERT Fine-tuning")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 1. Load data
    print("\n[1/6] Loading data...")
    train_df = pd.read_parquet(TRAIN_PATH)
    val_df = pd.read_parquet(VAL_PATH)

    train_texts = train_df["text"].tolist()
    train_labels = train_df["label"].tolist()
    val_texts = val_df["text"].tolist()
    val_labels = val_df["label"].tolist()

    safe_count = train_labels.count(0)
    toxic_count = train_labels.count(1)
    weight_toxic = safe_count / toxic_count
    class_weights = [1.0, weight_toxic]

    print(f"  Train: {len(train_texts):,} | Safe: {safe_count:,} | Toxic: {toxic_count:,}")
    print(f"  Val: {len(val_texts):,}")
    print(f"  Class weights: Safe={class_weights[0]:.2f}, Toxic={class_weights[1]:.2f}")

    # 2. Load tokenizer + model
    print("\n[2/6] Loading MARBERT...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME,
        num_labels=2,
        id2label={0: "Safe", 1: "Toxic"},
        label2id={"Safe": 0, "Toxic": 1},
    )
    print(f"  Model: {MODEL_NAME}")
    print(f"  Parameters: {sum(p.numel() for p in model.parameters()):,}")

    # 3. Create datasets
    print("\n[3/6] Tokenizing...")
    train_dataset = HayaDataset(train_texts, train_labels, tokenizer, MAX_LENGTH)
    val_dataset = HayaDataset(val_texts, val_labels, tokenizer, MAX_LENGTH)
    print(f"  Train dataset: {len(train_dataset):,}")
    print(f"  Val dataset: {len(val_dataset):,}")

    # 4. Training arguments
    print("\n[4/6] Setting up training...")
    total_steps = (len(train_dataset) // (BATCH_SIZE * GRADIENT_ACCUMULATION)) * EPOCHS
    eval_steps = len(train_dataset) // (BATCH_SIZE * GRADIENT_ACCUMULATION * 2)

    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        per_device_eval_batch_size=BATCH_SIZE * 2,
        gradient_accumulation_steps=GRADIENT_ACCUMULATION,
        learning_rate=LEARNING_RATE,
        warmup_ratio=WARMUP_RATIO,
        weight_decay=WEIGHT_DECAY,
        fp16=FP16,
        eval_strategy="steps",
        eval_steps=eval_steps,
        save_strategy="steps",
        save_steps=eval_steps,
        save_total_limit=3,
        load_best_model_at_end=True,
        metric_for_best_model="f1_weighted",
        greater_is_better=True,
        logging_dir=LOG_DIR,
        logging_steps=100,
        report_to="none",
        seed=SEED,
        dataloader_num_workers=4,
        remove_unused_columns=False,
        max_grad_norm=1.0,
    )

    print(f"  Epochs: {EPOCHS}")
    print(f"  Batch size: {BATCH_SIZE} (effective: {BATCH_SIZE * GRADIENT_ACCUMULATION})")
    print(f"  Max length: {MAX_LENGTH}")
    print(f"  Learning rate: {LEARNING_RATE}")
    print(f"  fp16: {FP16}")
    print(f"  Total steps: ~{total_steps:,}")
    print(f"  Eval every: {eval_steps:,} steps (~0.5 epoch)")

    # 5. Train
    print("\n[5/6] Training...")
    trainer = WeightedTrainer(
        class_weights=class_weights,
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=val_dataset,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=EARLY_STOPPING_PATIENCE)],
    )

    train_result = trainer.train()

    # 6. Save best model
    print("\n[6/6] Saving best model...")
    trainer.save_model(BEST_MODEL_DIR)
    tokenizer.save_pretrained(BEST_MODEL_DIR)

    # Final evaluation
    print("\n" + "=" * 60)
    print("FINAL EVALUATION ON VALIDATION SET")
    print("=" * 60)
    eval_results = trainer.evaluate()
    for key, value in eval_results.items():
        print(f"  {key}: {value:.4f}")

    # Classification report
    val_preds = trainer.predict(val_dataset)
    preds = np.argmax(val_preds.predictions, axis=-1)
    print("\nClassification Report:")
    print(classification_report(val_labels, preds, target_names=["Safe", "Toxic"]))

    cm = confusion_matrix(val_labels, preds)
    print(f"Confusion Matrix:")
    print(f"  Predicted:  Safe    Toxic")
    print(f"  Safe:     {cm[0][0]:>6,}  {cm[0][1]:>6,}")
    print(f"  Toxic:    {cm[1][0]:>6,}  {cm[1][1]:>6,}")

    # Save training info
    elapsed = time.time() - start_time
    info = {
        "model": MODEL_NAME,
        "train_rows": len(train_texts),
        "val_rows": len(val_texts),
        "epochs_completed": train_result.metrics.get("epoch", EPOCHS),
        "best_f1": eval_results.get("eval_f1_weighted", 0),
        "training_time_hours": elapsed / 3600,
        "class_weights": class_weights,
        "hyperparameters": {
            "max_length": MAX_LENGTH,
            "batch_size": BATCH_SIZE,
            "gradient_accumulation": GRADIENT_ACCUMULATION,
            "learning_rate": LEARNING_RATE,
            "warmup_ratio": WARMUP_RATIO,
            "weight_decay": WEIGHT_DECAY,
            "fp16": FP16,
            "seed": SEED,
        },
    }
    with open(os.path.join(BEST_MODEL_DIR, "training_info.json"), "w") as f:
        json.dump(info, f, indent=2)

    print(f"\nTraining completed in {elapsed/3600:.1f} hours")
    print(f"Best model saved to: {BEST_MODEL_DIR}/")
    print("Done!")


if __name__ == "__main__":
    main()
