/* Climate presentation: data loading (live with snapshot fallback), charts and controls. */
(function () {
  "use strict";
  const S = window.CLIMATE_SNAPSHOT;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const f1 = (v) => (v === null || v === undefined ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1));
  const f2 = (v) => (v === null || v === undefined ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2));
  const plain = (v, d = 1) => (v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ymLabel = (x) => { const y = Math.floor(x + 1e-6); const m = Math.min(11, Math.round((x - y) * 12 - 0.5)); return `${MONTHS[Math.max(0, m)]} ${y}`; };
  const setText = (sel, txt) => { const n = $(sel); if (n) n.textContent = txt; };

  // ---------- Working data (starts as the snapshot) ----------
  const D = JSON.parse(JSON.stringify(S));
  const status = { tsi: "snap", igcc: "snap", temps: "snap", berkeley: "snap", co2: "snap", attr: "snap", erf: "snap", sea: "snap", ocean: "snap" };
  setText("#built-date", new Date(S.built + "T12:00:00Z").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));

  // ---------- Helpers ----------
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  function offsetTo(ref, series, y0 = 1981, y1 = 2010) {
    const r = ref.filter((p) => p[0] >= y0 && p[0] <= y1).map((p) => p[1]);
    const s = series.filter((p) => p[0] >= y0 && p[0] <= y1 && p[1] !== null).map((p) => p[1]);
    return r.length && s.length ? mean(r) - mean(s) : 0;
  }
  function runMean(data, n) {
    const h = Math.floor(n / 2);
    return data.map((p, i) => {
      if (i < h || i + (n - h) > data.length) return [p[0], null];
      const w = data.slice(i - h, i - h + n).map((q) => q[1]);
      return [p[0], mean(w)];
    });
  }
  const monthToX = (s) => { const [y, m] = s.split("-").map(Number); return y + (m - 0.5) / 12; };
  const col = (name) => `var(--${name})`;

  // ---------- Derived series ----------
  function temps() {
    const igcc = D.igcc_gmst;
    const oG = offsetTo(igcc, D.gistemp), oH = offsetTo(igcc, D.hadcrut), oB = offsetTo(igcc, D.berkeley);
    return {
      igcc,
      gistemp: D.gistemp.map((p) => [p[0], p[1] + oG]),
      hadcrut: D.hadcrut.map((p) => [p[0], p[1] + oH]),
      berkeley: D.berkeley.map((p) => [p[0], p[1] + oB]),
      berkeleyBand: D.berkeley.filter((p) => p[2] !== null && p[2] !== undefined).map((p) => [p[0], p[1] + oB - p[2], p[1] + oB + p[2]]),
      hadMonthly: D.hadcrut_monthly.map((p) => [monthToX(p[0]), p[1] + oH]),
      gisMonthly: D.gistemp_monthly.map((p) => [monthToX(p[0]), p[1] + oG]),
    };
  }
  const lastOf = (a) => a[a.length - 1];
  function erfAt(key, year) {
    const i = D.erf.year.indexOf(year);
    return i < 0 ? null : D.erf[key][i];
  }
  function headline() {
    const rows = D.attr_headline || [];
    const pick = rows.filter((r) => !r.notes && String(r.timebound_upper) - String(r.timebound_lower) === 1);
    const r = pick[pick.length - 1] || rows[0];
    const n = (k) => parseFloat(r[k]);
    return {
      year: parseInt(r.timebound_lower, 10),
      ant: [n("anthropogenic_p05"), n("anthropogenic_p50"), n("anthropogenic_p95")],
      ghg: [n("ghg_p05"), n("ghg_p50"), n("ghg_p95")],
      ohf: [n("other_human_forcing_p05"), n("other_human_forcing_p50"), n("other_human_forcing_p95")],
      nat: [n("natural_p05"), n("natural_p50"), n("natural_p95")],
    };
  }

  // ---------- Chart registry ----------
  const C = {};
  const ui = { resWin: 1, recSmooth: 0, recMarks: "enso", recHidden: new Set(), co2: "ml", attrMethod: "walsh", attrHidden: new Set(), erfHidden: new Set(), scen: new Set(["ssp119", "ssp126", "ssp245", "ssp370", "ssp585"]), focus: "ssp245" };
  const mk = (id, Kind, opts) => { if (C[id]) C[id].update(opts); else C[id] = Kind($("#" + id), opts); };

  const REC_SERIES = [
    { id: "igcc", name: "IGCC composite", color: col("obs"), width: 2.5 },
    { id: "gistemp", name: "NASA GISTEMP", color: col("s1"), width: 1.5 },
    { id: "hadcrut", name: "HadCRUT5", color: col("s2"), width: 1.5 },
    { id: "berkeley", name: "Berkeley Earth", color: col("s3"), width: 1.5 },
  ];
  const ENSO_MARKS = [{ x: 1878, label: "1877–78 El Niño", short: "" }, { x: 1983, label: "1982–83" }, { x: 1998, label: "1997–98" }, { x: 2016, label: "2015–16" }, { x: 2024, label: "2023–24" }];
  const VOLC_MARKS = [{ x: 1883, label: "Krakatoa" }, { x: 1902, label: "Santa María" }, { x: 1963, label: "Agung" }, { x: 1982, label: "El Chichón" }, { x: 1991, label: "Pinatubo" }, { x: 2022, label: "Hunga Tonga" }];

  function drawRecord() {
    const T = temps();
    const endYear = Math.max(...REC_SERIES.map((s) => lastOf(T[s.id])[0]));
    mk("chart-record", Viz.LineChart, {
      ariaLabel: "Global temperature anomaly 1850 to present from four datasets",
      x: { min: 1850, max: endYear + 1, snap: 1.5 },
      y: { format: (v) => (v > 0 ? "+" : "") + v.toFixed(1), tipFormat: (v) => f2(v) + " °C", label: "°C" },
      series: REC_SERIES.map((s) => ({ ...s, data: ui.recSmooth ? runMean(T[s.id], 10) : T[s.id], hidden: ui.recHidden.has(s.id), opacity: s.id === "igcc" ? 1 : 0.85,
        band: s.id === "berkeley" && !ui.recSmooth && T.berkeleyBand.length ? T.berkeleyBand : undefined, bandOpacity: 0.22 })),
      refLines: [{ y: 1.5, label: "1.5 °C" }],
      markers: ui.recMarks === "enso" ? ENSO_MARKS : ui.recMarks === "volc" ? VOLC_MARKS : [],
    });
    const box = $("#rec-toggles");
    if (!box.childElementCount) {
      REC_SERIES.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "tog"; b.setAttribute("aria-pressed", "true");
        b.innerHTML = `<i style="background:${s.color}"></i>${s.name}`;
        b.addEventListener("click", () => {
          const on = ui.recHidden.has(s.id);
          if (on) ui.recHidden.delete(s.id); else ui.recHidden.add(s.id);
          b.setAttribute("aria-pressed", String(on));
          drawRecord();
        });
        box.appendChild(b);
      });
    }
    const from = 2015;
    const had = T.hadMonthly.filter((p) => p[0] >= from), gis = T.gisMonthly.filter((p) => p[0] >= from);
    mk("chart-monthly", Viz.LineChart, {
      ariaLabel: "Monthly global temperature since 2015",
      height: (w) => (w < 520 ? 240 : 290),
      x: { min: from, max: Math.ceil(Math.max(lastOf(had)[0], lastOf(gis)[0]) + 0.05), format: (v) => String(Math.round(v)), tipFormat: ymLabel, snap: 0.06, ticks: (n) => (n ? [2016, 2019, 2022, 2025] : [2015, 2017, 2019, 2021, 2023, 2025]) },
      y: { min: 0.6, max: 1.9, format: (v) => (v > 0 ? "+" : "") + v.toFixed(1), tipFormat: (v) => f2(v) + " °C", label: "°C" },
      series: [
        { id: "had", name: "HadCRUT5", color: col("s2"), data: had, width: 1.6, endDot: true },
        { id: "gis", name: "NASA GISTEMP", color: col("s1"), data: gis, width: 1.6, endDot: true },
      ],
      refLines: [{ y: 1.5, label: "1.5 °C", right: true }],
    });
    const be = D.berkeley.filter((p) => p[2] !== null && p[2] !== undefined);
    if (be.length > 20) {
      setText("#be-unc-early", "±" + mean(be.slice(0, 10).map((p) => p[2])).toFixed(2));
      setText("#be-unc-late", "±" + mean(be.slice(-10).map((p) => p[2])).toFixed(2));
    }
    drawResolution();
    const lh = lastOf(D.hadcrut_monthly);
    setText("#monthly-cap", `Individual months bounce around by a few tenths of a degree, largely because of El Niño and La Niña in the Pacific. Latest HadCRUT5 month: ${ymLabel(monthToX(lh[0]))}, ${f2(lastOf(had)[1])} °C.`);
  }

  function drawResolution() {
    const T = D.igcc_gmst, w = ui.resWin || 1;
    const end = lastOf(T)[0];
    $$(".be-end").forEach((n) => (n.textContent = String(end)));
    const blocks = [];
    if (w > 1) {
      for (let hi = end; hi >= T[0][0]; hi -= w) {
        const lo = Math.max(T[0][0], hi - w + 1);
        const vals = T.filter((p) => p[0] >= lo && p[0] <= hi).map((p) => p[1]);
        if (vals.length) blocks.unshift({ lo, hi, v: mean(vals) });
      }
    }
    const step = [];
    blocks.forEach((b) => { step.push([b.lo, b.v], [b.hi + 1, b.v]); });
    mk("chart-res", Viz.LineChart, {
      ariaLabel: "Modern temperature record averaged at different resolutions",
      height: (wd) => (wd < 520 ? 240 : 290),
      x: { min: T[0][0], max: end + 1, snap: 1.5 },
      y: { min: -0.4, max: 1.7, format: (v) => (v > 0 ? "+" : "") + v.toFixed(1), tipFormat: (v) => f2(v) + " °C", label: "°C" },
      series: [
        { id: "yr", name: "Measured yearly values", color: col("fg-3"), data: T, width: 1, opacity: w > 1 ? 0.45 : 1 },
        ...(w > 1 ? [{ id: "blk", name: `${w >= T.length ? "Whole-record" : w + "-year"} average`, color: col("k-rec"), data: step, width: 3 }] : []),
      ],
      refLines: [{ y: 1.5, label: "1.5 °C" }],
    });
    const top = Math.max(...T.map((p) => p[1]));
    const cap = $("#res-cap");
    if (w <= 1) cap.textContent = `Each year as measured. The warmest single year reached ${f2(top)} °C. Pick a wider window to see what a lower-resolution record would keep.`;
    else {
      const last = lastOf(blocks), peak = Math.max(...blocks.map((b) => b.v));
      cap.textContent = `Averaged over ${w >= T.length ? "the whole " + T.length + "-year record" : w + "-year blocks"}, the highest value is ${f2(peak)} °C, against ${f2(top)} °C for the warmest single year. ${w >= 100 ? "Most of the modern rise is averaged away, which is how a real warming of this length could look muted in a record that blends centuries." : "Year-to-year swings such as El Niño disappear, but the trend remains."}`;
    }
  }

  function drawPaleo() {
    const dec = D.igcc_gmst.filter((p) => p[0] >= lastOf(D.igcc_gmst)[0] - 9);
    const recent = mean(dec.map((p) => p[1]));
    mk("chart-paleo", Viz.RangeBars, {
      noBars: true, labelWidth: 250, rangeLabel: "Assessed range",
      x: { min: -8, max: 4, format: (v) => (v > 0 ? "+" : "") + v, tipFormat: (v) => f1(v) + " °C" },
      rows: [
        { label: "Last ice age peak, ~21,000 yrs ago", mid: -6, lo: -7, hi: -5, color: col("cool"), note: "Reconstructed. IPCC AR6; Tierney et al. 2020 estimate −6.1 °C. A multi-millennium average." },
        { label: "Holocene warmest, ~6,500 yrs ago", mid: 0.6, lo: 0.2, hi: 1.0, color: col("s3"), note: "Reconstructed. AR6 gives a range only (0.2 to 1 °C); the dot marks its midpoint. Averages over centuries." },
        { label: "Last interglacial, ~125,000 yrs ago", mid: 1.0, lo: 0.5, hi: 1.5, color: col("s3"), note: "Reconstructed. AR6 range 0.5 to 1.5 °C; midpoint shown. Sea level was 5–10 m higher." },
        { label: "Mid-Pliocene, ~3.2 million yrs ago", mid: 3.25, lo: 2.5, hi: 4.0, color: col("s4"), note: "Reconstructed. AR6 range 2.5 to 4 °C, with CO₂ about 360–420 ppm. Midpoint shown." },
        { label: `Last 10 years (${dec[0][0]}–${lastOf(dec)[0]})`, mid: recent, color: col("warm"), note: "Measured, IGCC composite. A 10-year average, much shorter than the averaging periods above." },
        { label: "2081–2100, middle scenario", mid: 2.7, lo: 2.1, hi: 3.5, color: col("human"), note: "Projected. SSP2-4.5, IPCC AR6, very likely range." },
      ],
    });
  }

  function drawCO2() {
    const ml = D.co2_monthly.filter((p) => p[1] !== null).map((p) => [monthToX(p[0]), p[1]]);
    const last = D.co2_monthly[D.co2_monthly.length - 1];
    if (ui.co2 === "ml") {
      setText("#co2-sub", `Parts per million, March 1958 to ${ymLabel(monthToX(last[0]))}`);
      mk("chart-co2", Viz.LineChart, {
        ariaLabel: "Monthly CO2 at Mauna Loa",
        x: { min: 1958, max: Math.ceil(lastOf(ml)[0]), format: (v) => String(Math.round(v)), tipFormat: ymLabel, snap: 0.08 },
        y: { min: 300, max: 440, format: (v) => v, tipFormat: (v) => v.toFixed(1) + " ppm", label: "ppm" },
        series: [{ id: "co2", name: "Mauna Loa CO₂", color: col("ghg"), data: ml, width: 1.2, endDot: true }],
        refLines: [],
      });
    } else {
      setText("#co2-sub", "Parts per million, annual average, 1750 to " + lastOf(D.ghg_conc)[0]);
      mk("chart-co2", Viz.LineChart, {
        ariaLabel: "CO2 since 1750",
        x: { min: 1750, max: lastOf(D.ghg_conc)[0] + 1, snap: 2 },
        y: { min: 260, max: 440, format: (v) => v, tipFormat: (v) => v.toFixed(1) + " ppm", label: "ppm" },
        series: [
          { id: "co2ice", name: "Ice cores (reconstructed, smoothed)", color: col("ghg"), data: D.ghg_conc.filter((p) => p[0] <= 1959).map((p) => [p[0], p[1]]), width: 2, dash: "5 4" },
          { id: "co2air", name: "Direct air measurements", color: col("ghg"), data: D.ghg_conc.filter((p) => p[0] >= 1959).map((p) => [p[0], p[1]]), width: 2.4, endDot: true },
        ],
        shading: [{ x0: 1750, x1: 1958.5, label: "Ice-core air bubbles", short: "Ice cores" }],
        refLines: [{ y: 300, label: "Highest natural level in 800,000 years: ~300 ppm" }],
      });
    }
  }

  const EMIS = [
    { i: 1, name: "CO₂ from fossil fuels & industry", color: col("s8") },
    { i: 2, name: "CO₂ from land use", color: col("s6") },
    { i: 3, name: "Methane", color: col("s2") },
    { i: 4, name: "Nitrous oxide", color: col("s4") },
    { i: 5, name: "Fluorinated gases", color: col("s7") },
  ];
  function drawEmissions() {
    const rows = D.emissions.filter((r) => r[0] >= 1970);
    mk("chart-emis", Viz.StackChart, {
      ariaLabel: "Greenhouse gas emissions by gas since 1970",
      years: rows.map((r) => r[0]),
      y: { min: 0, format: (v) => v, tipFormat: (v) => v.toFixed(1) + " Gt", label: "GtCO₂e" },
      x: {},
      series: EMIS.map((e) => ({ name: e.name, color: e.color, values: rows.map((r) => r[e.i]) })),
      netLine: false,
    });
    const lg = $("#emis-legend");
    if (!lg.childElementCount) lg.innerHTML = EMIS.map((e) => `<span><i class="box" style="background:${e.color}"></i>${e.name}</span>`).join("");
  }

  const ERF_GROUPS = [
    { id: "co2", name: "Carbon dioxide", color: col("s8"), keys: ["CO2"] },
    { id: "ch4", name: "Methane", color: col("s2"), keys: ["CH4"] },
    { id: "oghg", name: "N₂O and CFCs/HFCs", color: col("s4"), keys: ["N2O", "halogen"] },
    { id: "oth", name: "Ozone, contrails, soot on snow", color: col("s5"), keys: ["O3", "contrails", "BC_on_snow", "H2O_stratospheric"] },
    { id: "aer", name: "Aerosols", color: col("s1"), keys: ["aerosol"] },
    { id: "land", name: "Land use", color: col("s6"), keys: ["land_use"] },
    { id: "sun", name: "Sun", color: col("s3"), keys: ["solar"] },
    { id: "volc", name: "Volcanoes", color: col("s7"), keys: ["volcanic"] },
  ];
  function drawERF() {
    const yrs = D.erf.year, from = yrs.indexOf(1850);
    const years = yrs.slice(from);
    mk("chart-erf", Viz.StackChart, {
      ariaLabel: "Effective radiative forcing by factor since 1850",
      years,
      y: { format: (v) => (v > 0 ? "+" : "") + v, tipFormat: (v) => f2(v) + " W/m²", label: "W/m²" },
      x: {},
      height: (w) => (w < 520 ? 300 : 380),
      series: ERF_GROUPS.map((g) => ({ name: g.name, color: g.color, hidden: ui.erfHidden.has(g.id), values: years.map((_, i) => g.keys.reduce((a, k) => a + (D.erf[k][from + i] || 0), 0)) })),
      netLine: true, netLabel: "Net forcing",
      markers: [{ x: 1883, label: "Krakatoa" }, { x: 1963, label: "Agung" }, { x: 1991, label: "Pinatubo" }],
    });
    const box = $("#erf-toggles");
    if (!box.childElementCount) {
      ERF_GROUPS.forEach((g) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "tog"; b.setAttribute("aria-pressed", "true");
        b.innerHTML = `<i style="background:${g.color}"></i>${g.name}`;
        b.addEventListener("click", () => {
          const on = ui.erfHidden.has(g.id);
          if (on) ui.erfHidden.delete(g.id); else ui.erfHidden.add(g.id);
          b.setAttribute("aria-pressed", String(on));
          drawERF();
        });
        box.appendChild(b);
      });
    }
    const y = lastOf(D.erf.year), R = D.erf_range;
    const row = (label, k, color, note) => ({ label, mid: erfAt(k, y), lo: R[k][0], hi: R[k][1], color, note });
    setText("#erf-bars-sub", `Forcing in ${y} relative to 1750, W/m², with 5–95% range`);
    mk("chart-erf-bars", Viz.RangeBars, {
      labelWidth: 170, rangeLabel: "5–95% range",
      x: { format: (v) => (v > 0 ? "+" : "") + v, tipFormat: (v) => f2(v) + " W/m²" },
      rows: [
        row("Carbon dioxide", "CO2", col("s8")),
        row("Methane", "CH4", col("s2")),
        row("Nitrous oxide", "N2O", col("s4")),
        row("CFCs, HFCs etc.", "halogen", col("s4")),
        row("Ozone", "O3", col("s5")),
        row("Aerosols", "aerosol", col("s1"), "Includes direct reflection and the effect on clouds. The largest uncertainty in human forcing."),
        row("Land use", "land_use", col("s6")),
        row("Sun", "solar", col("s3"), "Relative to the 1750 level; varies with the 11-year cycle."),
        row("Volcanoes", "volcanic", col("s7"), "Relative to the long-term average; positive means quieter than average."),
        row("Total human", "anthro", col("human")),
      ],
    });
    setText("#txt-co2erf", plain(erfAt("CO2", y), 1));
    setText("#txt-wmghg", plain(erfAt("CO2", y) + erfAt("CH4", y) + erfAt("N2O", y) + erfAt("halogen", y), 1));
    setText("#txt-aer-lo", plain(R.aerosol[0], 1));
    setText("#txt-aer-hi", plain(R.aerosol[1], 1));
    setText("#txt-nat-erf", f1(erfAt("natural", y)));
    setText("#txt-anth-erf", f1(erfAt("anthro", y)));
    setText("#h-sun-val", f2(erfAt("solar", y)) + " W/m²");
  }

  function drawNatural() {
    const tsi = D.tsi;
    mk("chart-tsi", Viz.LineChart, {
      ariaLabel: "Total solar irradiance since 1850",
      height: (w) => (w < 520 ? 220 : 250),
      x: { min: 1850, max: lastOf(tsi)[0] + 1, snap: 1.5 },
      y: { min: 1360, max: 1363, format: (v) => v.toFixed(1), tipFormat: (v) => v.toFixed(2) + " W/m²", label: "W/m²" },
      series: [
        { id: "tsi", name: "Yearly", color: col("s4"), data: tsi, width: 1, opacity: 0.7 },
        { id: "tsi11r", name: "11-year average (reconstructed)", color: col("s3"), data: runMean(tsi, 11).filter((p) => p[0] <= 1979), width: 2.5, dash: "5 4" },
        { id: "tsi11", name: "11-year average (satellite era)", color: col("s3"), data: runMean(tsi, 11).filter((p) => p[0] >= 1979), width: 2.5 },
      ],
      shading: [{ x0: 1850, x1: 1978.5, label: "Reconstructed from sunspots", short: "Reconstructed" }],
    });
    mk("chart-tsi-temp", Viz.LineChart, {
      ariaLabel: "Global temperature 10-year average",
      height: (w) => (w < 520 ? 220 : 250),
      x: { min: 1850, max: lastOf(tsi)[0] + 1, snap: 1.5 },
      y: { format: (v) => (v > 0 ? "+" : "") + v.toFixed(1), tipFormat: (v) => f2(v) + " °C", label: "°C" },
      series: [{ id: "t10", name: "Temperature, 10-yr avg", color: col("warm"), data: runMean(D.igcc_gmst, 10), width: 2.5 }],
    });
    mk("chart-volc", Viz.LineChart, {
      ariaLabel: "Stratospheric aerosol optical depth",
      x: { min: 1850, max: lastOf(D.volcanic)[0] + 1, snap: 1.5 },
      y: { min: 0, format: (v) => v.toFixed(2), tipFormat: (v) => v.toFixed(3), label: "Aerosol optical depth" },
      series: [{ id: "aod", name: "Stratospheric haze", color: col("s7"), data: D.volcanic.map((r) => [r[0], r[1]]), width: 1.8, area: true }],
      shading: [{ x0: 1850, x1: 1979, label: "Reconstructed from ice-core sulfate and records", short: "Reconstructed" }],
      markers: VOLC_MARKS.filter((m) => m.x !== 1902),
    });
    const ohc = D.ocean_heat;
    const ohcOpts = (id) => ({
      ariaLabel: "Ocean heat content gained since 1971",
      x: { min: 1971, max: lastOf(ohc)[0] + 1, snap: 1 },
      y: { min: -50, format: (v) => v, tipFormat: (v) => Math.round(v) + " ZJ", label: "ZJ" },
      series: [{ id, name: "Ocean heat gained", color: col("s1"), data: ohc.map((r) => [r[0], r[1]]), band: ohc.map((r) => [r[0], r[1] - r[2], r[1] + r[2]]), width: 2.2, endDot: true }],
      shading: [{ x0: 1971, x1: 2005, label: "Sparse ship sampling", short: "Sparse" }],
    });
    mk("chart-ohc", Viz.LineChart, ohcOpts("ohc"));
    mk("chart-ohc2", Viz.LineChart, ohcOpts("ohc2"));
    const lo = Math.round(lastOf(ohc)[1] / 10) * 10;
    setText("#txt-ohc", String(lo)); setText("#h-ohc", String(lo));
  }

  const METHODS = { walsh: "Global Warming Index", gillett: "Regression", ribes: "Kriging" };
  const ATTR_SERIES = [
    { id: "anthropogenic", name: "All human causes", color: col("human") },
    { id: "ghg", name: "Greenhouse gases", color: col("ghg") },
    { id: "other_human_forcing", name: "Other human (mostly aerosols)", color: col("aerosol") },
    { id: "natural", name: "Natural (Sun, volcanoes)", color: col("natural") },
  ];
  function drawAttribution() {
    const A = D.attr[ui.attrMethod];
    const obs = D.igcc_gmst;
    mk("chart-attr", Viz.LineChart, {
      ariaLabel: "Observed warming compared with attributed causes",
      height: (w) => (w < 520 ? 300 : 380),
      x: { min: 1850, max: lastOf(A.year) + 1, snap: 1.5 },
      y: { min: -0.8, max: 2.2, format: (v) => (v > 0 ? "+" : "") + v.toFixed(1), tipFormat: (v) => f2(v), label: "°C" },
      series: [
        ...ATTR_SERIES.map((s) => ({
          ...s, hidden: ui.attrHidden.has(s.id), width: s.id === "anthropogenic" ? 2.6 : 1.8,
          data: A.year.map((y, i) => [y, A[s.id][i][1]]),
          band: A.year.map((y, i) => [y, A[s.id][i][0], A[s.id][i][2]]),
          bandOpacity: s.id === "anthropogenic" ? 0.2 : 0.12,
        })),
        { id: "obs", name: "Observed", color: col("obs"), data: obs, dots: 1.8, width: 0.8, opacity: 0.55, hidden: ui.attrHidden.has("obs") },
      ],
      refLines: [],
    });
    const box = $("#attr-toggles");
    if (!box.childElementCount) {
      [{ id: "obs", name: "Observed", color: col("obs") }, ...ATTR_SERIES].forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "tog"; b.setAttribute("aria-pressed", "true");
        b.innerHTML = `<i style="background:${s.color}"></i>${s.name}`;
        b.addEventListener("click", () => {
          const on = ui.attrHidden.has(s.id);
          if (on) ui.attrHidden.delete(s.id); else ui.attrHidden.add(s.id);
          b.setAttribute("aria-pressed", String(on));
          drawAttribution();
        });
        box.appendChild(b);
      });
    }
    const H = headline();
    const obsY = D.igcc_gmst.find((p) => p[0] === H.year);
    setText("#attr-year", String(H.year));
    $$(".hy").forEach((n) => (n.textContent = String(H.year)));
    mk("chart-attr-bars", Viz.RangeBars, {
      labelWidth: 200, rangeLabel: "5–95% range",
      x: { format: (v) => (v > 0 ? "+" : "") + v, tipFormat: (v) => f2(v) + " °C" },
      rows: [
        ...(obsY ? [{ label: `Observed, ${H.year}`, mid: obsY[1], color: col("obs"), note: "Single year, includes El Niño/La Niña effects." }] : []),
        { label: "All human causes", mid: H.ant[1], lo: H.ant[0], hi: H.ant[2], color: col("human") },
        { label: "  Greenhouse gases", mid: H.ghg[1], lo: H.ghg[0], hi: H.ghg[2], color: col("ghg") },
        { label: "  Other human (aerosols etc.)", mid: H.ohf[1], lo: H.ohf[0], hi: H.ohf[2], color: col("aerosol") },
        { label: "Natural forcing", mid: H.nat[1], lo: H.nat[0], hi: H.nat[2], color: col("natural") },
      ],
    });
    setText("#h-nat-val", f2(H.nat[1]) + " °C");
    const NAMES = { "CFC+HCFC+HFC": "CFCs, HCFCs, HFCs", NOx: "Nitrogen oxides (NOx)", "NMVOC+CO": "VOCs and carbon monoxide", SO2: "Sulfur dioxide (SO₂)", CO2: "Carbon dioxide", CH4: "Methane", N2O: "Nitrous oxide" };
    mk("chart-species", Viz.RangeBars, {
      labelWidth: 190, rangeLabel: "5–95% range",
      x: { format: (v) => (v > 0 ? "+" : "") + v, tipFormat: (v) => f2(v) + " °C" },
      rowHeight: 32,
      rows: D.species.map((s) => ({ label: NAMES[s.name] || s.name, mid: s.p50, lo: s.p05, hi: s.p95, color: s.p50 >= 0 ? col("human") : col("s1") })),
    });
  }

  function drawHunga() {
    const v = (y) => D.volcanic.find((r) => r[0] === y);
    const base = v(2021), y22 = v(2022), y23 = v(2023), y24 = v(2024);
    if (!base || !y22) return;
    const dS = (r) => r[2] - base[2];
    const y = lastOf(D.erf.year);
    const rows = [
      { label: `All human forcing, ${y}`, mid: erfAt("anthro", y), lo: D.erf_range.anthro[0], hi: D.erf_range.anthro[1], color: col("human"), note: "IGCC 2025, relative to 1750." },
      { label: "Hunga water vapour, 2023", mid: y23[3], color: col("s5"), note: "IGCC estimate from satellite water vapour and offline radiative transfer." },
      { label: "Hunga sulfate haze, 2022", mid: dS(y22), color: col("s1"), note: "Change in volcanic sulfate forcing from 2021. Includes some contribution from other eruptions." },
      { label: "Hunga net, 2022", mid: y22[3] + dS(y22), color: col("s7") },
      { label: "Hunga net, 2023", mid: y23[3] + dS(y23), color: col("s7") },
      ...(y24 ? [{ label: "Hunga net, 2024", mid: y24[3] + dS(y24), color: col("s7") }] : []),
      { label: "Multi-model net, 2022–23", mid: -0.19, lo: -0.25, hi: -0.13, color: col("s7"), note: "Quaglia et al. 2026, global mean at top of atmosphere (± one standard deviation)." },
    ];
    mk("chart-hunga", Viz.RangeBars, {
      labelWidth: 200, rowHeight: 32, rangeLabel: "Range",
      x: { format: (v) => (v > 0 ? "+" : "") + v, tipFormat: (v) => f2(v) + " W/m²" },
      rows,
    });
    setText("#h-h2o", f2(mean([y23[3], (y24 || y23)[3]])));
  }

  function drawOceans() {
    const sl = D.sea_level;
    mk("chart-sea", Viz.LineChart, {
      ariaLabel: "Global mean sea level since 1901",
      x: { min: 1900, max: lastOf(sl)[0] + 1, snap: 1.5 },
      y: { format: (v) => (v > 0 ? "+" : "") + v, tipFormat: (v) => f1(v) + " cm", label: "cm" },
      series: [{ id: "sl", name: "Sea level", color: col("s1"), data: sl.map((r) => [r[0], r[1] / 10]), band: sl.map((r) => [r[0], (r[1] - r[2]) / 10, (r[1] + r[2]) / 10]), width: 2, endDot: true }],
      shading: [{ x0: 1900, x1: 1993, label: "Reconstructed from tide gauges", short: "Tide gauges" }],
    });
  }

  const SCEN = [
    { id: "ssp119", name: "SSP1-1.9", label: "Very low", color: col("s3"), desc: "CO₂ emissions cut to net zero around 2050, then net negative.", p: [[1.5, 1.2, 1.7], [1.6, 1.2, 2.0], [1.4, 1.0, 1.8]], sl: [0.28, 0.55] },
    { id: "ssp126", name: "SSP1-2.6", label: "Low", color: col("s1"), desc: "CO₂ emissions reach net zero around 2070.", p: [[1.5, 1.2, 1.8], [1.7, 1.3, 2.2], [1.8, 1.3, 2.4]], sl: [0.32, 0.62] },
    { id: "ssp245", name: "SSP2-4.5", label: "Intermediate", color: col("s4"), desc: "Emissions stay around today's level until mid-century, then decline but do not reach net zero by 2100.", p: [[1.5, 1.2, 1.8], [2.0, 1.6, 2.5], [2.7, 2.1, 3.5]], sl: [0.44, 0.76] },
    { id: "ssp370", name: "SSP3-7.0", label: "High", color: col("s2"), desc: "Emissions roughly double by 2100 in a fragmented, slow-growth world.", p: [[1.5, 1.2, 1.8], [2.1, 1.7, 2.6], [3.6, 2.8, 4.6]], sl: [0.55, 0.9] },
    { id: "ssp585", name: "SSP5-8.5", label: "Very high", color: col("s8"), desc: "Emissions roughly double by 2050 through fossil-fuelled growth. Now considered unlikely as a baseline.", p: [[1.6, 1.3, 1.9], [2.4, 1.9, 3.0], [4.4, 3.3, 5.7]], sl: [0.63, 1.01] },
  ];
  function drawFuture() {
    const H = D.attr.walsh;
    const start = 2021;
    const hiIdx = H.year.indexOf(start);
    const startV = hiIdx >= 0 ? H.anthropogenic[hiIdx] : [1.0, 1.24, 1.5];
    const xs = [start, 2030.5, 2050.5, 2090.5];
    const obs = D.igcc_gmst.filter((p) => p[0] >= 1950);
    mk("chart-future", Viz.LineChart, {
      ariaLabel: "Projected warming by scenario to 2100",
      height: (w) => (w < 520 ? 300 : 380),
      x: { min: 1950, max: 2100, snap: 2.5 },
      y: { min: -0.2, max: 6, format: (v) => (v > 0 ? "+" : "") + v, tipFormat: (v) => plain(v) + " °C", label: "°C" },
      series: [
        { id: "obs", name: "Observed (yearly)", color: col("obs"), data: obs, width: 1.2, opacity: 0.8 },
        ...SCEN.map((s) => ({
          id: s.id, name: `${s.name} (${s.label})`, color: s.color, hidden: !ui.scen.has(s.id), width: s.id === ui.focus ? 3 : 2,
          data: [[xs[0], startV[1]], ...s.p.map((p, i) => [xs[i + 1], p[0]])],
          band: [[xs[0], startV[0], startV[2]], ...s.p.map((p, i) => [xs[i + 1], p[1], p[2]])],
          bandOpacity: s.id === ui.focus ? 0.2 : 0.07,
        })),
      ],
      refLines: [{ y: 1.5, label: "1.5 °C", right: true }, { y: 2, label: "2 °C", right: true }],
      shading: [{ x0: 1950, x1: 2025.5, label: "Measured", short: "Measured" }],
    });
    const box = $("#scen-chips");
    if (!box.childElementCount) {
      SCEN.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "tog"; b.dataset.id = s.id; b.setAttribute("aria-pressed", "true");
        b.innerHTML = `<i style="background:${s.color}"></i>${s.name} · ${s.label}`;
        b.addEventListener("click", () => {
          if (ui.focus !== s.id && ui.scen.has(s.id)) { ui.focus = s.id; }
          else if (ui.scen.has(s.id) && ui.scen.size > 1) { ui.scen.delete(s.id); if (ui.focus === s.id) ui.focus = [...ui.scen][0]; }
          else { ui.scen.add(s.id); ui.focus = s.id; }
          $$("#scen-chips .tog").forEach((x) => x.setAttribute("aria-pressed", String(ui.scen.has(x.dataset.id))));
          drawFuture();
        });
        box.appendChild(b);
      });
      const hint = document.createElement("span");
      hint.className = "lbl"; hint.style.marginLeft = "6px";
      hint.textContent = "Click to highlight; click again to hide";
      box.appendChild(hint);
    }
    const s = SCEN.find((x) => x.id === ui.focus);
    const card = (k, v, d) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span><span class="d">${d}</span></div>`;
    $("#scen-detail").innerHTML =
      card(`${s.name} · ${s.label}`, `<span style="font-size:1.05rem;line-height:1.35;display:block;font-weight:600">${s.desc}</span>`, "") +
      card("Around 2050 (2041–2060)", `+${s.p[1][0].toFixed(1)}<small>°C</small>`, `Very likely ${s.p[1][1].toFixed(1)}–${s.p[1][2].toFixed(1)} °C`) +
      card("Around 2090 (2081–2100)", `+${s.p[2][0].toFixed(1)}<small>°C</small>`, `Very likely ${s.p[2][1].toFixed(1)}–${s.p[2][2].toFixed(1)} °C`) +
      card("Sea-level rise by 2100", `${Math.round(s.sl[0] * 100)}–${Math.round(s.sl[1] * 100)}<small>cm</small>`, "Likely range, relative to 1995–2014");
    $$("#scen-detail .stat .v").forEach((n) => { if (!n.textContent.trim()) n.remove(); });

    mk("chart-policy", Viz.RangeBars, {
      labelWidth: 210, rowHeight: 34, rangeLabel: "Range",
      x: { min: 0, format: (v) => v, tipFormat: (v) => v.toFixed(1) + " °C" },
      rows: [
        { label: "SSP1-1.9 · very low", mid: 1.4, lo: 1.0, hi: 1.8, color: col("s3") },
        { label: "SSP1-2.6 · low", mid: 1.8, lo: 1.3, hi: 2.4, color: col("s1") },
        { label: "Pledges fully met (UNEP)", mid: 2.4, lo: 2.3, hi: 2.5, color: col("accent"), note: "UNEP 2025 gives 2.3–2.5 °C for full implementation of national pledges (NDCs). This span is across pledge variants, not climate uncertainty." },
        { label: "SSP2-4.5 · intermediate", mid: 2.7, lo: 2.1, hi: 3.5, color: col("s4") },
        { label: "Current policies (UNEP)", mid: 2.8, color: col("accent"), note: "UNEP Emissions Gap Report 2025 central estimate for this century with current policies." },
        { label: "SSP3-7.0 · high", mid: 3.6, lo: 2.8, hi: 4.6, color: col("s2") },
        { label: "SSP5-8.5 · very high", mid: 4.4, lo: 3.3, hi: 5.7, color: col("s8") },
      ],
    });
  }

  function drawHero() {
    Viz.Stripes($("#stripes"), D.igcc_gmst, { min: -0.3, max: 1.5, mid: 0.35 });
    setText("#stripes-start", String(D.igcc_gmst[0][0]));
    setText("#stripes-end", String(lastOf(D.igcc_gmst)[0]));
    const t = lastOf(D.igcc_gmst);
    const max = D.igcc_gmst.reduce((a, b) => (b[1] > a[1] ? b : a));
    $("#st-temp").innerHTML = `${f2(t[1])}<small>°C</small>`;
    setText("#st-temp-d", `${t[0]} vs 1850–1900. ${max[0] === t[0] ? "The warmest year on record." : `Record so far: ${max[0]} at ${f2(max[1])} °C.`}`);
    const c = D.co2_monthly[D.co2_monthly.length - 1];
    $("#st-co2").innerHTML = `${c[1].toFixed(1)}<small>ppm</small>`;
    setText("#st-co2-d", `${ymLabel(monthToX(c[0]))}. About 278 ppm before industrialization.`);
    const H = headline();
    $("#st-human").innerHTML = `${f2(H.ant[1])}<small>°C</small>`;
    setText("#st-human-d", `${H.year}, 5–95% range ${plain(H.ant[0])} to ${plain(H.ant[2])} °C. Natural forcing: ${f2(H.nat[1])} °C.`);
    const sl = D.sea_level;
    $("#st-sea").innerHTML = `+${((lastOf(sl)[1] - sl[0][1]) / 10).toFixed(0)}<small>cm</small>`;
    setText("#st-sea-d", `${sl[0][0]} to ${lastOf(sl)[0]}. Now rising about 4 mm per year.`);
    const dec = D.igcc_gmst.slice(-10).map((p) => p[1]);
    setText("#bl-warm", `${plain(Math.min(mean(dec), H.ant[1]), 1)}–${plain(Math.max(mean(dec), t[1]), 1)}`);
    const em = lastOf(D.emissions);
    setText("#h-emis", String(Math.round(em[1] + em[2])));
  }

  // ---------- Data status ----------
  const DATASETS = [
    { key: "igcc", name: "Global temperature (composite)", kinds: ["obs"], provider: "Indicators of Global Climate Change", latest: () => { const p = lastOf(D.igcc_gmst); return `${p[0]}: ${f2(p[1])} °C`; } },
    { key: "temps", name: "NASA GISTEMP v4", kinds: ["obs"], provider: "NASA GISS, via the datasets/global-temp mirror", latest: () => { const p = lastOf(D.gistemp_monthly); return `${ymLabel(monthToX(p[0]))}`; } },
    { key: "temps", name: "HadCRUT5", kinds: ["obs"], provider: "Met Office Hadley Centre / UEA, via datasets/global-temp", latest: () => { const p = lastOf(D.hadcrut_monthly); return `${ymLabel(monthToX(p[0]))}`; } },
    { key: "berkeley", name: "Berkeley Earth Land/Ocean", kinds: ["obs"], provider: "Berkeley Earth", latest: () => String(lastOf(D.berkeley)[0]) },
    { key: "co2", name: "CO₂ at Mauna Loa", kinds: ["obs"], provider: "NOAA GML and Scripps", latest: () => { const c = D.co2_monthly[D.co2_monthly.length - 1]; return `${ymLabel(monthToX(c[0]))}: ${c[1].toFixed(2)} ppm`; } },
    { key: "erf", name: "Radiative forcing, emissions, concentrations", kinds: ["est", "rec", "obs"], provider: "IGCC (Smith, Forster et al.)", latest: () => String(lastOf(D.erf.year)) },
    { key: "attr", name: "Attribution of warming", kinds: ["est"], provider: "IGCC (Walsh, Gillett, Ribes)", latest: () => `${headline().year}: ${f2(headline().ant[1])} °C human-induced` },
    { key: "sea", name: "Global mean sea level", kinds: ["obs", "rec"], provider: "IGCC (Slangen, Palmer)", latest: () => String(lastOf(D.sea_level)[0]) },
    { key: "ocean", name: "Ocean heat content", kinds: ["obs", "rec"], provider: "IGCC (Palmer, von Schuckmann)", latest: () => String(lastOf(D.ocean_heat)[0]) },
    { key: "tsi", name: "Solar irradiance and volcanic aerosol", kinds: ["obs", "rec"], provider: "IGCC forcing time series", latest: () => String(lastOf(D.tsi)[0]) },
    { key: "fixed", name: "Projections, paleoclimate ranges, extremes", kinds: ["proj", "rec"], provider: "IPCC AR6 (2021), UNEP (2025)", latest: () => "Published assessments" },
  ];
  const KIND = { obs: '<span class="kind obs">Measured</span>', rec: '<span class="kind rec">Reconstructed</span>', est: '<span class="kind est">Estimated</span>', proj: '<span class="kind proj">Projected</span>' };
  function drawStatus() {
    const chip = (st) => (st === "live" ? '<span class="chip live">live</span>' : st === "snap" ? `<span class="chip snap">snapshot ${S.built}</span>` : '<span class="chip">published values</span>');
    $("#data-table tbody").innerHTML = DATASETS.map((d) => `<tr><td>${d.name}</td><td><div class="kind-row">${(d.kinds || []).map((k) => KIND[k]).join("")}</div></td><td>${d.provider}</td><td class="n">${d.latest()}</td><td>${chip(status[d.key] || "fixed")}</td></tr>`).join("");
    const map = { igcc: "igcc", co2: "co2", attr: "attr", sea: "sea" };
    $$("[data-status]").forEach((n) => {
      const st = status[map[n.dataset.status]];
      n.className = "chip " + (st === "live" ? "live" : "snap");
      n.textContent = st === "live" ? "live" : `snapshot ${S.built}`;
    });
  }

  function drawAll() {
    drawHero(); drawRecord(); drawPaleo(); drawCO2(); drawEmissions(); drawERF(); drawNatural(); drawAttribution(); drawHunga(); drawOceans(); drawFuture(); drawStatus();
  }

  // ---------- Live data ----------
  async function get(url, ms = 9000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } finally { clearTimeout(t); }
  }
  async function firstOf(urls) {
    let err;
    for (const u of urls) { try { return await get(u); } catch (e) { err = e; } }
    throw err;
  }
  function csv(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
    const head = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((l) => { const c = l.split(","); const o = {}; head.forEach((h, i) => (o[h] = c[i])); return o; });
  }
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const r3 = (v) => (v === null ? null : Math.round(v * 1000) / 1000);
  const ok = (arr, min) => Array.isArray(arr) && arr.length >= min;

  const LIVE = [
    { key: "igcc", run: async () => {
      const rows = csv(await get(S.sources.igcc_gmst)).filter((x) => num(x.GMST) !== null).map((x) => [Math.floor(num(x.time)), r3(num(x.GMST))]);
      if (!ok(rows, 150)) throw new Error("short");
      D.igcc_gmst = rows;
    } },
    { key: "temps", run: async () => {
      const [a, m] = await Promise.all([get(S.sources.global_temp_annual), get(S.sources.global_temp_monthly)]);
      const A = csv(a), M = csv(m);
      const gis = A.filter((x) => x.Source === "GISTEMP").map((x) => [parseInt(x.Year, 10), num(x.Mean)]).sort((p, q) => p[0] - q[0]);
      const had = A.filter((x) => x.Source === "GCAG").map((x) => [parseInt(x.Year, 10), num(x.Mean)]).sort((p, q) => p[0] - q[0]);
      const hm = M.filter((x) => x.Source === "GCAG" && x.Year >= "1991").map((x) => [x.Year, num(x.Mean)]).sort();
      const gm = M.filter((x) => x.Source === "GISTEMP" && x.Year >= "1991").map((x) => [x.Year, num(x.Mean)]).sort();
      if (!ok(gis, 100) || !ok(had, 100) || !ok(hm, 100)) throw new Error("short");
      Object.assign(D, { gistemp: gis, hadcrut: had, hadcrut_monthly: hm, gistemp_monthly: gm.length ? gm : D.gistemp_monthly });
    } },
    { key: "berkeley", run: async () => {
      const rows = (await get(S.sources.berkeley)).split(/\r?\n/).filter((l) => /^\s*\d{4}\s/.test(l)).map((l) => l.trim().split(/\s+/)).filter((p) => num(p[1]) !== null).map((p) => [parseInt(p[0], 10), num(p[1]), num(p[2])]);
      if (!ok(rows, 150)) throw new Error("short");
      D.berkeley = rows;
    } },
    { key: "co2", run: async () => {
      // Try NOAA directly first, then the GitHub mirror of the same NOAA file.
      const text = await firstOf(["https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv", S.sources.co2_monthly]);
      const rows = csv(text);
      let out;
      if ("decimal date" in rows[0]) {
        out = rows.map((x) => [`${x.year}-${String(x.month).padStart(2, "0")}`, num(x.average) > 0 ? num(x.average) : num(x.deseasonalized)]);
      } else {
        out = rows.map((x) => [x.Date, num(x.Average) > 0 ? num(x.Average) : num(x.Interpolated)]);
      }
      out = out.filter((p) => p[1] !== null && p[1] > 0);
      if (!ok(out, 700)) throw new Error("short");
      D.co2_monthly = out;
    } },
    { key: "erf", run: async () => {
      const rows = csv(await get(S.sources.erf));
      const cols = Object.keys(D.erf).filter((k) => k !== "year");
      const e = { year: rows.map((x) => Math.floor(num(x.time))) };
      cols.forEach((c) => (e[c] = rows.map((x) => r3(num(x[c])))));
      if (!ok(e.year, 250) || e.CO2.some((v) => v === null)) throw new Error("bad");
      D.erf = e;
    } },
    { key: "attr", run: async () => {
      const parse = (t) => {
        const rows = csv(t), out = { year: rows.map((x) => Math.floor(num(x.time))) };
        ["anthropogenic", "ghg", "other_human_forcing", "natural"].forEach((k) => (out[k] = rows.map((x) => [r3(num(x[k + "_p05"])), r3(num(x[k + "_p50"])), r3(num(x[k + "_p95"]))])));
        return out;
      };
      const [w, g, r] = await Promise.all([get(S.sources.attr_walsh), get(S.sources.attr_gillett), get(S.sources.attr_ribes)]);
      const A = { walsh: parse(w), gillett: parse(g), ribes: parse(r) };
      if (!ok(A.walsh.year, 150)) throw new Error("short");
      D.attr = A;
    } },
    { key: "sea", run: async () => {
      const rows = csv(await get(S.sources.sea_level)).filter((x) => num(x.time) !== null).map((x) => [Math.floor(num(x.time)), num(x.mean), num(x.std)]);
      if (!ok(rows, 100)) throw new Error("short");
      D.sea_level = rows;
    } },
    { key: "tsi", run: async () => {
      const [sv, vv] = await Promise.all([get(S.sources.solar), get(S.sources.volcanic)]);
      const tsi = csv(sv).filter((x) => num(x.Year) >= 1850 && num(x.igcc) !== null).map((x) => [Math.floor(num(x.Year)), num(x.igcc)]);
      const vol = csv(vv).filter((x) => num(x.year) >= 1850).map((x) => [Math.floor(num(x.year)), num(x.stratospheric_AOD), num(x.ERF_sulfate), num(x.ERF_H2O)]);
      if (!ok(tsi, 150) || !ok(vol, 150)) throw new Error("short");
      D.tsi = tsi; D.volcanic = vol;
    } },
    { key: "ocean", run: async () => {
      const rows = csv(await get(S.sources.energy)).filter((x) => num(x.time) !== null && num(x["ocean_full-depth"]) !== null).map((x) => [Math.floor(num(x.time)), num(x["ocean_full-depth"]), num(x["ocean_full-depth_error"])]);
      if (!ok(rows, 40)) throw new Error("short");
      D.ocean_heat = rows;
    } },
  ];

  async function goLive() {
    let changed = false;
    await Promise.all(LIVE.map(async (src) => {
      try { await src.run(); status[src.key] = "live"; changed = true; }
      catch (e) { status[src.key] = "snap"; }
    }));
    if (changed) drawAll(); else drawStatus();
  }

  // ---------- Controls ----------
  function seg(id, fn) {
    $$(`#${id} button`).forEach((b) => b.addEventListener("click", () => {
      $$(`#${id} button`).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      fn(b.dataset.v);
    }));
  }
  seg("rec-smooth", (v) => { ui.recSmooth = +v; drawRecord(); });
  seg("rec-marks", (v) => { ui.recMarks = v; drawRecord(); });
  seg("res-win", (v) => { ui.resWin = +v; drawResolution(); });
  seg("co2-range", (v) => { ui.co2 = v; drawCO2(); });
  seg("attr-method", (v) => { ui.attrMethod = v; drawAttribution(); });

  $$("#nat-tabs button").forEach((b) => b.addEventListener("click", () => {
    $$("#nat-tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.tab));
    drawNatural();
  }));

  const expand = $("#hyp-expand");
  expand.addEventListener("click", () => {
    const open = expand.getAttribute("aria-pressed") !== "true";
    $$("#hyps details").forEach((d) => (d.open = open));
    expand.setAttribute("aria-pressed", String(open));
    expand.textContent = open ? "Close all cards" : "Open all cards";
  });
  $$("#hyps details").forEach((d) => d.addEventListener("toggle", () => { if (d.open && d.id === "h-hunga") drawHunga(); }));

  // Chapter navigation
  const chapters = $$("main > section.chapter");
  const links = $$("#rail-list a");
  const current = () => {
    const y = window.scrollY + 90;
    let idx = -1;
    chapters.forEach((c, i) => { if (c.offsetTop <= y) idx = i; });
    return idx;
  };
  const go = (d) => {
    const i = Math.max(-1, Math.min(chapters.length - 1, current() + d));
    const target = i < 0 ? $("#top") : chapters[i];
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  $("#prev-ch").addEventListener("click", () => go(-1));
  $("#next-ch").addEventListener("click", () => go(1));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "j" || e.key === "J") { e.preventDefault(); go(1); }
    if (e.key === "k" || e.key === "K") { e.preventDefault(); go(-1); }
  });
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const i = current();
      links.forEach((a, j) => a.classList.toggle("on", j === i));
      if (i < 0) links[0].closest("nav").scrollLeft = 0;
      const on = links[i];
      if (on) { const nav = on.closest("nav"); const l = on.offsetLeft - nav.clientWidth / 2 + on.clientWidth / 2; if (Math.abs(nav.scrollLeft - l) > 40) nav.scrollLeft = l; }
      ticking = false;
    });
  }, { passive: true });

  drawAll();
  goLive();
})();
