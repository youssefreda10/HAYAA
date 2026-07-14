/* Verify the Layer-2 block-text fix on a real DOM: a comment split across
   child elements must be sent to the model as ONE whole comment, once. */
const { JSDOM } = require("jsdom");

const dom = new JSDOM(`
  <div class="comment">
    والله يا اخي <span>محدش بيحبك خالص</span> <b>ومحدش طايقك</b>
    <a href="#">وكل اللي حواليك بيتمنوا تمشي</a> ومش عايزين يشوفوا وشك تاني ابدا
  </div>
  <p>صباح الخير يا جماعة</p>
`);
const document = dom.window.document;

// --- the exact logic now in content.js ---
const BLOCK_TAGS = new Set(["P","DIV","LI","TD","TH","ARTICLE","SECTION","BLOCKQUOTE","H1","H2","H3","H4","H5","H6","DD","DT","FIGCAPTION","MAIN"]);
const MAX_BLOCK_CHARS = 1000;
function getBlockElement(el){let n=el,h=0;while(n&&n!==document.body&&h<6){if(BLOCK_TAGS.has(n.tagName)){var textLen=(n.textContent||"").length;if(textLen<=2000)return n;return el;}n=n.parentElement;h++;}return el;}
function getBlockText(el){let t=(getBlockElement(el).textContent||"").replace(/\s+/g," ").trim();return t.length>MAX_BLOCK_CHARS?t.substring(0,MAX_BLOCK_CHARS):t;}
function getDirectText(el){let t="";for(const c of el.childNodes) if(c.nodeType===3) t+=c.textContent;return t.trim();}

const queuedBlocks = new WeakSet();
const sentToModel = [];

// walk every element, as content.js does
for (const el of document.querySelectorAll("*")) {
  const direct = getDirectText(el);
  if (!direct) continue;
  const block = getBlockElement(el);
  const blockText = getBlockText(el);
  if (queuedBlocks.has(block)) continue;   // dedupe
  queuedBlocks.add(block);
  sentToModel.push({ tag: block.tagName, cls: block.className, text: blockText, words: blockText.split(/\s+/).length });
}

console.log("النصوص اللي بتتبعت للموديل:\n");
sentToModel.forEach((s,i)=>{
  console.log(`  [${i+1}] <${s.tag}${s.cls?" ."+s.cls:""}>  (${s.words} كلمة)`);
  console.log(`      "${s.text}"\n`);
});

const comment = sentToModel.find(s=>s.cls==="comment");
const ok1 = !!comment && comment.words >= 15;
const ok2 = sentToModel.filter(s=>s.cls==="comment").length === 1;
console.log(ok1 ? "✓ الكومنت اتبعت كامل (مش شظايا)" : "✗ الكومنت لسه مقطّع");
console.log(ok2 ? "✓ اتبعت مرة واحدة بس (مفيش تكرار)" : "✗ اتبعت أكتر من مرة");
process.exitCode = (ok1 && ok2) ? 0 : 1;
