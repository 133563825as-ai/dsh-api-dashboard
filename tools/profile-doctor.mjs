#!/usr/bin/env node
/**
 * dsh-profile-doctor —— 诊断 / 抢救「装完插件，dsh web 起不来」
 *
 * 背景：DSH 启动时会把 profile 里 dsh.profile.bundles 列出的每个插件包**逐个 import**。
 * 只要有一个解析不了（没装、装坏、link:/file: 的目标目录被删被移导致软链断掉），
 * **整个 dsh web 就拒绝启动**，日志尾部是：
 *
 *   [cause]: Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<包名>' imported from .../profiles/<profile>/...
 *
 * 这个脚本用**框架自己的解析顺序**（createRequire(profile/package.json).resolve.paths，
 * 会一路向上找到 $DSH_HOME/profiles/node_modules）判断每个 bundle 到底能不能被 import，
 * 再把「哪个包、断在哪、怎么补」列出来。
 *
 * 用法：
 *   node dsh-profile-doctor.mjs                 # 只体检，不改任何东西
 *   node dsh-profile-doctor.mjs --profile web   # 指定 profile（默认 web）
 *   node dsh-profile-doctor.mjs --fix           # 只摘掉「解析不了 **且** 在 dependencies 里」的条目
 *
 * 安全规则（和 DSH 自己的 reconcilePlugins 一致）：
 *   **不在 dependencies 里的 bundle 永远不动** —— 那是 DSH 自带的 in-box bundle
 *   （@deepseek-ai/dsh-base / dsh-web-app 之类），从 $DSH_HOME/profiles/node_modules 解析。
 *   把它从清单里摘掉会直接把 DSH 弄哑，所以本脚本只会报告、绝不删除。
 *
 * 退出码：健康 0；有问题 1；用法/环境错 2。--fix 前会把 package.json 备份成 .bak-<时间戳>。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const FIX = argv.includes("--fix");
const pi = argv.indexOf("--profile");
const PROFILE = pi >= 0 ? argv[pi + 1] : "web";

if (!PROFILE || PROFILE.startsWith("--")) {
  console.error("用法: node dsh-profile-doctor.mjs [--profile <名>] [--fix]");
  process.exit(2);
}

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const DIR = path.join(DSH_HOME, "profiles", PROFILE);
const MANIFEST = path.join(DIR, "package.json");
const NM = path.join(DIR, "node_modules");

const C_OK = "\u001b[32m";
const C_BAD = "\u001b[31m";
const C_WARN = "\u001b[33m";
const C_DIM = "\u001b[2m";
const C_OFF = "\u001b[0m";

console.log(`DSH_HOME   ${DSH_HOME}`);
console.log(`profile    ${PROFILE}   ${C_DIM}${DIR}${C_OFF}`);

if (!fs.existsSync(MANIFEST)) {
  console.error(`\n✗ 找不到 ${MANIFEST}`);
  const pdir = path.join(DSH_HOME, "profiles");
  if (fs.existsSync(pdir)) {
    const names = fs
      .readdirSync(pdir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name);
    if (names.length > 0) console.error(`  这个 DSH_HOME 里现有 profile：${names.join(", ")}`);
  }
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
} catch (e) {
  console.error(`\n✗ ${MANIFEST} 不是合法 JSON：${e.message}`);
  console.error(`  它坏了的话 dsh 也起不来。备份后按 DSH 的 profile 模板重建即可。`);
  process.exit(2);
}

/** dsh 安装目录（.../@deepseek-ai/dsh），用来做第二个解析锚点 */
function findInstallDir() {
  try {
    const bin = execFileSync("/bin/sh", ["-c", "command -v dsh"], { encoding: "utf8" }).trim();
    if (!bin) return undefined;
    const real = fs.realpathSync(bin); // .../@deepseek-ai/dsh/lib/bin.js
    const dir = path.dirname(path.dirname(real));
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
  } catch {
    /* ignore */
  }
  for (const c of ["/usr/local/lib/node_modules/@deepseek-ai/dsh"]) {
    if (fs.existsSync(path.join(c, "package.json"))) return c;
  }
  return undefined;
}

const installDir = findInstallDir();
const anchors = [path.join(DIR, "package.json")];
if (installDir) anchors.push(path.join(installDir, "package.json"));

/**
 * 按框架自己的顺序解析一个包名。createRequire(...).resolve.paths() 会给出
 * Node 的完整查找链（profile/node_modules → profiles/node_modules → ... → /node_modules）。
 * @returns {string|undefined} 解析到的包目录
 */
function resolvePackage(name) {
  for (const anchor of anchors) {
    let searchPaths;
    try {
      searchPaths = createRequire(anchor).resolve.paths(name) ?? [];
    } catch {
      continue;
    }
    for (const sp of searchPaths) {
      const candidate = path.join(sp, name);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    }
  }
  return undefined;
}

/** node_modules 里那个同名条目是不是一条断掉的软链（能报出它本来指向哪） */
function danglingTarget(name) {
  const p = path.join(NM, name);
  try {
    if (fs.lstatSync(p).isSymbolicLink() && !fs.existsSync(p)) return fs.readlinkSync(p);
  } catch {
    /* ignore */
  }
  return undefined;
}

const bundles = manifest.dsh?.profile?.bundles ?? [];
const deps = manifest.dependencies ?? {};

console.log(`\nbundles（启动时逐个 import，一个失败 = 整个 web 起不来）：`);

const brokenDeps = []; // 解析不了、且在 dependencies 里 → 可摘
const brokenInBox = []; // 解析不了、但不在 dependencies 里 → 只报告
const brokenSpecs = []; // dependencies 里 link:/file: 指向不存在的路径

if (bundles.length === 0) console.log(`  ${C_DIM}(空)${C_OFF}`);

for (const name of bundles) {
  if (resolvePackage(name)) {
    console.log(`  ${C_OK}✓${C_OFF} ${name}`);
    continue;
  }
  const tgt = danglingTarget(name);
  const inDeps = Object.hasOwn(deps, name);
  if (tgt) {
    console.log(`  ${C_BAD}✗ 软链断掉${C_OFF} ${name}`);
    console.log(`      ${C_DIM}-> ${tgt}   ← 这个目录已经不存在了${C_OFF}`);
  } else {
    console.log(`  ${C_BAD}✗ 解析不到${C_OFF} ${name}`);
  }
  if (inDeps) brokenDeps.push({ name, spec: deps[name], tgt });
  else brokenInBox.push({ name, tgt });
}

for (const [name, spec] of Object.entries(deps)) {
  const m = /^(?:link|file):(.+)$/.exec(String(spec));
  if (m && !fs.existsSync(m[1])) brokenSpecs.push({ name, spec });
}

const total = brokenDeps.length + brokenInBox.length;

if (total > 0) {
  console.log(
    `\n${C_BAD}✗ ${total} 个 bundle 解析不了${C_OFF} —— 这就是 dsh web 起不来的原因。\n`,
  );
  for (const b of brokenDeps) {
    console.log(`【${b.name}】  ${C_DIM}(在 dependencies 里：${b.spec})${C_OFF}`);
    if (b.tgt) {
      console.log(`  软链指向的目录没了：${b.tgt}`);
      console.log(`  ① 目录还在别处 → 放回原路径，或重装：dsh plugin --profile ${PROFILE} add link:<现在的路径>`);
    } else {
      console.log(`  重装一次通常就好：dsh plugin --profile ${PROFILE} add ${b.spec}`);
    }
    console.log(`  ② 不要了 → --fix 摘掉它`);
    console.log();
  }
  for (const b of brokenInBox) {
    console.log(`【${b.name}】  ${C_BAD}不在 dependencies 里${C_OFF}`);
    if (b.tgt) console.log(`  软链指向的目录没了：${b.tgt}`);
    console.log(`  这是 DSH 自带的 in-box bundle，正常情况下从 $DSH_HOME/profiles/node_modules 解析。`);
    console.log(`  ${C_WARN}它解析不了 = DSH 安装本身出问题了（不是插件的事）。${C_OFF}`);
    console.log(`  ⚠ 不要从 bundles 清单里摘掉它 —— 摘了就彻底起不来了。修 DSH 安装。`);
    console.log();
  }
}

if (brokenSpecs.length > 0) {
  console.log(`${C_WARN}dependencies 里指向已不存在路径的条目：${C_OFF}`);
  for (const b of brokenSpecs) console.log(`  ${C_BAD}✗${C_OFF} ${b.name}  ${C_DIM}${b.spec}${C_OFF}`);
  console.log(`  ${C_DIM}（现在不一定卡启动，但下一次 dsh plugin add 会因此失败）${C_OFF}`);
  console.log();
}

if (total === 0) {
  console.log(
    `\n${C_OK}✓ 全部 ${bundles.length} 个 bundle 都能解析${C_OFF} —— 启动不会被它们卡住。`,
  );
  if (brokenSpecs.length === 0) console.log(`${C_OK}✓ profile 健康${C_OFF}`);
  process.exit(0);
}

if (!FIX) {
  console.log(`${C_DIM}只体检，没改任何东西。${C_OFF}`);
  if (brokenDeps.length > 0) {
    console.log(`要摘掉上面 ${brokenDeps.length} 个坏条目（in-box 的不会动）：`);
    console.log(`    node ${path.basename(process.argv[1])} --profile ${PROFILE} --fix`);
  }
  process.exit(1);
}

if (brokenDeps.length === 0) {
  console.log(`${C_WARN}✗ 解析不了的 bundle 全都不在 dependencies 里，--fix 不会动它们。${C_OFF}`);
  console.log(`  这是 DSH 安装的问题，请修 DSH 本身（或重装 DSH）。`);
  process.exit(1);
}

const bad = new Set(brokenDeps.map((b) => b.name));
const nextBundles = bundles.filter((n) => !bad.has(n));
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
const backup = `${MANIFEST}.bak-${stamp}`;
fs.copyFileSync(MANIFEST, backup);
manifest.dsh = {
  ...manifest.dsh,
  profile: { ...(manifest.dsh?.profile ?? {}), bundles: nextBundles },
};
fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`${C_OK}✓ 已从 bundles 摘掉 ${bad.size} 个：${[...bad].join(", ")}${C_OFF}`);
if (brokenInBox.length > 0) {
  console.log(`${C_WARN}⚠ 另有 ${brokenInBox.length} 个 in-box bundle 仍未解决：${brokenInBox.map((b) => b.name).join(", ")}${C_OFF}`);
}
console.log(`  清单备份：${backup}`);
console.log(`  没删任何文件；node_modules 原样保留。`);
console.log();
console.log(`下一步：重启 dsh web。想要回被摘掉的插件：dsh plugin --profile ${PROFILE} add <包名或 link:路径>`);
