import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = process.env.UI_TEST_BROWSER ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const BASE = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";

const MANUAL_STEPS = {
  "smoke-review-button": [
    "手工清单（脚本不可用时按此验证）：",
    "1. 浏览器打开 http://127.0.0.1:3000/ （今日学习页）",
    "2. 找到「开场抽查」卡片，点击「现在就抽查我」按钮",
    "3. 预期：抽查卡片里出现抽查题目与「写下你的回忆答案」输入框",
  ],
  "explain-structured-feedback": [
    "手工清单（脚本不可用时按此验证）：",
    "1. 浏览器打开 http://127.0.0.1:3000/ （今日学习页）",
    "2. 点击今日任务第一条的「开始学习」，等讲解与判定标准出现",
    "3. 在回答框输入「大概就是那个意思吧，我也说不太清楚。」，点「提交判定」",
    "4. 预期：出现「未通过」徽章；「达标情况」清单里每条标准标为已达标或未达标，未达标条目高亮显示缺口；如有建议则显示在「督学建议（不影响判定）」区",
  ],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printManual(name) {
  const steps = MANUAL_STEPS[name] ?? [`手工清单：路径 ${name} 未登记手工步骤，请联系维护者补充。`];
  for (const line of steps) {
    console.log("MANUAL |", line);
  }
}

async function checkBaseReachable() {
  try {
    const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

function startBrowser() {
  if (!existsSync(EDGE)) {
    return { ok: false, reason: `找不到浏览器程序：${EDGE}。可用环境变量 UI_TEST_BROWSER 指定 msedge.exe 或 chrome.exe 的完整路径。` };
  }
  const userDataDir = mkdtempSync(join(tmpdir(), "edge-ui-paths-"));
  const child = spawn(
    EDGE,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${PORT}`,
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  return { ok: true, child };
}

async function waitForDevtools() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) {
        return true;
      }
    } catch {
      // 浏览器还在启动
    }
    await sleep(500);
  }
  return false;
}

async function connectPage() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const target = list.find((item) => item.type === "page");
    if (target) {
      const socket = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
      });
      return socket;
    }
    await sleep(500);
  }
  return null;
}

function makeClient(socket) {
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

  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true });
    return result.result?.result?.value;
  }

  async function waitForAny(needles, timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const text = await bodyText();
      if (typeof text === "string") {
        const matched = needles.find((needle) => text.includes(needle));
        if (matched) {
          return matched;
        }
      }
      await sleep(500);
    }
    return null;
  }

  async function open(path, readyTexts = ["计划 v", "还没有学习计划"]) {
    await send("Page.enable");
    await send("Page.navigate", { url: `${BASE}${path}` });
    const ready = await waitForAny(readyTexts, 30000);
    if (!ready) {
      throw new Error(`页面 ${path} 加载超时（30 秒内没有出现就绪标志 ${JSON.stringify(readyTexts)}）。`);
    }
  }

  async function bodyText() {
    return evaluate("document.body.innerText");
  }

  async function waitForText(needle, timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const text = await bodyText();
      if (typeof text === "string" && text.includes(needle)) {
        return true;
      }
      await sleep(500);
    }
    return false;
  }

  async function clickByText(selector, text, timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const clicked = await evaluate(`(() => {
        const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const el = els.find((item) => item.textContent && item.textContent.includes(${JSON.stringify(text)}));
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (clicked) {
        return true;
      }
      await sleep(500);
    }
    return false;
  }

  async function fill(selector, value) {
    return evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  }

  return { send, evaluate, open, bodyText, waitForText, waitForAny, clickByText, fill };
}

const paths = [
  {
    name: "smoke-review-button",
    run: async (page) => {
      await page.open("/");
      await sleep(1500);
      let appeared = false;
      for (let attempt = 0; attempt < 3 && !appeared; attempt += 1) {
        const clicked = await page.clickByText("button", "现在就抽查我");
        if (!clicked) {
          throw new Error("没有找到「现在就抽查我」按钮");
        }
        appeared = await page.waitForText("提交抽查", attempt === 0 ? 20000 : 60000);
      }
      if (!appeared) {
        throw new Error("点击「现在就抽查我」重试 3 次后仍没有出现抽查题目与提交按钮");
      }
    },
  },
  {
    name: "explain-structured-feedback",
    run: async (page) => {
      await page.open("/");
      const started = await page.clickByText("button", "开始学习");
      if (!started) {
        throw new Error("没有找到今日任务的「开始学习」按钮");
      }
      const standardReady = await page.waitForText("督学讲解", 60000);
      if (!standardReady) {
        throw new Error("点击开始学习后 60 秒内没有出现讲解与判定标准");
      }
      await sleep(500);
      const filled = await page.fill("textarea", "大概就是那个意思吧，我也说不太清楚。");
      if (!filled) {
        throw new Error("没有找到回答输入框");
      }
      let checklist = false;
      for (let attempt = 0; attempt < 3 && !checklist; attempt += 1) {
        if (attempt > 0) {
          const refilled = await page.fill("textarea", "大概就是那个意思吧，我也说不太清楚。");
          if (!refilled) {
            throw new Error("重试时没有找到回答输入框");
          }
        }
        const submitted = await page.clickByText("button", "提交判定");
        if (!submitted) {
          throw new Error("没有找到「提交判定」按钮");
        }
        const outcome = await page.waitForAny(["达标情况", "判定未完成"], 60000);
        if (outcome === "判定未完成") {
          continue;
        }
        checklist = outcome === "达标情况";
      }
      if (!checklist) {
        const text = await page.bodyText();
        console.log("DEBUG_TEXT |", JSON.stringify(String(text ?? "").slice(0, 1500)));
        throw new Error("提交后重试 3 次仍没有出现结论徽章与「达标情况」清单");
      }
      const text = await page.bodyText();
      if (!text.includes("部分通过") && !text.includes("未通过")) {
        throw new Error("判定结论不是「部分通过」或「未通过」");
      }
      const gapShown = await page.waitForText("未达标：", 10000);
      if (!gapShown) {
        throw new Error("达标清单里没有出现高亮的「未达标」缺口条目");
      }
    },
  },
];

const reachable = await checkBaseReachable();
if (!reachable) {
  console.log("ENV_FAIL | 本地服务不可达：" + BASE + "。请先启动 npm run dev 再运行本脚本。");
  for (const path of paths) {
    printManual(path.name);
  }
  process.exit(2);
}

const browser = startBrowser();
if (!browser.ok) {
  console.log("ENV_FAIL | " + browser.reason);
  for (const path of paths) {
    printManual(path.name);
  }
  process.exit(2);
}

const child = browser.child;
let socket = null;
const results = [];

try {
  const devtoolsReady = await waitForDevtools();
  if (!devtoolsReady) {
    throw new Error("无头浏览器启动超时（20 秒）。");
  }
  socket = await connectPage();
  if (!socket) {
    throw new Error("无法连接浏览器的调试接口。");
  }

  const page = makeClient(socket);
  for (const path of paths) {
    console.log("RUN |", path.name);
    try {
      await path.run(page);
      results.push({ name: path.name, ok: true });
      console.log("PASS |", path.name);
    } catch (error) {
      results.push({ name: path.name, ok: false, error: String(error.message ?? error) });
      console.log("FAIL |", path.name, "|", String(error.message ?? error));
      printManual(path.name);
    }
  }
} catch (error) {
  console.log("ENV_FAIL | 页面点击路径脚本的环境准备失败：" + String(error.message ?? error));
  console.log("ENV_FAIL | 处理建议：确认 Edge 已安装且路径正确（可用 UI_TEST_BROWSER 指定），或改用 Playwright 方案。");
  for (const path of paths) {
    printManual(path.name);
  }
  child.kill();
  process.exit(2);
} finally {
  if (socket) {
    socket.close();
  }
  child.kill();
}

const failed = results.filter((item) => !item.ok);
console.log(`SUMMARY | 通过 ${results.length - failed.length}/${results.length}`);
if (failed.length > 0 || results.length === 0) {
  process.exitCode = 2;
}