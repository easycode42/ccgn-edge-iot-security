// Full-page screenshot of the running dashboard with headless Edge/Chrome (for QA and slides).
// Usage: node tools/shot.mjs <out.png> [width=1440] [wait-ms=2500]
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out = "dashboard.png", width = "1440", wait = "2500"] = process.argv.slice(2);
const browser = [process.env.CCGN_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(p => p && existsSync(p));
const port = 9334;
const child = spawn(browser, ["--headless=new", `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(tmpdir(), "ccgn-shot-" + Date.now())}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page"); }
  catch { await sleep(200); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(ok => { ws.onopen = ok; });
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); };
const send = (method, params = {}) => new Promise(ok => { pending.set(++id, m => ok(m.result)); ws.send(JSON.stringify({ id, method, params })); });
await send("Emulation.setDeviceMetricsOverride", { width: +width, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:7581/" });
await sleep(+wait);
const { contentSize } = await send("Page.getLayoutMetrics");
await send("Emulation.setDeviceMetricsOverride", { width: +width, height: Math.ceil(contentSize.height), deviceScaleFactor: 1, mobile: false });
await sleep(1200);
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(out, Buffer.from(shot.data, "base64"));
ws.close(); child.kill();
console.log(`Saved ${out} (${width}x${Math.ceil(contentSize.height)})`);
