// Records the running CCGN dashboard (http://127.0.0.1:7581) with headless Edge/Chrome over the
// DevTools protocol: drives every scenario, overlays captions, saves frames + stills.
// Usage: node tools/record_demo.mjs <output-dir>      (the demo must be running; Node 22+)
// The caption bar and click highlight are recording overlays; they are not part of the product UI.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] || "recording");
const frames = join(out, "frames");
rmSync(out, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const browser = [process.env.CCGN_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(p => p && existsSync(p));
if (!browser) throw new Error("Set CCGN_BROWSER to an Edge or Chrome executable");
const port = 9333, profile = join(tmpdir(), "ccgn-record-" + Date.now());
const child = spawn(browser, ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "--window-size=1280,720", "--hide-scrollbars", "about:blank"],
  { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page");
  } catch { await sleep(200); }
}
if (!target) throw new Error("Browser did not expose a DevTools page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
let nextId = 0;
const pending = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((ok, fail) => {
  const id = ++nextId;
  pending.set(id, m => m.error ? fail(new Error(method + ": " + m.error.message)) : ok(m.result));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async expression => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " in " + expression.slice(0, 80));
  return r.result.value;
};

await send("Emulation.setDeviceMetricsOverride",
  { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false });   // 1920x1080 frames
await send("Page.navigate", { url: "http://127.0.0.1:7581/" });
await sleep(2500);
await js(`(() => {
  const s = document.createElement('style');
  s.textContent = '#cap{position:fixed;left:0;right:0;bottom:0;padding:16px 40px;background:#12343bf2;' +
    'color:#fff;font:600 21px/1.4 system-ui,sans-serif;z-index:99;min-height:62px}' +
    '#cap b{color:#7fe0d4}.rec-click{outline:4px solid #e89b2b!important;outline-offset:3px}' +
    'main{padding-bottom:110px!important}';
  document.head.append(s);
  const c = document.createElement('div'); c.id = 'cap'; document.body.append(c);
})()`);

const log = [];           // [{file, t}]
let recording = true;
const started = Date.now();
const loop = (async () => {
  for (let n = 0; recording; n++) {
    const t = Date.now() - started;
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 });
    const file = `f${String(n).padStart(5, "0")}.jpg`;
    writeFileSync(join(frames, file), Buffer.from(shot.data, "base64"));
    log.push({ file, t });
    await sleep(Math.max(0, 80 - (Date.now() - started - t)));
  }
})();

const caption = html => js(`document.getElementById('cap').innerHTML = ${JSON.stringify(html)}`);
const scroll = y => js(`window.scrollTo({ top: ${y}, behavior: 'smooth' })`);
const still = async name => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, name + ".png"), Buffer.from(shot.data, "base64"));
};
const idle = () => js(`(async () => { for (let i = 0; i < 400; i++) {
  const s = await (await fetch('/api/state')).json();
  if (s.ready && !(s.scenario && s.scenario.running)) return true;
  await new Promise(r => setTimeout(r, 100)); } throw new Error('scenario did not finish'); })()`);
const click = async selector => {
  await js(`document.querySelector(${JSON.stringify(selector)}).classList.add('rec-click')`);
  await sleep(900);
  await js(`(() => { const b = document.querySelector(${JSON.stringify(selector)});
    b.classList.remove('rec-click'); b.click(); })()`);
  await sleep(400);
  await idle();
  await sleep(1300);       // the page polls state once per second
};
const HISTORY = 545;
// Bring the row containing `text` into view inside the history panel (it re-renders, the panel does not).
const showRow = text => js(`(() => { const row = [...document.querySelectorAll('#events tr')]
  .find(r => r.textContent.includes(${JSON.stringify(text)}));
  if (row) document.querySelector('.scroll').scrollTo({ top: row.offsetTop - 120, behavior: 'smooth' }); })()`);
const topRow = () => js(`document.querySelector('.scroll').scrollTo({ top: 0 })`);

try {
  await idle();
  await caption("<b>CCGN</b> — simulated sensors on a real ACME oneM2M CSE; the detector is a oneM2M AE on the same edge host.");
  await sleep(5000);
  await still("01-start");

  await caption("<b>1/5 Normal traffic.</b> Six temperature readings reach the detector through a oneM2M subscription. No alert.");
  await click('[data-scenario="normal"]');
  await sleep(3500);
  await still("02-normal");

  await caption("<b>2/5 Unknown originator.</b> “Cunknown” was never registered. The CSE denies it (RSC 4103) and the detector raises an alert.");
  await click('[data-scenario="unregistered"]');
  await scroll(HISTORY); await sleep(4500);
  await still("03-unregistered");
  await scroll(0); await sleep(900);

  await caption("<b>3/5 Cross-device access.</b> The temperature sensor tries to read the door sensor’s data. Its ACP forbids it: denied and reported.");
  await click('[data-scenario="acp"]');
  await scroll(HISTORY); await sleep(4500);
  await scroll(0); await sleep(900);

  await caption("<b>4/5 Sensor anomaly.</b> 65 °C breaks the range rule. 29 °C is inside the range and is caught only by the Isolation Forest. Alert only, no block.");
  await click('[data-scenario="anomaly"]');
  await sleep(5000);
  await still("04-anomaly");

  await caption("<b>5/5 Request flood.</b> A registered sensor bursts requests. The detector removes it from the container ACP…");
  await click('[data-scenario="flood"]');
  await caption("<b>5/5 Request flood.</b> …and proves the block: requests that succeeded a moment ago are now denied by the CSE itself.");
  await sleep(4500);
  await still("05-flood-blocked");
  await scroll(HISTORY); await sleep(1200);
  await showRow("ACP block"); await sleep(5500);
  await still("06-flood-history");
  await topRow(); await scroll(0); await sleep(900);

  await caption("<b>Recovery.</b> The operator restores the sensor’s access; the restore is also verified with a real request.");
  await click("#restore");
  await sleep(3500);
  await still("07-restored");
} finally {
  recording = false;
  await loop;
  // ffmpeg concat list with real frame durations.
  const lines = log.map((f, i) => `file 'frames/${f.file}'\nduration ${(((log[i + 1]?.t ?? f.t + 80) - f.t) / 1000).toFixed(3)}`);
  writeFileSync(join(out, "frames.txt"), lines.join("\n") + `\nfile 'frames/${log.at(-1).file}'\n`);
  ws.close();
  child.kill();
  console.log(`${log.length} frames, ${((log.at(-1).t) / 1000).toFixed(1)} s -> ${out}`);
}
