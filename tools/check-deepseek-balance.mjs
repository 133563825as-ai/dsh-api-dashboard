#!/usr/bin/env node
/**
 * check-deepseek-balance.mjs —— 查清 DeepSeek 余额「一会儿 ¥123.45 正常、一会儿 $0.00 异常」
 *
 * 它做两件事：
 *   ① 找出这台机器上用到的**所有** DeepSeek key（环境变量 + ~/.dsh/.credentials.yaml），
 *      每个 key 连查 3 次余额；
 *   ② 打印每次返回里 balance_infos 的**条数**和每条的内容。
 *
 * 判读：
 *   · 同一个 key，返回在 CNY=123.45 和 USD=0.00 之间跳
 *        → 账号有多个币种钱包，插件 `infos[0]` 盲取第一个  ← 插件 bug
 *   · 不同 key 各自返回不同结果
 *        → 你配了两处 key（环境变量 / 凭据文件），是两码事  ← 配置问题
 *   · 每个 key 都稳定返回同一条
 *        → 两个都不是，把输出发回去继续查
 *
 * 用法：  node check-deepseek-balance.mjs
 * 不打印任何完整 key（只显示前 6 位 + 长度）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");

/** 收集候选 key（去重），只保留疑似 DeepSeek 的 sk- 开头串 */
function collectKeys() {
  const out = new Map(); // key -> 来源说明
  const add = (k, src) => {
    const s = String(k || "").trim().replace(/^Bearer\s+/i, "");
    if (/^sk-[A-Za-z0-9_-]{16,}$/.test(s) && !out.has(s)) out.set(s, src);
  };

  if (process.env.DEEPSEEK_API_KEY) add(process.env.DEEPSEEK_API_KEY, "环境变量 DEEPSEEK_API_KEY");

  for (const f of [path.join(HOME, ".credentials.yaml"), path.join(HOME, "settings.yaml")]) {
    let text;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    // 只看 deepseek 相关行，避免把别的厂商 key 也抓进来
    for (const line of text.split("\n")) {
      if (!/deepseek/i.test(line)) continue;
      for (const m of line.matchAll(/sk-[A-Za-z0-9_-]{16,}/g)) add(m[0], `${path.basename(f)} 里 deepseek 那一行`);
    }
    // 只看 deepseek 段落内部的 key：从 `deepseek:` 那行往下，缩进更深的都算它的，
    // 遇到缩进回退（下一个同/更浅的键）就停 —— 免得把别的厂商的 key 也拿去查 DeepSeek
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const head = /^(\s*)deepseek\s*:/i.exec(lines[i]);
      if (!head) continue;
      const base = head[1].length;
      for (const m of lines[i].matchAll(/sk-[A-Za-z0-9_-]{16,}/g)) add(m[0], `${path.basename(f)} 的 deepseek 段`);
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (line.trim() === "" || /^\s*#/.test(line)) continue;
        if (line.match(/^\s*/)[0].length <= base) break;
        for (const m of line.matchAll(/sk-[A-Za-z0-9_-]{16,}/g)) add(m[0], `${path.basename(f)} 的 deepseek 段`);
      }
    }
  }
  return out;
}

const mask = (k) => `${k.slice(0, 6)}…${k.slice(-4)}(长度 ${k.length})`;

const keys = collectKeys();
console.log(`DSH_HOME: ${HOME}`);
if (keys.size === 0) {
  console.log("✗ 没找到任何 DeepSeek key（环境变量 DEEPSEEK_API_KEY / ~/.dsh/.credentials.yaml 里都没有）");
  console.log("  那你就在插件设置里看一眼 DeepSeek 那条用的 key，用下面这条直接查：");
  console.log('  node -e "fetch(\'https://api.deepseek.com/user/balance\',{headers:{Authorization:\'Bearer 你的KEY\'}}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,1)))"');
  process.exit(1);
}

console.log(`找到 ${keys.size} 个 DeepSeek key：`);
for (const [k, src] of keys) console.log(`  · ${mask(k)}   ← ${src}`);
console.log();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [key, src] of keys) {
  console.log(`══ ${mask(key)}  （${src}）══`);
  const seen = new Set();
  for (let i = 1; i <= 3; i++) {
    const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    try {
      const res = await fetch("https://api.deepseek.com/user/balance", {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* 非 JSON */
      }
      const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : [];
      const desc = infos.map((x) => `${x.currency}=${x.total_balance}`).join("  |  ") || "(无 balance_infos)";
      console.log(`  第${i}次 ${t}  HTTP ${res.status}  balance_infos 有 ${infos.length} 条  →  ${desc}`);
      seen.add(desc);
    } catch (e) {
      console.log(`  第${i}次 ${t}  请求失败：${e.message}`);
    }
    await sleep(1200);
  }
  if (seen.size > 1) {
    console.log(`  ⚠ 同一个 key 三次结果不一致 —— 这就是「闪烁」的来源`);
  }
  console.log();
}

console.log("看完把上面整段发回去。没有完整 key 泄露（只显示前 6 位和后 4 位）。");
