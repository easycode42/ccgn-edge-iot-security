// Draws the message sequence of a request flood with the real oneM2M and MEC calls.
//   node tools/sequence_diagram.js          -> deliverables/sequence-flood.png        (hackster article, full detail)
//   node tools/sequence_diagram.js slide    -> deliverables/sequence-flood-slide.png  (deck: fewer arrows, larger text)
// Needs sharp; set NODE_PATH if installed elsewhere.
const path = require("path");
const sharp = require("sharp");

const variants = {
  full: {
    out: "sequence-flood.png", W: 1600, gap: 272, row: 52, font: 16, laneFont: 17, laneW: 224,
    title: "Request flood: sequence of oneM2M (Mca) and MEC calls",
    lanes: ["Ctemp (sensor AE)", "Request logger", "tinyIoT CSE", "Detector AE", "MEC platform (MEC013)", "Cdoor (sensor AE)"],
    msgs: [
      // [from, to, label, colour, dashed]
      [0, 1, "① RETRIEVE temperature/data  × burst", "#1e8a87"],
      [1, 2, "forward (Mca)", "#1e8a87"],
      [2, 1, "RSC 2000", "#1e8a87", true],
      [1, 3, "② request record: originator, op, RSC", "#c27a10"],
      [3, 3, "③ > 12 requests in 2 s → flood", "#5e4aa5"],
      [3, 2, "CREATE alert CIN  detector/alerts", "#c8403f"],
      [3, 2, "④ UPDATE temperature-policy (ACP) without Ctemp", "#c8403f"],
      [2, 3, "RSC 2004", "#c8403f", true],
      [3, 2, "⑤ RETRIEVE as Ctemp (verification)", "#c8403f"],
      [2, 3, "RSC 4103  → block verified", "#c8403f", true],
      [3, 4, "⑥ GET /location/v3/queries/users?address=UE", "#2b6cb5"],
      [4, 3, "zone03 · 4g-macro-cell-6", "#2b6cb5", true],
      [0, 1, "⑦ next requests from Ctemp", "#1e8a87"],
      [2, 0, "RSC 4103 (denied by the CSE)", "#c8403f", true],
      [5, 2, "Cdoor → door/data  RSC 2000 (unaffected)", "#1e8a87"],
    ],
  },
  slide: {
    out: "sequence-flood-slide.png", W: 1800, gap: 300, row: 54, font: 21, laneFont: 21, laneW: 250, title: "",
    lanes: ["Ctemp (sensor)", "Request logger", "tinyIoT CSE", "Detector AE", "MEC013 (Sandbox)", "Cdoor (sensor)"],
    msgs: [
      [0, 1, "① burst: RETRIEVE data", "#1e8a87"],
      [1, 2, "forward · RSC 2000", "#1e8a87"],
      [1, 3, "② request records", "#c27a10"],
      [3, 3, "③ >12 in 2 s → flood", "#5e4aa5"],
      [3, 2, "④ CREATE alert CIN", "#c8403f"],
      [3, 2, "⑤ UPDATE ACP: drop Ctemp", "#c8403f"],
      [3, 2, "⑥ RETRIEVE as Ctemp", "#c8403f"],
      [2, 3, "RSC 4103 → verified", "#c8403f", true],
      [3, 4, "⑦ where is Ctemp?", "#2b6cb5"],
      [4, 3, "zone03 · cell-6", "#2b6cb5", true],
      [2, 0, "⑧ Ctemp again → RSC 4103", "#c8403f", true],
      [5, 2, "Cdoor → door/data: RSC 2000", "#1e8a87"],
    ],
  },
};

const v = variants[process.argv[2] === "slide" ? "slide" : "full"];
const top = v.title ? 90 : 20, laneX = i => v.laneW / 2 + (v.title ? 8 : 20) + i * v.gap;
const H = top + 70 + v.msgs.length * v.row + 30;
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colours = [...new Set(v.msgs.map(m => m[3].slice(1)))];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${v.W}" height="${H}" viewBox="0 0 ${v.W} ${H}">
<rect width="100%" height="100%" fill="#ffffff"/>
<defs>${colours.map(c => `<marker id="m${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#${c}"/></marker>`).join("")}</defs>`;
if (v.title) svg += `<text x="40" y="44" font-family="Segoe UI, Arial" font-size="26" font-weight="700" fill="#12343b">${esc(v.title)}</text>`;
v.lanes.forEach((name, i) => {
  const x = laneX(i);
  svg += `<rect x="${x - v.laneW / 2}" y="${top}" width="${v.laneW}" height="50" rx="8" fill="#edf3f3" stroke="#12343b" stroke-width="1.5"/>
<text x="${x}" y="${top + 33}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="${v.laneFont}" font-weight="600" fill="#12343b">${esc(name)}</text>
<line x1="${x}" y1="${top + 50}" x2="${x}" y2="${H - 10}" stroke="#b8c6d6" stroke-width="2" stroke-dasharray="6 6"/>`;
});
v.msgs.forEach(([a, b, label, colour, dashed], k) => {
  const y = top + 50 + v.row * (k + 1), c = colour.slice(1);
  const t = (x, anchor) => `<text x="${x}" y="${y - 9}" text-anchor="${anchor}" font-family="Segoe UI, Arial" font-size="${v.font}" fill="${colour}" font-weight="600">${esc(label)}</text>`;
  if (a === b) {
    const x = laneX(a);
    svg += `<path d="M${x} ${y - 14} h60 v26 h-56" fill="none" stroke="${colour}" stroke-width="2.4" marker-end="url(#m${c})"/>`
      + t(x + 72, "start").replace(`y="${y - 9}"`, `y="${y + 6}"`);
    return;
  }
  const x1 = laneX(a), x2 = laneX(b), dir = x2 > x1 ? 1 : -1;
  svg += `<line x1="${x1}" y1="${y}" x2="${x2 - dir * 4}" y2="${y}" stroke="${colour}" stroke-width="2.4" ${dashed ? 'stroke-dasharray="8 6"' : ""} marker-end="url(#m${c})"/>`
    + t((x1 + x2) / 2, "middle");
});
svg += "</svg>";
const out = path.join(__dirname, "..", "deliverables", v.out);
sharp(Buffer.from(svg)).png().toFile(out).then(i => console.log(`Saved ${out} (${i.width}x${i.height})`));
