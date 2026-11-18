// Records the narrated dashboard walkthrough for the demo video.
// Attacks are sent by the real `ccgn attack` command in a separate process (WSL when the CSE is
// tinyIoT); its live stdout is shown in a terminal overlay. Captions are the narration lines.
// Usage (from the repo root on Windows, with the demo running):
//   node tools/record_walkthrough.mjs deliverables/walkthrough
// Needs deliverables/narration/durations.json (tools/make_narration.ps1). Node 22+.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] || "deliverables/walkthrough");
const frames = join(out, "frames");
rmSync(out, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const text = JSON.parse(readFileSync("tools/narration.json", "utf8"));
const dur = JSON.parse(readFileSync("deliverables/narration/durations.json", "utf8").replace(/^\uFEFF/, ""));
const repo = process.cwd();
const attackCmd = (kind, extra = []) => process.env.CCGN_ATTACK_NATIVE
  ? [process.env.CCGN_PYTHON || ".venv/Scripts/python.exe", ["-X", "utf8", "-m", "ccgn", "attack", kind, ...extra]]
  : ["wsl.exe", ["-d", process.env.CCGN_WSL_DISTRO || "Ubuntu-22.04", "--cd", repo, "--", "bash", "tools/ccgn_wsl.sh", "attack", kind, ...extra]];

const browser = [process.env.CCGN_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"]
  .find(p => p && existsSync(p));
const port = 9335;
const child = spawn(browser, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(tmpdir(), "ccgn-walk-" + Date.now())}`,
  "--window-size=1280,720", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page"); } catch { await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(ok => { ws.onopen = ok; });
let nextId = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((ok, fail) => {
  const id = ++nextId; pending.set(id, m => m.error ? fail(new Error(method + ": " + m.error.message)) : ok(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async expression => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " in " + expression.slice(0, 80));
  return r.result.value;
};

await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: +(process.env.CCGN_REC_SCALE || 1.5), mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:7581/" });
await sleep(3000);
await js(`(() => {
  const s = document.createElement('style');
  s.textContent = '#cap{position:fixed;left:0;right:0;bottom:0;padding:12px 36px;background:#12343bf2;color:#fff;' +
    'font:500 17px/1.45 system-ui,sans-serif;z-index:99;min-height:58px}' +
    '#term{position:fixed;right:18px;bottom:86px;width:640px;max-height:300px;overflow:hidden;background:#0f1720f2;' +
    'color:#d6e2ee;border-radius:10px;font:12.5px/1.45 Consolas,monospace;padding:10px 14px;z-index:98;display:none;' +
    'box-shadow:0 8px 30px #0006}#term b{color:#7fe0d4;font-weight:600}#term .x{color:#ff8a93}' +
    '.rec-click{outline:4px solid #e89b2b!important;outline-offset:3px}main{padding-bottom:120px!important}';
  document.head.append(s);
  const c = document.createElement('div'); c.id = 'cap'; document.body.append(c);
  const t = document.createElement('div'); t.id = 'term'; document.body.append(t);
})()`);

// Polling capture; optimizeForSpeed gives about 7 frames per second at 1920x1080.
const log = []; const steps = []; let recording = true; const started = Date.now();
const loop = (async () => {
  for (let n = 0; recording; n++) {
    const t = Date.now() - started;
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 82, optimizeForSpeed: true });
    const file = `f${String(n).padStart(5, "0")}.jpg`;
    writeFileSync(join(frames, file), Buffer.from(shot.data, "base64"));
    log.push({ file, t });
  }
})();

// Narration is spelled out for the speech engine ("C S E"); captions use the written form.
const WRITTEN = [["Edge A I based", "Edge AI-based"], ["one M 2 M", "oneM2M"], ["tiny I o T", "tinyIoT"], ["I o T", "IoT"],
  ["E T S I", "ETSI"], ["M E C 0 1 1", "MEC011"], ["M E C 0 1 3", "MEC013"], ["M E C", "MEC"], ["C S E", "CSE"],
  ["A C P", "ACP"], ["A P I", "API"], ["A C M E", "ACME"], ["C C G N", "CCGN"], ["A I", "AI"], ["4 1 0 3", "4103"]];
export const written = s => WRITTEN.reduce((acc, [a, b]) => acc.split(a).join(b), s);
const caption = s => js(`document.getElementById('cap').textContent = ${JSON.stringify(written(s))}`);
const scrollTo = sel => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const y = el.getBoundingClientRect().top + scrollY - 14; scrollTo({ top: y }); })()`);
const still = name => send("Page.captureScreenshot", { format: "png" }).then(s => writeFileSync(join(out, name + ".png"), Buffer.from(s.data, "base64")));
const idle = () => js(`(async () => { for (let i = 0; i < 400; i++) { const s = await (await fetch('/api/state')).json();
  if (s.ready && !(s.scenario && s.scenario.running)) return true; await new Promise(r => setTimeout(r, 100)); } throw new Error('scenario did not finish'); })()`);
const click = async sel => {
  await js(`document.querySelector(${JSON.stringify(sel)}).classList.add('rec-click')`); await sleep(800);
  await js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); b.classList.remove('rec-click'); b.click(); })()`);
  await sleep(300); await idle();
};
const term = async (kind, extra = []) => {
  const [cmd, args] = attackCmd(kind, extra);
  await js(`(() => { const t = document.getElementById('term'); t.style.display = 'block';
    t.innerHTML = '<b>Terminal 2 $ ccgn attack ${kind}${extra.length ? " " + extra.join(" ") : ""}</b><br>'; })()`);
  await new Promise(done => {
    const p = spawn(cmd, args, { cwd: repo });
    let buf = "";
    p.stdout.on("data", d => {
      buf += d.toString("utf8").replace(/\0/g, "");
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const line of lines.filter(l => l.trim())) {
        const cls = line.includes("[x]") ? "x" : "";
        js(`(() => { const t = document.getElementById('term'); const d = document.createElement('div'); d.className = '${cls}';
          d.textContent = ${JSON.stringify(line.replace(/\s+/g, " ").trim())}; t.append(d); while (t.scrollHeight > t.clientHeight && t.children.length > 2) t.children[1].remove(); })()`).catch(() => {});
      }
    });
    p.on("close", done);
  });
};
const hideTerm = () => js(`document.getElementById('term').style.display = 'none'`);
// Each narrated step lasts at least as long as its narration; `body` runs while it plays.
const step = async (key, body = async () => {}, pad = 700) => {
  const t0 = Date.now() - started;
  steps.push({ key, t: t0 });
  await caption(text[key]);
  const need = (dur[key] || 4) * 1000 + pad;
  await body();
  const spent = Date.now() - started - t0;
  if (spent < need) await sleep(need - spent);
};

try {
  await idle();
  await step("rec_overview", async () => { await scrollTo("#arch"); await sleep(1500); await still("01-architecture"); });
  await step("rec_mec", async () => { await scrollTo(".grid2"); await sleep(2500); await still("02-mec-registry"); });
  await step("rec_normal", async () => { await scrollTo("#arch"); await sleep(1200); await click('[data-scenario="normal"]'); });
  await step("rec_unregistered", async () => { await term("unregistered"); await sleep(2500); await still("03-unregistered"); });
  await step("rec_cross", async () => { await term("cross"); await sleep(2000); });
  await step("rec_anomaly", async () => { await term("anomaly"); await sleep(1500); await hideTerm(); await scrollTo(".grid3"); await sleep(2500); await still("04-anomaly"); });
  await step("rec_flood", async () => {
    await scrollTo("#arch"); await sleep(1000);
    await term("flood", ["--count", "30"]); await sleep(1500); await still("05-flood-terminal");
    await hideTerm(); await sleep(1500); await still("06-flood-architecture");
    await scrollTo(".grid3"); await sleep(3000); await still("07-flood-services");
  });
  await step("rec_evidence", async () => { await scrollTo(".grid2"); await sleep(2500); await still("08-cse-evidence"); });
  await step("rec_location", async () => { await js(`document.querySelector('#locs').scrollIntoView({block:'center'})`); await sleep(2500); await still("09-mec-location"); });
  await step("rec_restore", async () => { await scrollTo(".grid3"); await sleep(800); await click("#restore"); await sleep(1200); await still("10-restored"); });
} finally {
  recording = false;
  await loop;
  const lines = log.map((f, i) => `file 'frames/${f.file}'\nduration ${(((log[i + 1]?.t ?? f.t + 90) - f.t) / 1000).toFixed(3)}`);
  writeFileSync(join(out, "frames.txt"), lines.join("\n") + `\nfile 'frames/${log.at(-1).file}'\n`);
  writeFileSync(join(out, "steps.json"), JSON.stringify({ total_ms: log.at(-1).t + 90, steps }, null, 2));
  ws.close(); child.kill();
  console.log(`${log.length} frames, ${(log.at(-1).t / 1000).toFixed(1)} s, ${steps.length} narrated steps -> ${out}`);
}
