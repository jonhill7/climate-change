/* Small dependency-free SVG chart kit used by the climate presentation.
   Colors are CSS custom properties, so charts follow the page theme. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function niceTicks(min, max, count) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function nearest(data, x) {
    let lo = 0, hi = data.length - 1;
    if (hi < 0) return null;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (data[mid][0] < x) lo = mid; else hi = mid;
    }
    return Math.abs(data[lo][0] - x) <= Math.abs(data[hi][0] - x) ? data[lo] : data[hi];
  }

  function makeTooltip(wrap) {
    const tip = document.createElement("div");
    tip.className = "viz-tip";
    tip.hidden = true;
    wrap.appendChild(tip);
    return tip;
  }
  function placeTip(tip, wrap, px, py) {
    tip.hidden = false;
    const w = wrap.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = px + 14;
    if (left + tw > w - 4) left = px - tw - 14;
    tip.style.left = Math.max(4, left) + "px";
    tip.style.top = Math.max(4, py - th / 2) + "px";
  }

  function frame(container, opts) {
    container.classList.add("viz");
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "viz-wrap";
    container.appendChild(wrap);
    const W = opts.width || Math.max(280, wrap.clientWidth || container.clientWidth || 600);
    const narrow = W < 520;
    const H = opts.height ? (typeof opts.height === "function" ? opts.height(W) : opts.height) : narrow ? 260 : 340;
    const m = Object.assign({ top: 14, right: narrow ? 12 : 20, bottom: 30, left: narrow ? 40 : 52 }, opts.margin || {});
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": opts.ariaLabel || "" }, wrap);
    return { wrap, svg, W, H, m, narrow, iw: W - m.left - m.right, ih: H - m.top - m.bottom };
  }

  function axes(f, sx, sy, xd, yd, opts) {
    const { svg, m, iw, ih, narrow } = f;
    const g = el("g", { class: "viz-axes" }, svg);
    const yt = opts.y.ticks || niceTicks(yd[0], yd[1], narrow ? 4 : 6);
    yt.forEach((v) => {
      const y = sy(v);
      el("line", { x1: m.left, x2: m.left + iw, y1: y, y2: y, class: v === 0 && opts.y.zeroLine !== false ? "viz-zero" : "viz-grid" }, g);
      const t = el("text", { x: m.left - 6, y: y + 4, "text-anchor": "end", class: "viz-tick" }, g);
      t.textContent = (opts.y.format || ((d) => d))(v);
    });
    const xt = opts.x.ticks ? opts.x.ticks(narrow) : niceTicks(xd[0], xd[1], narrow ? 4 : 8);
    xt.forEach((v) => {
      const x = sx(v);
      if (x < m.left - 1 || x > m.left + iw + 1) return;
      el("line", { x1: x, x2: x, y1: m.top + ih, y2: m.top + ih + 4, class: "viz-axisline" }, g);
      const t = el("text", { x, y: m.top + ih + 18, "text-anchor": "middle", class: "viz-tick" }, g);
      t.textContent = (opts.x.format || ((d) => d))(v);
    });
    el("line", { x1: m.left, x2: m.left + iw, y1: m.top + ih, y2: m.top + ih, class: "viz-axisline" }, g);
    if (opts.y.label) {
      const t = el("text", { x: m.left, y: m.top - 2, class: "viz-axislabel" }, g);
      t.textContent = opts.y.label;
    }
  }

  function pathOf(data, sx, sy) {
    let d = "", pen = false;
    for (const p of data) {
      if (p[1] === null || p[1] === undefined || Number.isNaN(p[1])) { pen = false; continue; }
      d += (pen ? "L" : "M") + sx(p[0]).toFixed(1) + "," + sy(p[1]).toFixed(1);
      pen = true;
    }
    return d;
  }
  function bandPath(band, sx, sy) {
    const pts = band.filter((b) => b[1] !== null && b[2] !== null);
    if (!pts.length) return "";
    let d = "M" + pts.map((b) => sx(b[0]).toFixed(1) + "," + sy(b[2]).toFixed(1)).join("L");
    d += "L" + pts.slice().reverse().map((b) => sx(b[0]).toFixed(1) + "," + sy(b[1]).toFixed(1)).join("L") + "Z";
    return d;
  }

  /* Line chart with optional uncertainty bands, reference lines, markers and a crosshair tooltip. */
  function LineChart(container, opts) {
    let state = opts;
    function render() {
      const o = state;
      const f = frame(container, o);
      const vis = o.series.filter((s) => !s.hidden);
      const xs = [], ys = [];
      vis.forEach((s) => {
        (s.data || []).forEach((p) => { if (p[1] !== null) { xs.push(p[0]); ys.push(p[1]); } });
        (s.band || []).forEach((b) => { xs.push(b[0]); if (b[1] !== null) ys.push(b[1], b[2]); });
      });
      const xd = [o.x.min ?? Math.min(...xs), o.x.max ?? Math.max(...xs)];
      let yd = [o.y.min ?? Math.min(...ys), o.y.max ?? Math.max(...ys)];
      if (o.y.min === undefined || o.y.max === undefined) {
        const pad = (yd[1] - yd[0]) * 0.06 || 0.5;
        if (o.y.min === undefined) yd[0] -= pad;
        if (o.y.max === undefined) yd[1] += pad;
        const t = niceTicks(yd[0], yd[1], f.narrow ? 4 : 6);
        if (o.y.min === undefined) yd[0] = Math.min(yd[0], t[0]);
        if (o.y.max === undefined) yd[1] = Math.max(yd[1], t[t.length - 1]);
      }
      const { m, iw, ih, svg } = f;
      const sx = (v) => m.left + ((v - xd[0]) / (xd[1] - xd[0])) * iw;
      const sy = (v) => m.top + ih - ((v - yd[0]) / (yd[1] - yd[0])) * ih;
      axes(f, sx, sy, xd, yd, o);

      const clipId = "clip" + Math.random().toString(36).slice(2);
      const defs = el("defs", {}, svg);
      const cp = el("clipPath", { id: clipId }, defs);
      el("rect", { x: m.left, y: m.top - 2, width: iw, height: ih + 2 }, cp);
      const plot = el("g", { "clip-path": `url(#${clipId})` }, svg);

      (o.shading || []).forEach((s) => {
        const x0 = sx(Math.max(xd[0], s.x0)), x1 = sx(Math.min(xd[1], s.x1));
        el("rect", { x: x0, y: m.top, width: Math.max(1, x1 - x0), height: ih, class: "viz-shade" }, plot);
      });
      vis.forEach((s) => {
        if (s.band) el("path", { d: bandPath(s.band, sx, sy), style: `fill:${s.color};opacity:${s.bandOpacity ?? 0.16}` }, plot);
      });
      vis.forEach((s) => {
        if (s.data && !s.bandOnly) {
          if (s.area) {
            const d = pathOf(s.data, sx, sy);
            el("path", { d: d + `L${sx(s.data[s.data.length - 1][0])},${sy(Math.max(yd[0], 0))}L${sx(s.data[0][0])},${sy(Math.max(yd[0], 0))}Z`, style: `fill:${s.color};opacity:.12` }, plot);
          }
          el("path", { d: pathOf(s.data, sx, sy), class: "viz-line", style: `stroke:${s.color};stroke-width:${s.width || 2}px;${s.dash ? "stroke-dasharray:" + s.dash : ""};opacity:${s.opacity ?? 1}` }, plot);
          if (s.dots) s.data.forEach((p) => p[1] !== null && el("circle", { cx: sx(p[0]), cy: sy(p[1]), r: s.dots, style: `fill:${s.color}` }, plot));
        }
      });
      (o.shading || []).forEach((s) => {
        if (!s.label) return;
        const x0 = sx(Math.max(xd[0], s.x0)), x1 = sx(Math.min(xd[1], s.x1));
        const t = el("text", { x: x0 + 5, y: m.top + ih - 6, class: "viz-shadelabel" }, svg);
        t.textContent = f.narrow && s.short ? s.short : s.label;
        if (t.getComputedTextLength && t.getComputedTextLength() > x1 - x0 - 8) t.textContent = s.short || "";
      });
      (o.refLines || []).forEach((r) => {
        if (r.y < yd[0] || r.y > yd[1]) return;
        el("line", { x1: m.left, x2: m.left + iw, y1: sy(r.y), y2: sy(r.y), class: "viz-ref" }, svg);
        const t = el("text", { x: r.right ? m.left + iw - 4 : m.left + 6, y: sy(r.y) - 5, "text-anchor": r.right ? "end" : "start", class: "viz-reflabel" }, svg);
        t.textContent = r.label;
      });
      (o.markers || []).forEach((k, i) => {
        if (k.x < xd[0] || k.x > xd[1]) return;
        const x = sx(k.x);
        el("line", { x1: x, x2: x, y1: m.top + 12, y2: m.top + ih, class: "viz-marker" }, svg);
        if (!f.narrow || k.short) {
          const t = el("text", { x: x + 3, y: m.top + 10 + (i % 2) * 12, class: "viz-markerlabel" }, svg);
          t.textContent = f.narrow ? k.short || k.label : k.label;
        }
      });
      (o.labels || []).forEach((l) => {
        if (f.narrow && l.hideNarrow) return;
        const t = el("text", { x: sx(l.x) + (l.dx || 0), y: sy(l.y) + (l.dy || 0), "text-anchor": l.anchor || "start", class: "viz-directlabel" }, svg);
        t.textContent = l.text;
      });
      vis.forEach((s) => {
        if (s.endDot && s.data && s.data.length) {
          const p = s.data[s.data.length - 1];
          el("circle", { cx: sx(p[0]), cy: sy(p[1]), r: 4, class: "viz-enddot", style: `fill:${s.color}` }, svg);
        }
      });

      // Crosshair + tooltip
      const tip = makeTooltip(f.wrap);
      const cross = el("line", { y1: m.top, y2: m.top + ih, class: "viz-cross", visibility: "hidden" }, svg);
      const dotsG = el("g", {}, svg);
      const hit = el("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" }, svg);
      const fx = o.x.tipFormat || o.x.format || ((d) => d);
      const fy = o.y.tipFormat || o.y.format || ((d) => d);
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * f.W;
        const xv = xd[0] + ((px - m.left) / iw) * (xd[1] - xd[0]);
        const rowsHtml = [];
        let anchorX = null;
        dotsG.innerHTML = "";
        vis.forEach((s) => {
          if (s.noTip) return;
          const src = s.data && !s.bandOnly ? s.data : null;
          const p = src ? nearest(src, xv) : null;
          const b = s.band ? nearest(s.band, xv) : null;
          const ref = p || b;
          if (!ref || Math.abs(ref[0] - xv) > (o.x.snap ?? (xd[1] - xd[0]) / 40)) return;
          if (anchorX === null) anchorX = ref[0];
          let val = p && p[1] !== null ? fy(p[1]) : "";
          if (b && b[1] !== null) val += (val ? " " : "") + `<span class="viz-tip-range">(${fy(b[1])} to ${fy(b[2])})</span>`;
          if (!val) return;
          rowsHtml.push(`<div class="viz-tip-row"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${val}</b></div>`);
          if (p && p[1] !== null) el("circle", { cx: sx(p[0]), cy: sy(p[1]), r: 4, class: "viz-hoverdot", style: `fill:${s.color}` }, dotsG);
        });
        if (!rowsHtml.length) { tip.hidden = true; cross.setAttribute("visibility", "hidden"); return; }
        cross.setAttribute("x1", sx(anchorX)); cross.setAttribute("x2", sx(anchorX));
        cross.setAttribute("visibility", "visible");
        tip.innerHTML = `<div class="viz-tip-head">${esc(fx(anchorX))}</div>` + rowsHtml.join("");
        placeTip(tip, f.wrap, (sx(anchorX) / f.W) * r.width, ((ev.clientY - r.top)));
      };
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerdown", move);
      hit.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dotsG.innerHTML = ""; });
    }
    render();
    observe(container, render);
    return {
      update(next) { state = Object.assign({}, state, next); render(); },
      get state() { return state; },
    };
  }

  /* Stacked area chart: positive values stack up from zero, negative values stack down. */
  function StackChart(container, opts) {
    let state = opts;
    function render() {
      const o = state;
      const f = frame(container, o);
      const { m, iw, ih, svg } = f;
      const years = o.years;
      const vis = o.series.filter((s) => !s.hidden);
      const pos = years.map(() => 0), neg = years.map(() => 0);
      const layers = vis.map((s) => {
        const lo = [], hi = [];
        s.values.forEach((v, i) => {
          v = v || 0;
          if (v >= 0) { lo.push(pos[i]); pos[i] += v; hi.push(pos[i]); }
          else { hi.push(neg[i]); neg[i] += v; lo.push(neg[i]); }
        });
        return { s, lo, hi };
      });
      const net = years.map((_, i) => vis.reduce((a, s) => a + (s.values[i] || 0), 0));
      const yd = [o.y.min ?? Math.min(0, ...neg) * 1.08, o.y.max ?? Math.max(...pos) * 1.06];
      const t = niceTicks(yd[0], yd[1], f.narrow ? 4 : 6);
      yd[0] = Math.min(yd[0], t[0]); yd[1] = Math.max(yd[1], t[t.length - 1]);
      const xd = [years[0], years[years.length - 1]];
      const sx = (v) => m.left + ((v - xd[0]) / (xd[1] - xd[0])) * iw;
      const sy = (v) => m.top + ih - ((v - yd[0]) / (yd[1] - yd[0])) * ih;
      axes(f, sx, sy, xd, yd, o);
      layers.forEach(({ s, lo, hi }) => {
        let d = "M" + years.map((y, i) => sx(y).toFixed(1) + "," + sy(hi[i]).toFixed(1)).join("L");
        d += "L" + years.map((y, i) => [y, i]).reverse().map(([y, i]) => sx(y).toFixed(1) + "," + sy(lo[i]).toFixed(1)).join("L") + "Z";
        el("path", { d, style: `fill:${s.color}` }, svg);
      });
      if (o.netLine && vis.length > 1) el("path", { d: pathOf(years.map((y, i) => [y, net[i]]), sx, sy), class: "viz-line", style: "stroke:var(--fg);stroke-width:2px" }, svg);
      (o.markers || []).forEach((k, i) => {
        const x = sx(k.x);
        el("line", { x1: x, x2: x, y1: m.top + 12, y2: m.top + ih, class: "viz-marker" }, svg);
        if (!f.narrow) { const tt = el("text", { x: x + 3, y: m.top + 10 + (i % 2) * 12, class: "viz-markerlabel" }, svg); tt.textContent = k.label; }
      });
      const tip = makeTooltip(f.wrap);
      const cross = el("line", { y1: m.top, y2: m.top + ih, class: "viz-cross", visibility: "hidden" }, svg);
      const hit = el("rect", { x: m.left, y: m.top, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" }, svg);
      const fy = o.y.tipFormat || o.y.format || ((d) => d);
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * f.W;
        const xv = xd[0] + ((px - m.left) / iw) * (xd[1] - xd[0]);
        let i = years.findIndex((y) => y >= xv); if (i < 0) i = years.length - 1;
        if (i > 0 && Math.abs(years[i - 1] - xv) < Math.abs(years[i] - xv)) i--;
        cross.setAttribute("x1", sx(years[i])); cross.setAttribute("x2", sx(years[i])); cross.setAttribute("visibility", "visible");
        const rowsHtml = vis.slice().reverse().map((s) => `<div class="viz-tip-row"><i style="background:${s.color}"></i><span>${esc(s.name)}</span><b>${fy(s.values[i] || 0)}</b></div>`);
        if (o.netLine) rowsHtml.push(`<div class="viz-tip-row viz-tip-total"><i style="background:var(--fg)"></i><span>${esc(o.netLabel || "Net")}</span><b>${fy(net[i])}</b></div>`);
        tip.innerHTML = `<div class="viz-tip-head">${years[i]}</div>` + rowsHtml.join("");
        placeTip(tip, f.wrap, (sx(years[i]) / f.W) * r.width, ev.clientY - r.top);
      };
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerdown", move);
      hit.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
    }
    render();
    observe(container, render);
    return { update(next) { state = Object.assign({}, state, next); render(); }, get state() { return state; } };
  }

  /* Horizontal range bars: a best estimate with a 5-95% whisker per row. */
  function RangeBars(container, opts) {
    let state = opts;
    function render() {
      const o = state;
      const rows = o.rows;
      const rowH = o.rowHeight || 40;
      const probeW = Math.max(280, container.clientWidth || 600);
      const narrow = probeW < 440;
      const labelW = narrow ? 0 : o.labelWidth || 190;
      const f = frame(container, Object.assign({}, o, {
        width: probeW,
        height: rows.length * rowH + 40 + (narrow ? rows.length * 16 : 0),
        margin: { left: labelW + (narrow ? 12 : 16), right: 12, top: 8, bottom: 30 },
      }));
      const { m, iw, ih, svg } = f;
      const rh = ih / rows.length;
      const xs = rows.flatMap((r) => [r.lo ?? r.mid, r.hi ?? r.mid, r.mid]);
      let xd = [o.x.min ?? Math.min(0, ...xs), o.x.max ?? Math.max(0, ...xs)];
      // leave room for value labels beside the marks
      const labPx = 72, span0 = xd[1] - xd[0];
      const padFrac = labPx / Math.max(80, iw - 2 * labPx);
      if (rows.some((r) => r.mid >= 0) && o.x.max === undefined) xd[1] += span0 * padFrac;
      if (rows.some((r) => r.mid < 0) && o.x.min === undefined) xd[0] -= span0 * padFrac;
      const t = niceTicks(xd[0], xd[1], narrow ? 4 : 6).filter((v) => v >= xd[0] - 1e-9 && v <= xd[1] + 1e-9);
      const sx = (v) => m.left + ((v - xd[0]) / (xd[1] - xd[0])) * iw;
      const g = el("g", {}, svg);
      t.forEach((v) => {
        el("line", { x1: sx(v), x2: sx(v), y1: m.top, y2: m.top + ih, class: v === 0 ? "viz-zero" : "viz-grid" }, g);
        const tt = el("text", { x: sx(v), y: m.top + ih + 18, "text-anchor": "middle", class: "viz-tick" }, g);
        tt.textContent = (o.x.format || ((d) => d))(v);
      });
      if (o.x.label) { const tl = el("text", { x: m.left + iw, y: m.top + ih + 18 + 12, "text-anchor": "end", class: "viz-axislabel" }, g); tl.textContent = ""; }
      const tip = makeTooltip(f.wrap);
      const fmt = o.x.tipFormat || o.x.format || ((d) => d);
      rows.forEach((r, i) => {
        const yTop = m.top + i * rh;
        const cy = yTop + (narrow ? rh * 0.68 : rh / 2);
        const lab = el("text", { x: narrow ? m.left : labelW, y: narrow ? yTop + 13 : cy + 4, "text-anchor": narrow ? "start" : "end", class: "viz-rowlabel" }, svg);
        lab.textContent = r.label;
        const barH = Math.min(14, rh * (narrow ? 0.3 : 0.42));
        const x0 = sx(Math.min(0, r.mid)), x1 = sx(Math.max(0, r.mid));
        if (!o.noBars) el("rect", { x: x0, y: cy - barH / 2, width: Math.max(1.5, x1 - x0), height: barH, rx: 3, style: `fill:${r.color}` }, svg);
        if (r.lo !== undefined && r.hi !== undefined) {
          el("line", { x1: sx(r.lo), x2: sx(r.hi), y1: cy, y2: cy, class: "viz-whisker" }, svg);
          el("line", { x1: sx(r.lo), x2: sx(r.lo), y1: cy - 6, y2: cy + 6, class: "viz-whisker" }, svg);
          el("line", { x1: sx(r.hi), x2: sx(r.hi), y1: cy - 6, y2: cy + 6, class: "viz-whisker" }, svg);
        }
        if (o.noBars) el("circle", { cx: sx(r.mid), cy, r: 5, style: `fill:${r.color}`, class: "viz-enddot" }, svg);
        const rightEdge = Math.max(sx(r.mid), sx(r.hi ?? r.mid), sx(0));
        const leftEdge = Math.min(sx(r.mid), sx(r.lo ?? r.mid), sx(0));
        const vt = el("text", { y: cy + 4, class: "viz-value" }, svg);
        vt.textContent = fmt(r.mid);
        const tw = vt.getComputedTextLength ? vt.getComputedTextLength() || 60 : 60;
        const preferRight = r.mid >= 0;
        const fitsRight = rightEdge + 6 + tw <= f.W - 2, fitsLeft = leftEdge - 6 - tw >= (narrow ? 2 : m.left - 4);
        if ((preferRight && fitsRight) || (!preferRight && !fitsLeft && fitsRight)) { vt.setAttribute("x", rightEdge + 6); }
        else if (fitsLeft) { vt.setAttribute("x", leftEdge - 6); vt.setAttribute("text-anchor", "end"); }
        else { vt.setAttribute("x", f.W - 2); vt.setAttribute("text-anchor", "end"); vt.setAttribute("y", cy - 9); }
        const hit = el("rect", { x: 0, y: yTop, width: f.W, height: rh, fill: "transparent" }, svg);
        const show = (ev) => {
          const rr = svg.getBoundingClientRect();
          tip.innerHTML = `<div class="viz-tip-head">${esc(r.label)}</div><div class="viz-tip-row"><i style="background:${r.color}"></i><span>Best estimate</span><b>${fmt(r.mid)}</b></div>` +
            (r.lo !== undefined ? `<div class="viz-tip-row"><i></i><span>${esc(o.rangeLabel || "Likely range")}</span><b>${fmt(r.lo)} to ${fmt(r.hi)}</b></div>` : "") +
            (r.note ? `<div class="viz-tip-note">${esc(r.note)}</div>` : "");
          placeTip(tip, f.wrap, ev.clientX - rr.left, ev.clientY - rr.top);
        };
        hit.addEventListener("pointermove", show);
        hit.addEventListener("pointerdown", show);
        hit.addEventListener("pointerleave", () => (tip.hidden = true));
      });
    }
    render();
    observe(container, render);
    return { update(next) { state = Object.assign({}, state, next); render(); } };
  }

  function observe(container, render) {
    if (!("ResizeObserver" in window)) return;
    let lastW = container.clientWidth, raf = 0;
    new ResizeObserver(() => {
      const w = container.clientWidth;
      if (Math.abs(w - lastW) < 2) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(render);
    }).observe(container);
  }

  /* Warming stripes: one vertical band per year, colored on a blue-to-red scale. */
  function Stripes(canvas, data, opts = {}) {
    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      const lo = opts.min ?? -0.4, hi = opts.max ?? 1.6, mid = opts.mid ?? 0.4;
      const cold = [8, 48, 107], neutral = [247, 247, 247], warm = [103, 0, 13];
      const coolMid = [107, 174, 214], warmMid = [239, 59, 44];
      const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
      const color = (v) => {
        if (v <= mid) {
          const t = Math.max(0, Math.min(1, (v - lo) / (mid - lo)));
          return t < 0.5 ? lerp(cold, coolMid, t * 2) : lerp(coolMid, neutral, (t - 0.5) * 2);
        }
        const t = Math.max(0, Math.min(1, (v - mid) / (hi - mid)));
        return t < 0.5 ? lerp(neutral, warmMid, t * 2) : lerp(warmMid, warm, (t - 0.5) * 2);
      };
      const bw = w / data.length;
      data.forEach((d, i) => {
        const c = color(d[1]);
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, h);
      });
    };
    draw();
    if ("ResizeObserver" in window) new ResizeObserver(draw).observe(canvas);
  }

  window.Viz = { LineChart, StackChart, RangeBars, Stripes, niceTicks };
})();
