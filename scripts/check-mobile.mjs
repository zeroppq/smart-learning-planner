import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const pages = ["/", "/plan", "/knowledge", "/progress"];
const widths = (process.env.CHECK_WIDTHS ?? "390")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const captureDir = process.env.CAPTURE_DIR ?? "";
const pageSlug = { "/": "today", "/plan": "plan", "/knowledge": "knowledge", "/progress": "progress" };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const userDataDir = mkdtempSync(join(tmpdir(), "edge-mobile-"));
const child = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${PORT}`,
    "--window-size=390,1200",
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitForDevtools() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      // 等待浏览器启动
    }
    await sleep(500);
  }
  throw new Error("无头浏览器启动超时");
}

await waitForDevtools();

let target;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  target = list.find((item) => item.type === "page");
  if (target) {
    break;
  }
  await sleep(500);
}

if (!target) {
  child.kill();
  throw new Error("没有找到可用的页面目标");
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let messageId = 0;
const pending = new Map();

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  }
};

function send(method, params = {}) {
  messageId += 1;
  socket.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve) => pending.set(messageId, resolve));
}

await send("Page.enable");

const results = [];

for (const width of widths) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: width < 800 ? 844 : 900,
    deviceScaleFactor: width < 800 ? 2 : 1,
    mobile: width < 800,
  });

  for (const path of pages) {
    await send("Page.navigate", { url: `${BASE}${path}` });
    await sleep(6000);
    const evaluated = await send("Runtime.evaluate", {
      expression:
        "JSON.stringify({scrollWidth:document.documentElement.scrollWidth, bodyWidth:document.body.scrollWidth, innerWidth:window.innerWidth})",
      returnByValue: true,
    });
    const value = JSON.parse(evaluated.result.result.value);
    const ok = value.scrollWidth <= value.innerWidth + 1 && value.bodyWidth <= value.innerWidth + 1;
    results.push({ width, path, ...value, ok });
    console.log(ok ? "PASS" : "FAIL", width, path, JSON.stringify(value));

    if (captureDir) {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      const name = `2026-11-15-v1-1-group-6-${width}-${pageSlug[path] ?? "page"}.png`;
      writeFileSync(join(captureDir, name), Buffer.from(shot.result.data, "base64"));
    }
  }
}

socket.close();
child.kill();

const failed = results.filter((item) => !item.ok);
console.log(`SUMMARY | 通过 ${results.length - failed.length}/${results.length}`);
if (failed.length > 0) {
  process.exitCode = 2;
}