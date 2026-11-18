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
const latest = (prefix, keep = () => true) => {
  const found = fs.readdirSync(path.join(ROOT, "reports"))
    .filter(n => n.startsWith(prefix) && /\d\.json$/.test(n) && !n.includes("FAILED")).sort()
    .map(name => ({ name, data: JSON.parse(fs.readFileSync(path.join(ROOT, "reports", name), "utf8")) }))
    .filter(r => keep(r.data));
  if (!found.length) throw new Error("No report " + prefix);
  return found.at(-1);
};
// Reports written before the CSE became selectable carry no "cse" field: those runs used ACME.
const cseOf = d => d.cse || "ACME";
const LAT = latest("latency-", d => cseOf(d) === "tinyIoT"), LAT_ACME = latest("latency-", d => cseOf(d) === "ACME");
const EVAL = latest("evaluation-"), MEC = latest("mec-check-"), DEMO = latest("edge-demo-sandbox-");
const CSE = cseOf(LAT.data), mA = LAT_ACME.data.metrics;
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
async function crop(dir, file, left, top, width, height) {
  const buf = await sharp(path.join(ROOT, "deliverables", dir, file))
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
  const head = t => ({ text: t, options: { bold: true, color: C.background1, fill: { color: H.dk1 }, fontSize: 12 } });
  const cell = (t, o = {}) => ({ text: t, options: { fontSize: 12, color: C.text1, ...o } });
  // Numbered circle on the slide being built (reads the current `s`).
  const num = (n, x, y, color) => {
    s.addShape(pres.ShapeType.ellipse, { x, y, w: 0.26, h: 0.26, fill: { color }, line: { color, width: 0 } });
    text(s, String(n), { x, y, w: 0.26, h: 0.26, fontSize: 10, bold: true, color: C.background1, align: "center", valign: "middle" });
  };
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
    { text: "Final Report: how it works, live demo on tinyIoT and the ETSI MEC Sandbox, results", options: { bold: true, breakLine: true } },
    { text: "Team CCGN  ·  Jiho Lee  ·  Sejong University, Dept. of Information Security", options: { breakLine: true } },
    { text: "2026 oneM2M International Developer Competition  ·  November 2026", options: { fontSize: 11 } },
  ], { placeholder: "body" });
  await badge(s, "FaShieldAlt", 7.75, 1.85, 1.8, C.accent1);
  s.addNotes("Team CCGN is a one-person team, Jiho Lee, working with AI coding assistants. The interim report in October " +
    "covered the use case and the architecture. This final report shows the working prototype, what we measured, " +
    "and the interworking check against the real ETSI MEC Sandbox.");

  // ── 2. What we set out to do ─────────────────────────────────────────────
  s = content("Overview", "What we set out to do",
    "Three things to know before the demo. The problem: IoT devices are too small to protect themselves, and analysing everything " +
    "in the cloud is slow and moves raw data off site. Our goal: watch the standard oneM2M platform itself, at the edge, and stop a " +
    "misbehaving device with standard oneM2M access control. What we built: tinyIoT as the CSE, a detector application that is " +
    "itself a oneM2M AE, a dashboard that shows every step, and the MEC integration through MEC011 and MEC013.");
  const why = [
    ["FaExclamationTriangle", "Problem", "IoT devices cannot run their own security. Sending every request to the cloud is slow and moves raw data off site.", C.accent2],
    ["FaBullseye", "Goal", "Detect misbehaving devices at the edge, on the standard oneM2M platform, and stop them with standard oneM2M access control.", C.accent1],
    ["FaTools", "What we built", "tinyIoT CSE + a detector AE (rules + Isolation Forest) on a MEC host, MEC011 and MEC013 integration, an attack tool and a live dashboard.", C.accent5],
  ];
  for (let i = 0; i < 3; i++) {
    const [ic, title, body, color] = why[i], x = 0.45 + i * 3.08;
    card(s, x, 1.2, 2.92, 3.15, C.background2, title);
    await badge(s, ic, x + 0.25, 1.42, 0.72, color);
    text(s, title, { x: x + 0.25, y: 2.3, w: 2.45, h: 0.35, fontSize: 18, bold: true, color: C.text1, fontFace: "Cambria" });
    text(s, body, { x: x + 0.25, y: 2.72, w: 2.45, h: 1.55, fontSize: 14, color: C.text2 });
  }
  text(s, [{ text: "In one sentence: ", options: { bold: true } },
    { text: "a oneM2M application on the MEC host watches the CSE, decides with rules and AI, and answers with oneM2M requests." }],
    { x: 0.45, y: 4.55, w: 9.1, h: 0.5, fontSize: 14, color: C.text1 });

  // ── 3. Use case story ────────────────────────────────────────────────────
  s = content("Overview", "Use case: a compromised sensor in a smart building",
    "The story the demo follows. A building runs its sensors on a oneM2M platform hosted on an on-site MEC server. The temperature " +
    "sensor is compromised: it floods requests, sends abnormal values and tries to read the door sensor. The detector on the same " +
    "edge host notices, stores an alert, blocks only that sensor through its ACP, and asks the MEC location service where the device " +
    "is attached, so the operator knows which device, which service and where.");
  const story = [
    ["1", "Normal", "Sensor AEs write readings into their containers on the edge CSE.", H.accent1],
    ["2", "Attack", "The temperature sensor is compromised: request flood, abnormal values, reads the door data.", H.accent2],
    ["3", "Detect at the edge", "The detector AE checks request records and every notified reading: rules + Isolation Forest.", H.accent4],
    ["4", "Respond with oneM2M", "Alert stored as a CIN. For a flood: the sensor is removed from its ACP, and the CSE refuses it.", H.accent3],
    ["5", "Locate with MEC", "MEC013 returns the device's zone and cell. Other devices keep working.", H.accent5],
  ];
  story.forEach(([n, title, body, color], i) => {
    const x = 0.45 + i * 1.84;
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.62, y: 1.2, w: 0.5, h: 0.5, fill: { color }, line: { color, width: 0 } });
    text(s, n, { x: x + 0.62, y: 1.2, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: C.background1, align: "center", valign: "middle" });
    if (i < 4) s.addShape(pres.ShapeType.line, { x: x + 1.2, y: 1.45, w: 1.18, h: 0, line: { color: "C3CFDC", width: 1.5, endArrowType: "triangle" } });
    card(s, x, 1.9, 1.74, 2.6, C.background2, "Story " + n);
    text(s, title, { x: x + 0.14, y: 2.02, w: 1.48, h: 0.55, fontSize: 14, bold: true, color: C.text1 });
    text(s, body, { x: x + 0.14, y: 2.62, w: 1.48, h: 1.8, fontSize: 12, color: C.text2 });
  });
  text(s, "Users: building operators and security staff. The same pattern fits smart homes and factories with mixed-vendor devices.",
    { x: 0.45, y: 4.7, w: 9.1, h: 0.4, fontSize: 12, italic: true, color: C.text2 });

  pres.addSection({ title: "Design" });
  // ── 4. How we use oneM2M ─────────────────────────────────────────────────
  s = content("Design", "How we use oneM2M",
    "Everything that touches data goes through oneM2M. Each sensor and the detector register as AEs; the registered list is how " +
    "an unknown originator is recognised. Readings are content instances in containers on the edge CSE. The detector subscribes to " +
    "the temperature container, so the CSE pushes every new reading to it. Access control policies decide who may read or write; " +
    "the detector changes the policy to block a device, and the CSE's own refusal, response code 4103, is the proof. Alerts are " +
    "content instances too, so any oneM2M application can read them.");
  const tree = [
    [0, "cse-ccgn  (tinyIoT MN-CSE)", true], [1, "temperature  AE Ctemp", false], [2, "data  CNT  ← readings (CIN)", false],
    [3, "detector-sub  SUB", false], [1, "door  AE Cdoor", false], [2, "data  CNT", false],
    [1, "detector  AE Cdetector", false], [2, "alerts  CNT  ← alerts (CIN)", false],
    [1, "temperature-policy  ACP", false], [1, "door-policy · alerts-policy  ACP", false]];
  card(s, 0.45, 1.15, 3.6, 3.95, C.background2, "Resource tree");
  text(s, "Resource tree", { x: 0.65, y: 1.27, w: 3.2, h: 0.3, fontSize: 14, bold: true, color: C.text1 });
  tree.forEach(([lvl, label, bold], i) => text(s, label, { x: 0.65 + lvl * 0.28, y: 1.66 + i * 0.32, w: 3.3 - lvl * 0.28, h: 0.3,
    fontSize: 12, bold, color: label.includes("ACP") ? C.accent3 : label.includes("SUB") ? C.accent4 : C.text1, fontFace: "Consolas" }));
  const used = [
    ["AE registration", "Device identity. An originator that is not registered is flagged."],
    ["CNT / CIN", "Sensor readings and alerts are stored at the edge, in the CSE."],
    ["SUB / notification", "The CSE pushes every new reading to the detector: no polling."],
    ["ACP", "Who may read or write. The detector updates it to block a device."],
    ["RSC 4103", "The CSE's own refusal proves the block is enforced."],
    ["Discovery (fu=1)", "The dashboard lists the live resource tree."],
  ];
  s.addTable([[head("oneM2M feature"), head("What it does in CCGN")], ...used.map(([a, b]) => [cell(a, { bold: true }), cell(b)])],
    { x: 4.25, y: 1.15, w: 5.3, colW: [1.65, 3.65], rowH: 0.5, valign: "middle", border: { type: "solid", pt: 0.75, color: "D5DFE0" },
      margin: [0.03, 0.08, 0.03, 0.08] });

  // ── 5. How oneM2M and MEC work together ──────────────────────────────────
  const live = DEMO.data, loc = live.flood_source_lookups[0];
  s = content("Design", "How oneM2M and MEC work together (Option D)",
    "We follow deployment option D from oneM2M TR-0080: the CSE and the detector are both applications on the MEC host. The MEC " +
    "platform connects them through two standard APIs. MEC011: the CSE helper app registers the CSE as a service, the detector " +
    "discovers it and from then on sends its oneM2M requests to the discovered address; the detector also publishes its alert " +
    "service, which another MEC app discovers. MEC013, the location API: after a block, the detector asks where the device is " +
    "attached. In the demo the MEC platform is the real ETSI MEC Sandbox.");
  s.addShape(pres.ShapeType.roundRect, { x: 0.45, y: 1.15, w: 4.6, h: 3.4, rectRadius: 0.05, fill: { color: H.lt2 },
    line: { color: H.accent5, width: 1.25, dashType: "dash" }, objectName: "MEC host" });
  text(s, "MEC host (edge node)", { x: 0.6, y: 1.22, w: 4.3, h: 0.28, fontSize: 12, bold: true, color: C.accent5 });
  const appBox = (x, y, w, h, title, sub, color) => {
    s.addShape(pres.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: H.lt1 }, line: { color, width: 1.25 } });
    text(s, title, { x: x + 0.1, y: y + 0.08, w: w - 0.2, h: 0.28, fontSize: 12, bold: true, color: C.text1 });
    text(s, sub, { x: x + 0.1, y: y + 0.38, w: w - 0.2, h: h - 0.42, fontSize: 10, color: C.text2 });
  };
  appBox(0.65, 1.6, 2.0, 0.95, "MEC app 1: tinyIoT CSE", "oneM2M MN-CSE; publishes itself as onem2m-cse", H.dk1);
  appBox(2.85, 1.6, 2.0, 0.95, "MEC app 2: detector AE", "rules + Isolation Forest; publishes anomaly-alert", H.accent4);
  s.addShape(pres.ShapeType.line, { x: 2.65, y: 2.07, w: 0.2, h: 0, line: { color: H.dk1, width: 1.5, beginArrowType: "triangle", endArrowType: "triangle" } });
  text(s, "Mca", { x: 2.5, y: 1.8, w: 0.5, h: 0.2, fontSize: 9, color: C.text2, align: "center" });
  appBox(0.65, 3.05, 4.2, 1.3, "MEC platform (ETSI MEC Sandbox in the demo)",
    "MEC011 service registry: onem2m-cse, anomaly-alert, and the platform's own services\nMEC013 location service: where each UE is attached", H.accent5);
  [[1.1, "a"], [2.0, "b"], [3.3, "c"], [4.2, "d"]].forEach(([x, l]) => {
    s.addShape(pres.ShapeType.line, { x, y: 2.55, w: 0, h: 0.5, line: { color: H.accent5, width: 1.5, beginArrowType: l === "b" || l === "d" ? "triangle" : undefined, endArrowType: "triangle" } });
    text(s, l, { x: x + 0.05, y: 2.65, w: 0.2, h: 0.25, fontSize: 11, bold: true, color: C.accent5 });
  });
  const calls = [
    ["a", "MEC011 POST …/services", "CSE app registers onem2m-cse"],
    ["b", "MEC011 GET …/services", "detector discovers the CSE and uses that URI for every Mca request"],
    ["c", "MEC011 POST …/services", "detector publishes anomaly-alert; a consumer app discovers it"],
    ["d", "MEC013 GET …/queries/users", `after a block: ${loc.origin} is UE ${loc.address}, ${loc.zone}, ${loc.access_point}`],
  ];
  s.addTable([[head(""), head("Standard call"), head("What happens")], ...calls.map(([l, a, b]) => [cell(l, { bold: true, color: C.accent5 }), cell(a, { fontFace: "Consolas", fontSize: 11 }), cell(b)])],
    { x: 5.25, y: 1.15, w: 4.3, colW: [0.3, 1.6, 2.4], rowH: 0.62, valign: "middle", border: { type: "solid", pt: 0.75, color: "D5DFE0" }, margin: [0.03, 0.06, 0.03, 0.06] });
  text(s, `Real ETSI MEC Sandbox run: ${live.mec_services_listed_by_the_platform.length} services listed (incl. the platform's mec012, mec013, mec030 …).`,
    { x: 5.25, y: 4.5, w: 4.3, h: 0.55, fontSize: 11, italic: true, color: C.text2 });

  // ── 6. Data path ─────────────────────────────────────────────────────────
  s = content("Design", "Where data is stored and where it is analysed",
    "Following one reading. It leaves the sensor as a oneM2M create request, enters the edge through the request logger, which " +
    "records who asked for what and how the CSE answered, and is stored as a content instance in tinyIoT. tinyIoT notifies the " +
    "detector through the subscription. Analysis happens only in the detector, on the edge host. Its answer goes back as oneM2M " +
    "requests: an alert content instance, or an ACP update. Nothing leaves the edge host.");
  s.addImage({ data: await crop("walkthrough", "01-architecture.png", 40, 0, 1840, 700), x: 0.45, y: 1.12, w: 6.25, h: 2.38,
    altText: "Live architecture diagram from the dashboard" });
  s.addShape(pres.ShapeType.rect, { x: 0.45, y: 1.12, w: 6.25, h: 2.38, fill: { type: "none" }, line: { color: "D5DFE0", width: 0.75 } });
  const path5 = [
    ["1", "Enter", "sensor → request logger, which records it"],
    ["2", "Store", "tinyIoT: temperature/data, a CIN per reading"],
    ["3", "Notify", "tinyIoT → detector through the subscription"],
    ["4", "Analyse", "detector AE: rules + Isolation Forest"],
    ["5", "Answer", "alert CIN in detector/alerts, or ACP update"],
  ];
  path5.forEach(([n, a, b], i) => {
    const y = 1.12 + i * 0.48;
    s.addShape(pres.ShapeType.ellipse, { x: 6.9, y: y + 0.04, w: 0.3, h: 0.3, fill: { color: H.accent1 }, line: { color: H.accent1, width: 0 } });
    text(s, n, { x: 6.9, y: y + 0.04, w: 0.3, h: 0.3, fontSize: 11, bold: true, color: C.background1, align: "center", valign: "middle" });
    text(s, [{ text: a + "  ", options: { bold: true, color: C.text1 } }, { text: b, options: { color: C.text2 } }], { x: 7.3, y, w: 2.25, h: 0.46, fontSize: 11 });
  });
  card(s, 0.45, 3.7, 9.1, 1.35, C.background2, "Storage and analysis");
  text(s, [
    { text: "Stored: ", options: { bold: true } }, { text: "readings, alerts and access rules all live in tinyIoT on the edge host.", options: { breakLine: true } },
    { text: "Analysed: ", options: { bold: true } }, { text: "only in the detector AE, on the same host; the CSE stays a standard, unmodified tinyIoT.", options: { breakLine: true } },
    { text: "Enforced: ", options: { bold: true } }, { text: "by the CSE itself through the ACP, so it holds for every client, not just this dashboard." },
  ], { x: 0.65, y: 3.8, w: 8.7, h: 1.15, fontSize: 13, color: C.text1, paraSpaceAfter: 3 });

  // ── 7. Flood: which node, which service, where ───────────────────────────
  const blk = live.flood_blocks.at(-1) || {};
  s = content("Design", "During a flood: which node, which service, and where",
    "What a flood touches, step by step, with numbers from the run against the ETSI MEC Sandbox. The burst enters through the " +
    "request logger and hits the temperature container in tinyIoT. The detector counts more than twelve requests in two seconds " +
    "and removes the sensor from the temperature policy. From then on tinyIoT refuses that sensor; the door sensor's service is not " +
    `affected. Then MEC013 tells us where the device is: user equipment ${loc.address}, ${loc.zone}, ${loc.access_point}.`);
  const fl = [
    ["Node under load", "tinyIoT temperature/data, through the request logger", H.accent3],
    ["Detected", "> 12 requests in 2 s from Ctemp (detector rule)", H.accent4],
    ["Response", `PUT temperature-policy removes Ctemp${blk.acp_update_ms ? ` (${r0(blk.acp_update_ms)} ms)` : ""}`, H.accent2],
    ["Service denied", "Ctemp → temperature/data: RSC 4103. Cdoor → door/data: still OK", H.accent2],
    ["Located (MEC013)", `UE ${loc.address} · ${loc.zone} · ${loc.access_point}`, H.accent5],
  ];
  fl.forEach(([a, b, color], i) => {
    const y = 1.15 + i * 0.66;
    s.addShape(pres.ShapeType.roundRect, { x: 0.45, y, w: 5.3, h: 0.56, rectRadius: 0.06, fill: { color: H.lt2 }, line: { color: H.lt2, width: 0 } });
    s.addShape(pres.ShapeType.ellipse, { x: 0.58, y: y + 0.14, w: 0.28, h: 0.28, fill: { color }, line: { color, width: 0 } });
    text(s, a, { x: 1.0, y: y + 0.08, w: 1.55, h: 0.42, fontSize: 12, bold: true, color: C.text1, valign: "middle" });
    text(s, b, { x: 2.55, y: y + 0.08, w: 3.1, h: 0.42, fontSize: 12, color: C.text2, valign: "middle" });
  });
  card(s, 6.0, 1.15, 3.55, 1.6, C.background2, "Block latency");
  text(s, r0(m["flood.arrival_to_enforced_ms"].median) + " ms", { x: 6.2, y: 1.27, w: 3.2, h: 0.6, fontSize: 30, bold: true, color: C.accent1, fontFace: "Cambria" });
  text(s, `median from the threshold request to the block at the CSE (${LAT.data.runs} runs on ${CSE})`, { x: 6.2, y: 1.92, w: 3.2, h: 0.75, fontSize: 12, color: C.text1 });
  card(s, 6.0, 2.9, 3.55, 1.6, C.background2, "Location");
  text(s, `${loc.zone} · ${loc.access_point}`, { x: 6.2, y: 3.02, w: 3.2, h: 0.45, fontSize: 18, bold: true, color: C.accent5, fontFace: "Cambria" });
  text(s, `UE ${loc.address} at ${(+loc.lat).toFixed(4)}, ${(+loc.lon).toFixed(4)}, answered by the ETSI MEC Sandbox location API`, { x: 6.2, y: 3.5, w: 3.2, h: 0.9, fontSize: 12, color: C.text1 });
  text(s, "Device-to-UE pairing is assigned for the demo; the simulated sensors have no radio of their own.",
    { x: 0.45, y: 4.6, w: 9.1, h: 0.4, fontSize: 11, italic: true, color: C.text2 });

  // ── 8. Dashboard tour ────────────────────────────────────────────────────
  pres.addSection({ title: "Demonstration" });
  s = content("Demonstration", "The dashboard: what each part shows",
    "Before the demo, how to read the dashboard. At the top, the live architecture: every request, notification, alert and ACP " +
    "change lights up the path it takes, and a step-by-step list explains it in words. Below: what is inside the detector, which " +
    "service is affected, values read straight from the CSE, and the MEC registry with the location of each device.");
  s.addImage({ data: await crop("walkthrough", "01-architecture.png", 0, 0, 1920, 975), x: 0.45, y: 1.12, w: 5.4, h: 2.74,
    altText: "Dashboard: live architecture and step-by-step trace" });
  s.addShape(pres.ShapeType.rect, { x: 0.45, y: 1.12, w: 5.4, h: 2.74, fill: { type: "none" }, line: { color: "D5DFE0", width: 0.75 } });
  const tour = [
    ["Live architecture", "the path each event takes, coloured by result"],
    ["Step by step", "each event in words, with real codes"],
    ["Inside the detector", "flood window vs threshold, AI score per reading"],
    ["Which service is affected", "one request per second as each device"],
    ["Read from the CSE", "ACP rules, latest CIN, stored alerts, resource tree"],
    ["MEC panel", "MEC011 services and MEC013 device locations"],
  ];
  tour.forEach(([a, b], i) => {
    const y = 1.12 + i * 0.47;
    text(s, String(i + 1), { x: 6.05, y, w: 0.3, h: 0.42, fontSize: 14, bold: true, color: C.accent1 });
    text(s, [{ text: a, options: { bold: true, color: C.text1, breakLine: true } }, { text: b, options: { color: C.text2, fontSize: 11 } }], { x: 6.35, y, w: 3.2, h: 0.46, fontSize: 12 });
  });
  text(s, "Nothing on the page is simulated by the page itself: it reads the detector's event store, the CSE and the MEC platform.",
    { x: 0.45, y: 4.1, w: 9.1, h: 0.45, fontSize: 12, italic: true, color: C.text2 });

  // ── 9. Demo plan ─────────────────────────────────────────────────────────
  s = content("Demonstration", "Demo plan: five scenarios",
    "The demo runs five scenarios. Attacks are sent by our attack tool in a separate terminal, the way a misbehaving device would, " +
    "so what the dashboard shows is the system reacting, not a button animation. For each scenario the table says which path it " +
    "takes and what to look at.");
  const plan = [
    ["Normal", "button", "sensor → CSE → notification → detector", "green points, AI score above 0, no alert"],
    ["Unknown originator", "ccgn attack unregistered", "Cunknown → logger → CSE: 4103", "alert “unregistered”, stored in the CSE"],
    ["Cross-device access", "ccgn attack cross", "Ctemp reads door/data: 4103", "alert “acp_violation”"],
    ["Sensor anomaly", "ccgn attack anomaly", "65 °C and 29 °C via notification", "rule catches 65, only AI catches 29; no block"],
    ["Request flood", "ccgn attack flood", "burst → >12 in 2 s → ACP update", "requests switch to 4103, ACP rule gone, door still OK, MEC013 location"],
  ];
  s.addTable([[head("Scenario"), head("Sent from"), head("Path"), head("What to look at")],
    ...plan.map(([a, b, c, d]) => [cell(a, { bold: true }), cell(b, { fontFace: "Consolas", fontSize: 11 }), cell(c), cell(d)])],
    { x: 0.45, y: 1.15, w: 9.1, colW: [1.6, 2.05, 2.6, 2.85], rowH: 0.6, valign: "middle", border: { type: "solid", pt: 0.75, color: "D5DFE0" }, margin: [0.03, 0.08, 0.03, 0.08] });
  text(s, "Each scenario first restores access, so they can be run in any order. Video: deliverables/CCGN_Demo.mp4.",
    { x: 0.45, y: 4.9, w: 9.1, h: 0.3, fontSize: 11, italic: true, color: C.text2 });

  // ── 10. Demo: flood ──────────────────────────────────────────────────────
  s = content("Demonstration", "Demo: the flood, from the attacker's terminal",
    "The flood in the recorded run. On the right, the attack tool's own output: requests succeed with 2000 until the detector " +
    "acts, then the CSE answers 4103. Behind it, the architecture shows the ACP update and the alert in red, the temperature policy " +
    "marked as blocked, and the MEC platform highlighted for the location lookup.");
  s.addImage({ data: await crop("walkthrough", "05-flood-terminal.png", 0, 0, 1920, 940), x: 0.45, y: 1.12, w: 7.6, h: 3.72,
    altText: "Flood: terminal output with requests switching to RSC 4103, and the architecture diagram" });
  s.addShape(pres.ShapeType.rect, { x: 0.45, y: 1.12, w: 7.6, h: 3.72, fill: { type: "none" }, line: { color: "D5DFE0", width: 0.75 } });
  [["2000 → 4103", "the CSE's own answer to the sensor changes", C.accent2], ["ACP", "temperature-policy marked blocked", C.accent3], ["MEC013", "location lookup after the block", C.accent5]].forEach(([a, b, color], i) => {
    const y = 1.12 + i * 1.3;
    card(s, 8.2, y, 1.35, 1.18, C.background2, a);
    text(s, a, { x: 8.3, y: y + 0.1, w: 1.2, h: 0.4, fontSize: a.length > 8 ? 12 : 15, bold: true, color, fontFace: "Cambria" });
    text(s, b, { x: 8.3, y: y + 0.52, w: 1.2, h: 0.62, fontSize: 10, color: C.text2 });
  });

  // ── 11. Demo: evidence ───────────────────────────────────────────────────
  s = content("Demonstration", "Demo: the evidence comes from the CSE and from MEC",
    "The proof is not in the dashboard's own state. On the left, values read from tinyIoT: the temperature sensor's access rule " +
    "has been removed, and the alert is stored in the detector's alerts container. On the right, the ETSI MEC Sandbox location " +
    "API: the flooding device is user equipment 10.1.0.1 in zone 3, on 4G macro cell 6; the door sensor is elsewhere and unaffected.");
  s.addImage({ data: await crop("walkthrough", "08-cse-evidence.png", 0, 0, 960, 560), x: 0.45, y: 1.12, w: 4.45, h: 2.6,
    altText: "Values read from the CSE: ACP rule for Ctemp removed, latest alert" });
  s.addShape(pres.ShapeType.rect, { x: 0.45, y: 1.12, w: 4.45, h: 2.6, fill: { type: "none" }, line: { color: "D5DFE0", width: 0.75 } });
  s.addImage({ data: await crop("walkthrough", "09-mec-location.png", 960, 372, 960, 240), x: 5.1, y: 1.12, w: 4.45, h: 1.11,
    altText: "MEC013 location table: Ctemp at UE 10.1.0.1, zone03, 4g-macro-cell-6" });
  s.addShape(pres.ShapeType.rect, { x: 5.1, y: 1.12, w: 4.45, h: 1.11, fill: { type: "none" }, line: { color: "D5DFE0", width: 0.75 } });
  text(s, [{ text: "From tinyIoT: ", options: { bold: true } }, { text: "Ctemp's ACP rule is gone; the alert CIN is in detector/alerts." }],
    { x: 0.45, y: 3.9, w: 4.45, h: 0.6, fontSize: 13, color: C.text1 });
  text(s, [{ text: "From the ETSI MEC Sandbox: ", options: { bold: true } }, { text: `${loc.origin} = UE ${loc.address}, ${loc.zone}, ${loc.access_point}.` }],
    { x: 5.1, y: 2.4, w: 4.45, h: 0.6, fontSize: 13, color: C.text1 });

  // ── 7. Latency ───────────────────────────────────────────────────────────
  pres.addSection({ title: "Results" });
  const enf = m["flood.arrival_to_enforced_ms"];
  s = content("Results", `A flooding sensor is blocked in about ${r0(enf.median)} ms`,
    `We repeated every scenario ${LAT.data.runs} times against the running system with ${CSE} as the CSE and measured with one process clock. ` +
    `From the request that crosses the flood threshold to the ACP update being acknowledged by the CSE takes a median of ${r1(enf.median)} ` +
    `milliseconds and ${r1(enf.p95)} at the 95th percentile. A sensor reading needs about ${r0(m["normal.send_to_inspected_ms"].median)} milliseconds ` +
    `to travel through the CSE notification to a model decision. With ACME on the same PC the block takes ${r0(mA["flood.arrival_to_enforced_ms"].median)} milliseconds. ` +
    "Because the block lands tens of milliseconds after detection, a fast burst is partly served before it: on tinyIoT about " +
    `${r0(m["flood.requests_admitted_after_trigger"].mean)} more requests get through. These are single-PC loopback figures, so they show that the ` +
    "edge loop is short, not how a distributed deployment would perform.");
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
  text(s, `median to block. 95th percentile ${r0(enf.p95)} ms, worst of ${enf.n} runs ${r0(enf.max)} ms`, { x: 7.08, y: 1.98, w: 2.3, h: 0.7, fontSize: 12, color: C.text1 });
  card(s, 6.9, 2.95, 2.65, 1.9, C.background2, "Latency scope");
  text(s, "How it was measured", { x: 7.08, y: 3.07, w: 2.3, h: 0.3, fontSize: 12, bold: true, color: C.text1 });
  text(s, `${LAT.data.runs} runs per scenario, one PC, loopback, ${CSE} as CSE. ACME on the same PC: ${r0(mA["flood.arrival_to_enforced_ms"].median)} ms to block. Not a network or scale result.`,
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
    `interworking, not MEC application hosting. The CSE behind the registered service in this run was ${cseOf(MEC.data)}.`);
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
  text(s, `CSE in this run: ${cseOf(MEC.data)}. Services are registered with loopback endpoints and consumed on the same PC. This shows MEC011 API interworking with the real platform. ` +
    "It is not MEC application hosting, remote reachability or conformance certification.",
    { x: 5.4, y: 3.66, w: 3.95, h: 1.2, fontSize: 12, color: C.text2 });

  // ── 10. Plan vs delivered ────────────────────────────────────────────────
  pres.addSection({ title: "Assessment" });
  s = content("Assessment", "Planned in October, delivered in November",
    "Compared with the interim plan. The core loop, the four MVP threats, the Isolation Forest, verified ACP blocking and the MEC011 services " +
    "are delivered. The interim plan named ACME; the prototype now runs on tinyIoT as well, with no change to the detector. Two things changed: the dashboard is a small Flask page instead of Streamlit so that it runs in the same process as the " +
    "detector, and we kept two sensors, temperature and door, and dropped humidity. None of the stretch goals were done.");
  const ok = t => cell(t, { bold: true, color: C.accent1 }), no = t => cell(t, { bold: true, color: C.accent2 }), ch = t => cell(t, { bold: true, color: C.accent3 });
  s.addTable([
    [head("Interim plan"), head("Status"), head("What exists now")],
    [cell("Sensor AE → CSE → notification → detector"), ok("Delivered"), cell("tinyIoT and ACME, same detector code")],
    [cell("Four MVP threats"), ok("Delivered"), cell("Five pass/fail scenarios including normal traffic")],
    [cell("Rules + Isolation Forest"), ok("Delivered"), cell("Compared in 30 repeated offline trials")],
    [cell("ACP blocking"), ok("Delivered"), cell("Block and restore verified by real CSE responses")],
    [cell("MEC011 alert service"), ok("Delivered"), cell("Passed on the ETSI MEC Sandbox; demo runs on it")],
    [cell("(new) Locate the offending device"), ok("Added"), cell("MEC013 location lookup after a block")],
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
    ["FaNetworkWired", "MEC scope", "MEC011 + MEC013 on the ETSI Sandbox with loopback endpoints and an assigned device-to-UE pairing. Not app hosting or conformance.", C.accent5],
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
  console.log("Saved: " + OUT + `  (latency ${LAT.name} + ${LAT_ACME.name}, evaluation ${EVAL.name}, MEC ${MEC.name})`);
})();
