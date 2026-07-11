import os
import sys
import random
import pandas as pd


def validate(dataset_name: str, n_samples: int = 10, seed: int = None):
    path = f"data/standardized/{dataset_name}.parquet"
    if not os.path.exists(path):
        print(f"ERROR: {path} not found")
        return

    df = pd.read_parquet(path)

    if seed is None:
        seed = random.randint(1, 9999)

    sample = df.sample(min(n_samples, len(df)), random_state=seed)

    print(f"\n{'='*60}")
    print(f"VALIDATION: {dataset_name}")
    print(f"Total rows: {len(df):,} | Safe: {(df['label']==0).sum():,} | Toxic: {(df['label']==1).sum():,}")
    print(f"Seed: {seed} | Samples: {len(sample)}")
    print(f"{'='*60}\n")

    for i, (_, row) in enumerate(sample.iterrows(), 1):
        label = "TOXIC" if row["label"] == 1 else "SAFE "
        text = row["text"][:150]
        print(f"  {i:2d}. [{label}] {text}")
        print()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python validate.py <dataset_name> [n_samples] [seed]")
        sys.exit(1)
    name = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    s = int(sys.argv[3]) if len(sys.argv) > 3 else None
    validate(name, n, s)
