// Draws deliverables/sequence-flood.png: the message sequence of a request flood, with the real
// oneM2M and MEC calls. For the hackster article ("sequence flows and API usage").
// Usage: node tools/sequence_diagram.js   (needs sharp; set NODE_PATH if installed elsewhere)
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const lanes = ["Ctemp (sensor AE)", "Request logger", "tinyIoT CSE", "Detector AE", "MEC platform (MEC013)", "Cdoor (sensor AE)"];
const W = 1600, top = 90, laneX = i => 120 + i * 272;
const msgs = [
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
];
const H = top + 70 + msgs.length * 52 + 40;
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="100%" height="100%" fill="#ffffff"/>
<defs>${["1e8a87", "c27a10", "5e4aa5", "c8403f", "2b6cb5"].map(c => `<marker id="m${c}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#${c}"/></marker>`).join("")}</defs>
<text x="40" y="44" font-family="Segoe UI, Arial" font-size="26" font-weight="700" fill="#12343b">Request flood: sequence of oneM2M (Mca) and MEC calls</text>`;
lanes.forEach((name, i) => {
  const x = laneX(i);
  svg += `<rect x="${x - 112}" y="${top}" width="224" height="48" rx="8" fill="#edf3f3" stroke="#12343b" stroke-width="1.5"/>
<text x="${x}" y="${top + 30}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="17" font-weight="600" fill="#12343b">${esc(name)}</text>
<line x1="${x}" y1="${top + 48}" x2="${x}" y2="${H - 20}" stroke="#b8c6d6" stroke-width="2" stroke-dasharray="6 6"/>`;
});
msgs.forEach(([a, b, label, colour, dashed], k) => {
  const y = top + 95 + k * 52, c = colour.slice(1);
  if (a === b) {
    const x = laneX(a);
    svg += `<path d="M${x} ${y - 12} h70 v24 h-66" fill="none" stroke="${colour}" stroke-width="2.4" marker-end="url(#m${c})"/>
<text x="${x + 80}" y="${y + 6}" font-family="Segoe UI, Arial" font-size="16" fill="${colour}" font-weight="600">${esc(label)}</text>`;
    return;
  }
  const x1 = laneX(a), x2 = laneX(b), dir = x2 > x1 ? 1 : -1;
  svg += `<line x1="${x1}" y1="${y}" x2="${x2 - dir * 4}" y2="${y}" stroke="${colour}" stroke-width="2.4" ${dashed ? 'stroke-dasharray="8 6"' : ""} marker-end="url(#m${c})"/>
<text x="${(x1 + x2) / 2}" y="${y - 9}" text-anchor="middle" font-family="Segoe UI, Arial" font-size="16" fill="${colour}" font-weight="600">${esc(label)}</text>`;
});
svg += "</svg>";
const out = path.join(__dirname, "..", "deliverables", "sequence-flood.png");
sharp(Buffer.from(svg)).png().toFile(out).then(i => console.log(`Saved ${out} (${i.width}x${i.height})`));
