# ============================================================
# Hayā — Arabizi Transliterator (Python Pipeline)
#
# Detects and transliterates Latin-script Arabic (Arabizi)
# in the training datasets to ensure the MARBERT model learns
# the correct Arabic forms.
# ============================================================

import re

# Detection constants
HAS_LATIN_RE = re.compile(r'[a-zA-Z]')
HAS_ARABIC_RE = re.compile(r'[\u0600-\u06FF]')
ARABIZI_NUMBERS_RE = re.compile(r'[2345679]')
URL_RE = re.compile(r'https?://\S+|www\.\S+')
ARABIZI_PATTERNS_RE = re.compile(
    r'\b(ya|yala|w?allah|insha|7a[br]|ma3a|3ala|kos|7mar|a5|el|el-|al-|ibn|bnt|kel[bm]|shar?m|na?yek|5awal|ta7t)\b', 
    re.IGNORECASE
)

# Digraphs (ordered longest-first)
DIGRAPHS = [
    ("sha", "\u0634"),    
    ("shi", "\u0634\u064A"),
    ("shu", "\u0634\u0648"),
    ("kha", "\u062E"),    
    ("khi", "\u062E\u064A"),
    ("khu", "\u062E\u0648"),
    ("gha", "\u063A"),    
    ("ghi", "\u063A\u064A"),
    ("ghu", "\u063A\u0648"),
    ("tha", "\u062B"),    
    ("dha", "\u0630"),    
    ("sh", "\u0634"),     
    ("kh", "\u062E"),     
    ("gh", "\u063A"),     
    ("th", "\u062B"),     
    ("dh", "\u0630"),     
    ("ch", "\u062A\u0634"), 
    ("ou", "\u0648"),     
    ("oo", "\u0648"),     
    ("ee", "\u064A"),     
    ("aa", "\u0627"),     
    ("ii", "\u064A"),     
    ("ph", "\u0641"),     
]

# Number Combos
NUMBER_COMBOS = [
    ("3a", "\u0639"),     
    ("3e", "\u0639"),
    ("3i", "\u0639\u064A"),
    ("7a", "\u062D"),     
    ("7e", "\u062D"),
    ("7i", "\u062D\u064A"),
    ("5a", "\u062E"),     
    ("5e", "\u062E"),
    ("9a", "\u0635"),     
    ("6a", "\u0637"),     
    ("2a", "\u0623"),     
    ("2i", "\u0625"),     
    ("2o", "\u0624"),     
]

# Mapping single letters and numbers
NUMBER_MAP = {
    "2": "\u0621",        
    "3": "\u0639",        
    "5": "\u062E",        
    "6": "\u0637",        
    "7": "\u062D",        
    "8": "\u0642",        
    "9": "\u0635",        
    "4": "\u0630",        
}

SINGLE_MAP = {
    "a": "\u0627", "b": "\u0628", "t": "\u062A", "g": "\u062C", "j": "\u062C",
    "d": "\u062F", "r": "\u0631", "z": "\u0632", "s": "\u0633", "f": "\u0641",
    "q": "\u0642", "k": "\u0643", "l": "\u0644", "m": "\u0645", "n": "\u0646",
    "h": "\u0647", "w": "\u0648", "y": "\u064A", "i": "\u064A", "e": "\u0627",
    "o": "\u0648", "u": "\u0648", "p": "\u0628", "v": "\u0641", "x": "\u0643\u0633",
}

# Common word map (same as JS)
WORD_MAP = {
    "ksmk": "\u0643\u0633\u0645\u0643",
    "kosomak": "\u0643\u0633\u0645\u0643",
    "kos": "\u0643\u0633",
    "a7a": "\u0627\u062D\u0627",
    "ya7mar": "\u064A\u0627 \u062D\u0645\u0627\u0631",
    "7mar": "\u062D\u0645\u0627\u0631",
    "7mara": "\u062D\u0645\u0627\u0631\u0629",
    "5awal": "\u062E\u0648\u0644",
    "5awalat": "\u062E\u0648\u0644\u0627\u062A",
    "sharmoota": "\u0634\u0631\u0645\u0648\u0637\u0629",
    "sharmoot": "\u0634\u0631\u0645\u0648\u0637",
    "sharmouta": "\u0634\u0631\u0645\u0648\u0637\u0629",
    "3ars": "\u0639\u0631\u0635",
    "3arsa": "\u0639\u0631\u0635\u0629",
    "metnak": "\u0645\u062A\u0646\u0627\u0643",
    "metnaka": "\u0645\u062A\u0646\u0627\u0643\u0629",
    "ibn el sharmoota": "\u0627\u0628\u0646 \u0627\u0644\u0634\u0631\u0645\u0648\u0637\u0629",
    "ibn el kalb": "\u0627\u0628\u0646 \u0627\u0644\u0643\u0644\u0628",
    "ebn el kalb": "\u0627\u0628\u0646 \u0627\u0644\u0643\u0644\u0628",
    "dayooth": "\u062F\u064A\u0648\u062B",
    "gawaad": "\u0642\u0648\u0627\u062F",
    "m3rs": "\u0645\u0639\u0631\u0635",
    "kos o5tak": "\u0643\u0633 \u0627\u062E\u062A\u0643",
    "kos ommak": "\u0643\u0633 \u0627\u0645\u0643",
    "kosommak": "\u0643\u0633 \u0627\u0645\u0643",
    "manyook": "\u0645\u0646\u064A\u0648\u0643",
    "manyooka": "\u0645\u0646\u064A\u0648\u0643\u0629",
    "ya kalb": "\u064A\u0627 \u0643\u0644\u0628",
    "ya kelb": "\u064A\u0627 \u0643\u0644\u0628",
    "n3al bouk": "\u0646\u0639\u0644 \u0628\u0648\u0643",
    "na3al bouk": "\u0646\u0639\u0644 \u0628\u0648\u0643",
    "zamel": "\u0632\u0627\u0645\u0644",
    "zamla": "\u0632\u0627\u0645\u0644\u0629",
    "9armouta": "\u0634\u0631\u0645\u0648\u0637\u0629",
    "7alouf": "\u062D\u0644\u0648\u0641",
    "9a7bi": "\u0635\u0627\u062D\u0628\u064A",
    "ya 8abee": "\u064A\u0627 \u063A\u0628\u064A",
    "ya ghabi": "\u064A\u0627 \u063A\u0628\u064A",
    "3abeet": "\u0639\u0628\u064A\u0637",
    "ahbal": "\u0627\u0647\u0628\u0644",
    "5anzeera": "\u062E\u0646\u0632\u064A\u0631\u0629",
    "ha2tlak": "\u0647\u0642\u062A\u0644\u0643",
    "ha2tolk": "\u0647\u0642\u062A\u0644\u0643",
    "haotlak": "\u0647\u0642\u062A\u0644\u0643",
    "haktolak": "\u0647\u0642\u062A\u0644\u0643",
    "nik": "\u0646\u064A\u0643",
    "nayek": "\u0646\u0627\u064A\u0643",
    "anik": "\u0627\u0646\u064A\u0643",
    "zb": "\u0632\u0628",
    "teez": "\u0637\u064A\u0632",
    "tez": "\u0637\u064A\u0632",
    "gandara": "\u0642\u0646\u062F\u0631\u0629",
    "sarsari": "\u0633\u0631\u0633\u0631\u064A",
    "kadeesa": "\u0643\u062F\u064A\u0633\u0647",
    "kooz": "\u0643\u0648\u0632",
    "zool ghabi": "\u0632\u0648\u0644 \u063A\u0628\u064A",
    "zool": "\u0632\u0648\u0644",
    "masid": "\u0645\u0633\u064A\u062F",
    "kharrat": "\u062E\u0631\u0627\u0637",
    "msa5": "\u0645\u0633\u062E",
    "zanim": "\u0632\u0646\u064A\u0645",
}

def is_arabizi(text: str) -> bool:
    if not text or not HAS_LATIN_RE.search(text):
        return False
    if HAS_ARABIC_RE.search(text):
        return False
        
    cleaned = URL_RE.sub("", text).strip()
    if len(cleaned) < 3:
        return False
        
    if ARABIZI_NUMBERS_RE.search(cleaned):
        return True
        
    if ARABIZI_PATTERNS_RE.search(cleaned):
        return True
        
    return False

def transliterate_word(word: str) -> str:
    if not word: return word
    
    lower = word.lower()
    if lower in WORD_MAP:
        return WORD_MAP[lower]
        
    result = []
    i = 0
    length = len(lower)
    
    while i < length:
        matched = False
        
        # Try number combos
        for combo, rep in NUMBER_COMBOS:
            if lower[i:i+len(combo)] == combo:
                result.append(rep)
                i += len(combo)
                matched = True
                break
        if matched: continue
        
        # Try digraphs
        for dg, rep in DIGRAPHS:
            if lower[i:i+len(dg)] == dg:
                result.append(rep)
                i += len(dg)
                matched = True
                break
        if matched: continue
        
        ch = lower[i]
        if ch in NUMBER_MAP:
            result.append(NUMBER_MAP[ch])
        elif ch in SINGLE_MAP:
            result.append(SINGLE_MAP[ch])
        else:
            result.append(word[i]) # keep original casing if possible
            
        i += 1
        
    return "".join(result)

def transliterate(text: str) -> str:
    if not text or not is_arabizi(text):
        return text
        
    lower_trim = text.lower().strip()
    if lower_trim in WORD_MAP:
        return WORD_MAP[lower_trim]
        
    words = text.split()
    return " ".join(transliterate_word(w) for w in words)
