"""
Phase 6: Shuffle & Stratified Split — Train / Validation / Test
Prevents data leakage by splitting on unique texts after deduplication.
"""
import pandas as pd
import os
from sklearn.model_selection import train_test_split

MERGED_PATH = "data/merged/haya_merged_clean.parquet"
SPLITS_DIR = "data/splits"
REPORTS_DIR = "reports"
os.makedirs(SPLITS_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)

SEED = 42

# ============================================================
# 1. Load
# ============================================================
df = pd.read_parquet(MERGED_PATH)
print(f"Loaded: {len(df):,} rows | Safe: {(df['label']==0).sum():,} | Toxic: {(df['label']==1).sum():,}")

# ============================================================
# 2. Verify no duplicates (data leakage prevention)
# ============================================================
dupes = df.duplicated(subset=["text"]).sum()
print(f"Duplicate check: {dupes} duplicates")
assert dupes == 0, "DUPLICATES FOUND — fix before splitting!"

# ============================================================
# 3. Shuffle
# ============================================================
df = df.sample(frac=1, random_state=SEED).reset_index(drop=True)
print(f"Shuffled with seed={SEED}")

# ============================================================
# 4. Stratified Split: 80% Train / 10% Val / 10% Test
#    Stratified by label to ensure balanced representation
# ============================================================
train_df, temp_df = train_test_split(
    df, test_size=0.2, random_state=SEED, stratify=df["label"]
)
val_df, test_df = train_test_split(
    temp_df, test_size=0.5, random_state=SEED, stratify=temp_df["label"]
)

print(f"\nSplit results:")
print(f"  Train: {len(train_df):,} ({len(train_df)/len(df)*100:.1f}%)")
print(f"  Val:   {len(val_df):,} ({len(val_df)/len(df)*100:.1f}%)")
print(f"  Test:  {len(test_df):,} ({len(test_df)/len(df)*100:.1f}%)")

# ============================================================
# 5. Verify no leakage between splits
# ============================================================
train_texts = set(train_df["text"].values)
val_texts = set(val_df["text"].values)
test_texts = set(test_df["text"].values)

leak_train_val = len(train_texts & val_texts)
leak_train_test = len(train_texts & test_texts)
leak_val_test = len(val_texts & test_texts)

print(f"\nLeakage check:")
print(f"  Train-Val overlap:  {leak_train_val}")
print(f"  Train-Test overlap: {leak_train_test}")
print(f"  Val-Test overlap:   {leak_val_test}")

assert leak_train_val == 0, "LEAKAGE: Train-Val overlap!"
assert leak_train_test == 0, "LEAKAGE: Train-Test overlap!"
assert leak_val_test == 0, "LEAKAGE: Val-Test overlap!"
print("  ALL CLEAR — zero leakage")

# ============================================================
# 6. Label distribution per split
# ============================================================
print(f"\nLabel distribution:")
for name, split_df in [("Train", train_df), ("Val", val_df), ("Test", test_df)]:
    safe = (split_df["label"] == 0).sum()
    toxic = (split_df["label"] == 1).sum()
    print(f"  {name:5s}: Safe={safe:,} ({safe/len(split_df)*100:.1f}%) | Toxic={toxic:,} ({toxic/len(split_df)*100:.1f}%)")

# ============================================================
# 7. Source distribution per split
# ============================================================
print(f"\nSource coverage:")
for name, split_df in [("Train", train_df), ("Val", val_df), ("Test", test_df)]:
    sources = split_df["source"].str.split("|").explode().nunique()
    print(f"  {name:5s}: {sources} sources")

# ============================================================
# 8. Save splits
# ============================================================
train_df.to_parquet(f"{SPLITS_DIR}/train.parquet", index=False)
val_df.to_parquet(f"{SPLITS_DIR}/val.parquet", index=False)
test_df.to_parquet(f"{SPLITS_DIR}/test.parquet", index=False)
print(f"\nSaved:")
print(f"  {SPLITS_DIR}/train.parquet ({len(train_df):,} rows)")
print(f"  {SPLITS_DIR}/val.parquet ({len(val_df):,} rows)")
print(f"  {SPLITS_DIR}/test.parquet ({len(test_df):,} rows)")

# ============================================================
# 9. QA Final — 1000 random from train
# ============================================================
qa = train_df.sample(1000, random_state=SEED)[["text", "label", "source", "dialect"]]
qa.to_csv(f"{REPORTS_DIR}/qa_final.csv", index=False, encoding="utf-8")
print(f"  {REPORTS_DIR}/qa_final.csv (1000 rows)")

# ============================================================
# 10. Summary
# ============================================================
print(f"\n{'='*60}")
print(f"PHASE 6 COMPLETE")
print(f"{'='*60}")
print(f"Total: {len(df):,}")
print(f"Train: {len(train_df):,} | Val: {len(val_df):,} | Test: {len(test_df):,}")
print(f"Leakage: ZERO")
print(f"Stratified by: label")
print(f"Seed: {SEED}")
