// v1.7.0 更新安全：全部网络/文件为夹具，不读取本机私有凭据。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dshadb-update170-'))
const oldHome = process.env.DSH_HOME, oldFetch = globalThis.fetch
process.env.DSH_HOME = home
try {
  const m = await import('../src/index.js')
  const manifest = (range = '^0.2.0-rc.2') => ({ name: 'dsh-api-dashboard', version: '9.9.9',
    peerDependencies: { '@deepseek-ai/dsh': range }, dsh: { update: { targets: ['DSHA Web / 手机 / 桌面'] } } })
  const c = m.evaluateUpdateCompatibility
  assert.equal(c(manifest(), '0.2.0-rc.2').status, 'compatible')
  assert.equal(c(manifest(), '0.1.7-rc.2').status, 'incompatible', '旧宿主不能更新新宿主专用版本')
  assert.equal(c(manifest('^0.1.0-rc.6 || ^0.2.0-rc.2'), '0.1.7-rc.2').status, 'compatible')
  assert.equal(c(manifest('>=0.2.0 <0.3.0'), '0.2.0-rc.2').status, 'incompatible', '不把 RC 冒充稳定版')
  assert.equal(c({ ...manifest(), peerDependencies: {} }, '0.2.0').status, 'unknown')
  assert.equal(c(manifest('invalid'), '0.2.0').status, 'unknown')
  assert.equal(c(manifest(), null).status, 'unknown')
  assert.equal(c({ ...manifest(), peerDependencies: { '@deepseek-ai/dsh': '^0.2.0', '@deepseek-ai/dsh-credentials': '^0.1.0' } }, '0.2.0').status, 'incompatible', '全部 DSH peer 必须匹配')
  assert.equal(c({ ...manifest(), engines: { dsh: '>=0.3.0' } }, '0.2.0').status, 'incompatible')

  let remoteManifest = manifest(), archiveBytes, calls = [], pending
  const fetchMock = async (url) => {
    calls.push(String(url))
    if (String(url).endsWith('/releases/latest')) {
      if (pending) await pending
      return { ok: true, json: async () => ({ tag_name: 'v9.9.9', body: '新增功能\n适配 DSH 0.2.x\n<img src=x onerror=alert(1)>', draft: false, prerelease: false, published_at: '2026-10-09T00:00:00Z' }) }
    }
    if (String(url).includes('/contents/package.json?ref=v9.9.9')) return { ok: true, json: async () => ({ content: Buffer.from(JSON.stringify(remoteManifest)).toString('base64') }) }
    if (String(url).includes('codeload.github.com')) return { ok: true, arrayBuffer: async () => archiveBytes }
    throw Error('unexpected URL: ' + url)
  }
  globalThis.fetch = fetchMock
  const info = await m.getUpdateStatus(true)
  assert.equal(info.ok, true); assert.equal(info.remote, '9.9.9'); assert.equal(info.hasUpdate, true)
  // 宿主版本随环境升级（0.2.0-rc.2 → 0.2.1-rc.2 …），写死会随环境必红：
  // 改为「必须等于真实安装值」，并按 semver 形状兜底，防止 runtimeVersion 被写成任意字符串。
  const installedDsh = (() => {
    const require = createRequire(import.meta.url)
    for (const spec of ['@deepseek-ai/dsh-client-connection/package.json', '@deepseek-ai/dsh-app-boot/package.json']) {
      try { return JSON.parse(fs.readFileSync(require.resolve(spec), 'utf8')).version } catch { /* 下一个 */ }
    }
    return null
  })()
  assert.match(info.compatibility.runtimeVersion, /^0\.\d+\.\d+(?:-rc\.\d+)?$/)
  assert.equal(info.compatibility.runtimeVersion, installedDsh, '运行时版本必须等于已安装的 DSH 版本')
  assert.equal(info.canInstall, true); assert.ok(info.summary.includes('新增功能'))
  assert.equal(info.compatibility.targets[0], 'DSHA Web / 手机 / 桌面')
  assert.match(info.confirmationToken, /^[a-f0-9]{64}$/)
  assert.ok(!calls.some(url => /ref=main|refs\/heads\/main/.test(url)), '稳定更新不跟 main')
  const count = calls.length; await m.getUpdateStatus(false); assert.equal(calls.length, count, '检查缓存有效')

  const target = path.join(home, 'installed'); fs.mkdirSync(path.join(target, 'src'), { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'dsh-api-dashboard', version: '1.7.0' }))
  fs.writeFileSync(path.join(target, 'src/index.js'), '// old')
  const opts = { targets: [target], expectedVersion: info.remote, confirmationToken: info.confirmationToken }
  await assert.rejects(m.applyUpdate({ ...opts, confirmationToken: '0'.repeat(64) }), e => e.code === 'update-changed')
  remoteManifest = manifest('>=0.3.0')
  const blocked = await m.getUpdateStatus(true); assert.equal(blocked.compatibility.status, 'incompatible'); assert.equal(blocked.canInstall, false)
  await assert.rejects(m.applyUpdate({ ...opts, confirmationToken: blocked.confirmationToken }), e => e.code === 'update-incompatible')
  remoteManifest = { ...manifest(), peerDependencies: {} }
  const unknown = await m.getUpdateStatus(true); assert.equal(unknown.canInstall, false)
  await assert.rejects(m.applyUpdate({ ...opts, confirmationToken: unknown.confirmationToken }), e => e.code === 'update-unknown')
  assert.equal(fs.readFileSync(path.join(target, 'src/index.js'), 'utf8'), '// old')
  remoteManifest = manifest()
  let unlock; pending = new Promise(resolve => { unlock = resolve })
  const first = m.applyUpdate({ ...opts, confirmationToken: '0'.repeat(64) })
  await assert.rejects(m.applyUpdate(opts), e => e.code === 'update-busy')
  unlock(); pending = null; await assert.rejects(first, e => e.code === 'update-changed')

  // 解包后再次复核；兼容包成功，不兼容/manifest变化/坏语法不覆盖原件。
  const root = path.join(home, 'package-source', 'dsh-api-dashboard-tag')
  fs.mkdirSync(path.join(root, 'src'), { recursive: true }); fs.mkdirSync(path.join(root, 'client'))
  const buildArchive = (pkg, js = '// new') => {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg))
    fs.writeFileSync(path.join(root, 'src/index.js'), js); fs.writeFileSync(path.join(root, 'client/client.js'), '// client')
    fs.writeFileSync(path.join(root, 'cordis.patch.yml'), '- insert: []\n')
    const tar = path.join(home, 'test.tar.gz')
    execFileSync('tar', ['czf', tar, '-C', path.dirname(root), path.basename(root)])
    archiveBytes = fs.readFileSync(tar); return tar
  }
  buildArchive(manifest('>=0.3.0'))
  await assert.rejects(m.applyUpdate(opts), e => e.code === 'update-incompatible')
  buildArchive({ ...manifest(), description: 'changed after confirmation' })
  await assert.rejects(m.applyUpdate(opts), e => e.code === 'update-changed')
  buildArchive(manifest(), 'const broken = ;')
  await assert.rejects(m.applyUpdate(opts))
  assert.equal(fs.readFileSync(path.join(target, 'src/index.js'), 'utf8'), '// old')
  remoteManifest = { ...manifest(), dependencies: { 'missing-test-dependency': '^99.0.0' } }
  const dependencyInfo = await m.getUpdateStatus(true)
  buildArchive(remoteManifest)
  await assert.rejects(m.applyUpdate({ ...opts, confirmationToken: dependencyInfo.confirmationToken }), e => e.code === 'update-dependencies')
  assert.equal(fs.readFileSync(path.join(target, 'src/index.js'), 'utf8'), '// old')
  remoteManifest = manifest(); buildArchive(manifest())
  fs.mkdirSync(path.join(target, '.git')); fs.writeFileSync(path.join(target, '.git/HEAD'), 'keep')
  const result = await m.applyUpdate(opts)
  assert.equal(result.installed, '9.9.9'); assert.ok(fs.existsSync(result.backup))
  assert.equal(fs.readFileSync(path.join(target, '.git/HEAD'), 'utf8'), 'keep')
  assert.equal(fs.readFileSync(path.join(target, 'src/index.js'), 'utf8'), '// new')
  assert.ok(calls.some(url => url.endsWith('/refs/tags/v9.9.9')))

  // 真实路由调用：无确认体=400；绕过前端也会被服务端拒绝。
  const routes = []
  const web = { effect: fn => fn(), webServer: { register(r) { routes.push(r); return () => {} } } }
  m.apply({ get() {}, effect() {}, inject(names, fn) { if (names[0] === 'webServer') fn(web); if (names[0] === 'connection') fn({ connection: { requestRejection: () => undefined } }) } }, { presets: [] })
  const route = routes.find(r => r.path === '/api-dashboard/update/install')
  const req = payload => ({ method: 'POST', headers: {}, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(payload)) } })
  const res = () => ({ code: null, body: null, writeHead(code) { this.code = code }, end(body) { this.body = JSON.parse(body) } })
  let r = res(); await route.handler(req({}), r); assert.equal(r.code, 400)
  remoteManifest = manifest('>=0.3.0'); const incompatibleInfo = await m.getUpdateStatus(true)
  r = res(); await route.handler(req({ expectedVersion: incompatibleInfo.remote, confirmationToken: incompatibleInfo.confirmationToken }), r)
  assert.equal(r.code, 409); assert.equal(r.body.error, 'update-incompatible')
  console.log('v1.7.0 更新保护：适配范围矩阵、Release来源、摘要、确认指纹、服务端复检、重复安装、解包兼容、语法预检、原件保留及路由闸门全部通过')
} finally {
  globalThis.fetch = oldFetch
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  rmSafe(home)
}
function rmSafe(p) { assert.ok(p.startsWith(path.join(os.tmpdir(), 'dshadb-update170-'))); fs.rmSync(p, { recursive: true, force: true }) }
