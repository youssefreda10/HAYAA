import re
import unicodedata
import html


def normalize_arabic(text: str) -> str:
    if not isinstance(text, str) or not text.strip():
        return ""

    # 1. NFKC Unicode Normalization
    text = unicodedata.normalize("NFKC", text)

    # 2. HTML entity decoding + escaped chars
    text = html.unescape(text)
    text = text.replace("\\n", " ").replace("\\t", " ").replace("\\r", " ")
    text = text.replace("\n", " ").replace("\t", " ").replace("\r", " ")

    # 3. Zero-width character stripping
    zero_width = "​‌‍‎‏‪‫‬‭‮⁠⁡⁢⁣⁤﻿"
    for ch in zero_width:
        text = text.replace(ch, "")

    # 4. Placeholder & mention removal
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"www\.\S+", "", text)
    text = re.sub(r"@\w+", "", text)
    text = re.sub(r"\bRT\b", "", text)
    text = re.sub(r"\bUSER\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bURL\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bIDX\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bLF\b", "", text, flags=re.IGNORECASE)

    # 5. Strict Arabic-only filter (Removes punctuation, emojis, numbers, and non-Arabic letters)
    # Explicitly remove all digits (English, Arabic, Farsi)
    text = re.sub(r"[0-9٠-٩۰-۹]", " ", text)
    # Replace anything that is NOT a whitespace (\s) and NOT an Arabic character with a space
    text = re.sub(r"[^\s؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]", " ", text)

    # 6. Spaced-letter stitching (ك ل ب → كلب)
    text = re.sub(r"(?<=[؀-ۿ])\s(?=[؀-ۿ](?:\s|$))", "", text)

    # 7. Arabic orthographic normalization
    # Normalize Alefs
    text = re.sub(r"[إأآٱ]", "ا", text)
    # Remove diacritics (tashkeel)
    text = re.sub(r"[ً-ٰٟ]", "", text)
    # Remove tatweel (kashida)
    text = text.replace("ـ", "")
    # Farsi/Urdu letter substitution
    text = text.replace("ی", "ي")
    text = text.replace("ک", "ك")
    text = text.replace("ۀ", "ه")
    text = text.replace("ؤ", "و")
    text = text.replace("ئ", "ي")
    # NOTE: ة → ه is intentionally NOT done
    # NOTE: ى → ي is intentionally NOT done

    # 8. Compress repeated characters (max 2)
    text = re.sub(r"(.)\1{2,}", r"\1\1", text)

    # 9. Collapse multiple spaces
    text = re.sub(r"\s+", " ", text)

    # 10. Strip
    text = text.strip()

    return text
