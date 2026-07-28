import os
import sys
import json
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.arabic_normalizer import normalize_arabic
from utils.script_detector import is_arabic_script, has_mojibake

DESKTOP_DIR = "C:/Users/youss/OneDrive/Desktop"

def clean_and_save(df, dataset_name):
    total_raw = len(df)
    
    # Ensure text is string and drop empty
    df = df.dropna(subset=["text", "label"])
    df["text"] = df["text"].astype(str).str.strip()
    df = df[df["text"] != ""]
    
    # Filter Arabic script
    df = df[df["text"].apply(lambda x: is_arabic_script(str(x)))]
    
    # Normalize text
    df["text"] = df["text"].apply(normalize_arabic)
    
    # Length filter
    df = df[df["text"].str.len() >= 3]
    df = df[df["text"].str.len() <= 1000]
    
    # Mojibake filter
    df = df[~df["text"].apply(has_mojibake)]
    
    # Drop empty again
    df = df[df["text"].str.strip() != ""]
    
    df["source"] = dataset_name
    df["label"] = df["label"].astype(int)
    
    os.makedirs("data/standardized_new", exist_ok=True)
    out_path = f"data/standardized_new/{dataset_name}.parquet"
    df[["text", "label", "source"]].to_parquet(out_path, index=False)
    
    print(f"[{dataset_name}] Raw: {total_raw:,} -> Clean: {len(df):,} | Safe: {(df['label']==0).sum():,} Toxic: {(df['label']==1).sum():,}")
    return df

def process_adhar():
    print("Processing ADHAR...")
    xl = pd.ExcelFile(f"{DESKTOP_DIR}/ADHAR Hate Speech Corpus.xlsx")
    dfs = []
    for sheet in ["Religious beliefs", "Nationality", "RaceEthnicity", "Gender"]:
        df = pd.read_excel(xl, sheet_name=sheet)
        df = df.rename(columns={"Sentence": "text"})
        df["label"] = df["Final Annotation"].map({"Hate": 1, "Not Hate": 0, "Ethnicity + Hate": 1, "Race + Hate": 1, "Ethnicity + Not Hate": 0, "Race + Not Hate": 0})
        dfs.append(df)
    full_df = pd.concat(dfs, ignore_index=True)
    clean_and_save(full_df, "adhar")

def process_d021():
    print("Processing D021...")
    with open(f"{DESKTOP_DIR}/D021.json", 'r', encoding='utf-8') as f:
        data = [json.loads(l) for l in f.readlines()]
    df = pd.DataFrame(data)
    
    def get_label(offs):
        if not isinstance(offs, list) or len(offs) == 0:
            return 0
        toxic_count = 0
        for o in offs:
            if "Clean" not in o and "Humor" not in o and "Irony/sarcasm" not in o:
                toxic_count += 1
        return 1 if toxic_count > 0 else 0
        
    df["label"] = df["offensiveness"].apply(get_label)
    clean_and_save(df, "d021")

def process_lrec():
    print("Processing LREC...")
    df = pd.read_excel(f"{DESKTOP_DIR}/LREC Data.xlsx/LREC Data.xlsx", sheet_name="Sheet1")
    df = df.rename(columns={"info_text": "text"})
    
    def is_toxic(row):
        cols = ["Q4.1: Offensive/Vulgar لغة مسيئة/بذيئة ", "Q4.5: Vulgar ألفاظ بذيئة فاحشة", "Q4.6: Violence تحريض على العنف"]
        for c in cols:
            if c in df.columns:
                val = str(row[c]).strip().lower()
                if val == "yes" or val == "yes-directed" or val == "yes-important" or val == "yes-specific-product-or-service": # Just catch 'yes' broadly for hate/vulgar
                    if "yes" in val:
                        return 1
        return 0
        
    df["label"] = df.apply(is_toxic, axis=1)
    clean_and_save(df, "lrec")

def process_task1():
    print("Processing Task 1...")
    dfs = []
    for f in ["train.csv", "test.csv", "validation.csv"]:
        df = pd.read_csv(f"{DESKTOP_DIR}/drive-download-20260728T095212Z-1-001/Task 1/{f}")
        df["label"] = df["label"].map({"hate": 1, "hope": 0, "not_applicable": 0})
        dfs.append(df)
    full_df = pd.concat(dfs, ignore_index=True)
    clean_and_save(full_df, "task1")

def process_task2():
    print("Processing Task 2...")
    dfs = []
    for f in ["train.csv", "test.csv", "validation.csv"]:
        df = pd.read_csv(f"{DESKTOP_DIR}/drive-download-20260728T095212Z-1-001/Task 2/{f}")
        df["label"] = ((df["Offensive"].str.lower() == "yes") | (df["Hate"].str.lower() == "hate")).astype(int)
        dfs.append(df)
    full_df = pd.concat(dfs, ignore_index=True)
    clean_and_save(full_df, "task2")

def process_corpus1():
    print("Processing Corpus 1...")
    df = pd.read_excel(f"{DESKTOP_DIR}/drive-download-20260728T095536Z-1-001/Corpus 1.xlsx", sheet_name="Corpra 1")
    df = df.rename(columns={"comment": "text"})
    df["label"] = (df["use of offensive language"].str.strip().str.lower() == "yes").astype(int)
    clean_and_save(df, "corpus1")

def process_corpus2():
    print("Processing Corpus 2...")
    df = pd.read_excel(f"{DESKTOP_DIR}/drive-download-20260728T095536Z-1-001/Corpus 2.xlsx", sheet_name="Corpora 2")
    # text is the 2nd col
    text_col = df.columns[1]
    df["text"] = df[text_col]
    
    def get_label(x):
        x = str(x).lower().strip()
        if "offensive" in x and "not" not in x:
            return 1
        return 0
        
    df["label"] = df["not offensive/neutral"].apply(get_label)
    clean_and_save(df, "corpus2")

if __name__ == "__main__":
    process_adhar()
    process_d021()
    process_lrec()
    process_task1()
    process_task2()
    process_corpus1()
    process_corpus2()
