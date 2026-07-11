import os
import sys
import pandas as pd
import glob


def inspect(path: str, encoding: str = "utf-8", separator: str = ","):
    print(f"\n{'='*60}")
    print(f"INSPECTING: {path}")
    print(f"{'='*60}")

    ext = os.path.splitext(path)[1].lower()

    try:
        if ext == ".parquet":
            df = pd.read_parquet(path)
        elif ext in (".xlsx", ".xls"):
            df = pd.read_excel(path)
        elif ext == ".tsv":
            df = pd.read_csv(path, sep="\t", encoding=encoding)
        elif ext == ".json" or ext == ".jsonl":
            df = pd.read_json(path, lines=(ext == ".jsonl"), encoding=encoding)
        else:
            df = pd.read_csv(path, sep=separator, encoding=encoding, on_bad_lines="skip")
    except Exception as e:
        print(f"ERROR loading file: {e}")
        return None

    print(f"\nRows: {len(df):,}")
    print(f"Columns ({len(df.columns)}): {list(df.columns)}")
    print(f"\nColumn dtypes:")
    for col in df.columns:
        print(f"  {col}: {df[col].dtype} | NaN: {df[col].isna().sum()}")

    print(f"\nFirst 3 rows:")
    print(df.head(3).to_string())

    for col in df.columns:
        n_unique = df[col].nunique()
        if n_unique <= 20:
            print(f"\nUnique values in '{col}' ({n_unique}):")
            print(f"  {dict(df[col].value_counts())}")

    return df


def inspect_folder(folder: str):
    files = []
    for ext in ["*.csv", "*.tsv", "*.xlsx", "*.parquet", "*.json", "*.jsonl"]:
        files.extend(glob.glob(os.path.join(folder, "**", ext), recursive=True))
    if not files:
        print(f"No data files found in {folder}")
        return
    for f in sorted(files):
        inspect(f)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python inspect_dataset.py <path>")
        sys.exit(1)
    target = sys.argv[1]
    if os.path.isdir(target):
        inspect_folder(target)
    else:
        inspect(target)
