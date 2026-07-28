import os
import pandas as pd
from sklearn.model_selection import train_test_split

def create_final_dataset():
    print("Loading Old Splits...")
    old_train = pd.read_parquet("data/splits/train.parquet")
    old_val = pd.read_parquet("data/splits/val.parquet")
    old_test = pd.read_parquet("data/splits/test.parquet")
    
    print("Loading New Splits...")
    new_train = pd.read_parquet("data/splits/new_train.parquet")
    new_val = pd.read_parquet("data/splits/new_val.parquet")
    
    # Merge all into one massive dataframe
    print("Concatenating all data...")
    all_data = pd.concat([old_train, old_val, old_test, new_train, new_val], ignore_index=True)
    
    print(f"Total Rows Combined: {len(all_data):,}")
    
    # Just to be absolutely safe, let's dedup by text one final time
    print("Performing final deduplication...")
    all_data = all_data.groupby("text").agg({
        "label": "max",
        "source": "first"
    }).reset_index()
    print(f"Total Unique Rows: {len(all_data):,}")
    
    # Split into Train (80%), Val (10%), Test (10%)
    print("Splitting into 80% Train, 10% Val, 10% Test...")
    
    # First split into 80% Train, 20% Temp
    train_df, temp_df = train_test_split(
        all_data, 
        test_size=0.2, 
        random_state=42, 
        stratify=all_data["label"]
    )
    
    # Then split the 20% Temp into 10% Val, 10% Test (which is 50% of the Temp)
    val_df, test_df = train_test_split(
        temp_df, 
        test_size=0.5, 
        random_state=42, 
        stratify=temp_df["label"]
    )
    
    # Save the new final splits
    os.makedirs("data/final_dataset", exist_ok=True)
    
    print("Saving to data/final_dataset/ ...")
    train_df.to_parquet("data/final_dataset/train.parquet", index=False)
    val_df.to_parquet("data/final_dataset/val.parquet", index=False)
    test_df.to_parquet("data/final_dataset/test.parquet", index=False)
    all_data.to_parquet("data/final_dataset/full_dataset.parquet", index=False)
    
    print("\n--- Final Dataset Summary ---")
    print(f"Train: {len(train_df):,} rows")
    print(f"Val:   {len(val_df):,} rows")
    print(f"Test:  {len(test_df):,} rows")
    
    print("\nLabel Distribution in Train:")
    print(train_df["label"].value_counts(normalize=True).round(3))

if __name__ == "__main__":
    create_final_dataset()
