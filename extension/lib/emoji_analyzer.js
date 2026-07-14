/* ============================================================
   Hayā — Emoji Analyzer (Layer 0.2)

   Extracts semantic toxicity from emojis before the normalizer
   strips them away. Emojis often carry the primary toxic intent
   in otherwise clean text.

   Handles:
   - Direct toxic emojis (🖕, 💩)
   - Contextual toxic emojis (🐕, 🐖 when directed at someone)
   - Threat emojis (🔪, 💀, 🔫)
   ============================================================ */

var HayaEmojiAnalyzer = (function () {

  // Directly toxic / offensive emojis
  var TOXIC_EMOJIS = new Set([
    "🖕", "🖕🏻", "🖕🏼", "🖕🏽", "🖕🏾", "🖕🏿", // Middle finger
    "💩", // Poop
  ]);

  // Emojis that are toxic if directed at a person (e.g. "انت 🐕")
  var ANIMAL_INSULTS = new Set([
    "🐕", "🐶", "🦮", "🐩", "🐕‍🦺", // Dog
    "🐖", "🐷", "🐗", "🐽", // Pig/Boar
    "🐴", "🐎", "🦓", "🫏", // Horse/Donkey
    "🐒", "🐵", "🦍", "🦧", // Monkey/Ape
    "🐐", "🐏", "🐑", // Goat/Sheep (Tiss/Kharouf)
    "🐀", "🐁", "🐭", // Rat/Mouse
  ]);

  // Threat emojis
  var THREAT_EMOJIS = new Set([
    "🔪", "🗡️", "⚔️", // Knife/Swords
    "🔫", "💣", "🧨", // Gun/Bomb/Dynamite
    "💀", "☠️", "🩸", // Skull/Blood
    "⚰️", "🪦", // Coffin/Tombstone
  ]);

  var ADDRESS_CUES = /(?:^|\s)(ya|يا|انت|انتي|انتم|انتو|انتوا)(?:\s|$)/i;

  function analyze(text) {
    if (!text || typeof text !== "string") {
      return { isToxic: false, score: 0, flags: [], extractedText: "" };
    }

    var flags = [];
    var score = 0;
    var isToxic = false;

    // Convert string to array of code points to properly iterate over emojis
    var chars = Array.from(text);
    var hasToxicEmoji = false;
    var hasAnimalInsult = false;
    var hasThreat = false;
    var extractedTextTokens = [];

    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (TOXIC_EMOJIS.has(ch)) hasToxicEmoji = true;
      if (ANIMAL_INSULTS.has(ch)) hasAnimalInsult = true;
      if (THREAT_EMOJIS.has(ch)) hasThreat = true;
    }

    if (hasToxicEmoji) {
      flags.push("toxic_emoji");
      score += 0.9;
      isToxic = true;
      extractedTextTokens.push("[شتيمة]");
    }

    if (hasThreat) {
      flags.push("threat_emoji");
      score += 0.8;
      // Threat emojis on their own might just be a joke, but highly suspicious
      // If combined with any negative text, it's very toxic
      extractedTextTokens.push("[تهديد]");
    }

    if (hasAnimalInsult) {
      // Only toxic if directed at someone
      if (ADDRESS_CUES.test(text)) {
        flags.push("directed_animal_insult");
        score += 0.85;
        isToxic = true;
        extractedTextTokens.push("[إهانة موجهة]");
      } else {
        flags.push("undirected_animal");
        score += 0.2; // Minor bump
      }
    }

    return {
      isToxic: isToxic,
      score: Math.min(score, 1.0),
      flags: flags,
      extractedText: extractedTextTokens.join(" ")
    };
  }

  return { analyze: analyze };
})();
