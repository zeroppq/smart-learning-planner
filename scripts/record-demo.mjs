import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9444;
const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const OUT = "docs/evidence/recordings/demo-backup-2026-11-14.mp4";
const FRAME_DIR = join(tmpdir(), "slp-demo-frames");
const FPS = 10;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

mkdirSync(FRAME_DIR, { recursive: true });
for (const file of readdirSync(FRAME_DIR)) {
  rmSync(join(FRAME_DIR, file));
}

const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (probe.status !== 0) {
  console.error("未找到 ffmpeg，请先安装或在 FFMPEG_PATH 指定路径");
  process.exit(1);
}

try {
  await fetch(`${BASE}/api/plans/adjust`, { method: "POST" });
} catch {
  // 没有可调整项时继续录制静态页面
}

const userDataDir = join(tmpdir(), "edge-record");
const child = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--hide-scrollbars",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${PORT}`,
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (response.ok) {
      break;
    }
  } catch {
    // 等待浏览器启动
  }
  await sleep(500);
}

let target;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  target = list.find((item) => item.type === "page");
  if (target) {
    break;
  }
  await sleep(500);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let messageId = 0;
const pending = new Map();
let latestFrame = null;

socket.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.method === "Page.screencastFrame") {
    latestFrame = data.params.data;
    socket.send(
      JSON.stringify({
        id: ++messageId,
        method: "Page.screencastFrameAck",
        params: { sessionId: data.params.sessionId },
      }),
    );
    return;
  }
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
await send("Page.startScreencast", {
  format: "jpeg",
  quality: 80,
  maxWidth: 1440,
  maxHeight: 900,
  everyNthFrame: 1,
});

let frameIndex = 0;
const sampler = setInterval(() => {
  if (!latestFrame) {
    return;
  }
  frameIndex += 1;
  writeFileSync(join(FRAME_DIR, `${String(frameIndex).padStart(5, "0")}.jpg`), Buffer.from(latestFrame, "base64"));
}, Math.round(1000 / FPS));

const pages = [
  { path: "/knowledge", hold: 5000 },
  { path: "/plan", hold: 6000 },
  { path: "/", hold: 5000 },
  { path: "/progress", hold: 8000 },
];

for (const page of pages) {
  await send("Page.navigate", { url: `${BASE}${page.path}` });
  await sleep(2000);
  await sleep(page.hold);
}

clearInterval(sampler);
await send("Page.stopScreencast");
socket.close();
child.kill();

console.log(`RECORDED_FRAMES | ${frameIndex}`);

const result = spawnSync(
  "ffmpeg",
  [
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    join(FRAME_DIR, "%05d.jpg"),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    OUT,
  ],
  { encoding: "utf8" },
);

if (result.status !== 0) {
  console.error(result.stderr?.slice(-800));
  process.exit(2);
}

console.log(`VIDEO_SAVED | ${OUT}`);

try {
  await fetch(`${BASE}/api/plans/adjustment/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proposalId: "", action: "reject" }),
  });
} catch {
  // 忽略清理失败
}

console.log("提示：如需恢复演示数据，请执行 reset-demo demo");