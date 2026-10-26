/* Cron Explain — standard 5-field (Vixie) cron: parse, describe in English, compute next runs locally. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var FIELDS = [
    { key: "minute", label: "Minute", min: 0, max: 59, hint: "0–59" },
    { key: "hour", label: "Hour", min: 0, max: 23, hint: "0–23" },
    { key: "dom", label: "Day of month", min: 1, max: 31, hint: "1–31" },
    { key: "month", label: "Month", min: 1, max: 12, hint: "1–12 or JAN–DEC", names: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"], base: 1 },
    { key: "dow", label: "Day of week", min: 0, max: 7, hint: "0–7 or SUN–SAT (0, 7 = Sun)", names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"], base: 0 }
  ];
  var MACROS = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };

  // ---------- parsing ----------
  function num(tok, f) {
    var up = tok.toUpperCase();
    if (f.names && f.names.indexOf(up) >= 0) return f.names.indexOf(up) + f.base;
    if (!/^\d+$/.test(tok)) throw new Error("“" + tok + "” is not a number" + (f.names ? " or a name like " + f.names[1] : ""));
    var n = +tok;
    if (n < f.min || n > f.max) throw new Error(n + " is out of range (" + f.hint + ")");
    return n;
  }
  function parseField(str, f) {
    if (!str) throw new Error("missing");
    if (str === "?" && (f.key === "dom" || f.key === "dow")) str = "*";
    var items = str.split(",").map(function (part) {
      var m = /^(\*|[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?)(?:\/(\d+))?$/.exec(part);
      if (!m) {
        if (/[LW#]/i.test(part)) throw new Error("“" + part + "” uses L, W or # — those are Quartz extensions, not standard cron");
        throw new Error("can't read “" + part + "”");
      }
      var step = m[2] ? +m[2] : 1, it;
      if (m[2] && (step < 1 || step > f.max)) throw new Error("step /" + m[2] + " is out of range");
      if (m[1] === "*") it = { a: f.min, b: f.max, star: true };
      else {
        var r = m[1].split("-"), a = num(r[0], f), b = r.length > 1 ? num(r[1], f) : (m[2] ? f.max : a);
        if (a > b) throw new Error("range " + m[1] + " must go from low to high");
        it = { a: a, b: b, star: false, open: !!m[2] && r.length === 1 };
      }
      it.step = step;
      return it;
    });
    var set = {}, values = [];
    items.forEach(function (it) { for (var v = it.a; v <= it.b; v += it.step) { var x = f.key === "dow" && v === 7 ? 0 : v; if (!set[x]) { set[x] = true; values.push(x); } } });
    values.sort(function (x, y) { return x - y; });
    return { raw: str, items: items, set: set, values: values, restricted: str.charAt(0) !== "*" };
  }
  // → {ok, fields:[…], errors:{key:msg}, expanded, macro, reboot}
  function parse(expr) {
    var s = String(expr).trim().replace(/\s+/g, " "), res = { ok: false, errors: {}, fields: null };
    if (!s) { res.empty = true; return res; }
    var low = s.toLowerCase();
    if (low === "@reboot") { res.ok = true; res.reboot = true; return res; }
    if (low.charAt(0) === "@") {
      if (!MACROS[low]) { res.error = "Unknown macro " + s + ". Try @hourly, @daily, @weekly, @monthly or @yearly"; return res; }
      res.macro = low; s = MACROS[low];
    }
    var parts = s.split(" ");
    if (parts.length === 6 || parts.length === 7) { res.error = "This has " + parts.length + " fields — it looks like a Quartz/Spring cron with seconds. Standard cron has 5: minute hour day-of-month month day-of-week"; return res; }
    if (parts.length !== 5) { res.error = "A cron expression needs 5 fields, found " + parts.length; return res; }
    res.expanded = s;
    res.fields = {};
    FIELDS.forEach(function (f, i) {
      try { res.fields[f.key] = parseField(parts[i], f); } catch (e) { res.errors[f.key] = e.message; }
    });
    res.ok = !Object.keys(res.errors).length;
    return res;
  }

  // ---------- description ----------
  function ord(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function list(a) { return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  var h12 = false;
  function time(h, m) {
    if (!h12) return pad(h) + ":" + pad(m);
    return (h % 12 || 12) + ":" + pad(m) + " " + (h < 12 ? "AM" : "PM");
  }
  function isAll(f) { return f.items.length === 1 && f.items[0].star && f.items[0].step === 1; }
  function starStep(f) { return f.items.length === 1 && f.items[0].star && f.items[0].step > 1 ? f.items[0].step : 0; }
  function singles(f) { return f.items.every(function (i) { return !i.star && i.a === i.b; }); }
  function items(f, fmt, unit) {
    return list(f.items.map(function (i) {
      if (i.star) return "every " + ord(i.step) + " " + unit;
      if (i.open) return "every " + ord(i.step) + " " + unit + " from " + fmt(i.a);
      if (i.a === i.b) return fmt(i.a);
      return fmt(i.a) + " through " + fmt(i.b) + (i.step > 1 ? " (every " + ord(i.step) + ")" : "");
    }));
  }

  function describe(p) {
    if (p.reboot) return "Once, when the cron daemon starts (at boot)";
    var F = p.fields, m = F.minute, h = F.hour, out;
    var hourName = function (x) { return time(x, 0); };
    if (isAll(m) && isAll(h)) out = "Every minute";
    else if (starStep(m) && isAll(h)) out = "Every " + starStep(m) + " minutes";
    else if (singles(m) && singles(h) && m.values.length * h.values.length <= 12) {
      var times = [];
      h.values.forEach(function (hh) { m.values.forEach(function (mm) { times.push(time(hh, mm)); }); });
      out = "At " + list(times);
    } else {
      var at = !isAll(m) && !starStep(m);
      out = isAll(m) ? "Every minute" : starStep(m) ? "Every " + starStep(m) + " minutes"
        : singles(m) ? "At minute" + (m.values.length > 1 ? "s " : " ") + list(m.values.map(String)) : "At minutes " + items(m, String, "minute");
      if (isAll(h)) out += at ? " past every hour" : "";
      else if (starStep(h)) out += (at ? " past" : ",") + " every " + ord(starStep(h)) + " hour";
      else if (h.items.length === 1 && !h.items[0].star && h.items[0].step === 1 && h.items[0].a < h.items[0].b) out += ", between " + time(h.items[0].a, 0) + " and " + time(h.items[0].b, 59);
      else if (singles(h)) out += ", during the " + list(h.values.map(hourName)) + " hour" + (h.values.length > 1 ? "s" : "");
      else out += ", hours " + items(h, hourName, "hour");
    }
    var dom = F.dom, dow = F.dow, day = "", mon = F.month;
    var domT = starStep(dom) ? "every " + ord(starStep(dom)) + " day of the month"
      : singles(dom) ? "on day" + (dom.values.length > 1 ? "s " : " ") + list(dom.values.map(String)) + " of the month" : "on days " + items(dom, String, "day") + " of the month";
    var dowT = starStep(dow) ? "every " + ord(starStep(dow)) + " day of the week" : "on " + items(dow, function (d) { return DAYS[d]; }, "day");
    var domOn = !isAll(dom), dowOn = !isAll(dow);
    if (domOn && dowOn) day = dom.restricted && dow.restricted ? domT + " or " + dowT : domT + " and " + dowT;
    else if (domOn) day = domT; else if (dowOn) day = dowT;
    if (day) out += ", " + day;
    if (!isAll(mon)) out += ", " + (starStep(mon) ? "every " + ord(starStep(mon)) + " month" : "in " + items(mon, function (x) { return MONTHS[x]; }, "month"));
    return out;
  }

  // ---------- next runs ----------
  function dayOk(F, d) {
    var a = F.dom.set[d.getDate()], b = F.dow.set[d.getDay()];
    return F.dom.restricted && F.dow.restricted ? a || b : a && b;
  }
  function nextRuns(p, from, count) {
    var F = p.fields, out = [], d = new Date(from.getTime()), stopYear = from.getFullYear() + 30;
    d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
    while (out.length < count && d.getFullYear() <= stopYear) {
      if (!F.month.set[d.getMonth() + 1]) { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); continue; }
      if (!dayOk(F, d)) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); continue; }
      if (!F.hour.set[d.getHours()]) { d.setHours(d.getHours() + 1, 0, 0, 0); continue; }
      if (!F.minute.set[d.getMinutes()]) { d.setMinutes(d.getMinutes() + 1, 0, 0); continue; }
      out.push(new Date(d.getTime()));
      d.setMinutes(d.getMinutes() + 1);
    }
    return out;
  }
  function rel(ms) {
    var s = ms / 1000, U = [["day", 86400], ["hour", 3600], ["minute", 60]];
    for (var i = 0; i < U.length; i++) if (Math.abs(s) >= U[i][1]) return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(s / U[i][1]), U[i][0]);
    return "in less than a minute";
  }

  // ---------- UI ----------
  var expr = $("#expr"), inputs = {};
  var PRESETS = [
    ["Every minute", "* * * * *"], ["Every 5 minutes", "*/5 * * * *"], ["Every 15 minutes", "*/15 * * * *"], ["Every hour", "0 * * * *"],
    ["Daily at midnight", "0 0 * * *"], ["Twice a day", "0 9,21 * * *"], ["Weekdays at 9:00", "0 9 * * 1-5"], ["Mondays at 8:30", "30 8 * * MON"],
    ["Office hours, every 30 min", "*/30 9-17 * * 1-5"], ["Sundays at 2:00", "0 2 * * 0"], ["1st of the month", "0 0 1 * *"], ["Quarterly", "0 0 1 */3 *"]
  ];
  PRESETS.forEach(function (p) {
    $("#presets").appendChild(S3.h("button", { "class": "chip ce-preset", type: "button", title: p[1], text: p[0], onclick: function () { expr.value = p[1]; fromExpr(); S3.done(); } }));
  });
  FIELDS.forEach(function (f) {
    var inp = S3.h("input", { "class": "input mono", id: "f-" + f.key, spellcheck: "false", autocomplete: "off", autocapitalize: "off" });
    var err = S3.h("span", { "class": "ce-err", id: "e-" + f.key });
    inputs[f.key] = { inp: inp, err: err };
    $("#fields").appendChild(S3.h("label", { "class": "ce-field", "for": "f-" + f.key }, [
      S3.h("span", { "class": "ce-fl" }, [S3.h("b", { text: f.label }), S3.h("span", { "class": "faint", text: f.hint })]), inp, err
    ]));
    inp.addEventListener("input", function () {
      expr.value = FIELDS.map(function (g) { return inputs[g.key].inp.value.trim() || "*"; }).join(" ");
      render(false);
    });
  });
  $("#tz").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  h12 = S3.store("cron.clock") === "12";
  $$("#clock button").forEach(function (b) {
    b.setAttribute("aria-pressed", String((b.dataset.v === "12") === h12));
    b.addEventListener("click", function () {
      h12 = b.dataset.v === "12"; S3.store("cron.clock", b.dataset.v);
      $$("#clock button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      render(false);
    });
  });

  function render(syncFields) {
    var p = parse(expr.value), says = $("#says"), status = $("#status"), runs = $("#runs");
    S3.store("cron.expr", expr.value);
    if (syncFields && p.expanded) p.expanded.split(" ").forEach(function (v, i) { inputs[FIELDS[i].key].inp.value = v; });
    if (syncFields && p.reboot) FIELDS.forEach(function (f) { inputs[f.key].inp.value = ""; });
    FIELDS.forEach(function (f) {
      var e = p.errors[f.key] || ""; inputs[f.key].err.textContent = e;
      if (e) inputs[f.key].inp.setAttribute("aria-invalid", "true"); else inputs[f.key].inp.removeAttribute("aria-invalid");
    });
    runs.textContent = "";
    if (p.empty) { says.textContent = "Type a cron expression, or pick a preset below."; status.className = "chip"; status.textContent = "Waiting"; return; }
    if (!p.ok) {
      var msgs = p.error ? [p.error] : FIELDS.filter(function (f) { return p.errors[f.key]; }).map(function (f) { return f.label + ": " + p.errors[f.key]; });
      says.textContent = msgs.join(" · ");
      says.classList.add("bad"); status.className = "chip bad"; status.textContent = "Invalid";
      runs.appendChild(S3.h("li", { "class": "ce-none", text: "Fix the expression to see run times." }));
      return;
    }
    says.classList.remove("bad");
    says.textContent = describe(p) + ".";
    status.className = "chip ok"; status.textContent = p.macro ? "✓ " + p.macro + " = " + p.expanded : "✓ Valid";
    if (p.reboot) { runs.appendChild(S3.h("li", { "class": "ce-none", text: "Runs once at system start-up, not on a clock." })); return; }
    var now = new Date(), list10 = nextRuns(p, now, 10);
    if (!list10.length) runs.appendChild(S3.h("li", { "class": "ce-none", text: "This schedule never runs (for example 31 February)." }));
    var fmt = new Intl.DateTimeFormat(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: h12 });
    list10.forEach(function (d) {
      runs.appendChild(S3.h("li", null, [S3.h("span", { "class": "mono", text: fmt.format(d) }), S3.h("span", { "class": "faint", text: rel(d - now) })]));
    });
  }
  function fromExpr() { render(true); }
  expr.addEventListener("input", S3.debounce(fromExpr, 100));
  $("#copy").addEventListener("click", function () { S3.copy(expr.value.trim(), "Cron expression copied"); S3.done(); });

  expr.value = S3.store("cron.expr") || expr.value;
  fromExpr();
  setInterval(function () { if (document.visibilityState === "visible" && parse(expr.value).ok) render(false); }, 30000);

  window.S3_DEMO = function () { expr.value = "*/30 9-17 * * 1-5"; fromExpr(); };

  window.S3_SELFTEST = function () {
    var was = h12; h12 = false;
    try {
      var D = function (e) { return describe(parse(e)); };
      var cases = {
        "* * * * *": "Every minute",
        "*/5 * * * *": "Every 5 minutes",
        "0 9 * * 1-5": "At 09:00, on Monday through Friday",
        "30 8 * * MON": "At 08:30, on Monday",
        "0 9,21 * * *": "At 09:00 and 21:00",
        "*/15 9-17 * * *": "Every 15 minutes, between 09:00 and 17:59",
        "0 0 1 */3 *": "At 00:00, on day 1 of the month, every 3rd month",
        "5 */2 * * *": "At minute 5 past every 2nd hour",
        "0 0 13 * 5": "At 00:00, on day 13 of the month or on Friday",
        "@daily": "At 00:00"
      };
      for (var k in cases) if (D(k) !== cases[k]) return k + " → " + D(k);
      // Next runs, from Monday 26 Oct 2026 09:00 local time
      var from = new Date(2026, 9, 26, 9, 0);
      var r = nextRuns(parse("30 8 * * 1"), from, 2);
      if (r[0].getTime() !== new Date(2026, 10, 2, 8, 30).getTime() || r[1].getTime() !== new Date(2026, 10, 9, 8, 30).getTime()) return "next monday";
      if (nextRuns(parse("0 0 29 2 *"), from, 1)[0].getTime() !== new Date(2028, 1, 29).getTime()) return "leap day";
      if (nextRuns(parse("0 0 13 * 5"), from, 1)[0].getTime() !== new Date(2026, 9, 30).getTime()) return "dom OR dow";
      if (nextRuns(parse("0 0 */2 * 5"), from, 1)[0].getTime() !== new Date(2026, 10, 13).getTime()) return "star dom AND dow"; // "*/2" counts as unrestricted: odd day AND Friday
      if (nextRuns(parse("0 0 31 2 *"), from, 1).length !== 0) return "never";
      if (nextRuns(parse("*/20 * * * *"), from, 3).map(function (d) { return d.getMinutes(); }).join() !== "20,40,0") return "minutes";
      if (!parse("0 0 * * 7").fields.dow.set[0]) return "sunday 7";
      var bad = parse("60 25 * * *");
      if (bad.ok || !bad.errors.minute || !bad.errors.hour || bad.errors.dom) return "field errors";
      if (parse("0 0 0 * * *").ok || parse("0 0 L * *").ok || !parse("@reboot").reboot) return "rejects";
      return true;
    } finally { h12 = was; }
  };
})();
