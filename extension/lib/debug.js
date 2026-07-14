/* ============================================================
   Hayā — Debug Tracer (developer instrumentation)

   A zero-overhead-when-off tracer for the whole detection
   pipeline. When enabled it prints, for every scanned element,
   exactly what each layer saw and decided — so a developer can
   trace why any given text was blurred or passed.

   Enable from the page console:
     HayaDebug.on()        → verbose grouped logs + verdict table
     HayaDebug.on("table") → one-line-per-element table only
     HayaDebug.off()       → silent (default)
     HayaDebug.dump()      → print everything traced so far
     HayaDebug.clear()     → wipe the in-memory trace buffer
     HayaDebug.last()      → return the most recent trace object

   State persists across reloads via localStorage, so you can turn
   it on once and keep tracing as you navigate.
   ============================================================ */

var HayaDebug = (function () {
  "use strict";

  var KEY = "__haya_debug__";
  var MODE_KEY = "__haya_debug_mode__";
  var MAX_TRACES = 300;

  var enabled = false;
  var mode = "verbose"; // "verbose" | "table"
  var traces = [];
  var seq = 0;

  // Restore prior state (best-effort — storage may be unavailable).
  try {
    enabled = localStorage.getItem(KEY) === "1";
    var m = localStorage.getItem(MODE_KEY);
    if (m) mode = m;
  } catch (e) {}

  var CSS = {
    head:  "color:#e0ac4e;font-weight:700",
    pass:  "color:#4fb28c;font-weight:700",
    block: "color:#e8697a;font-weight:700",
    dim:   "color:#8b95a6",
    key:   "color:#909baf",
  };

  function now() {
    return (typeof performance !== "undefined" && performance.now)
      ? performance.now() : Date.now();
  }

  function short(s, n) {
    s = String(s == null ? "" : s);
    n = n || 80;
    return s.length > n ? s.slice(0, n) + "…" : s;
  }

  // A trace accumulates timed steps for ONE element, then reports once.
  function Trace(rawText) {
    if (!enabled) return NULL_TRACE; // hot path: no allocation when off
    this.id = ++seq;
    this.raw = rawText;
    this.steps = [];
    this.verdict = null;   // "BLOCK" | "PASS"
    this.layer = null;     // which layer decided
    this.reason = null;
    this.t0 = now();
    this._t = this.t0;
  }

  Trace.prototype.step = function (name, detail) {
    if (!enabled || this === NULL_TRACE) return this;
    var t = now();
    this.steps.push({ name: name, detail: detail, dt: t - this._t });
    this._t = t;
    return this;
  };

  Trace.prototype.decide = function (verdict, layer, reason) {
    if (!enabled || this === NULL_TRACE) return this;
    this.verdict = verdict;
    this.layer = layer;
    this.reason = reason;
    this.total = now() - this.t0;
    traces.push(this);
    if (traces.length > MAX_TRACES) traces.shift();
    this._emit();
    return this;
  };

  Trace.prototype._emit = function () {
    if (!enabled) return;
    var isBlock = this.verdict === "BLOCK";
    var vcss = isBlock ? CSS.block : CSS.pass;
    var tag = isBlock ? "BLOCK" : "PASS ";

    if (mode === "table") {
      console.log(
        "%c[Hayā #" + this.id + "] " + tag + "%c  %c" + this.layer +
        "%c  " + this.total.toFixed(1) + "ms  %c" + short(this.raw, 60),
        vcss, "", CSS.head, CSS.dim, CSS.dim
      );
      return;
    }

    // verbose: a collapsible group with every step.
    var label = "%c[Hayā #" + this.id + "] " + tag +
      "%c  " + short(this.raw, 70);
    (console.groupCollapsed || console.log).call(console, label, vcss, CSS.dim);
    console.log("%craw      %c" + JSON.stringify(this.raw), CSS.key, "");
    for (var i = 0; i < this.steps.length; i++) {
      var s = this.steps[i];
      var d = s.detail == null ? "" : (typeof s.detail === "string"
        ? s.detail : JSON.stringify(s.detail));
      console.log(
        "%c" + pad(s.name, 22) + "%c" + d + "  %c(" + s.dt.toFixed(2) + "ms)",
        CSS.key, "", CSS.dim
      );
    }
    console.log(
      "%cverdict  %c" + this.verdict + " · " + this.layer +
      "%c — " + this.reason + "  %ctotal " + this.total.toFixed(2) + "ms",
      CSS.key, vcss, "", CSS.dim
    );
    if (console.groupEnd) console.groupEnd();
  };

  function pad(s, n) {
    s = String(s);
    while (s.length < n) s += " ";
    return s;
  }

  // Shared no-op object so the disabled path allocates nothing and every
  // method is a cheap return.
  var NULL_TRACE = {
    id: 0, raw: "", steps: [],
    step: function () { return this; },
    decide: function () { return this; },
    _emit: function () {},
  };

  function persist() {
    try {
      localStorage.setItem(KEY, enabled ? "1" : "0");
      localStorage.setItem(MODE_KEY, mode);
    } catch (e) {}
  }

  function on(m) {
    enabled = true;
    if (m === "table" || m === "verbose") mode = m;
    persist();
    console.log("%c[Hayā] debug ON (" + mode + "). Reload or re-scan to trace. " +
      "HayaDebug.off() to stop.", CSS.head);
    return true;
  }

  function off() {
    enabled = false;
    persist();
    console.log("%c[Hayā] debug OFF.", CSS.dim);
    return false;
  }

  function dump() {
    console.log("%c[Hayā] " + traces.length + " trace(s):", CSS.head);
    for (var i = 0; i < traces.length; i++) traces[i]._emit();
    return traces.length;
  }

  // A compact console.table of every trace — great for scanning a whole page.
  function table() {
    if (!console.table) return dump();
    console.table(traces.map(function (t) {
      return {
        "#": t.id,
        verdict: t.verdict,
        layer: t.layer,
        ms: Number(t.total.toFixed(1)),
        text: short(t.raw, 50),
        reason: short(t.reason, 40),
      };
    }));
    return traces.length;
  }

  return {
    trace: function (raw) { return new Trace(raw); },
    on: on,
    off: off,
    dump: dump,
    table: table,
    clear: function () { traces = []; console.log("%c[Hayā] traces cleared.", CSS.dim); },
    last: function () { return traces[traces.length - 1] || null; },
    all: function () { return traces.slice(); },
    isOn: function () { return enabled; },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = HayaDebug;
