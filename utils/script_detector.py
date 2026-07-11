import re


def is_arabic_script(text: str, threshold: float = 0.5) -> bool:
    if not isinstance(text, str) or not text.strip():
        return False
    arabic_chars = len(re.findall(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]", text))
    all_alpha = len(re.findall(r"[a-zA-Zа-яА-Я؀-ۿݐ-ݿ一-鿿]", text))
    if all_alpha == 0:
        return False
    return (arabic_chars / all_alpha) >= threshold


def has_mojibake(text: str) -> bool:
    return "�" in text if isinstance(text, str) else False
