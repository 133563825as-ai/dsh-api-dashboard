// 服务端 provider 官方/中转判定 (开源化改造): YAML 最小解析器 + 域名白名单
// 替代原 test-provider.mjs (测的是被推翻的旧实现: provider 传进 modelToPlatform)
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
const { readFileSync } = await import('node:fs')
let pass = 0, fail = 0
const a = (n, c) => { if (c) { pass++ } else { fail++; console.log('FAIL ' + n) } }
const eq = (n, got, want) => a(n + ' (got ' + JSON.stringify(got) + ')', JSON.stringify(got) === JSON.stringify(want))

// ==== hostOfUrl ====
eq('host 小写去端口', m.hostOfUrl('https://API.DeepSeek.com:443/v1'), 'api.deepseek.com')
eq('host 非法 URL → 空', m.hostOfUrl('garbage'), '')
eq('host 非字符串 → 空', m.hostOfUrl(null), '')

// ==== isOfficialHost ====
a('官方 api.deepseek.com', m.isOfficialHost('api.deepseek.com') === true)
a('官方 open.bigmodel.cn', m.isOfficialHost('open.bigmodel.cn') === true)
a('官方后缀 api.xiaomimimo.com', m.isOfficialHost('api.xiaomimimo.com') === true)
a('官方后缀 token-plan-cn.xiaomimimo.com', m.isOfficialHost('token-plan-cn.xiaomimimo.com') === true)
a('中转 tokenrhythm.studio', m.isOfficialHost('tokenrhythm.studio') === false)
a('中转 api.mhsapi.top', m.isOfficialHost('api.mhsapi.top') === false)
a('后缀不被伪造域名骗', m.isOfficialHost('api.xiaomimimo.com.attacker.net') === false)
a('子域不冒充精确条目', m.isOfficialHost('evil.api.deepseek.com.cn') === false)
a('空/非字符串', m.isOfficialHost('') === false && m.isOfficialHost(undefined) === false)

// ==== parseProviderBaseURLs: 真实 settings.yaml ====
const real = readFileSync(process.env.DSH_HOME ? process.env.DSH_HOME + '/settings.yaml' : (process.env.HOME || '/root') + '/.dsh/settings.yaml', 'utf8')
const realUrls = m.parseProviderBaseURLs(real)
a('真实文件抓到 zhipu', realUrls.zhipu === 'https://open.bigmodel.cn/api/paas/v4')
a('真实文件抓到中转 new', realUrls.new === 'https://api.mhsapi.top/v1')
a('真实文件不给 xiaomi 表态(无 baseURL)', !('xiaomi' in realUrls))
a('真实文件不给 opencode 表态(无 baseURL)', !('opencode' in realUrls))
const realKinds = m.computeProviderKinds(real)
eq('真实文件 kinds', realKinds, {
  zhipu: 'official', jiyuan: 'relay', jiyuanlvdong: 'relay',
  new: 'relay', sw: 'relay', dshzuoxhe: 'relay',
})

// ==== parseProviderBaseURLs: 边界 ====
const y1 = `llm-pi-ai:
  providers:
    a:
      baseURL: https://api.deepseek.com/v1
    b:
      baseURL: https://relay.example.com/v1
      models:
        - id: x
          baseURL: https://api.openai.com/v1
agent-default-model:
  providers:
    - provider: a
other:
  providers:
    zzz:
      baseURL: https://api.openai.com
`
eq('models 项内部的 baseURL 不算 provider 的', m.parseProviderBaseURLs(y1), {
  a: 'https://api.deepseek.com/v1', b: 'https://relay.example.com/v1',
})
eq('段外的 providers 不被吃进来', m.computeProviderKinds(y1), { a: 'official', b: 'relay' })

const y2 = `llm-pi-ai:
  providers:
    q:
      baseURL: "https://api.moonshot.cn/v1"  # 官方
    r:
      baseURL: 'https://x.y.z/v1'
    s:
      apiKeyEnv: FOO_KEY
`
eq('引号/行内注释/无 baseURL', m.computeProviderKinds(y2), { q: 'official', r: 'relay' })

eq('空输入', m.parseProviderBaseURLs(''), {})
eq('非字符串输入', m.parseProviderBaseURLs(null), {})
eq('没有 llm-pi-ai 段', m.computeProviderKinds('foo:\n  bar: 1\n'), {})
eq('baseUrl 小写 u 也认', m.parseProviderBaseURLs('llm-pi-ai:\n  providers:\n    z:\n      baseUrl: https://api.x.ai/v1\n'), { z: 'https://api.x.ai/v1' })
eq('baseURL 值为空不入表', m.parseProviderBaseURLs('llm-pi-ai:\n  providers:\n    z:\n      baseURL:\n'), {})
eq('URL 解析失败不入 kinds', m.computeProviderKinds('llm-pi-ai:\n  providers:\n    z:\n      baseURL: not-a-url\n'), {})

// ==== normalizeOfficialProviders ====
eq('逗号/换行/空格混合分隔', m.normalizeOfficialProviders('deepseek, zhipu\nfoo  bar,,deepseek'), ['deepseek', 'zhipu', 'foo', 'bar'])
eq('数组去重去空、去非字符串', m.normalizeOfficialProviders(['a', ' b ', 'a', 3, null, '']), ['a', 'b'])
eq('中文逗号顿号分号', m.normalizeOfficialProviders('a，b、c；d'), ['a', 'b', 'c', 'd'])
eq('非法输入 → 空数组', m.normalizeOfficialProviders(undefined), [])
eq('保留原大小写(去重按小写)', m.normalizeOfficialProviders('DS-CN, ds-cn'), ['DS-CN'])

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
