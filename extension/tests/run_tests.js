var fs = require("fs");
eval(fs.readFileSync(__dirname + "/../lib/normalizer.js", "utf8"));
eval(fs.readFileSync(__dirname + "/../lib/dictionary.js", "utf8"));
eval(fs.readFileSync(__dirname + "/../lib/matcher.js", "utf8"));

var wordGroups = {
  exact: HayaDictionary.words,
  partial: new Set(),
  regex: HayaDictionary.patterns || [],
};

function check(text) {
  var normalized = HayaNormalizer.normalize(text);
  var matched = normalized && HayaMatcher.check(normalized, wordGroups);
  return { normalized: normalized, matched: matched };
}

var TESTS = {
  "Profanity — Egyptian": [
    ["كسمك",true],["كسمه",true],["عرص",true],["عرصه",true],["خول",true],
    ["شرموطة",true],["متناكة",true],["يا ابن الشرموطة",true],["ابن المتناكة",true],
    ["احا",true],["بضان",true],["يا خولات",true],["كسامك",true],
    ["يلعن ابوك",true],["يلعن امك",true],["يلعن دينك",true],
  ],
  "Profanity — Gulf": [
    ["كشخة",true],["قواد",true],["قوادة",true],["ديوث",true],["تفو",true],
    ["معرص",true],["يا تيس",true],["حقير",true],["خايس",true],
    ["طز فيك",true],["يا قذر",true],["ام سافلة",true],
  ],
  "Profanity — Levantine": [
    ["كس اختك",true],["كس امك",true],["يلعن ربك",true],["منيوكة",true],
    ["شرموط",true],["ابن الحرام",true],["يا حيوان",true],["يا كلب",true],
    ["زبالة",true],["مقرف",true],["بدي فشخك",true],["لك يا حمار",true],
  ],
  "Profanity — Maghrebi": [
    ["قحبة",true],["قحاب",true],["نيك موك",true],["ولد الحرام",true],
    ["زعطوط",true],["بوزلوف",true],["يا مخنث",true],["تبون امك",true],
    ["كحبة",true],["يا حشايشي",true],
  ],
  "Sexual Explicit": [
    ["كس",true],["زب",true],["زبر",true],["طيز",true],["نيك",true],
    ["ينيك",true],["انيك",true],["نايك",true],["نياك",true],["عير",true],
    ["زاني",true],["زانية",true],["لبوة",true],["مزز",true],["عيرك",true],["طيزك",true],
  ],
  "Insults": [
    ["يا حمار",true],["يا غبي",true],["يا اهبل",true],["يا تافه",true],
    ["يا جبان",true],["يا كذاب",true],["يا حقير",true],["يا وسخ",true],
    ["يا فاشل",true],["يا منافق",true],["يا عبيط",true],["يا معفن",true],
    ["يا قذر",true],["يا نذل",true],["يا وطي",true],["يا جحش",true],
    ["ابن الكلب",true],["يا ابن الحرام",true],
  ],
  "Harassment (Layer 1 catchable)": [
    ["هفضحك",true],["هدمرك",true],["مش هسيبك",true],["هلاحقك في كل مكان",true],
    ["هخلي حياتك جحيم",true],
  ],
  "Harassment (Layer 2 — AI only)": [
    ["انا عارف بيتك فين",false],["وريني صورتك",false],
    ["مفيش حد هيصدقك",false],
  ],
  "Cyberbullying (Layer 1 catchable)": [
    ["روح انتحر",true],["محدش بيحبك",true],
    ["شكلك مقرف",true],["مكانك الزبالة",true],
    ["يا فاشل يا ابن الفاشل",true],["اتمنى تموت",true],
  ],
  "Cyberbullying (Layer 2 — AI only)": [
    ["الدنيا احسن من غيرك",false],
    ["يا خسارة فيك الاكل",false],
  ],
  "Racism (Layer 1 catchable)": [
    ["يا عبد",true],["يا زنجي",true],["ارجع لبلدك",true],["يا خادم",true],
    ["العبيد دول",true],["انتو بهائم",true],["الاجانب دول وسخين",true],["يا هندي",true],
  ],
  "Religious Hate (Layer 2 — AI only)": [
    ["يلعن دينك",true],["يلعن ربك",true],
    ["كفار",false],["يا كافر",false],
    ["يا مشرك",false],["يا مرتد",false],["يا يهودي",false],
    ["النصارى اعداء الله",false],["الشيعة انجاس",false],["السنة خوارج",false],
  ],
  "Sexism (Layer 1 catchable)": [
    ["البنات ناقصات عقل",true],
  ],
  "Sexism (Layer 2 — AI only)": [
    ["مكانك المطبخ",false],["النسوان مبيفهموش",false],
    ["استاهلت لانها لابسة كده",false],["بنت والا ولد",false],
    ["يا ست اقعدي ساكتة",false],["المراة مخلوقة ضعيفة",false],["البنت لازم تسمع كلام",false],
  ],
  "Threats (Layer 1 catchable)": [
    ["هقتلك",true],["هذبحك",true],["هكسرك",true],
    ["هضربك ضرب",true],["دمك على رقبتي",true],
  ],
  "Threats (Layer 2 — AI only)": [
    ["مستنيك على الباب",false],["والله لاوريك",false],["انت ميت ميت",false],
  ],
  "Obfuscation — Separators": [
    ["ع-ر-ص",true],["ع.ر.ص",true],["ك_س_م_ك",true],["ش/ر/م/و/ط/ة",true],
    ["خ-و-ل",true],["ن.ي.ك",true],["م-ت-ن-ا-ك",true],["ق.ح.ب.ة",true],
  ],
  "Obfuscation — Repeated": [
    ["عررررص",true],["خووووول",true],["شرمووووطة",true],["كسسسسمك",true],
    ["نيييييك",true],["متنااااك",true],["حقيييير",true],["وسسسسخ",true],
  ],
  "Obfuscation — Spaced": [
    ["ع ر ص",true],["ك س م ك",true],["خ و ل",true],
    ["ن ي ك",true],["ش ر م و ط ة",true],["ق ح ب ة",true],
  ],
  "Obfuscation — Diacritics": [
    ["عَرَص",true],["كُسْمَك",true],["شَرْمُوطَة",true],
    ["خَوَلْ",true],["نِيكْ",true],["مُتَنَاك",true],
  ],
  "Obfuscation — Tatweel": [
    ["عـــرص",true],["خـول",true],["شـرمـوطـة",true],["كـسـمـك",true],
  ],
  "Obfuscation — Alef": [
    ["إبن الشرموطة",true],["أبن القحبة",true],["آبن الكلب",true],["إحا",true],
  ],
  "Morphological": [
    ["عراصة",true],["خولنة",true],["شراميط",true],["منايك",true],
    ["قحاب",true],["عواهر",true],["يتناك",true],["اتعرص",true],
    ["متعرص",true],["بتنيك",true],["هتنيك",true],["نكت",true],["تنيك",true],
  ],
  "Context-Dependent": [
    ["يا بن الحلال اسكت",false],["الكلب بتاعي مريض",false],["الحمار ده لطيف",false],
    ["هو وسخ الهدوم",true],["الحق عليك انت واطي اوي",true],
    ["الله يسامحك يا حبيبي",false],
  ],
  "Code-Switching (Layer 2 — AI only)": [
    ["you are عرص",true],
    ["انت trash اصلا",false],["يا loser يا فاشل",true],
    ["this guy كلب",false],
  ],
  "Different Spellings": [
    ["قحبه",true],["شرموطه",true],["عاهره",true],["وسخه",true],
    ["حقيره",true],["ساقطه",true],["نجسه",true],["ملعونه",true],
  ],
  "Safe — False Positives": [
    ["عرس جميل",false],["كسر الزجاج",false],["حقيقة مهمة",false],
    ["يا سلام عليك",false],["الله يبارك فيك",false],["شكرا جزيلا لك",false],
    ["احسنت يا بطل",false],["ماشاء الله تبارك الله",false],["ربنا يحفظك",false],
    ["كل سنة وانت طيب",false],["مبروك عليك",false],["تحياتي لحضرتك",false],
    ["الزبدة والجبنة",false],["طيز الخروف",true],["انا عايز اسال سوال",false],
    ["الجو حلو اليوم",false],
  ],
};

var totalPass=0, totalFail=0, totalTests=0;
var gaps = [];

console.log("");
console.log("=".repeat(55));
console.log("  HAYA TEST SUITE RESULTS (Dictionary Layer 1)");
console.log("=".repeat(55));

for (var cat in TESTS) {
  var cases = TESTS[cat];
  var p=0, f=0;
  var fails = [];
  for (var j=0; j<cases.length; j++) {
    var input = cases[j][0], expect = cases[j][1];
    var r = check(input);
    totalTests++;
    if (r.matched === expect) { p++; totalPass++; }
    else {
      f++; totalFail++;
      fails.push([input, expect, r.matched, r.normalized]);
      gaps.push([cat, input, expect, r.matched, r.normalized]);
    }
  }
  var pct = Math.round(p/cases.length*100);
  var mark = f === 0 ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  var color = f === 0 ? "\x1b[32m" : (pct >= 50 ? "\x1b[33m" : "\x1b[31m");
  console.log(mark + " " + cat + ": " + color + p + "/" + cases.length + " (" + pct + "%)\x1b[0m");
  for (var k=0;k<fails.length;k++) {
    var fl = fails[k];
    var lbl = fl[1] ? "\x1b[31mMISSED\x1b[0m" : "\x1b[33mFALSE POS\x1b[0m";
    console.log("    \x1b[31m✗\x1b[0m \"" + fl[0] + "\" (norm: \"" + fl[3] + "\") — " + lbl);
  }
}

var rate = Math.round(totalPass/totalTests*100);
console.log("");
console.log("-".repeat(55));
console.log("TOTAL: " + totalTests + " tests | \x1b[32m" + totalPass + " passed\x1b[0m | \x1b[31m" + totalFail + " failed\x1b[0m | Rate: " + rate + "%");
console.log("-".repeat(55));

if (gaps.length > 0) {
  console.log("");
  console.log("=".repeat(55));
  console.log("  GAP ANALYSIS — " + gaps.length + " FAILURES");
  console.log("=".repeat(55));

  var byCat = {};
  for (var g=0;g<gaps.length;g++) {
    var c = gaps[g][0];
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(gaps[g]);
  }

  for (var c in byCat) {
    console.log("\n\x1b[36m" + c + " (" + byCat[c].length + " gaps):\x1b[0m");
    for (var i=0;i<byCat[c].length;i++) {
      var g = byCat[c][i];
      var lbl = g[2] ? "SHOULD CATCH" : "FALSE POSITIVE";
      console.log("  \"" + g[1] + "\" → norm: \"" + g[4] + "\" — \x1b[31m" + lbl + "\x1b[0m");
    }
  }
}
