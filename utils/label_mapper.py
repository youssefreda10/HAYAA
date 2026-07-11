import re


def is_corrupt_label(label) -> bool:
    label_str = str(label).strip()
    if len(label_str) > 30:
        return True
    arabic_chars = len(re.findall(r"[؀-ۿ]", label_str))
    if arabic_chars > 5:
        return True
    return False


def map_label_to_binary(label, label_map: dict) -> int | None:
    label_str = str(label).strip()
    if label_str in label_map:
        return label_map[label_str]
    label_lower = label_str.lower()
    if label_lower in label_map:
        return label_map[label_lower]
    return None
