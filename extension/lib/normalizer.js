/* Hayā — Arabic Text Normalizer (ported from utils/arabic_normalizer.py) */

var HayaNormalizer = (function () {
  var ZERO_WIDTH = "​‌‍‎‏‪‫‬‭‮⁠⁡⁢⁣⁤﻿";
  var ARABIC_RANGE = "[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]";
  var ARABIC_RE = new RegExp(ARABIC_RANGE);
  var NOT_ARABIC_OR_SPACE = new RegExp("[^\\s\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]", "g");
  var DIGITS_RE = /[0-9٠-٩۰-۹]/g;
  var DIACRITICS_RE = /[ً-ٰٟ]/g;
  var ALEF_RE = /[إأآٱ]/g;
  var REPEATED_RE = /(.)\1{2,}/g;
  var SPACES_RE = /\s+/g;
  var SPACED_LETTERS_RE;

  try {
    SPACED_LETTERS_RE = new RegExp("(?<=" + ARABIC_RANGE + ")\\s(?=" + ARABIC_RANGE + "(?:\\s|$))", "g");
  } catch (e) {
    SPACED_LETTERS_RE = null;
  }

  function normalize(text) {
    if (!text || typeof text !== "string") return "";

    text = text.normalize("NFKC");

    for (var i = 0; i < ZERO_WIDTH.length; i++) {
      text = text.split(ZERO_WIDTH[i]).join("");
    }

    text = text.replace(/https?:\/\/\S+/g, "");
    text = text.replace(/www\.\S+/g, "");
    text = text.replace(/@\w+/g, "");
    text = text.replace(/\bRT\b/g, "");
    text = text.replace(/\bUSER\b/gi, "");
    text = text.replace(/\bURL\b/gi, "");

    text = text.replace(DIGITS_RE, " ");
    text = text.replace(NOT_ARABIC_OR_SPACE, " ");

    if (SPACED_LETTERS_RE) {
      text = text.replace(SPACED_LETTERS_RE, "");
    }

    text = text.replace(ALEF_RE, "ا");
    text = text.replace(DIACRITICS_RE, "");
    text = text.split("ـ").join("");

    text = text.replace(/ی/g, "ي"); // ی → ي
    text = text.replace(/ک/g, "ك"); // ک → ك
    text = text.replace(/ۀ/g, "ه"); // ۀ → ه
    text = text.replace(/ؤ/g, "و"); // ؤ → و
    text = text.replace(/ئ/g, "ي"); // ئ → ي

    text = text.replace(REPEATED_RE, "$1$1");
    text = text.replace(SPACES_RE, " ").trim();

    return text;
  }

  return { normalize: normalize };
})();
