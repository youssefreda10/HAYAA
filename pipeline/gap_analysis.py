"""
Phase 5: Gap Analysis — Charts and Reports
"""
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import os

plt.rcParams["font.family"] = "Arial"
plt.rcParams["figure.dpi"] = 150

MERGED_PATH = "data/merged/haya_merged_clean.parquet"
OUT_DIR = "reports/charts"
os.makedirs(OUT_DIR, exist_ok=True)

df = pd.read_parquet(MERGED_PATH)
print(f"Loaded: {len(df):,} rows | Safe: {(df['label']==0).sum():,} | Toxic: {(df['label']==1).sum():,}")


# ============================================================
# 1. Class Distribution (Safe vs Toxic)
# ============================================================
fig, ax = plt.subplots(figsize=(6, 4))
counts = df["label"].value_counts().sort_index()
colors = ["#2ecc71", "#e74c3c"]
labels = [f"Safe\n{counts[0]:,} ({counts[0]/len(df)*100:.1f}%)",
          f"Toxic\n{counts[1]:,} ({counts[1]/len(df)*100:.1f}%)"]
ax.bar(labels, counts.values, color=colors, width=0.5, edgecolor="white")
ax.set_title("Class Distribution", fontsize=14, fontweight="bold")
ax.set_ylabel("Rows")
ax.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{x/1000:.0f}K"))
plt.tight_layout()
plt.savefig(f"{OUT_DIR}/1_class_distribution.png")
plt.close()
print("1. Class distribution saved")


# ============================================================
# 2. Source Dataset Contribution (Top 20)
# ============================================================
fig, ax = plt.subplots(figsize=(10, 6))
src = df["source"].str.split("|").str[0].value_counts().head(20)
bars = ax.barh(src.index[::-1], src.values[::-1], color="#3498db", edgecolor="white")
ax.set_title("Top 20 Source Datasets", fontsize=14, fontweight="bold")
ax.set_xlabel("Rows")
ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{x/1000:.0f}K"))
for bar, val in zip(bars, src.values[::-1]):
    ax.text(val + 1000, bar.get_y() + bar.get_height()/2, f"{val:,}", va="center", fontsize=7)
plt.tight_layout()
plt.savefig(f"{OUT_DIR}/2_source_contribution.png")
plt.close()
print("2. Source contribution saved")


# ============================================================
# 3. Dialect Distribution
# ============================================================
fig, ax = plt.subplots(figsize=(8, 5))
dial = df["dialect"].str.split("|").explode().value_counts()
ax.barh(dial.index[::-1], dial.values[::-1], color="#9b59b6", edgecolor="white")
ax.set_title("Dialect Distribution", fontsize=14, fontweight="bold")
ax.set_xlabel("Rows")
ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{x/1000:.0f}K"))
plt.tight_layout()
plt.savefig(f"{OUT_DIR}/3_dialect_distribution.png")
plt.close()
print("3. Dialect distribution saved")


# ============================================================
# 4. Text Length Distribution
# ============================================================
fig, axes = plt.subplots(1, 2, figsize=(12, 4))
for i, (label, name, color) in enumerate([(0, "Safe", "#2ecc71"), (1, "Toxic", "#e74c3c")]):
    lens = df[df["label"]==label]["text"].str.len()
    axes[i].hist(lens, bins=50, color=color, alpha=0.8, edgecolor="white")
    axes[i].set_title(f"{name} — Text Length Distribution", fontsize=12, fontweight="bold")
    axes[i].set_xlabel("Characters")
    axes[i].set_ylabel("Count")
    axes[i].axvline(lens.median(), color="black", linestyle="--", linewidth=1, label=f"Median: {lens.median():.0f}")
    axes[i].legend()
plt.tight_layout()
plt.savefig(f"{OUT_DIR}/4_text_length_distribution.png")
plt.close()
print("4. Text length distribution saved")


# ============================================================
# 5. Toxic Rate per Source
# ============================================================
fig, ax = plt.subplots(figsize=(10, 8))
sources = df["source"].str.split("|").str[0].value_counts().head(25).index
toxic_rates = []
for s in sources:
    mask = df["source"].str.contains(s, regex=False)
    total = mask.sum()
    tox = (mask & (df["label"]==1)).sum()
    toxic_rates.append((s, tox/total*100, total))

toxic_rates.sort(key=lambda x: x[1])
names = [r[0] for r in toxic_rates]
rates = [r[1] for r in toxic_rates]
colors_bar = ["#e74c3c" if r > 50 else "#f39c12" if r > 25 else "#2ecc71" for r in rates]

ax.barh(names, rates, color=colors_bar, edgecolor="white")
ax.set_title("Toxic Rate per Source (Top 25)", fontsize=14, fontweight="bold")
ax.set_xlabel("Toxic %")
ax.axvline(50, color="gray", linestyle="--", alpha=0.5)
for i, (name, rate, total) in enumerate(toxic_rates):
    ax.text(rate + 0.5, i, f"{rate:.0f}% ({total:,})", va="center", fontsize=7)
plt.tight_layout()
plt.savefig(f"{OUT_DIR}/5_toxic_rate_per_source.png")
plt.close()
print("5. Toxic rate per source saved")


# ============================================================
# 6. Category Coverage in Toxic Data
# ============================================================
categories = {
    "Profanity": ["كس", "زب ", "طيز", "خرا ", "شرموط"],
    "Hate Speech": ["يلعن", "لعن", "كافر", "رافض", "صهيون"],
    "Insults": ["غبي", "احمق", "اهبل", "حمار", " كلب", "خنزير"],
    "Sexual Content": ["سكس", "جنسي", "اباحي", "يضاجع", "قضيب", "مهبل", "ممحون"],
    "Cyberbullying": ["مقرف", "قبيح", "بشع", "دميم"],
    "Religious Hate": ["كافر", "مرتد", "رافض", "مجوس", "نصيري", "صفوي"],
    "Racism": ["عنصر", "عرق", "زنجي"],
    "Sexism": ["نسوي", "حريم", "ناقصات عقل"],
    "Violence": ["اقتل", "اذبح", "احرق", "دماء"],
    "Harassment": ["تحرش", "مطارد"],
}

fig, ax = plt.subplots(figsize=(10, 5))
toxic_texts = df[df["label"]==1]["text"]
cat_counts = {}
for cat, keywords in categories.items():
    count = sum(toxic_texts.str.contains(kw, regex=False).sum() for kw in keywords)
    cat_counts[cat] = count

sorted_cats = sorted(cat_counts.items(), key=lambda x: x[1], reverse=True)
cat_names = [c[0] for c in sorted_cats]
cat_vals = [c[1] for c in sorted_cats]
cat_pcts = [v/len(toxic_texts)*100 for v in cat_vals]

colors_cat = plt.cm.RdYlGn_r([p/max(cat_pcts) for p in cat_pcts])
ax.barh(cat_names[::-1], cat_pcts[::-1], color=colors_cat[::-1], edgecolor="white")
ax.set_title("Category Coverage in Toxic Data", fontsize=14, fontweight="bold")
ax.set_xlabel("% of Toxic Rows Containing Keywords")
for i, (name, pct, val) in enumerate(zip(cat_names[::-1], cat_pcts[::-1], cat_vals[::-1])):
    ax.text(pct + 0.2, i, f"{pct:.1f}% ({val:,})", va="center", fontsize=8)
plt.tight_layout()
plt.savefig(f"{OUT_DIR}/6_category_coverage.png")
plt.close()
print("6. Category coverage saved")


# ============================================================
# 7. Dialect x Class Cross-tabulation
# ============================================================
dial_class = df.copy()
dial_class["dialect_first"] = dial_class["dialect"].str.split("|").str[0]
top_dialects = dial_class["dialect_first"].value_counts().head(8).index
dial_class = dial_class[dial_class["dialect_first"].isin(top_dialects)]

ct = pd.crosstab(dial_class["dialect_first"], dial_class["label"])
ct.columns = ["Safe", "Toxic"]
ct = ct.sort_values("Toxic", ascending=True)

fig, ax = plt.subplots(figsize=(10, 5))
ct.plot(kind="barh", stacked=True, color=["#2ecc71", "#e74c3c"], ax=ax, edgecolor="white")
ax.set_title("Dialect x Class Distribution", fontsize=14, fontweight="bold")
ax.set_xlabel("Rows")
ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{x/1000:.0f}K"))
ax.legend(loc="lower right")
plt.tight_layout()
plt.savefig(f"{OUT_DIR}/7_dialect_class_crosstab.png")
plt.close()
print("7. Dialect x Class saved")


# ============================================================
# Summary report
# ============================================================
print(f"\n{'='*60}")
print(f"PHASE 5 COMPLETE — Gap Analysis")
print(f"{'='*60}")
print(f"Total rows: {len(df):,}")
print(f"Safe: {(df['label']==0).sum():,} ({(df['label']==0).sum()/len(df)*100:.1f}%)")
print(f"Toxic: {(df['label']==1).sum():,} ({(df['label']==1).sum()/len(df)*100:.1f}%)")
print(f"Sources: {df['source'].str.split('|').explode().nunique()}")
print(f"Charts saved to: {OUT_DIR}/")
print(f"Files: {os.listdir(OUT_DIR)}")
