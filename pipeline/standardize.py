import os
import sys
import json
import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.arabic_normalizer import normalize_arabic
from utils.script_detector import is_arabic_script, has_mojibake
from utils.label_mapper import map_label_to_binary, is_corrupt_label


def standardize(dataset_name: str, config_path: str = "pipeline/config/dataset_configs.json"):
    with open(config_path, "r", encoding="utf-8") as f:
        all_configs = json.load(f)

    if dataset_name not in all_configs:
        print(f"ERROR: No config found for '{dataset_name}'")
        return

    cfg = all_configs[dataset_name]
    raw_path = cfg["raw_path"]
    text_col = cfg["text_column"]
    label_col = cfg["label_column"]
    label_map = cfg.get("label_map", {})
    dialect = cfg.get("dialect", "Unknown")
    encoding = cfg.get("encoding", "utf-8")
    separator = cfg.get("separator", ",")
    no_header = cfg.get("no_header", False)

    ext = os.path.splitext(raw_path)[1].lower()
    if ext == ".parquet":
        df = pd.read_parquet(raw_path)
    elif ext in (".xlsx", ".xls"):
        if no_header:
            df = pd.read_excel(raw_path, header=None, names=[text_col, label_col])
        else:
            df = pd.read_excel(raw_path)
    elif ext == ".tsv":
        df = pd.read_csv(raw_path, sep="\t", encoding=encoding, on_bad_lines="skip")
    elif ext in (".json", ".jsonl"):
        df = pd.read_json(raw_path, lines=(ext == ".jsonl"), encoding=encoding)
    else:
        df = pd.read_csv(raw_path, sep=separator, encoding=encoding, on_bad_lines="skip")

    total_raw = len(df)
    print(f"Loaded {total_raw:,} rows from {raw_path}")

    # 1. Map columns
    multi_label = cfg.get("multi_label_mode")
    if isinstance(label_col, list) and multi_label == "any_positive":
        for col in label_col:
            df[col] = df[col].map(label_map).fillna(0).astype(int)
        df["label"] = df[label_col].max(axis=1)
        df = df.rename(columns={text_col: "text"})
    else:
        df = df.rename(columns={text_col: "text", label_col: "label"})
    df["source"] = dataset_name
    df["dialect"] = dialect

    # 2. Drop empty/NaN text
    df = df.dropna(subset=["text"])
    df = df[df["text"].astype(str).str.strip() != ""]
    print(f"After dropping empty text: {len(df):,}")

    # 3. Filter Arabic script
    df = df[df["text"].apply(lambda x: is_arabic_script(str(x)))]
    print(f"After Arabic script filter: {len(df):,}")

    # 4. Detect corrupt labels & map to binary
    if not (isinstance(label_col, list) and multi_label == "any_positive"):
        corrupt_mask = df["label"].apply(is_corrupt_label)
        if corrupt_mask.any():
            print(f"Corrupt labels detected: {corrupt_mask.sum()}")
            df = df[~corrupt_mask]

        # 5. Extract unlabeled
        df["label_binary"] = df["label"].apply(lambda x: map_label_to_binary(x, label_map))
        unlabeled = df[df["label_binary"].isna()]
        if len(unlabeled) > 0:
            os.makedirs("reports", exist_ok=True)
            unlabeled[["text", "label", "source"]].to_csv(
                f"reports/unlabeled_{dataset_name}.csv", index=False, encoding="utf-8"
            )
            print(f"Unlabeled rows extracted: {len(unlabeled):,}")
        df = df.dropna(subset=["label_binary"])
        df["label"] = df["label_binary"].astype(int)
        df = df.drop(columns=["label_binary"])

    # 6. Clean text
    df["original_text"] = df["text"]
    df["text"] = df["text"].apply(normalize_arabic)

    # 7. Length filter
    df = df[df["text"].str.len() >= 3]
    df = df[df["text"].str.len() <= 1000]
    print(f"After length filter: {len(df):,}")

    # 8. Mojibake filter
    df = df[~df["text"].apply(has_mojibake)]

    # 9. Post-clean empty filter
    df = df[df["text"].str.strip() != ""]
    print(f"After all filters: {len(df):,}")

    # 10. Save standardized
    os.makedirs("data/standardized", exist_ok=True)
    output_path = f"data/standardized/{dataset_name}.parquet"
    df[["text", "label", "source", "dialect"]].to_parquet(output_path, index=False)
    print(f"Saved: {output_path} ({len(df):,} rows)")

    # 11. QA sample
    os.makedirs("reports", exist_ok=True)
    sample_size = min(100, len(df))
    qa = df.sample(sample_size, random_state=42)[["original_text", "text", "label"]]
    qa.columns = ["original_text", "cleaned_text", "label"]
    qa.to_csv(f"reports/qa_{dataset_name}.csv", index=False, encoding="utf-8")
    print(f"QA sample: reports/qa_{dataset_name}.csv ({sample_size} rows)")

    # Stats
    print(f"\n--- STATS ---")
    print(f"Raw: {total_raw:,} → Final: {len(df):,} ({len(df)/total_raw*100:.1f}%)")
    print(f"Label 0 (safe): {(df['label']==0).sum():,}")
    print(f"Label 1 (toxic): {(df['label']==1).sum():,}")
    print(f"Dialect: {dialect}")

    return df


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python standardize.py <dataset_name>")
        sys.exit(1)
    standardize(sys.argv[1])
