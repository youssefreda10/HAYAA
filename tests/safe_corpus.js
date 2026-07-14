/* ============================================================
   Hayā — Hard-Negative (SAFE) Corpus Generator

   The 100K stress suite is ~99.7% toxic, so it barely measures
   PRECISION — yet blurring innocent Arabic is this product's
   worst failure mode. This module generates a large, adversarial
   corpus of text that MUST stay safe, targeting exactly where a
   recall-tuned rule engine tends to over-fire:

     1. Proper names that embed a profanity substring / stem
     2. Innocent words that contain a slur as a substring
     3. Neutral mention of a religion / ethnicity (identity ≠ hate)
     4. Contextual & pejorative words in descriptive (undirected) use
     5. Fiqh / news / literary registers that quote harsh words
     6. Safe text pushed through the same obfuscations as the attacks
        (obfuscation must never CREATE a hit that wasn't there)

   Every case here is expected == 0. Any hit is a false positive.
   ============================================================ */

// ── 1. Proper names embedding a stem ────────────────────────
// Real Arabic given names / surnames / place names that overlap a
// dictionary stem after affix stripping.
const NAMES = [
  "عبد الرحمن صديقي", "عبد الله جه امبارح", "عبد العزيز مدير الشركة",
  "عبيدة بن الجراح صحابي", "خوله بنت الازور بطلة", "الخولي مسؤول المزرعة",
  "شحاته لاعب كورة", "نورا بنت خالتي", "نور الهدى اسمها حلو",
  "شرم الشيخ مدينة سياحية", "كفر الشيخ محافظة", "كفر الدوار",
  "عبد الناصر زعيم", "زبيدة زوجة هارون الرشيد", "طيبة اسم قديم للمدينة",
  "بربر مدينة في السودان", "زنجبار جزيرة", "حمورابي ملك بابل",
];

// ── 2. Innocent words containing a slur substring ───────────
const SUBSTRING_TRAPS = [
  "كسر الزجاج على الارض", "انكسر الكوب في المطبخ", "المكسرات غالية السنة دي",
  "كساء الشتاء دافي", "اكتساب مهارة جديدة", "الكسل مش كويس",
  "زبدة الفول السوداني لذيذة", "الزبون دايما على حق", "زبيب وتين للفطار",
  "زبالة الشارع اترفعت", "معرض الكتاب افتتح", "عرض تقديمي مهم",
  "معيار الجودة عالي", "عيار الذهب واحد وعشرين", "زقاق ضيق في الحي",
  "طهارة الماء مهمة", "حمار الوحش حيوان بري", "لحم الخنزير محرم",
  "قصة قصيرة جميلة", "المقص حاد", "نيكولا اسم اجنبي",
];

// Accepted trade-offs: the profane token is used here in a rare literal /
// technical sense (طيز = anatomical, زبر النخل = palm pruning). Catching the
// slur in normal use is worth over-firing on these edge registers, so they
// are expected-safe-but-accepted rather than bugs. The AI model (Layer 2)
// could recover them with context; Layer 1 deliberately does not try.
const ACCEPTED_TRAPS = [
  "الطيز مصطلح تشريحي في كتاب طب",
  "زبر النخل يعني تقليمه في الزراعة",
];

// ── 3. Neutral identity mention (religion / ethnicity) ──────
// Naming a faith or people is not hate. These are the precision
// failures the audit surfaced — the identity terms live in the
// UNCONDITIONAL dictionary today, so all of these currently fire.
const IDENTITY_NEUTRAL = [
  "صديقي مسيحي محترم جدا", "زميلي يهودي شخص طيب", "جاري مسلم كريم",
  "الدين اليهودي من الاديان السماوية", "الديانة المسيحية منتشرة",
  "زرت كنيسة مع صديقي النصراني", "المذهب الشيعي له اتباع كتير",
  "درست تاريخ الاديان في الجامعة", "الملحد له رايه والمؤمن له رايه",
  "حرية العقيدة مكفولة", "كتاب عن المجوس في فارس القديمة",
  "البربر سكان شمال افريقيا الاصليين", "الاقلية اليهودية في المغرب",
  "احترم كل الاديان والطوائف", "التسامح الديني قيمة مهمة",
  "كافر بالطاغوت مؤمن بالله", // Quranic register: rejecting idols
  // ── سب الدين negative: استخدام عادي لكلمات دين/رب ──
  "ربنا يوفقك ويسعدك", "يا رب ارحمنا واغفر لنا",
  "على دين محمد صلى الله عليه وسلم", "دين الحق واضح",
  "ابو بكر الصديق رضي الله عنه", "ابو هريرة راوي حديث",
  "الدين الاسلامي دين رحمة", "ربك كريم وغفور",
  "كل انسان حر في دينه", "ربنا يحفظك ويرعاك",
  "التدين والايمان قيم جميلة", "بديني وعقيدتي فخور",
  "دين ابراهيم عليه السلام", "ربنا يهديك ويصلح حالك",
];

// ── 4. Contextual / pejorative words, descriptive (undirected) ──
const DESCRIPTIVE = [
  "شيل الوسخ من الشارع", "الملابس وسخة محتاجة غسيل", "المكان قذر محتاج تنظيف",
  "الماء نجس شرعا ولا طاهر", "طعم الاكل مقرف بصراحة", "رائحة كريهة ومقرفة",
  "الحمار حيوان صبور", "الكلب حارس امين", "التيس ذكر الماعز",
  "اشتريت تيس للعيد", "حديقة الحيوان فيها قرود", "الجحش صغير الحمار",
  "رميت الزبالة بره البيت", "عربية الزبالة عدت", "البهيمة بتاكل عشب",
  "عبيد اسم زميلي في الشغل", "الخادم في الفندق مؤدب", "العامل الهندي شغال كويس",
  "طز كلمة زفت بس مش موجهة لحد هنا", "الغبار كتير النهاردة",
  // ── ألفاظ لها استخدام عادي — سياقية/وصفية ──
  "حالة شاذة في العلم", "قاعدة شاذة في النحو", "ظاهرة شاذة عن المالوف",
  "الطفل بيمص صباعه", "مص العصير بالشاليموه",
  "لحس القطة الطبق", "الولد لحس الايس كريم",
  // ── كلمات مزدوجة الاستخدام (جنسي + حيادي) ──
  "الفرج بعد الشدة قريب", "فرج الله همك", "باب الفرج في حلب",
  "ثدي الام مهم للرضاعة الطبيعية", "سرطان الثدي مرض خطير",
  "حلمة الزجاجة للطفل", "قضبان الحديد في البناء",
  "شهوة العلم والمعرفة", "شهوة الطعام قوية",
  "بالاجماع تم الاتفاق", "حكم الجماع في رمضان شرعا",
  "المبادل الحراري في المصنع", "بلغ الاحتلام سن البلوغ",
  "الولد لعق الايس كريم",
];

// ── 5. Register: news / fiqh / literary quoting harsh words ──
const REGISTER = [
  "قال الخطيب ان الكذب حرام", "حذر الشيخ من الغيبة والنميمة",
  "المقال بيتكلم عن ظاهرة التنمر في المدارس", "دراسة عن خطاب الكراهية اونلاين",
  "الفيلم بيناقش قضية العنصرية", "الرواية فيها شخصية شريرة",
  "الحديث عن اداب الطريق والنظافة", "محاضرة عن حقوق المراة في الاسلام",
  "الاعلامي اتكلم عن الفقر والتشرد", "تقرير عن جرائم التحرش",
];

// ── 6. Everyday clean text (broad coverage) ─────────────────
const EVERYDAY = [
  "صباح الخير يا جماعة", "ازيك عامل ايه النهاردة", "الحمد لله على كل حال",
  "المباراة كانت حلوة اوي", "الجو حر جدا انهاردة", "ربنا يكرمك ويوفقك",
  "المدرسة بتبدا الساعة سبعة", "عايز اشتري كتاب جديد", "كل سنة وانت طيب",
  "مبروك عليك الشغل الجديد", "تحياتي لحضرتك واحترامي", "شكرا جزيلا على المساعدة",
  "احسنت يا بطل عمل رائع", "ماشاء الله تبارك الله", "ربنا يحفظك ويرعاك",
  "الله يبارك فيك وفي عيلتك", "يا رب يسرها وتعدي بخير", "يا دكتور شكرا على الكشف",
  "يا استاذ محمد ممكن سؤال", "يا اخي الكريم جزاك الله خير",
  "انت شخص محترم وقيمة", "انتي انسانة رائعة وطيبة", "يا حبيبي وحشتني قوي",
  "القهوة الصبح احلى حاجة", "بحب اقرا الروايات", "السفر بيوسع المدارك",
];

// ── Obfuscations (mirror the attack generator) ──────────────
// Applying these to SAFE text must NOT create a hit.
const OBF = [
  ["Plain", w => w],
  ["Dots", w => w.split("").join(".")],
  ["Spaces", w => w.split("").join(" ")],
  ["Dashes", w => w.split("").join("-")],
  ["Tatweel", w => w.split("").join("ـ")],
  ["Diacritics", w => w.split("").join("َ")],
  ["ZeroWidth", w => w.split("").join("​")],
];

function build() {
  const cases = [];
  const seen = new Set();
  function add(text, category, flags = []) {
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    cases.push({ text, expected: 0, dialect: "SafeCorpus", category, flags });
  }

  // Accepted trade-offs: expected safe, but a Layer-1 hit is tolerated (see
  // ACCEPTED_TRAPS note). Flagged so the runner counts them apart from bugs.
  for (const t of ACCEPTED_TRAPS) add(t, "Accepted_Trap", ["accepted"]);

  const groups = {
    Name_Trap: NAMES,
    Substring_Trap: SUBSTRING_TRAPS,
    Identity_Neutral: IDENTITY_NEUTRAL,
    Descriptive_Undirected: DESCRIPTIVE,
    Register_Quote: REGISTER,
    Everyday_Clean: EVERYDAY,
  };

  for (const [cat, arr] of Object.entries(groups)) {
    for (const t of arr) {
      add(t, cat);
      // Light framing — safe text should survive being wrapped.
      add("والله " + t, cat, ["Framed"]);
      add(t + " يا جماعة", cat, ["Framed"]);
    }
  }

  // Obfuscation-does-not-create-a-hit: push a subset through each obf.
  const obfPool = [...NAMES, ...SUBSTRING_TRAPS, ...DESCRIPTIVE];
  for (const t of obfPool) {
    for (const [oName, oFn] of OBF) {
      if (oName === "Plain") continue;
      add(oFn(t), "Safe_Obfuscated", ["Obf_" + oName]);
    }
  }

  return cases;
}

module.exports = { build };

if (require.main === module) {
  const cases = build();
  const fs = require("fs");
  const path = require("path");
  const out = path.join(__dirname, "safe_corpus.json");
  fs.writeFileSync(out, JSON.stringify(cases, null, 2));
  console.log(`Generated ${cases.length} hard-negative (safe) cases → ${out}`);
}
