/* Minimal CDP screenshotter: launches headless Chrome, scrolls to a given
   offset (or captures the whole page) and writes a PNG. Node's global
   WebSocket means no puppeteer dependency. */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333 + Math.floor(Math.random() * 400);

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
const mode = args[2] || "0";             // "full" | a pixel offset | "#sel"
const W = parseInt(args[3] || "1440", 10);
const H = parseInt(args[4] || "900", 10);
const RM = args.includes("--rm");
const WAIT = parseInt((args.find(a => a.startsWith("--wait=")) || "--wait=3500").slice(7), 10);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cbshot-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--no-default-browser-check",
  ...(RM ? ["--force-prefers-reduced-motion"] : []),
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      return (await r.json()).webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  throw new Error("chrome did not start");
}

(async () => {
  const ws = new WebSocket(await endpoint());
  let id = 0;
  const pending = new Map();
  await new Promise(r => ws.onopen = r);
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result); pending.delete(d.id); }
  };
  const send = (method, params = {}, sessionId) => new Promise(res => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);

  await S("Page.enable");
  await S("Runtime.enable");
  await S("Emulation.setDeviceMetricsOverride",
    { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  await S("Page.navigate", { url });
  await sleep(WAIT);

  if (mode !== "full" && mode !== "0") {
    const isNum = /^\d+$/.test(mode);
    const expr = isNum
      ? `window.scrollTo(0, ${parseInt(mode, 10)})`
      : `(() => { const el = document.querySelector(${JSON.stringify(mode)});
                  if (el) window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 70);
                  return !!el; })()`;
    await S("Runtime.evaluate", { expression: expr });
    await sleep(1400);                    // let reveals + parallax settle
  }

  const shot = await S("Page.captureScreenshot", {
    format: "png",
    ...(mode === "full" ? { captureBeyondViewport: true } : {}),
  });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));

  const info = await S("Runtime.evaluate", {
    expression: `JSON.stringify({h:document.body.scrollHeight,
      errs: window.__errs||[], revealed: document.querySelectorAll('.in').length,
      total: document.querySelectorAll('[data-rv],.split').length})`,
    returnByValue: true,
  });
  console.log(out, info.result?.value || "");
  ws.close(); chrome.kill();
  await sleep(200);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}  // windows locks it
  process.exit(0);
})().catch(e => { console.error("ERR", e.message); chrome.kill(); process.exit(1); });
