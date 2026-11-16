import { spawn, spawnSync } from "node:child_process";
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
  "rejudge-flow": [
    "手工清单（脚本不可用时按此验证）：",
    "1. 浏览器打开 http://127.0.0.1:3000/ （今日学习页），点击今日任务第一条的「开始学习」",
    "2. 在回答框输入含糊回答并提交，等判定结果出现（未通过或部分通过）",
    "3. 预期：出现「申请重判」区块；不填补充说明时按钮是灰的（点了也不会发请求、不消耗次数）",
    "4. 在补充说明框写一两句话，点「申请重判」；预期：按钮变为「重判中…」，提示就地显示在区块内",
    "5. 预期：重判完成后「申请重判」区块消失（次数已扣一次），页面显示新的判定结果",
  ],
  "rearrange-flow": [
    "手工清单（脚本不可用时按此验证）：",
    "1. 浏览器打开 http://127.0.0.1:3000/plan （学习计划页），确认已有计划（版本 v1、每天 2 项、每项 20 分钟）",
    "2. 把「每天可用」时长从 40 改为 50，点「开始规划」",
    "3. 预期：出现「按新时长重排（需要你确认）」卡片，展示调整前（11 天、每天 2 项、每项 20 分钟）与调整后（8 天、每天 3 项、每项 17 分钟）的对比；旧计划全程可见",
    "4. 点「确认重排」；预期：计划版本升到 v2，每日任务按 50 分钟重排（每天 3 项、每项 17 分钟），对比卡消失",
  ],
  "citation-badge": [
    "手工清单（脚本不可用时按此验证）：",
    "1. 浏览器打开 http://127.0.0.1:3000/ （今日学习页），点击今日任务第一条的「开始学习」",
    "2. 等「督学讲解」出现；预期：讲解正文里的来源引用显示为上标角标 [1]，不再是【文档名 第N段】长串文字",
    "3. 点击角标；预期：讲解下方展开「出处：文档名 · 第 N 段」卡片，并显示对应段落原文",
    "4. 点「收起」；预期：出处卡片收起，正文保持连贯",
  ],
  "knowledge-card-expand": [
    "手工清单（脚本不可用时按此验证）：",
    "1. 浏览器打开 http://127.0.0.1:3000/knowledge （知识库页）",
    "2. 在「资料列表」点击预置课程《大学计算机基础_课堂讲义.md》",
    "3. 预期：知识点以卡片展示，每张卡片有标题、摘要与来源段落序号",
    "4. 点击任意卡片；预期：卡片内展开「原文出处：文档名 · 第 N 段」与段落原文，再次点击可收起",
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

  async function waitForGone(needle, timeoutMs = 60000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const text = await bodyText();
      if (typeof text === "string" && !text.includes(needle)) {
        return true;
      }
      await sleep(500);
    }
    return false;
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

  async function fill(selector, value, index = 0) {
    return evaluate(`(() => {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const el = els[${index}];
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  }

  return { send, evaluate, open, bodyText, waitForText, waitForAny, waitForGone, clickByText, fill };
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
  {
    name: "rejudge-flow",
    run: async (page) => {
      await page.open("/");
      const started = await page.clickByText("button", "开始学习");
      if (!started) {
        throw new Error("没有找到今日任务的「开始学习」按钮");
      }
      const lectureReady = await page.waitForText("督学讲解", 60000);
      if (!lectureReady) {
        throw new Error("点击开始学习后 60 秒内没有出现讲解与判定标准");
      }
      await sleep(500);
      let judged = false;
      for (let attempt = 0; attempt < 3 && !judged; attempt += 1) {
        if (attempt > 0) {
          const refilled = await page.fill("textarea", "大概就是那个意思吧，我也说不太清楚。", 0);
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
        judged = outcome === "达标情况";
      }
      if (!judged) {
        throw new Error("提交后重试 3 次仍没有出现判定结果");
      }
      const blockShown = await page.waitForText("申请重判（只能一次", 10000);
      if (!blockShown) {
        throw new Error("判定不过后没有出现「申请重判」区块");
      }
      const disabledBefore = await page.evaluate(
        `(() => { const els = Array.from(document.querySelectorAll("button")); const el = els.find(b => b.textContent.includes("申请重判")); return el ? el.disabled : null; })()`,
      );
      if (disabledBefore !== true) {
        throw new Error("未填补充说明时「申请重判」按钮不是禁用状态");
      }
      await page.evaluate(
        `(() => { const els = Array.from(document.querySelectorAll("button")); const el = els.find(b => b.textContent.includes("申请重判")); if (el) { el.click(); } return true; })()`,
      );
      await sleep(1500);
      const stillThere = await page.waitForText("申请重判（只能一次", 3000);
      if (!stillThere) {
        throw new Error("禁用状态下点击后重判区块异常消失");
      }
      const noteFilled = await page.fill("textarea", "刚才太紧张没答好，我想补充说明后再判定一次。", 1);
      if (!noteFilled) {
        throw new Error("没有找到补充说明输入框");
      }
      const rejudgeClicked = await page.clickByText("button", "申请重判");
      if (!rejudgeClicked) {
        throw new Error("没有找到可点击的「申请重判」按钮");
      }
      const blockGone = await page.waitForGone("申请重判（只能一次", 90000);
      if (!blockGone) {
        throw new Error("重判提交后 90 秒内重判区块没有消失（次数未扣或请求未完成）");
      }
      const resultShown = await page.waitForText("达标情况", 10000);
      if (!resultShown) {
        throw new Error("重判完成后没有显示新的判定结果");
      }
    },
  },
  {
    name: "rearrange-flow",
    run: async (page) => {
      await page.open("/plan", ["计划 v"]);
      await sleep(500);
      const filled = await page.fill("input[type=number]", "50");
      if (!filled) {
        throw new Error("没有找到每日时长输入框");
      }
      await sleep(500);
      const planned = await page.clickByText("button", "开始规划");
      if (!planned) {
        throw new Error("没有找到「开始规划」按钮");
      }
      const previewShown = await page.waitForText("按新时长重排", 60000);
      if (!previewShown) {
        throw new Error("改时长并点开始规划后 60 秒内没有出现重排对比卡");
      }
      const beforeShown = await page.waitForText("调整前", 5000);
      const afterShown = await page.waitForText("调整后", 5000);
      if (!beforeShown || !afterShown) {
        throw new Error("重排对比卡里没有出现调整前后的对比内容");
      }
      const confirmed = await page.clickByText("button", "确认重排");
      if (!confirmed) {
        throw new Error("没有找到「确认重排」按钮");
      }
      const versionUp = await page.waitForText("计划 v2", 60000);
      if (!versionUp) {
        throw new Error("确认重排后 60 秒内计划版本没有升到 v2");
      }
      const newMinutes = await page.waitForText("17 分钟", 10000);
      if (!newMinutes) {
        throw new Error("重排后每日任务没有出现 50 分钟档的每项 17 分钟");
      }
      const cardGone = await page.waitForGone("按新时长重排", 10000);
      if (!cardGone) {
        throw new Error("确认重排后对比卡没有消失");
      }
    },
  },
  {
    name: "citation-badge",
    run: async (page) => {
      await page.open("/");
      const started = await page.clickByText("button", "开始学习");
      if (!started) {
        throw new Error("没有找到今日任务的「开始学习」按钮");
      }
      const lectureReady = await page.waitForText("督学讲解", 60000);
      if (!lectureReady) {
        throw new Error("点击开始学习后 60 秒内没有出现督学讲解");
      }
      let badgeCount = 0;
      for (let attempt = 0; attempt < 10 && badgeCount === 0; attempt += 1) {
        badgeCount = await page.evaluate(
          `document.querySelectorAll("button[data-citation]").length`,
        );
        if (!badgeCount) {
          await sleep(500);
        }
      }
      if (!badgeCount) {
        throw new Error("讲解正文中没有出现来源角标（模型未按【文档名 第N段】标注引用）");
      }
      const clicked = await page.evaluate(
        `(() => { const el = document.querySelector("button[data-citation]"); if (!el) return false; el.click(); return true; })()`,
      );
      if (!clicked) {
        throw new Error("来源角标无法点击");
      }
      const cardText = await page.evaluate(
        `(() => { const el = document.querySelector("[data-citation-card]"); return el ? el.innerText : ""; })()`,
      );
      if (!cardText || !cardText.includes("出处") || !/第\s*\d+\s*段/.test(cardText)) {
        throw new Error("点击角标后没有出现含文档名与段落序号的出处卡片");
      }
      const hasParagraph = await page.evaluate(
        `Boolean(document.querySelector("[data-citation-paragraph]"))`,
      );
      if (!hasParagraph) {
        throw new Error("出处卡片没有展示可定位的段落原文");
      }
      const closed = await page.clickByText("button", "收起");
      if (!closed) {
        throw new Error("出处卡片没有「收起」按钮");
      }
      const cardGone = await page.waitForGone("出处：", 5000);
      if (!cardGone) {
        throw new Error("点击收起后出处卡片没有关闭");
      }
    },
  },
  {
    name: "knowledge-card-expand",
    run: async (page) => {
      await page.open("/knowledge", ["资料列表"]);
      const materialClicked = await page.clickByText("button", "大学计算机基础");
      if (!materialClicked) {
        throw new Error("资料列表里没有找到预置课程《大学计算机基础_课堂讲义.md》");
      }
      let cardCount = 0;
      for (let attempt = 0; attempt < 30 && cardCount === 0; attempt += 1) {
        cardCount = await page.evaluate(
          `document.querySelectorAll("[data-knowledge-card]").length`,
        );
        if (!cardCount) {
          await sleep(500);
        }
      }
      if (cardCount === 0) {
        throw new Error("打开资料后知识点没有以卡片列表展示");
      }
      const cardText = await page.evaluate(
        `(() => { const card = document.querySelector("[data-knowledge-card]"); return card ? card.innerText : ""; })()`,
      );
      if (!cardText.includes("来源") || !/第\s*\d+\s*段/.test(cardText)) {
        throw new Error("知识点卡片没有显示标题、摘要与来源段落序号");
      }
      const expanded = await page.evaluate(
        `(() => { const card = document.querySelector("[data-knowledge-card]"); const btn = card && card.querySelector("button"); if (!btn) return false; btn.click(); return true; })()`,
      );
      if (!expanded) {
        throw new Error("知识点卡片无法点击展开");
      }
      const detailShown = await page.waitForText("原文出处：", 20000);
      if (!detailShown) {
        throw new Error("点击卡片后没有展开详情与出处");
      }
      const detailText = await page.evaluate(
        `(() => { const card = document.querySelector("[data-knowledge-card]"); return card ? card.innerText : ""; })()`,
      );
      if (!detailText.includes("原文出处") || !/第\s*\d+\s*段/.test(detailText)) {
        throw new Error("展开后没有显示文档名与段落序号：" + JSON.stringify(detailText.slice(0, 300)));
      }
      const closed = await page.clickByText("button", "收起");
      if (!closed) {
        throw new Error("知识点卡片没有「收起」按钮");
      }
      const detailGone = await page.waitForGone("原文出处：", 5000);
      if (!detailGone) {
        throw new Error("点击收起后知识点详情没有关闭");
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

function resetDemo() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/reset-demo.mjs", "demo"],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      return { ok: true };
    }
  }
  return {
    ok: false,
    reason:
      "reset-demo demo 连续 2 次失败（模型可能暂不可用）。可先手动执行 node --experimental-strip-types scripts/reset-demo.mjs demo，成功后再运行本脚本。",
  };
}

console.log("RESET | 重置为演示基线数据（保证每条路径从同一起点开始，会清空学习记录）…");
const reset = resetDemo();
if (!reset.ok) {
  console.log("ENV_FAIL | " + reset.reason);
  for (const path of paths) {
    printManual(path.name);
  }
  process.exit(2);
}
console.log("RESET | 完成");

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