// v1.5.0: 大肥鱼挂件的音效引擎重做 + 音效组扩展。
// 背景: 上游 (MeteorNOX/DeepSeek-Balance-Whale-Widget) 在 v0.3.8 / v0.3.10 两轮重做了音效引擎,
//   起因是 media element 的三个通病 —— ①注册进系统「正在播放」(macOS Touch Bar 播放条)
//   ②起播等 Promise/解码, 点按不跟手 ③部分机器网络层(下载管理器)拦请求导致静默无声。
//   我们的实现当时是 new Audio(url) + HTTP, 三条全中, 故本轮把它换成 Web Audio。
const fs = await import('node:fs')
const path = await import('node:path')
let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const src = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8')
const cli = fs.readFileSync(path.join(ROOT, 'client/client.js'), 'utf8')
const assetDir = path.join(ROOT, 'assets/whale')

// ===== ① 音效引擎: Web Audio 为主 =====
a('引擎用 AudioBufferSourceNode 起播(不是 media element)', /ctx\.createBufferSource\(\)/.test(cli))
a('预解码走 decodeAudioData', /ctx\.decodeAudioData\(/.test(cli))
a('有预取预解码入口 warmSound', /function warmSound\(urls\)/.test(cli))
a('命中缓存时在同一任务里同步 start', /src\.start\(ctx\.currentTime \+ when\)/.test(cli))
a('松手音衔接量 RELEASE_LEAD_MS = 40(与上游同一口径)', /var RELEASE_LEAD_MS = 40;/.test(cli))
a('松手音排到"按压音结束前"起播', /sound\.pressAt \+ Math\.max\(0, sound\.pressDur - RELEASE_LEAD_MS \/ 1000\)/.test(cli))
a('按压音落点被记录(pressAt / pressDur)', /sound\.pressAt = ctx\.currentTime; sound\.pressDur = buf\.duration;/.test(cli))
a('suspended 时先 resume(自动播放策略)', /ctx\.state === "suspended"/.test(cli))

// ===== ② 回退链路必须还在(Web Audio 不可用 / 没解码完时不能没声) =====
a('回退到 media element', /new Audio\(pu\)/.test(cli) && /var el = sound\.el\[which\]/.test(cli))
a('回退路径带 play() 的 catch(不产生未处理拒绝)', /var p = el\.play\(\); if \(p && p\.catch\)/.test(cli))
a('AudioContext 建不出来时记 false 而不抛', /sound\.ctx = AC \? new AC\(\) : false;/.test(cli))
a('取不到 Buffer 时才走回退(优先 Web Audio)', /var buf = \(ctx && sound\.buf\[url\]\) \? sound\.buf\[url\] : null;/.test(cli))

// ===== ③ 音量与开关的旧契约不变 =====
a('关闭音效 / 音量 0 直接返回', /if \(!st\.soundOn \|\| st\.volume <= 0\) return;/.test(cli))
a('音量夹到 0..1 再下发', /var vol = Math\.max\(0, Math\.min\(1, st\.volume\)\)/.test(cli))
a('reloadAudio 仍叫这个名字(切音效组的调用方没改)', /if \(patch\.soundSet !== undefined\) reloadAudio\(\)/.test(cli))
a('残留的 audio.press / audio.release 引用已清干净', !/audio\.press|audio\.release/.test(cli))

// ===== ④ 音效组 2 → 4(交叉配对, 不动素材) =====
a('服务端有 4 组音效', /duck: \{ press: 'Ya1\.mp3', release: 'Ya2\.mp3' \}/.test(src) &&
  /fx1: \{ press: 'D1\.mp3', release: 'D2\.mp3' \}/.test(src) &&
  /fx2: \{ press: 'D1\.mp3', release: 'Ya2\.mp3' \}/.test(src) &&
  /fx3: \{ press: 'Ya1\.mp3', release: 'D2\.mp3' \}/.test(src))
a('未知 set 名回落到 duck(不再只认 fx1)', /hasOwnProperty\.call\(WHALE_SOUND_SETS, wanted\) \? wanted : 'duck'/.test(src))
a('Content-Type 按实际文件推导(.wav 也认)', /file\.endsWith\('\.wav'\) \? 'audio\/wav' : 'audio\/mpeg'/.test(src))
a('客户端 UI 给出 4 个音效组选项', /\["duck", t\("whale\.duck"\)\], \["fx1", t\("whale\.fx1"\)\], \["fx2", t\("whale\.fx2"\)\], \["fx3", t\("whale\.fx3"\)\]/.test(cli))
a('中英文都有 fx2/fx3 文案', /"whale\.fx2": "音效2", "whale\.fx3": "音效3"/.test(cli) && /"whale\.fx2": "FX 2", "whale\.fx3": "FX 3"/.test(cli))
a('音效组名与素材表一一对应(客户端不出未定义组)', ['duck', 'fx1', 'fx2', 'fx3'].every((k) => src.includes(k + ': {') && cli.includes('t("whale.' + k + '")')))

// ===== ⑤ 合规钉子: 不引入上游新增素材 =====
// 上游自 0.3.1(2026-09-16) 起补了 PROVENANCE.md —— assets/** 不在 MIT 覆盖内、明确"不授予再许可"。
// 我们 v1.1.0 移植时(早于该日期)仓库 MIT 覆盖全部内容, 所以既有素材无过失;
// 但**此后新增的素材不能拿**。这条断言就是那道边界 —— 别顺手把它们拷进来。
const forbidden = ['DSH2.png', 'DSniang02.png', 'bubble-money1.gif', 'bubble-petpet.gif', 'minecraft-exp-orb.wav', 'task-end-a.wav']
for (const f of forbidden) a('未引入上游 0.3.1 之后新增的素材: ' + f, !fs.existsSync(path.join(assetDir, f)))
a('既有素材仍齐(音效 4 + 图 2)', ['Ya1.mp3', 'Ya2.mp3', 'D1.mp3', 'D2.mp3', 'DSniang1.png', 'rua.gif'].every((f) => fs.existsSync(path.join(assetDir, f))))
a('素材许可说明文件保留', fs.existsSync(path.join(assetDir, 'LICENSE-whale-widget.txt')))

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
