// v1.4.0「真自动」: 让插件直接读 DSH settings.yaml 的 provider 列表,
// 把用户在 DSH 里配好的中转站变成可查余额的条目 (不必再手抄一遍 baseUrl + key)。
//
// ⚠️ 与 test-provider-kinds.mjs 同样的纪律: **不许读运行机器上的私有文件**。
// 全部用内联夹具, provider 名与域名均为占位值 (example.com)。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (n, c) => { if (c) { pass++ } else { fail++; console.log('FAIL ' + n) } }
const eq = (n, got, want) => a(n + ' (got ' + JSON.stringify(got) + ')', JSON.stringify(got) === JSON.stringify(want))

// 夹具结构与真实 settings.yaml 逐项对齐: provider 名下 apiKeyEnv/api/baseURL/compat 混排、
// compat 更深一层缩进、models 是带 `- id:` 与空值子键的列表、部分 provider 故意不写 baseURL。
const fixture = `llm-pi-ai:
  providers:
    relay-one:
      apiKeyEnv: RELAY_ONE_API_KEY
      api: openai-completions
      baseURL: https://relay-one.example.com/v1
      compat:
        thinkingFormat: deepseek
      models:
        - id: some-model
          name: Some Model
          contextWindow: 1000000
          reasoningEfforts:
            off:
            high: high
    vendor-a:
      apiKeyEnv: VENDOR_A_API_KEY
      models:
        - id: vendor-model
          contextWindow: 131072
    relay-two:
      apiKeyEnv: RELAY_TWO_API_KEY
      baseURL: "https://relay-two.example.net/v1"   # 带引号 + 行内注释
    relay-three:
      baseURL: 'https://relay-three.example.org/v1/'
      apiKeyEnv: RELAY_THREE_API_KEY
    relay-four:
      baseURL: https://relay-four.example.io/v1
      nested:
        baseURL: https://should-not-be-picked.example.com/v1
    relay-five:
      baseURL: not-a-url
`

// ================= parseProviderEntries =================
const entries = m.parseProviderEntries(fixture)
eq('抓到的 provider 名', Object.keys(entries).sort(),
  ['relay-five', 'relay-four', 'relay-one', 'relay-three', 'relay-two', 'vendor-a'])

eq('relay-one: baseURL + apiKeyEnv', entries['relay-one'],
  { baseURL: 'https://relay-one.example.com/v1', apiKeyEnv: 'RELAY_ONE_API_KEY' })
eq('vendor-a: 没 baseURL 但有 apiKeyEnv (必须仍被发现, 才能提示「没写 baseURL」)',
  entries['vendor-a'], { baseURL: '', apiKeyEnv: 'VENDOR_A_API_KEY' })
eq('双引号 + 行内注释被剥掉', entries['relay-two'].baseURL, 'https://relay-two.example.net/v1')
eq('单引号被剥掉 (尾斜杠保留)', entries['relay-three'].baseURL, 'https://relay-three.example.org/v1/')
eq('apiKeyEnv 在 baseURL 之后也能抓到', entries['relay-three'].apiKeyEnv, 'RELAY_THREE_API_KEY')
eq('provider 下更深一层的 baseURL 不被误吃', entries['relay-four'].baseURL, 'https://relay-four.example.io/v1')
eq('非 URL 值原样保留 (判定交给 hostOfUrl)', entries['relay-five'].baseURL, 'not-a-url')
eq('空文本 → {}', m.parseProviderEntries(''), {})
eq('非字符串 → {}', m.parseProviderEntries(null), {})
eq('没有 llm-pi-ai 段 → {}', m.parseProviderEntries('other:\n  providers:\n    x:\n      baseURL: https://a.example.com\n'), {})

// ================= 重构安全网: 两个解析器必须一致 =================
// parseProviderBaseURLs 的返回语义**不许被这次重构改掉** (test-provider-kinds 也在盯着它)。
const urls = m.parseProviderBaseURLs(fixture)
const expectUrls = {}
for (const [name, e] of Object.entries(entries)) if (e.baseURL !== '') expectUrls[name] = e.baseURL
eq('parseProviderBaseURLs 与 entries 的 baseURL 逐项一致', urls, expectUrls)

// ================= selectDshProviders =================
const kinds = m.computeProviderKinds(fixture)
const picked = m.selectDshProviders(entries, kinds, [])
eq('挑中的 provider (按名排序, 剥尾斜杠)',
  picked.map((p) => p.name), ['relay-five', 'relay-four', 'relay-one', 'relay-three', 'relay-two'])
eq('relay-three 尾斜杠被剥', picked.find((p) => p.name === 'relay-three').baseURL, 'https://relay-three.example.org/v1')
eq('apiKeyEnv 一并带出', picked.find((p) => p.name === 'relay-one').apiKeyEnv, 'RELAY_ONE_API_KEY')
a('没写 baseURL 的 vendor-a 被排除 (铁律 9: 不表态)', !picked.some((p) => p.name === 'vendor-a'))

// 官方直连跳过 —— 它们由预设平台负责, 别重复成一条中转站
eq('official 被跳过', m.selectDshProviders(entries, { ...kinds, 'relay-one': 'official' }, [])
  .map((p) => p.name), ['relay-five', 'relay-four', 'relay-three', 'relay-two'])
// 拿真实官方域名形状的夹具再验一次 (域名用官方值, provider 名仍是占位)
const officialFixture = 'llm-pi-ai:\n  providers:\n    vendor-x:\n      apiKeyEnv: VENDOR_X_API_KEY\n      baseURL: https://api.deepseek.com/v1\n'
const officialEntries = m.parseProviderEntries(officialFixture)
const officialKinds = m.computeProviderKinds(officialFixture)
eq('本夹具确实判成 official', officialKinds, { 'vendor-x': 'official' })
eq('官方域名 provider 不进自动中转站列表', m.selectDshProviders(officialEntries, officialKinds, []), [])

// 用户关掉的跳过 (大小写不敏感)
eq('关掉一个 → 少一个', m.selectDshProviders(entries, kinds, ['relay-two']).map((p) => p.name),
  ['relay-five', 'relay-four', 'relay-one', 'relay-three'])
eq('关掉时大小写不敏感', m.selectDshProviders(entries, kinds, ['RELAY-Two']).map((p) => p.name),
  ['relay-five', 'relay-four', 'relay-one', 'relay-three'])
eq('全部关掉 → 空', m.selectDshProviders(entries, kinds,
  ['relay-one', 'relay-two', 'relay-three', 'relay-four', 'relay-five']), [])

// 畸形输入一律静默 (投影/轮询每 5s 跑一次, 绝不能抛)
eq('entries 缺失', m.selectDshProviders(undefined, kinds, []), [])
eq('entries 是字符串', m.selectDshProviders('garbage', kinds, []), [])
eq('kinds 缺失', m.selectDshProviders(entries, undefined, []).map((p) => p.name),
  ['relay-five', 'relay-four', 'relay-one', 'relay-three', 'relay-two'])
eq('optOut 缺失', m.selectDshProviders(entries, kinds, undefined).map((p) => p.name),
  ['relay-five', 'relay-four', 'relay-one', 'relay-three', 'relay-two'])
eq('optOut 是字符串 (不炸, 当作空) ', m.selectDshProviders(entries, kinds, 'relay-one').map((p) => p.name),
  ['relay-five', 'relay-four', 'relay-one', 'relay-three', 'relay-two'])
eq('entry 不是对象', m.selectDshProviders({ bad: null, worse: 42 }, {}, []), [])
eq('baseURL 非字符串', m.selectDshProviders({ x: { baseURL: 123 } }, {}, []), [])
eq('空对象', m.selectDshProviders({}, {}, []), [])

// ================= 与 refreshAll 的合并规则对齐 =================
// src 里: 手填的 customRelays 与自动发现合并时「手填优先」(同 id 或同 baseUrl 都算重复)。
// 这里复刻同一段过滤, 保证规则不被单方面改掉。
const manualRelays = [{ id: 'mine', name: '我自己填的', baseUrl: 'https://relay-one.example.com/v1', apiKey: 'k' }]
const dshRelays = picked.map((p) => ({ id: 'dsh:' + p.name, baseUrl: p.baseURL, fromDsh: true }))
const manualIds = new Set(manualRelays.map((r) => String(r.id)))
const manualUrls = new Set(manualRelays.map((r) => String(r.baseUrl || '').replace(/\/+$/, '')))
const merged = [...manualRelays, ...dshRelays.filter((r) => !manualIds.has(r.id) && !manualUrls.has(r.baseUrl))]
a('手填的同 baseUrl 条目不被重复查一遍', merged.filter((r) => r.baseUrl === 'https://relay-one.example.com/v1').length === 1)
a('手填的那条排在前面 (口径由用户定)', merged[0].id === 'mine')
a('自动发现的其余条目仍在', merged.filter((r) => r.fromDsh === true).length === 4)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
// 断言失败时以非 0 退出, 否则 CI 拦不住回归
if (fail > 0) process.exitCode = 1
