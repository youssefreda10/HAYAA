import os
import pandas as pd
from sklearn.model_selection import train_test_split

def get_existing_texts():
    existing_texts = set()
    splits_dir = "data/splits"
    for f in ["train.parquet", "test.parquet", "val.parquet"]:
        path = os.path.join(splits_dir, f)
        if os.path.exists(path):
            df = pd.read_parquet(path)
            existing_texts.update(df["text"].tolist())
    return existing_texts

def merge_and_dedup():
    print("Loading new standardized datasets...")
    new_dir = "data/standardized_new"
    dfs = []
    for f in os.listdir(new_dir):
        if f.endswith(".parquet"):
            df = pd.read_parquet(os.path.join(new_dir, f))
            dfs.append(df)
    
    if not dfs:
        print("No new datasets found.")
        return
        
    full_new_df = pd.concat(dfs, ignore_index=True)
    print(f"Total new rows before dedup: {len(full_new_df):,}")
    
    # Dedup internally within new data (if conflict, max label = toxic)
    # Actually taking max label means if any source says toxic, it's toxic
    full_new_df = full_new_df.groupby("text").agg({
        "label": "max",
        "source": "first"
    }).reset_index()
    
    print(f"Total new rows after internal dedup: {len(full_new_df):,}")
    
    # Dedup against existing data
    print("Loading existing data for cross-dedup...")
    existing_texts = get_existing_texts()
    print(f"Loaded {len(existing_texts):,} existing unique texts.")
    
    # Filter out overlap
    clean_new_df = full_new_df[~full_new_df["text"].isin(existing_texts)].copy()
    print(f"Total new rows after removing overlap with existing data: {len(clean_new_df):,}")
    
    # Save merged full
    os.makedirs("data/merged", exist_ok=True)
    clean_new_df.to_parquet("data/merged/haya_new_clean.parquet", index=False)
    print("Saved to data/merged/haya_new_clean.parquet")
    
    # Split into new_train and new_val (90/10)
    print("Splitting into train and val...")
    train_df, val_df = train_test_split(clean_new_df, test_size=0.1, random_state=42, stratify=clean_new_df["label"])
    
    os.makedirs("data/splits", exist_ok=True)
    train_df.to_parquet("data/splits/new_train.parquet", index=False)
    val_df.to_parquet("data/splits/new_val.parquet", index=False)
    
    print(f"Saved splits:")
    print(f" - new_train: {len(train_df):,} rows")
    print(f" - new_val: {len(val_df):,} rows")
    
    print("\nLabel distribution in new_train:")
    print(train_df["label"].value_counts(normalize=True).round(3))

if __name__ == "__main__":
    merge_and_dedup()
