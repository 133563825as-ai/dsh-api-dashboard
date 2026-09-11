#!/bin/sh
# dsh-api-dashboard 安装脚本（v1.5.0-desktop-preview.2）
#
# 为什么不是 `dsh plugin --profile web add dsh-api-dashboard`：
#   手机版 DSHA 跑在 proot 容器里（启动参数带 --link2symlink），pnpm 的硬链接会被降级成
#   **指向全局 store 的符号链接**；Node 的 ESM 会先把模块解析成 realpath，再从那开始向上找
#   node_modules —— 从 store 目录往上永远找不到宿主 DSH 提供的 peer 依赖
#   （@deepseek-ai/schemastery / zod），结果是整个 `dsh web` 启动失败。
#   本脚本改为「下载源码到真实目录 + 建 node_modules 软链 + link: 安装」，三条路径都通。
#
# 用法：
#   sh install.sh [安装目录]        # 默认 /root/dsha-api-dashboard
#   DSH_HOME=/xxx sh install.sh /path/to/dir
#   DSH_DASHBOARD_REF=preview/desktop sh install.sh    # 装预发行(桌面适配预览)分支
#
# 环境变量：
#   DSH_INSTALL_NM   手动指定宿主 DSH 的 node_modules 目录
#   DSHA_STARTUP_PROFILE / DSH_PROFILE   profile 名（默认 web）
#   DSH_DASHBOARD_REF   要装的 git ref（默认 main）。预发行版是 `preview/desktop`；
#                       预览版装完后**不参与一键更新**（避免被 main 的正式版覆盖）。

set -eu

TARGET="${1:-/root/dsha-api-dashboard}"
PROFILE="${DSHA_STARTUP_PROFILE:-${DSH_PROFILE:-web}}"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
REF="${DSH_DASHBOARD_REF:-main}"
REPO_URL="https://codeload.github.com/133563825as-ai/dsh-api-dashboard/tar.gz/refs/heads/${REF}"
TMP_TGZ="${TMPDIR:-/tmp}/dsh-api-dashboard-install.tar.gz"
STAMP="$(date +%Y%m%d-%H%M%S)"

say() { printf '%s\n' "$*"; }
die() { printf '✗ %s\n' "$*" >&2; exit 1; }

# ---- 0. 保护开发者的 git 工作区 ----
if [ -e "$TARGET/.git" ]; then
  die "目标目录 $TARGET 是一个 git 工作区；本脚本会用 tarball 覆盖它（tarball 里没有 .git）。
   开发用途请改用：git -C \"$TARGET\" fetch --all && git -C \"$TARGET\" reset --hard origin/main"
fi

# ---- 1. 下载 ----
say "→ 下载 $REPO_URL"
[ "$REF" = "main" ] || say "  （预发行分支：$REF —— 装完后不参与一键更新，正式版仍在 main）"
if command -v curl >/dev/null 2>&1; then
  curl -fL "$REPO_URL" -o "$TMP_TGZ" || die "下载失败（检查网络/代理）"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$TMP_TGZ" "$REPO_URL" || die "下载失败（检查网络/代理）"
else
  die "需要 curl 或 wget"
fi
[ -s "$TMP_TGZ" ] || die "下载到的文件是空的"

# ---- 2. 解压（旧目录先改名留作回退点）----
if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null || true)" ]; then
  say "→ 旧目录改名为 $TARGET.preinstall-$STAMP（回退用）"
  mv "$TARGET" "$TARGET.preinstall-$STAMP"
fi
mkdir -p "$TARGET"
tar xzf "$TMP_TGZ" -C "$TARGET" --strip-components=1 || die "解压失败"
[ -f "$TARGET/package.json" ] || die "解压结果不对（缺少 package.json）"
[ -f "$TARGET/src/index.js" ] || die "解压结果不对（缺少 src/index.js）"
say "→ 已解压到 $TARGET"

# ---- 3. 找到宿主 DSH 的 node_modules 并建软链（关键一步，不能省）----
find_dsh_nm() {
  if [ -n "${DSH_INSTALL_NM:-}" ] && [ -d "${DSH_INSTALL_NM}/@deepseek-ai/schemastery" ]; then
    printf '%s' "$DSH_INSTALL_NM"; return 0
  fi
  if command -v dsh >/dev/null 2>&1; then
    p="$(command -v dsh)"
    rp="$(readlink -f "$p" 2>/dev/null || printf '%s' "$p")"
    d="$(dirname "$(dirname "$rp")")"     # .../@deepseek-ai/dsh/lib/bin.js -> .../@deepseek-ai/dsh
    if [ -d "$d/node_modules/@deepseek-ai/schemastery" ]; then printf '%s' "$d/node_modules"; return 0; fi
  fi
  for c in "$DSH_HOME_DIR/profiles/node_modules" \
           /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules; do
    if [ -d "$c/@deepseek-ai/schemastery" ]; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

if NM="$(find_dsh_nm)"; then
  rm -rf "$TARGET/node_modules"
  ln -sfn "$NM" "$TARGET/node_modules"
  say "→ node_modules -> $NM"
else
  say "⚠ 没找到宿主 DSH 的 node_modules（其中应有 @deepseek-ai/schemastery）。"
  say "  插件自带的解析回退通常仍能启动宿主半身，但建议手动补上："
  say "    ln -sfn <DSH安装目录>/node_modules $TARGET/node_modules"
fi

# ---- 3.5 备份 profile 清单 + 记录「装之前」的健康状况 ----
# 为什么要有这一步：DSH 启动时会把 profile 里 dsh.profile.bundles 的每个包**逐个 import**，
# 只要有一个解析不了（没装 / 软链断掉），**整个 dsh web 就拒绝启动**，日志尾部是
#   [cause]: Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<包名>'
# 这类坏条目常常在本次安装**之前**就存在了（上一次装插件失败留下的），
# 但用户是在「按你的教程装完 + 重启」之后才看到崩溃 —— 于是算到我们头上。
# 所以：装前先备份清单、先体检一次，装后再体检一次，把责任分清楚。
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
MANIFEST="$PROFILE_DIR/package.json"
CHECKER="${TMPDIR:-/tmp}/dsh-profile-check-$$.cjs"
BEFORE_BAD=0

cat > "$CHECKER" <<'CHECKEOF'
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const dir = process.argv[2];
const anchor = path.join(dir, "package.json");
let m;
try {
  m = JSON.parse(fs.readFileSync(anchor, "utf8"));
} catch {
  console.log("  (profile 清单读不了，跳过自检)");
  process.exit(0);
}
const bundles = (m.dsh && m.dsh.profile && m.dsh.profile.bundles) || [];
const deps = m.dependencies || {};
const bad = [];
for (const name of bundles) {
  let ok = false;
  try {
    for (const sp of createRequire(anchor).resolve.paths(name) || []) {
      if (fs.existsSync(path.join(sp, name, "package.json"))) { ok = true; break; }
    }
  } catch { /* 解析链拿不到就当解析不了 */ }
  if (!ok) bad.push(name + (Object.hasOwn(deps, name)
    ? "   (dependencies: " + deps[name] + ")"
    : "   (DSH 自带 in-box —— 别动清单)"));
}
if (bad.length === 0) {
  console.log("  ✓ " + bundles.length + " 个 bundle 全部可解析");
  process.exit(0);
}
console.log("  ✗ " + bad.length + " 个 bundle 解析不了：");
for (const b of bad) console.log("      " + b);
process.exit(1);
CHECKEOF

if [ -f "$MANIFEST" ]; then
  cp "$MANIFEST" "$MANIFEST.before-install-$STAMP"
  say "→ profile 清单已备份：$MANIFEST.before-install-$STAMP"
  say "→ 安装前自检："
  node "$CHECKER" "$PROFILE_DIR" || BEFORE_BAD=1
fi

# ---- 4. 装进 profile ----
say "→ 注册到 profile: $PROFILE"
dsh plugin --profile "$PROFILE" add "link:$TARGET" || die "dsh plugin add 失败"

# ---- 5. 装完自检 ----
say ""
if [ -f "$MANIFEST" ]; then
  say "→ 安装后自检："
  if node "$CHECKER" "$PROFILE_DIR"; then
    say ""
    say "✓ 安装完成。下一步：重启 dsh web 生效。"
  else
    say ""
    if [ "$BEFORE_BAD" = 1 ]; then
      say "⚠ 上面这些 bundle 在**安装之前**就解析不了 —— 不是本次安装造成的。"
      say "  但你现在重启 dsh web 会起不来（不是你装错了，是 profile 里本来就有坏条目）。"
    else
      say "⚠ 安装前是好的、装完变成这样 —— 先别重启，把上面的输出发出来。"
    fi
    say "  抢救工具："
    say "    curl -fsSL https://raw.githubusercontent.com/133563825as-ai/dsh-api-dashboard/main/tools/profile-doctor.mjs -o /tmp/dsh-profile-doctor.mjs"
    say "    node /tmp/dsh-profile-doctor.mjs --profile $PROFILE"
    say "  （只摘掉 dependencies 里那些坏条目，DSH 自带 in-box bundle 一律不动）"
  fi
fi
rm -f "$CHECKER"
say "  卸载：dsh plugin --profile $PROFILE remove dsh-api-dashboard && rm -rf $TARGET"
