import pandas as pd
import os

STANDARDIZED_DIR = "data/standardized"
OUTPUT_DIR = "data/merged"
REPORTS_DIR = "reports"
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(REPORTS_DIR, exist_ok=True)

# ============================================================
# Step 1: Load all datasets
# ============================================================
print("=" * 60)
print("STEP 1: Loading all datasets")
print("=" * 60)

dfs = []
for f in sorted(os.listdir(STANDARDIZED_DIR)):
    if not f.endswith(".parquet"):
        continue
    df = pd.read_parquet(os.path.join(STANDARDIZED_DIR, f))
    dfs.append(df)

merged = pd.concat(dfs, ignore_index=True)
print(f"Total rows loaded: {len(merged):,}")
print(f"Unique sources: {merged['source'].nunique()}")

# ============================================================
# Step 2: Remove problematic datasets
# ============================================================
print("\n" + "=" * 60)
print("STEP 2: Removing problematic datasets")
print("=" * 60)

remove_datasets = [
    "Fraiwan",             # labels based on extremism not general abuse
    "HabashGraduation",    # high noise, McDonald's complaint = toxic
    "KhairyCyberbullying",  # exact duplicate of ArabicAbusiveCollection
    "Kaggle_HateSpeech",   # exact duplicate of L-HSAB
    "OSACT2022",           # exact duplicate of OSACT5
]

for name in remove_datasets:
    count = (merged["source"] == name).sum()
    print(f"  Removing {name}: {count:,} rows")

merged = merged[~merged["source"].isin(remove_datasets)]
print(f"After removal: {len(merged):,}")

# ============================================================
# Step 3: Move HateCheck to evaluation only
# ============================================================
print("\n" + "=" * 60)
print("STEP 3: Separating HateCheck for evaluation only")
print("=" * 60)

hatecheck = merged[merged["source"] == "HateCheck_Arabic"].copy()
merged = merged[merged["source"] != "HateCheck_Arabic"]
hatecheck.to_parquet(os.path.join(OUTPUT_DIR, "eval_hatecheck.parquet"), index=False)
print(f"HateCheck saved for eval: {len(hatecheck):,} rows")
print(f"Training pool: {len(merged):,}")

# ============================================================
# Step 4: Fix SaudiCodeMixing mislabels
# ============================================================
print("\n" + "=" * 60)
print("STEP 4: Fixing SaudiCodeMixing mislabels")
print("=" * 60)

profanity_keywords = [
    "كس ام", "كسم", "كس اخت", "ابن القحب", "قحب", "عاهر",
    "زب", "طيز", "نيك", "ينيك", "تنيك", "منيوك", "متناك",
    "شرموط", "ديوث", "خول", "لوط", "سحاق",
    "زاني", "زانية", "فاجر", "فاسق",
    "كلب", "حمار", "حيوان", "خنزير",
    "وسخ", "قذر", "حقير", "نجس",
]

saudi_mask = merged["source"] == "SaudiCodeMixing"
saudi_safe_mask = saudi_mask & (merged["label"] == 0)

flipped = 0
for idx in merged[saudi_safe_mask].index:
    text = merged.at[idx, "text"]
    for kw in profanity_keywords:
        if kw in text:
            merged.at[idx, "label"] = 1
            flipped += 1
            break

print(f"SaudiCodeMixing safe rows scanned: {saudi_safe_mask.sum():,}")
print(f"Flipped to toxic: {flipped:,}")

# ============================================================
# Step 5: Filter PolyGuardMix noise
# ============================================================
print("\n" + "=" * 60)
print("STEP 5: Filtering PolyGuardMix noise")
print("=" * 60)

poly_mask = merged["source"] == "PolyGuardMix"
before_poly = poly_mask.sum()

poly_safe = poly_mask & (merged["label"] == 0)
poly_safe_long = poly_safe & (merged["text"].str.len() > 300)
merged = merged[~poly_safe_long]

after_poly = (merged["source"] == "PolyGuardMix").sum()
print(f"PolyGuardMix before: {before_poly:,}")
print(f"Removed (long translated safe): {before_poly - after_poly:,}")
print(f"PolyGuardMix after: {after_poly:,}")

# ============================================================
# Step 6: Resolve label conflicts (majority vote)
# ============================================================
print("\n" + "=" * 60)
print("STEP 6: Resolving label conflicts")
print("=" * 60)

text_labels = merged.groupby("text")["label"].agg(["mean", "count"])
conflicts = text_labels[(text_labels["mean"] > 0) & (text_labels["mean"] < 1)]
print(f"Texts with conflicting labels: {len(conflicts):,}")

majority_label = (text_labels["mean"] >= 0.5).astype(int)
majority_label.name = "majority_label"

label_map = majority_label.to_dict()

# Save conflicts for review
conflict_texts = conflicts.index.tolist()
conflict_samples = merged[merged["text"].isin(conflict_texts[:200])]
conflict_samples[["text", "label", "source"]].to_csv(
    os.path.join(REPORTS_DIR, "label_conflicts_sample.csv"),
    index=False, encoding="utf-8"
)
print(f"Conflict sample saved: reports/label_conflicts_sample.csv")

# ============================================================
# Step 7: Deduplicate (keep dialect info)
# ============================================================
print("\n" + "=" * 60)
print("STEP 7: Deduplication with dialect merging")
print("=" * 60)

before_dedup = len(merged)

deduped = merged.groupby("text").agg({
    "label": lambda x: label_map.get(x.name, x.mode().iloc[0]),
    "source": lambda x: "|".join(sorted(set(x))),
    "dialect": lambda x: "|".join(sorted(set(x))),
}).reset_index()

print(f"Before dedup: {before_dedup:,}")
print(f"After dedup: {len(deduped):,}")
print(f"Removed: {before_dedup - len(deduped):,} ({(before_dedup - len(deduped))/before_dedup*100:.1f}%)")

# ============================================================
# Step 8: Save final merged file
# ============================================================
print("\n" + "=" * 60)
print("STEP 8: Saving final merged dataset")
print("=" * 60)

deduped.to_parquet(os.path.join(OUTPUT_DIR, "haya_merged_clean.parquet"), index=False)

safe = (deduped["label"] == 0).sum()
toxic = (deduped["label"] == 1).sum()

print(f"Final dataset: {len(deduped):,} rows")
print(f"  Safe (0): {safe:,} ({safe/len(deduped)*100:.1f}%)")
print(f"  Toxic (1): {toxic:,} ({toxic/len(deduped)*100:.1f}%)")
print(f"  Sources: {deduped['source'].str.split('|').explode().nunique()}")
print(f"\nSaved: {OUTPUT_DIR}/haya_merged_clean.parquet")

# Dialect distribution
print(f"\nDialect distribution:")
all_dialects = deduped["dialect"].str.split("|").explode()
for d, c in all_dialects.value_counts().head(15).items():
    print(f"  {d}: {c:,}")
