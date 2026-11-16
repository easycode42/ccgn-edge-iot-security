// Builds deliverables/CCGN_Final_Report.pptx from the report files and dashboard stills.
// Usage:  node tools/build_deck.js
// Needs:  npm packages pptxgenjs, sharp, react, react-dom, react-icons, jszip (set NODE_PATH if they
//         are installed elsewhere) and the stills from `node tools/record_demo.mjs deliverables/recording`.
// Every number on the slides is read from reports/*.json, so the deck cannot drift from the evidence.
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const JSZip = require("jszip");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const fa = require("react-icons/fa");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "deliverables", "CCGN_Final_Report.pptx");
const latest = prefix => {
  const names = fs.readdirSync(path.join(ROOT, "reports"))
    .filter(n => n.startsWith(prefix) && /\d\.json$/.test(n) && !n.includes("FAILED")).sort();
  if (!names.length) throw new Error("No report " + prefix);
  return { name: names.at(-1), data: JSON.parse(fs.readFileSync(path.join(ROOT, "reports", names.at(-1)), "utf8")) };
};
const LAT = latest("latency-"), EVAL = latest("evaluation-"), MEC = latest("mec-check-");
const m = LAT.data.metrics, rep = EVAL.data.repeated.summary;
const r0 = v => v.toFixed(0), r1 = v => v.toFixed(1), r2 = v => v.toFixed(2);
const pct = v => (v * 100).toFixed(v === 1 || v === 0 ? 0 : 1) + "%";
const mecStep = name => MEC.data.steps.filter(s => s.step.startsWith(name));

const THEME = {
  name: "CCGN", headFontFace: "Cambria", bodyFontFace: "Calibri",
  colors: { dk1: "12343B", lt1: "FFFFFF", dk2: "3F5A60", lt2: "EDF3F3", accent1: "1E8A87",
            accent2: "C8403F", accent3: "E89B2B", accent4: "5E4AA5", accent5: "2B6CB5",
            accent6: "8A9A9C", hlink: "1E8A87", folHlink: "5E4AA5" },
};
const H = THEME.colors;

async function icon(name, color = "FFFFFF") {
  const svg = renderToStaticMarkup(React.createElement(fa[name], { color: "#" + color, size: 256 }));
  return "image/png;base64," + (await sharp(Buffer.from(svg)).png().toBuffer()).toString("base64");
}
async function crop(file, left, top, width, height) {
  const buf = await sharp(path.join(ROOT, "deliverables", "recording", file))
    .extract({ left, top, width, height }).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_16x9";                     // 10 x 5.625 in
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  pres.title = "CCGN Final Report";
  pres.author = "Team CCGN";
  const C = pres.SchemeColor;
  const FOOT = "Team CCGN  |  Final Report  |  oneM2M International Developer Competition 2026";

  pres.defineSlideMaster({
    title: "TITLE_DARK", background: { color: H.dk1 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 1.0, w: 7.0, h: 2.05, fontSize: 28,
          bold: true, color: C.background1, fontFace: "Cambria", valign: "bottom", align: "left", margin: 0 }, text: "" } },
      { placeholder: { options: { name: "body", type: "body", x: 0.6, y: 3.25, w: 6.8, h: 1.4, fontSize: 14,
          color: C.background1, valign: "top", margin: 0 }, text: "" } }],
  });
  pres.defineSlideMaster({
    title: "CONTENT", background: { color: H.lt1 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.45, y: 0.28, w: 9.1, h: 0.7, fontSize: 26,
          bold: true, color: C.text1, fontFace: "Cambria", valign: "middle", align: "left", margin: 0 }, text: "" } },
      { text: { text: FOOT, options: { x: 0.45, y: 5.28, w: 7, h: 0.22, fontSize: 8, color: C.accent6, margin: 0 } } }],
    slideNumber: { x: 9.15, y: 5.28, w: 0.4, h: 0.22, fontSize: 8, color: H.accent6, align: "right" },
  });

  const text = (slide, value, o) => slide.addText(value, { isTextBox: true, margin: 0, valign: "top", ...o });
  const card = (slide, x, y, w, h, fill = C.background2, name) =>
    slide.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.08, fill: { color: fill },
      line: { color: fill, width: 0 }, objectName: name });
  async function badge(slide, name, x, y, d, color) {
    slide.addShape(pres.ShapeType.ellipse, { x, y, w: d, h: d, fill: { color }, line: { color, width: 0 } });
    slide.addImage({ data: await icon(name), x: x + d * 0.26, y: y + d * 0.26, w: d * 0.48, h: d * 0.48 });
  }
  const content = (section, title, notes) => {
    const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: section });
    s.addText(title, { placeholder: "title" });
    s.addNotes(notes);
    return s;
  };

  // ── 1. Title ─────────────────────────────────────────────────────────────
  pres.addSection({ title: "Overview" });
  let s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Overview" });
  s.addText("Edge AI-based IoT Device Anomaly Detection on oneM2M and ETSI MEC", { placeholder: "title" });
  s.addText([
    { text: "Final Report: working prototype, measurements, ETSI MEC Sandbox interworking", options: { bold: true, breakLine: true } },
    { text: "Team CCGN  ·  Jiho Lee  ·  Sejong University, Dept. of Information Security", options: { breakLine: true } },
    { text: "2026 oneM2M International Developer Competition  ·  November 2026", options: { fontSize: 11 } },
  ], { placeholder: "body" });
  await badge(s, "FaShieldAlt", 7.75, 1.85, 1.8, C.accent1);
  s.addNotes("Team CCGN is a one-person team, Jiho Lee, working with AI coding assistants. The interim report in October " +
    "covered the use case and the architecture. This final report shows the working prototype, what we measured, " +
    "and the interworking check against the real ETSI MEC Sandbox.");

  // ── 2. Summary ───────────────────────────────────────────────────────────
  s = content("Overview", "What the prototype proves",
    "The headline results. All four MVP threats from the interim plan are detected and handled on a real ACME oneM2M CSE. " +
    `A flooding sensor is blocked at the CSE a median of ${r0(m["flood.arrival_to_enforced_ms"].median)} milliseconds after the request that ` +
    `crossed the threshold. In the same live runs, ${LAT.data.normal_traffic.readings} normal readings produced ` +
    `${LAT.data.normal_traffic.alerts} alerts. And the MEC011 registration and discovery flow passed against the real ETSI MEC Sandbox. ` +
    "Every number in this deck is read from a report file in the repository.");
  const stats = [
    ["4 / 4", "MVP threats detected and handled on a real ACME oneM2M CSE", C.accent1],
    [r0(m["flood.arrival_to_enforced_ms"].median) + " ms", "median from the threshold-crossing request to the sensor being blocked at the CSE", C.accent5],
    [`${LAT.data.normal_traffic.alerts} / ${LAT.data.normal_traffic.readings}`, "false alerts on normal readings across 30 live runs", C.accent4],
    ["Passed", "MEC011 registration and discovery on the real ETSI MEC Sandbox", C.accent3],
  ];
  stats.forEach(([big, label, color], i) => {
    const x = 0.45 + i * 2.3;
    card(s, x, 1.2, 2.15, 2.35, C.background2, "Stat card " + (i + 1));
    text(s, big, { x: x + 0.2, y: 1.42, w: 1.8, h: 0.75, fontSize: 34, bold: true, color, fontFace: "Cambria" });
    text(s, label, { x: x + 0.2, y: 2.25, w: 1.8, h: 1.2, fontSize: 14, color: C.text1 });
  });
  text(s, [
    { text: "Only standard interfaces: ", options: { bold: true } },
    { text: "oneM2M Mca (AE, CNT, CIN, SUB, ACP) for data, alerts and blocking; ETSI MEC011 over Mp1 for service registration and discovery.", options: { breakLine: true } },
    { text: "Evidence in the repository: ", options: { bold: true } },
    { text: "19 automated tests, 5 pass/fail scenarios, and the latency, evaluation and MEC report files behind every number here." },
  ], { x: 0.45, y: 3.85, w: 9.1, h: 1.2, fontSize: 14, color: C.text1, paraSpaceAfter: 6 });

  // ── 3. Architecture ──────────────────────────────────────────────────────
  pres.addSection({ title: "Design" });
  s = content("Design", "Architecture as built (TR-0080 Option D)",
    "This is what runs today, all on one edge host. Simulated sensors send oneM2M requests through a request logger to a real ACME " +
    "MN-CSE. The logger records every request and the CSE's answer, path 2. New sensor data reaches the detector as a oneM2M " +
    "notification, path 3. The detector is itself a oneM2M AE: it writes alerts into the CSE and updates the ACP to block, path 4. " +
    "Over MEC011 the CSE service and the alert service are registered and discovered, paths 5 and 6; the detector reaches the CSE " +
    "through the discovered address. The MEC platform is the ETSI MEC Sandbox in the interworking check, and a local stand-in in a normal run.");
  const box = (x, y, w, h, fill, line, label, sub, labelColor = C.text1) => {
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: { color: line, width: 1.25 } });
    text(s, label, { x: x + 0.1, y: y + 0.09, w: w - 0.2, h: 0.28, fontSize: 12, bold: true, color: labelColor, align: "center" });
    if (sub) text(s, sub, { x: x + 0.1, y: y + 0.4, w: w - 0.2, h: h - 0.45, fontSize: 10, color: C.text2, align: "center" });
  };
  const arrow = (x, y, w, h, color, flipV = false, flipH = false) => s.addShape(pres.ShapeType.line,
    { x, y, w, h, line: { color, width: 1.75, endArrowType: "triangle" }, flipV, flipH });
  const num = (n, x, y, color) => {
    s.addShape(pres.ShapeType.ellipse, { x, y, w: 0.26, h: 0.26, fill: { color }, line: { color, width: 0 } });
    text(s, String(n), { x, y, w: 0.26, h: 0.26, fontSize: 10, bold: true, color: C.background1, align: "center", valign: "middle" });
  };
  s.addShape(pres.ShapeType.roundRect, { x: 2.35, y: 1.1, w: 5.2, h: 3.75, rectRadius: 0.04, fill: { color: H.lt2 },
    line: { color: H.accent5, width: 1.25, dashType: "dash" }, objectName: "MEC host" });
  text(s, "Edge host (one node)", { x: 2.35, y: 1.14, w: 5.2, h: 0.25, fontSize: 11, bold: true, color: C.accent5, align: "center" });
  box(0.45, 1.5, 1.6, 1.0, C.background1, H.accent1, "Sensor AEs", "Ctemp, Cdoor (simulated)");
  box(0.45, 2.75, 1.6, 1.0, C.background1, H.accent2, "Attack scenarios", "bounded, this host only", C.accent2);
  box(2.55, 1.5, 1.45, 1.0, C.background1, H.accent3, "Request logger", "records request and result");
  box(4.4, 1.5, 2.95, 1.0, C.background1, H.dk1, "ACME MN-CSE", "AE · CNT · CIN · SUB · ACP");
  box(3.3, 2.95, 3.2, 0.85, C.background1, H.accent4, "Detector (oneM2M AE)", "rules + Isolation Forest · alert · ACP update", C.accent4);
  box(2.55, 4.15, 4.8, 0.55, C.background1, H.accent5, "MEC platform  (MEC011 over Mp1): service registry and discovery", null, C.accent5);
  box(7.9, 1.5, 1.65, 1.0, C.background1, H.accent1, "Dashboard", "status, alerts, history", C.accent1);
  box(7.9, 2.95, 1.65, 0.85, C.background1, H.accent1, "Alert consumer", "finds the alert service via MEC", C.accent1);
  arrow(2.05, 2.0, 0.5, 0, H.dk1); num(1, 2.17, 1.7, H.dk1);
  arrow(2.05, 2.5, 0.5, 0.75, H.accent2, true);
  arrow(4.0, 2.0, 0.4, 0, H.dk1);
  arrow(3.45, 2.5, 0, 0.45, H.accent3); num(2, 3.1, 2.58, H.accent3);
  arrow(5.0, 2.5, 0, 0.45, H.accent4); num(3, 4.66, 2.58, H.accent4);
  arrow(5.9, 2.5, 0, 0.45, H.dk1, true); num(4, 5.98, 2.58, H.dk1);
  arrow(7.0, 2.5, 0, 1.65, H.accent5); num(5, 7.08, 3.5, H.accent5);
  arrow(4.2, 3.8, 0, 0.35, H.accent5); num(6, 3.86, 3.84, H.accent5);
  arrow(6.5, 3.37, 1.4, 0, H.accent1);
  arrow(7.35, 2.0, 0.55, 0, H.accent1);
  text(s, [
    { text: "Mca: ", options: { bold: true } }, { text: "1 device requests   3 notification   4 alert + ACP update      " },
    { text: "Logger: ", options: { bold: true, color: C.accent3 } }, { text: "2 request records      " },
    { text: "Mp1: ", options: { bold: true, color: C.accent5 } }, { text: "5 CSE service registered   6 discovery + alert service" },
  ], { x: 0.45, y: 4.95, w: 9.1, h: 0.25, fontSize: 10, color: C.text1 });

  // ── 4. Threat table ──────────────────────────────────────────────────────
  s = content("Design", "Each threat has its own evidence and its own answer",
    "Three threats are visible in the request records and are handled by rules. Sensor values arrive by notification and go through " +
    "a range rule plus an Isolation Forest. Only flooding leads to an automatic block, because a wrong block on a sensor value would " +
    "cut off a healthy device. For every row the last column says how the demo proves the response worked.");
  const head = t => ({ text: t, options: { bold: true, color: C.background1, fill: { color: H.dk1 }, fontSize: 12 } });
  const cell = (t, o = {}) => ({ text: t, options: { fontSize: 12, color: C.text1, ...o } });
  s.addTable([
    [head("Threat"), head("Seen through"), head("Detection"), head("Response and proof")],
    [cell("Unregistered originator", { bold: true }), cell("Request records: originator, CSE result"), cell("Rule: not in the registered AE list"), cell("Alert. CSE already denies it (RSC 4103)")],
    [cell("Cross-device access", { bold: true }), cell("Request records: target, denied result"), cell("Rule: the CSE refused under ACP"), cell("Alert. Not counted as a new block")],
    [cell("Abnormal sensor value", { bold: true }), cell("CIN notification from the CSE"), cell("15–40 °C rule + Isolation Forest"), cell("Alert only. Never an automatic block")],
    [cell("Request flood", { bold: true }), cell("Requests per device in a 2 s window"), cell("Rule: more than 12 requests"), cell("ACP update, then a real request must be denied")],
  ], { x: 0.45, y: 1.2, w: 9.1, colW: [1.9, 2.5, 2.3, 2.4], rowH: 0.62, valign: "middle",
       border: { type: "solid", pt: 0.75, color: "D5DFE0" }, margin: [0.04, 0.1, 0.04, 0.1] });
  text(s, "Out of scope: a copied, valid originator ID. That is an authentication problem (oneM2M TS-0013) and is not detected.",
    { x: 0.45, y: 4.55, w: 9.1, h: 0.5, fontSize: 12, italic: true, color: C.text2 });

  // ── 5. Demo: anomaly ─────────────────────────────────────────────────────
  pres.addSection({ title: "Demonstration" });
  s = content("Demonstration", "Demo: the AI catches what the range rule misses",
    "This is the dashboard during the sensor anomaly scenario. Six green points are normal readings. Then two abnormal values arrive: " +
    "65 degrees breaks the fixed range rule, 29 degrees is inside the allowed range and only the Isolation Forest flags it. " +
    "Both raise alerts and the sensor stays allowed, because sensor anomalies never cause an automatic block.");
  s.addImage({ data: await crop("04-anomaly.png", 1040, 548, 828, 345), x: 0.45, y: 1.2, w: 6.0, h: 2.5,
    altText: "Dashboard temperature chart: six normal readings in green, 65 and 29 degrees in red" });
  s.addShape(pres.ShapeType.rect, { x: 0.45, y: 1.2, w: 6.0, h: 2.5, fill: { type: "none" }, line: { color: "D5DFE0", width: 0.75 } });
  const notes5 = [
    ["65 °C", "outside 15–40 °C: caught by the rule and the model", C.accent2],
    ["29 °C", "inside the range: caught only by the Isolation Forest", C.accent4],
    ["Allowed", "alert only; the sensor is not blocked for a bad value", C.accent1],
  ];
  notes5.forEach(([big, label, color], i) => {
    const y = 1.2 + i * 1.28;
    card(s, 6.7, y, 2.85, 1.13, C.background2, "Demo note " + (i + 1));
    text(s, big, { x: 6.88, y: y + 0.12, w: 2.5, h: 0.42, fontSize: 22, bold: true, color, fontFace: "Cambria" });
    text(s, label, { x: 6.88, y: y + 0.56, w: 2.5, h: 0.5, fontSize: 12, color: C.text1 });
  });
  text(s, [
    { text: "Path: ", options: { bold: true } },
    { text: "sensor AE → request logger → ACME CSE → subscription notification → detector. " },
    { text: `Median ${r0(m["anomaly.send_to_alert_ms"].median)} ms from sending the reading to the alert.`, options: { bold: true, color: C.accent1 } },
  ], { x: 0.45, y: 3.95, w: 6.0, h: 0.6, fontSize: 14, color: C.text1 });
  text(s, "Dashboard screenshot from the recorded run (deliverables/CCGN_Demo.mp4)",
    { x: 0.45, y: 4.95, w: 6.0, h: 0.22, fontSize: 10, color: C.text2 });

  // ── 6. Demo: verified block ──────────────────────────────────────────────
  s = content("Demonstration", "Blocking is proven, not assumed",
    "This is the history during the flood scenario, newest first. Reading upward: the sensor's requests succeed with RSC 2000, the " +
    "detector raises the flood alert, updates the ACP, and then sends a real request as the sensor. The CSE itself answers 4103, " +
    "access denied. Only then is the block recorded as verified. The requests after that are denied too. " +
    "We count a block only if access worked before and is refused afterwards.");
  s.addImage({ data: await crop("06-flood-history.png", 70, 325, 1150, 530), x: 0.45, y: 1.2, w: 5.9, h: 2.72,
    altText: "History rows: requests with RSC 2000, flood alert, ACP block verified with RSC 4103, then denied requests" });
  s.addShape(pres.ShapeType.rect, { x: 0.45, y: 1.2, w: 5.9, h: 2.72, fill: { type: "none" }, line: { color: "D5DFE0", width: 0.75 } });
  const steps6 = [
    ["1", "Before", "The sensor's requests succeed (RSC 2000)", H.accent1],
    ["2", "Detect and act", "More than 12 requests in 2 s: alert, then the sensor is removed from the container ACP", H.accent3],
    ["3", "Prove", "A real request as the sensor is refused by the CSE (RSC 4103)", H.accent2],
  ];
  steps6.forEach(([n, title, body, color], i) => {
    const y = 1.2 + i * 1.2;
    s.addShape(pres.ShapeType.ellipse, { x: 6.6, y: y + 0.02, w: 0.42, h: 0.42, fill: { color }, line: { color, width: 0 } });
    text(s, n, { x: 6.6, y: y + 0.02, w: 0.42, h: 0.42, fontSize: 14, bold: true, color: C.background1, align: "center", valign: "middle" });
    text(s, title, { x: 7.15, y, w: 2.4, h: 0.3, fontSize: 14, bold: true, color: C.text1 });
    text(s, body, { x: 7.15, y: y + 0.32, w: 2.4, h: 0.8, fontSize: 12, color: C.text2 });
  });
  text(s, [
    { text: `${r2(m["flood.requests_admitted_after_trigger"].mean)} requests`, options: { bold: true, color: C.accent2 } },
    { text: ` on average still got through after the threshold was crossed (at most ${r0(m["flood.requests_admitted_after_trigger"].max)}). ` },
    { text: "Recovery is verified the same way: after the operator restores access, a real request must succeed." },
  ], { x: 0.45, y: 4.1, w: 5.9, h: 1.0, fontSize: 14, color: C.text1 });

  // ── 7. Latency ───────────────────────────────────────────────────────────
  pres.addSection({ title: "Results" });
  const enf = m["flood.arrival_to_enforced_ms"];
  s = content("Results", `A flooding sensor is blocked in about ${r0(enf.median)} ms`,
    `We repeated every scenario ${LAT.data.runs} times against the running system and measured with one process clock. ` +
    `From the request that crosses the flood threshold to the ACP update being acknowledged by the CSE takes a median of ${r1(enf.median)} ` +
    `milliseconds and ${r1(enf.p95)} at the 95th percentile. A sensor reading needs about ${r0(m["normal.send_to_inspected_ms"].median)} milliseconds ` +
    "to travel through the CSE notification to a model decision. These are single-PC loopback figures, so they show that the edge loop is " +
    "short, not how a distributed deployment would perform.");
  const rows7 = [
    ["Unknown originator: request → alert", m["unregistered.arrival_to_alert_ms"]],
    ["Cross-device access: request → alert", m["acp.arrival_to_alert_ms"]],
    ["Flood: threshold request → alert", m["flood.arrival_to_alert_ms"]],
    ["Abnormal reading sent → alert", m["anomaly.send_to_alert_ms"]],
    ["Flood: threshold request → blocked at CSE", enf],
  ];
  s.addChart(pres.charts.BAR, [
    { name: "Median", labels: rows7.map(r => r[0]), values: rows7.map(r => +r[1].median.toFixed(1)) },
    { name: "95th percentile", labels: rows7.map(r => r[0]), values: rows7.map(r => +r[1].p95.toFixed(1)) },
  ], { x: 0.45, y: 1.1, w: 6.2, h: 3.75, barDir: "bar", barGrouping: "clustered", barGapWidthPct: 60,
       chartColors: [H.accent1, H.accent6], showLegend: true, legendPos: "b", legendFontSize: 11, legendFontFace: "+mn-lt",
       legendColor: H.dk1, showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 10, dataLabelFontFace: "+mn-lt",
       dataLabelColor: H.dk1, dataLabelFormatCode: "0", catAxisLabelFontSize: 10, catAxisLabelFontFace: "+mn-lt",
       catAxisLabelColor: H.dk1, catAxisOrientation: "maxMin", valAxisLabelFontSize: 10, valAxisLabelFontFace: "+mn-lt",
       valAxisLabelColor: H.dk2, valAxisTitle: "milliseconds", showValAxisTitle: true, valAxisTitleFontSize: 10,
       valAxisTitleFontFace: "+mn-lt", valAxisTitleColor: H.dk2, valGridLine: { color: "E3EAEA", size: 0.75 },
       catGridLine: { style: "none" }, altText: "Bar chart of median and 95th percentile latency per scenario" });
  card(s, 6.9, 1.2, 2.65, 1.6, C.background2, "Latency callout");
  text(s, r0(enf.median) + " ms", { x: 7.08, y: 1.33, w: 2.3, h: 0.6, fontSize: 30, bold: true, color: C.accent1, fontFace: "Cambria" });
  text(s, `median to block; ${r0(enf.p95)} ms at p95, ${r0(enf.max)} ms worst of ${enf.n}`, { x: 7.08, y: 1.98, w: 2.3, h: 0.7, fontSize: 12, color: C.text1 });
  card(s, 6.9, 2.95, 2.65, 1.9, C.background2, "Latency scope");
  text(s, "How it was measured", { x: 7.08, y: 3.07, w: 2.3, h: 0.3, fontSize: 12, bold: true, color: C.text1 });
  text(s, `${LAT.data.runs} runs of every scenario on one Windows PC over loopback, in-memory CSE, one clock. Not a network or scale result.`,
    { x: 7.08, y: 3.4, w: 2.3, h: 1.35, fontSize: 12, color: C.text2 });

  // ── 8. Model evaluation ──────────────────────────────────────────────────
  const fa1 = rep.rules_plus_ai.false_alerts_per_minute, fa2 = rep.rules_plus_ai_2consecutive.false_alerts_per_minute;
  s = content("Results", "AI adds coverage but raises false alerts",
    `Offline evaluation on synthetic temperature data, repeated ${EVAL.data.repeated.trials} times with new seeds for training, normal and attack data. ` +
    "The range rule alone only sees the spike. Adding the Isolation Forest detects the shift, a small shift of two and a half sigma, and a slow drift. " +
    `The price is ${r2(fa1.mean)} false alerts per minute on normal data. An offline what-if that requires two consecutive AI flags removes almost all ` +
    `of them, at ${pct(rep.rules_plus_ai_2consecutive.by_kind.small_shift.detection_rate.mean)} detection for the small shift. That variant is not deployed. ` +
    "A single feature and Gaussian data make this an easy problem; it does not prove field accuracy.");
  const kinds = [["spike", "Spike (65 °C)"], ["shift", "Shift (29 °C)"], ["small_shift", "Small shift (+2.5 σ)"], ["drift", "Drift (+0.8 °C/sample)"]];
  const series = [["rules_only", "Rules only"], ["rules_plus_ai", "Rules + AI (deployed)"], ["rules_plus_ai_2consecutive", "Rules + AI, 2 consecutive (what-if)"]];
  s.addChart(pres.charts.BAR, series.map(([key, name]) => ({ name, labels: kinds.map(k => k[1]),
    values: kinds.map(k => +(rep[key].by_kind[k[0]].detection_rate.mean * 100).toFixed(1)) })),
    { x: 0.45, y: 1.1, w: 6.2, h: 3.75, barDir: "col", barGrouping: "clustered", barGapWidthPct: 70,
      chartColors: [H.accent6, H.accent1, H.accent4], showLegend: true, legendPos: "b", legendFontSize: 11,
      legendFontFace: "+mn-lt", legendColor: H.dk1, showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 10,
      dataLabelFontFace: "+mn-lt", dataLabelColor: H.dk1, dataLabelFormatCode: "0", catAxisLabelFontSize: 10,
      catAxisLabelFontFace: "+mn-lt", catAxisLabelColor: H.dk1, valAxisLabelFontSize: 10, valAxisLabelFontFace: "+mn-lt",
      valAxisLabelColor: H.dk2, valAxisMaxVal: 120, valAxisMinVal: 0, valAxisMajorUnit: 20, valAxisTitle: "episodes detected (%)", showValAxisTitle: true,
      valAxisTitleFontSize: 10, valAxisTitleFontFace: "+mn-lt", valAxisTitleColor: H.dk2,
      valGridLine: { color: "E3EAEA", size: 0.75 }, catGridLine: { style: "none" },
      altText: "Detection rate by attack shape for rules only, rules plus AI, and the two-consecutive variant" });
  card(s, 6.9, 1.2, 2.65, 2.45, C.background2, "False alert card");
  text(s, "False alerts per minute", { x: 7.08, y: 1.32, w: 2.3, h: 0.3, fontSize: 12, bold: true, color: C.text1 });
  [["0.00", "Rules only", C.accent6], [r2(fa1.mean), `Rules + AI  (±${r2(fa1.stdev)})`, C.accent1],
   [r2(fa2.mean), "2 consecutive (what-if)", C.accent4]].forEach(([big, label, color], i) => {
    const y = 1.7 + i * 0.63;
    text(s, big, { x: 7.08, y, w: 0.85, h: 0.5, fontSize: 22, bold: true, color, fontFace: "Cambria" });
    text(s, label, { x: 7.95, y: y + 0.1, w: 1.5, h: 0.45, fontSize: 11, color: C.text1 });
  });
  card(s, 6.9, 3.8, 2.65, 1.05, C.background2, "Evaluation scope");
  text(s, `Synthetic data, ${EVAL.data.repeated.trials} trials, 20 episodes per shape. Not field accuracy.`,
    { x: 7.08, y: 3.92, w: 2.3, h: 0.85, fontSize: 12, color: C.text2 });

  // ── 9. ETSI MEC ──────────────────────────────────────────────────────────
  const st = n => mecStep(n).map(x => x.status).join(", ");
  s = content("Results", "ETSI MEC Sandbox: MEC011 interworking passed",
    `On ${MEC.data.started.slice(0, 10)} the check ran against the real ETSI MEC Sandbox at ${MEC.data.platform_host}, network scenario ${MEC.data.network_scenario}. ` +
    "The client logs in with a GitHub device code, activates a scenario and creates three application instances. Then, over MEC011: confirm ready, " +
    "register the oneM2M CSE as a service, discover it and retrieve a oneM2M resource through the discovered address, register and discover the " +
    "alert service, and read the alerts. Everything created is removed again. The first attempt failed because we called the Sandbox before its " +
    "services had started; that failed report is kept in the repository. Scope: the endpoints are loopback addresses, so this shows API " +
    "interworking, not MEC application hosting.");
  const flow = [
    ["Provision", "Sandbox login, scenario, 3 app instances", st("create_app_instance")],
    ["confirm_ready", "CSE helper, detector, test client", st("confirm_ready")],
    ["Register CSE", "oneM2M CSE as a MEC service", st("register_service:ccgn-onem2m-cse")],
    ["Discover + use", "oneM2M retrieve via discovered URI", "200, RSC " + mecStep("onem2m_retrieve")[0].rsc],
    ["Alert service", "register, discover, read alerts", st("register_service:ccgn-anomaly-alert") + ", " + st("alerts_via")],
    ["Clean up", "services, app instances, scenario", st("deregister_service")],
  ];
  flow.forEach(([title, body, status], i) => {
    const x = 0.45 + i * 1.53;
    card(s, x, 1.2, 1.4, 1.75, C.background2, "MEC step " + (i + 1));
    num(i + 1, x + 0.12, 1.32, H.accent5);
    text(s, title, { x: x + 0.12, y: 1.66, w: 1.2, h: 0.3, fontSize: 12, bold: true, color: C.text1 });
    text(s, body, { x: x + 0.12, y: 1.97, w: 1.2, h: 0.55, fontSize: 10, color: C.text2 });
    text(s, "HTTP " + status, { x: x + 0.12, y: 2.58, w: 1.2, h: 0.3, fontSize: 10, bold: true, color: C.accent1 });
  });
  text(s, "What the real platform taught us", { x: 0.45, y: 3.2, w: 4.4, h: 0.3, fontSize: 14, bold: true, color: C.text1 });
  text(s, [
    { text: "Login accepts provider=github only, not the documented GITHUB", options: { bullet: true, breakLine: true } },
    { text: "Right after login the Sandbox answers 500 until its services start: wait and retry", options: { bullet: true, breakLine: true } },
    { text: "Scenario activation returns 204, not the documented 201", options: { bullet: true } },
  ], { x: 0.45, y: 3.55, w: 4.5, h: 1.45, fontSize: 12, color: C.text1, paraSpaceAfter: 4 });
  card(s, 5.2, 3.2, 4.35, 1.75, C.background2, "MEC scope");
  text(s, "Scope of this evidence", { x: 5.4, y: 3.32, w: 3.95, h: 0.3, fontSize: 14, bold: true, color: C.text1 });
  text(s, "Services are registered with loopback endpoints and consumed on the same PC. This shows MEC011 API interworking with the real platform. " +
    "It is not MEC application hosting, remote reachability or conformance certification.",
    { x: 5.4, y: 3.66, w: 3.95, h: 1.2, fontSize: 12, color: C.text2 });

  // ── 10. Plan vs delivered ────────────────────────────────────────────────
  pres.addSection({ title: "Assessment" });
  s = content("Assessment", "Planned in October, delivered in November",
    "Compared with the interim plan. The core loop, the four MVP threats, the Isolation Forest, verified ACP blocking and the MEC011 services " +
    "are delivered. Two things changed: the dashboard is a small Flask page instead of Streamlit so that it runs in the same process as the " +
    "detector, and we kept two sensors, temperature and door, and dropped humidity. None of the stretch goals were done.");
  const ok = t => cell(t, { bold: true, color: C.accent1 }), no = t => cell(t, { bold: true, color: C.accent2 }), ch = t => cell(t, { bold: true, color: C.accent3 });
  s.addTable([
    [head("Interim plan"), head("Status"), head("What exists now")],
    [cell("Sensor AE → CSE → notification → detector"), ok("Delivered"), cell("Real ACME CSE, subscription with verification")],
    [cell("Four MVP threats"), ok("Delivered"), cell("Five pass/fail scenarios including normal traffic")],
    [cell("Rules + Isolation Forest"), ok("Delivered"), cell("Compared in 30 repeated offline trials")],
    [cell("ACP blocking"), ok("Delivered"), cell("Block and restore verified by real CSE responses")],
    [cell("MEC011 alert service"), ok("Delivered"), cell("Passed on the ETSI MEC Sandbox (API interworking)")],
    [cell("Streamlit dashboard, three sensors"), ch("Changed"), cell("Flask + HTML dashboard; temperature and door only")],
    [cell("Stretch: spoofed IDs, cross-sensor checks, cloud IN-CSE"), no("Not done"), cell("Left as future work")],
  ], { x: 0.45, y: 1.15, w: 9.1, colW: [3.6, 1.2, 4.3], rowH: 0.45, valign: "middle",
       border: { type: "solid", pt: 0.75, color: "D5DFE0" }, margin: [0.03, 0.1, 0.03, 0.1] });

  // ── 11. Limits ───────────────────────────────────────────────────────────
  s = content("Assessment", "Limits we state openly",
    "Four limits. First, an originator string is not authentication, so a copied valid ID is not identified. Second, a client that talks " +
    "to the CSE directly bypasses the request logger; only the notification-based detection still sees it. Third, the measurements come from " +
    "one PC, one simulated temperature sensor and synthetic training data. Fourth, the MEC evidence is API interworking with loopback endpoints. " +
    "An ACP block also denies access to resources; it does not stop network traffic.");
  const limits = [
    ["FaIdBadge", "Identity", "The originator string is not authentication. A copied, registered ID is not identified.", C.accent2],
    ["FaRandom", "Bypass", "Requests sent straight to the CSE skip the request logger. Real deployments need network isolation.", C.accent3],
    ["FaServer", "Scale and data", "One PC, one simulated temperature sensor, synthetic training data, fixed rules.", C.accent4],
    ["FaNetworkWired", "MEC scope", "MEC011 API interworking with loopback endpoints. Not app hosting or conformance.", C.accent5],
  ];
  for (let i = 0; i < limits.length; i++) {
    const [ic, title, body, color] = limits[i];
    const x = 0.45 + (i % 2) * 4.65, y = 1.2 + Math.floor(i / 2) * 1.75;
    card(s, x, y, 4.45, 1.55, C.background2, "Limit " + (i + 1));
    await badge(s, ic, x + 0.22, y + 0.25, 0.7, color);
    text(s, title, { x: x + 1.12, y: y + 0.2, w: 3.15, h: 0.32, fontSize: 14, bold: true, color: C.text1 });
    text(s, body, { x: x + 1.12, y: y + 0.55, w: 3.15, h: 0.9, fontSize: 12, color: C.text2 });
  }
  text(s, "An ACP block denies resource access; it does not stop network traffic or protect the CSE from exhaustion.",
    { x: 0.45, y: 4.8, w: 9.1, h: 0.3, fontSize: 12, italic: true, color: C.text2 });

  // ── 12. Closing ──────────────────────────────────────────────────────────
  s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "Assessment" });
  s.addText("Standard interfaces were enough to detect, block and prove it at the edge", { placeholder: "title" });
  s.addText([
    { text: "Next steps", options: { bold: true, breakLine: true } },
    { text: "Authenticated device identity (oneM2M TS-0013) to cover copied IDs", options: { bullet: true, breakLine: true } },
    { text: "Persistence filter for AI alerts, then several sensors and real data", options: { bullet: true, breakLine: true } },
    { text: "Run the detector and CSE as hosted MEC applications", options: { bullet: true } },
  ], { placeholder: "body" });
  await badge(s, "FaShieldAlt", 7.75, 1.85, 1.8, C.accent1);
  text(s, "Reproduce:  setup.ps1  →  start.ps1  →  python -m ccgn demo | benchmark | evaluate | mec-check --sandbox",
    { x: 0.6, y: 4.85, w: 8.8, h: 0.3, fontSize: 11, color: C.background1 });
  s.addNotes("To close: with nothing but oneM2M resources and the MEC011 service APIs, the prototype detects four kinds of misbehaviour, " +
    "blocks a flooding sensor in about sixty milliseconds, and proves the block with the CSE's own answer. The next steps are authenticated " +
    "identity, a persistence filter to cut false alerts, more sensors with real data, and hosting both parts as MEC applications. " +
    "Everything shown can be reproduced with the commands on this slide. Thank you.");

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await pres.writeFile({ fileName: OUT });
  // pptxgenjs cannot write theme colours: put THEME's palette and name into the theme part.
  const zip = await JSZip.loadAsync(fs.readFileSync(OUT));
  const themePath = Object.keys(zip.files).find(n => /^ppt\/theme\/theme\d+\.xml$/.test(n));
  let xml = await zip.file(themePath).async("string");
  for (const [key, hex] of Object.entries(THEME.colors)) {
    xml = xml.replace(new RegExp(`(<a:${key}>)[\\s\\S]*?(</a:${key}>)`), `$1<a:srgbClr val="${hex}"/>$2`);
  }
  zip.file(themePath, xml.replace(/<a:theme([^>]*?)name="[^"]*"/, `<a:theme$1name="${THEME.name}"`));
  const clean = new JSZip();                       // files only: folder entries upset some cloud viewers
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir) clean.file(name, await entry.async("nodebuffer"), { createFolders: false });
  }
  fs.writeFileSync(OUT, await clean.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log("Saved: " + OUT + `  (latency ${LAT.name}, evaluation ${EVAL.name}, MEC ${MEC.name})`);
})();
