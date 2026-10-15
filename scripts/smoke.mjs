/**
 * 客户端 bundle 冒烟测试 —— 不启动浏览器、不重启 DSH，验证：
 *   1. 信封正确：window.__ModuleLoader__.load 被调用，id 与包名一致
 *   2. 导出正确：apply 是函数，inject 精确等于 ['slots']
 *   3. 加载期不抛错
 *   4. 接线正确：apply(fakeCtx) 之后，两个挂载面注册到了预期的槽位与选项上
 *   5. 目标解析正确：agentTeam 优先，回落到 subagentCatalog（真机上踩过的 bug）
 *   6. 上下文解析正确：在子智能体里划词要能识别出来（据此显示三个动作）
 *
 * 用法：node scripts/smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const problems = []
const check = (ok, label) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label)
  if (!ok) problems.push(label)
}

// ---------------------------------------------------------------- 平台桩

let loaded = null

globalThis.window = {
  __ModuleLoader__: { load: (definition) => (loaded = definition) },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1440,
  innerHeight: 900,
  getSelection: () => null,
}

// document 桩：记录被注册的监听器，用来断言"发送手势的两条路都拦上了"。
const docListeners = []
globalThis.document = {
  head: { appendChild() {} },
  body: null,
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '', appendChild() {} }),
  addEventListener: (type, fn, capture) => docListeners.push({ type, capture }),
  removeEventListener: () => {},
}

// 让 useEffect 真的执行一次，这样组件挂载期注册的监听器能被观察到。
const effectCleanups = []
const runEffects = []

const reactStub = {
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
  },
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: (fn) => {
    runEffects.push(fn)
    const cleanup = fn()
    if (typeof cleanup === 'function') effectCleanups.push(cleanup)
  },
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  memo: (fn) => fn,
}

const reactDomStub = { createPortal: (children) => children }

const jsxRuntimeStub = {
  // 保留第三参（key）—— 真实运行时里它是 key，不是 children。
  jsx: (type, props, key) => ({ type, props, key }),
  jsxs: (type, props, key) => ({ type, props, key }),
  Fragment: Symbol('Fragment'),
}

const requireStub = (name) => {
  if (name === 'react') return reactStub
  if (name === 'react-dom') return reactDomStub
  if (name === 'react/jsx-runtime') return jsxRuntimeStub
  throw new Error('unexpected require: ' + name)
}

// ---------------------------------------------------------------- 1-3. 加载

console.log('— 加载期 —')

try {
  new Function('window', 'require', source)(globalThis.window, requireStub)
  check(true, 'factory 执行未抛错')
} catch (error) {
  check(false, 'factory 执行未抛错 —— ' + error.message)
}

check(loaded !== null, 'window.__ModuleLoader__.load 被调用')
if (loaded === null) {
  console.log('\n无法继续：bundle 没有注册到 ModuleLoader')
  process.exit(1)
}
check(loaded.id === 'dsh-quote-to-agent', `load id === "dsh-quote-to-agent"（实际 "${loaded.id}"）`)

const plugin = loaded.factory(requireStub)
check(typeof plugin.apply === 'function', 'exports.apply 是函数')
check(
  Array.isArray(plugin.inject) && plugin.inject.length === 1 && plugin.inject[0] === 'slots',
  `exports.inject === ["slots"]（实际 ${JSON.stringify(plugin.inject)}）`,
)

// ---------------------------------------------------------------- 4. 接线

console.log('\n— 接线（apply 到桩 ctx）—')

const slotRegistrations = []
const injectCalls = []

// 让 inject 面能真的跑起来：给 scope 挂可控的 sessions 桩。
let sessionSnapshot = { byId: {}, projectionsBySession: {} }
let bindingResult = undefined
// A′ 相关记录器
const draftWrites = []
const openedResources = []
const sessionsStub = {
  list: { getSnapshot: () => sessionSnapshot },
  binding: () => bindingResult,
  refreshProjections: () => Promise.resolve(),
  scope: () => ({}),
}

function makeScope(services) {
  return {
    services,
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale: { register: () => () => {}, bind: () => (key) => key },
    sessions: sessionsStub,
    sidebarRight: {
      openResource: (address, options) => openedResources.push({ address, options }),
    },
    conversation: {
      input: {
        for: () => ({
          state: { getSnapshot: () => ({ draft: '' }) },
          setDraft: (text) => draftWrites.push(text),
        }),
      },
    },
    slots: {
      inject: (key, cb) => {
        cb()
        return () => {}
      },
      register: (options, Component) => {
        slotRegistrations.push({ face: services.join('+'), options, Component })
        return () => {}
      },
    },
  }
}

const ctx = {
  effect: (fn) => {
    fn()
    return () => {}
  },
  locale: { register: () => () => {} },
  sessions: sessionsStub,
  slots: {
    inject: (key, cb) => {
      cb()
      return () => {}
    },
    register: (options, Component) => {
      slotRegistrations.push({ face: 'root', options, Component })
      return () => {}
    },
  },
  inject: (services, cb) => {
    injectCalls.push(services)
    cb(makeScope(services))
    return () => {}
  },
}

try {
  plugin.apply(ctx)
  check(true, 'apply(ctx) 未抛错')
} catch (error) {
  check(false, 'apply(ctx) 未抛错 —— ' + error.stack)
}

check(injectCalls.length >= 2, `ctx.inject 被调用 ${injectCalls.length} 次（期望 ≥2）`)
check(
  injectCalls.some((s) => s.length === 1 && s[0] === 'locale'),
  '等待了 locale 服务',
)
check(
  injectCalls.some(
    (s) =>
      s.includes('sessions') && s.includes('sidebarRight') && s.includes('uiWorkspace') && s.includes('conversation'),
  ),
  '动作条等待了 sessions/sidebarRight/uiWorkspace/conversation',
)

const bySlot = (name) => slotRegistrations.filter((r) => r.options.name === name)

const cards = bySlot('conversation.input.dock')
check(cards.length === 1, '注册了 conversation.input.dock（D2 锁定的落点）')
check(cards[0]?.options.id === 'quote-to-agent-cards', '引用条槽位给了自有 id（list 槽位必填）')
check(cards[0]?.options.locale === 'dsh-quote-to-agent', '引用条槽位声明了 locale 命名空间')

const overlay = bySlot('shell.overlay')
check(overlay.length === 1, '注册了 shell.overlay（划词动作条）')
check(overlay[0]?.options.id === 'quote-to-agent-actions', '动作条槽位给了自有 id')
check(typeof overlay[0]?.options.inject === 'function', '动作条声明了 inject 业务面')

let actions = null
try {
  actions = overlay[0].options.inject().actions
  for (const name of ['quoteTo', 'resolveContext', 'listTargets', 'refreshTargets', 'quoteToSub']) {
    check(typeof actions?.[name] === 'function', `inject 面提供 ${name}`)
  }
} catch (error) {
  check(false, 'inject 面可构造 —— ' + error.message)
}

// ---------------------------------------------------------------- 5. 目标解析

console.log('\n— 目标解析（两个投影的优先级）—')

const LEAD = 'session-lead'

if (actions !== null) {
  // 5a. 团队 teammate 优先
  sessionSnapshot = {
    byId: {},
    projectionsBySession: {
      [LEAD]: {
        state: 'ready',
        values: {
          agentTeam: {
            members: [
              { id: LEAD, name: 'lead', role: 'lead', phase: 'active' },
              { id: 'member-a', name: 'scout', role: 'teammate', phase: 'active' },
            ],
          },
          subagentCatalog: [{ id: 'child-x', createdAt: 1, mode: 'one-shot' }],
        },
      },
    },
  }
  let targets = actions.listTargets(LEAD)
  check(targets.source === 'team', `teammate 优先（实际 source=${targets.source}）`)
  check(targets.members.length === 1 && targets.members[0].id === 'member-a', '过滤掉了 lead 自己')
  check(targets.members[0]?.mode === 'continuable', 'teammate 标记为 continuable')

  // 5b. 只有 lead 时回落到 subagentCatalog  ← 真机上曾在这里误报"还没有子智能体"
  sessionSnapshot = {
    byId: {},
    projectionsBySession: {
      [LEAD]: {
        state: 'ready',
        values: {
          agentTeam: { members: [{ id: LEAD, name: 'lead', role: 'lead', phase: 'active' }] },
          subagentCatalog: [
            { id: 'child-x', createdAt: 1, mode: 'one-shot', label: 'Explorer' },
            { id: 'child-y', createdAt: 2, mode: 'continuable', label: 'Builder' },
          ],
        },
      },
    },
  }
  targets = actions.listTargets(LEAD)
  check(targets.source === 'subagent', `团队无成员时回落到 subagentCatalog（实际 source=${targets.source}）`)
  check(targets.members.length === 2, `列出 2 个普通子智能体（实际 ${targets.members.length}）`)
  check(targets.members[0]?.name === 'Explorer', '用了 label 作为显示名')
  check(targets.members[0]?.mode === 'one-shot', '保留了 one-shot 模式（用于只读提示）')

  // 5c. excludeId：在子智能体里引用时，"另一个子对话"不该列出自己
  targets = actions.listTargets(LEAD, 'child-x')
  check(targets.members.length === 1 && targets.members[0].id === 'child-y', 'excludeId 排除了当前子会话')

  // 5d. 两个投影都没有 → 空态
  sessionSnapshot = { byId: {}, projectionsBySession: { [LEAD]: { state: 'ready', values: {} } } }
  targets = actions.listTargets(LEAD)
  check(targets.members.length === 0 && targets.source === 'none', '无任何子会话时给出空态')

  // 5e. 目录懒加载中 → loading（据此触发 refreshProjections）
  sessionSnapshot = { byId: {}, projectionsBySession: { [LEAD]: { state: 'idle', values: {} } } }
  targets = actions.listTargets(LEAD)
  check(targets.loading === true, '目录未到位时标记 loading（据此触发 refreshProjections）')
}

// ---------------------------------------------------------------- 6. 上下文解析

console.log('\n— 上下文解析（决定显示两个还是三个动作）—')

if (actions !== null) {
  // 主对话：binding 拿不到 subagent 地址 → 就是 lead 自己
  bindingResult = undefined
  let context = actions.resolveContext(LEAD)
  check(context.isSubagent === false, '主对话里 isSubagent=false（两个动作）')
  check(context.lead === LEAD, '主对话的 lead 是自己')

  // 子智能体：binding 给出 parentSessionId → 是子会话
  bindingResult = {
    session: { getSnapshot: () => ({ subagent: { address: { parentSessionId: LEAD, childSessionId: 'child-y' } } }) },
  }
  context = actions.resolveContext('child-y')
  check(context.isSubagent === true, '子智能体里 isSubagent=true（三个动作）')
  check(context.lead === LEAD, '子智能体的 lead 反查正确')

  // 引用投放到指定会话
  const before = actions.listTargets(LEAD).members.length
  void before
  const result = actions.quoteTo(LEAD, {
    text: 'hello',
    sessionId: LEAD,
    rect: { left: 0, bottom: 0 },
  })
  check(result.ok === true, 'quoteTo 能把引用投放到指定会话')
  check(actions.quoteTo(undefined, { text: 'x' }).ok === false, 'quoteTo 缺目标会话时明确失败')
}

// ---------------------------------------------------------------- 7. 渲染

console.log('\n— 渲染（真实元素树）—')

if (actions !== null && plugin.__test !== undefined) {
  const { QuoteCards } = plugin.__test

  // 强制 useState 的布尔初值为 true，让"展开"态直接渲染出来
  reactStub.useState = (initial) => [
    typeof initial === 'boolean' ? true : typeof initial === 'function' ? initial() : initial,
    () => {},
  ]

  const S = 'session-render'
  const a = actions.quoteTo(S, { text: '第一条被引用的原文', sessionId: S, rect: { left: 0, bottom: 0 } })
  const b = actions.quoteTo(S, { text: '第二条被引用的原文', sessionId: S, rect: { left: 0, bottom: 0 } })
  check(a.ok === true && b.ok === true, '引子：两条引用已入 store')

  let tree = null
  try {
    tree = QuoteCards({
      sessionId: S,
      t: (key, params) => key + (params && params.count !== undefined ? ':' + params.count : ''),
      useInput: (selector) => selector({ draft: '' }),
      inputActions: { setDraft() {} },
    })
  } catch (error) {
    check(false, 'QuoteCards 可渲染 —— ' + error.stack)
  }

  const texts = []
  const collect = (node, onNode) => {
    if (node === null || node === undefined || node === false) return
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) collect(child, onNode)
      return
    }
    if (typeof node === 'object' && node.props !== undefined) {
      onNode(node)
      collect(node.props.children, onNode)
    }
  }

  const itemNodes = []
  collect(tree, (node) => {
    if (node.props.className === 'qdq_item') itemNodes.push(node)
  })
  const joined = texts.join(' | ')

  check(joined.includes('第一条被引用的原文'), '展开列表里出现第 1 条引用原文')
  check(joined.includes('第二条被引用的原文'), '展开列表里出现第 2 条引用原文')
  check(itemNodes.length === 2, `渲染出 2 个引用条目（实际 ${itemNodes.length}）`)
  // 这条断言就是真机 bug 的回归：第三参被当成 children 时，条目会渲染成空的
  check(
    itemNodes.every((node) => Array.isArray(node.props.children) && node.props.children.length === 2),
    '每个条目都有 children（原文 + 删除按钮）',
  )

  // 发送手势必须两条路都拦上：回车 与 点主发送按钮。
  // 只拦回车时，带图片的消息（用户更习惯点按钮）会漏掉引用。
  const listenerTypes = docListeners.map((entry) => entry.type)
  check(listenerTypes.includes('keydown'), '注册了「回车发送」的捕获监听')
  check(listenerTypes.includes('click'), '注册了「点发送按钮」的捕获监听')
  check(
    docListeners.filter((entry) => entry.capture === true).length >= 2,
    '两条发送手势都走捕获阶段（早于框架自己的处理）',
  )
}

// ---------------------------------------------------------------- 8. 序列化格式

console.log('\n— 序列化（模型看到的 = 记录里显示的，同一份文本）—')

if (plugin.__test !== undefined && typeof plugin.__test.formatQuoteBlock === 'function') {
  const block = plugin.__test.formatQuoteBlock([{ text: '第一条\n第二行' }, { text: '第二条' }])
  check(!block.includes('>'), '不使用 Markdown 的 ">"（用户消息不解析 Markdown，会显示成字面字符）')
  check(
    block.split('\n').every((line) => line.startsWith('❝ ') && line.endsWith(' ❞')),
    '每一行左右都有装饰引号（❝ … ❞）',
  )
  check(
    block.includes('❝ 第一条 ❞') && block.includes('❝ 第二行 ❞') && block.includes('❝ 第二条 ❞'),
    '多行引用与多条引用的内容都完整',
  )

  // 真机踩过的坑：被引用原文里若含 host 会解析的 wire form，整轮会失败
  // （SESSION_REFERENCE_INVALID_REFERENCE）。这里直接拿 host 的正则断言"产出物不命中"。
  const HOST_WIRE_RE =
    /@\[((?:\\.|[^\\\]])*)\]\((dsh-session:[^\s)]*)\)|(dsh-session:[A-Za-z0-9_-]+)/gu
  const dangerous = plugin.__test.formatQuoteBlock([
    { text: '看这个写法 @[label](dsh-session:…) 就是这样' },
    { text: '裸 URI 也一样 dsh-session:abc123' },
  ])
  HOST_WIRE_RE.lastIndex = 0
  check(!HOST_WIRE_RE.test(dangerous), '引用块不会命中 host 的 session-reference 正则（否则整轮失败）')
  check(
    dangerous.replace(/\u200B/gu, '').includes('dsh-session:…') &&
      dangerous.replace(/\u200B/gu, '').includes('dsh-session:abc123'),
    '中和用的是零宽字符，去掉后原文一字不差',
  )
}

// ---------------------------------------------------------------- 9. A′ 自动接续

console.log('\n— A′：没有子智能体时挂起派生 —')

if (actions !== null) {
  const S = 'session-prime'
  const sel = { text: '要派生的引用内容', sessionId: S, rect: { left: 0, bottom: 0 } }

  // 基线：这个会话还没有任何子会话
  sessionSnapshot = {
    byId: {},
    projectionsBySession: { [S]: { state: 'ready', values: { subagentCatalog: [] } } },
  }

  const staged = actions.stageSpawnForSubagent(sel, S)
  check(staged.ok === true, 'stageSpawnForSubagent 成功')
  check(
    draftWrites.length === 1 && draftWrites[0].includes('❝ 要派生的引用内容 ❞'),
    '派生指令 + 引用块写进了输入框',
  )
  check(actions.pendingSpawnCount() === 1, `挂起计数为 1（实际 ${actions.pendingSpawnCount()}）`)

  // 还没出现新子会话 → 不该投放，且挂起项要保留
  let resolved = actions.resolvePendingSpawns()
  check(resolved.delivered === 0, '没有新子会话时不投放')
  check(actions.pendingSpawnCount() === 1, '挂起项保留、继续等')

  // 模拟模型真的派生了子智能体
  sessionSnapshot = {
    byId: {},
    projectionsBySession: {
      [S]: {
        state: 'ready',
        values: { subagentCatalog: [{ id: 'child-new', createdAt: 1, mode: 'continuable', label: 'New' }] },
      },
    },
  }
  resolved = actions.resolvePendingSpawns()
  check(resolved.delivered === 1, `新子会话出现后自动投放（实际 ${resolved.delivered}）`)
  check(
    openedResources.length === 1 && openedResources[0].address.includes('child-new'),
    '自动在右栏打开了新子会话',
  )
  check(
    openedResources[0]?.options?.kind === 'subagentchat' && openedResources[0]?.options?.preferNewPane === true,
    '用的是官方 subagentchat tab + 新开一格',
  )
  check(actions.pendingSpawnCount() === 0, '挂起项已消费')

  // 回归：地址里的 mode 必须来自**真实投影**。
  // 写死成 continuable 时，one-shot 子会话会触发 subagent/unauthorized
  // （"subagent mode does not match the supplied address"）。
  openedResources.length = 0
  sessionSnapshot = {
    byId: {},
    projectionsBySession: { [S]: { state: 'ready', values: { subagentCatalog: [] } } },
  }
  actions.stageSpawnForSubagent(sel, S, (key) => key)
  sessionSnapshot = {
    byId: {},
    projectionsBySession: {
      [S]: {
        state: 'ready',
        values: { subagentCatalog: [{ id: 'child-oneshot', createdAt: 1, mode: 'one-shot', label: 'OS' }] },
      },
    },
  }
  resolved = actions.resolvePendingSpawns()
  check(
    openedResources.length === 1 && openedResources[0].address.includes('mode=one-shot'),
    '地址里用的是投影给出的真实 mode（one-shot），不是写死的 continuable',
  )
  check(resolved.delivered === 0, 'one-shot 子会话不投放引用（它不接受后续消息）')

  // 查不到 mode 时必须退到 'unknown' —— host 只在 mode 是具体值时才比对
  const { childModeOf, subagentChatAddress } = plugin.__test
  sessionSnapshot = { byId: {}, projectionsBySession: {} }
  check(childModeOf(sessionsStub, S, 'nope') === 'unknown', '投影里查不到的子会话返回 unknown')
  check(
    subagentChatAddress('c', 'p', undefined).includes('mode=unknown'),
    'mode 缺省时地址写 unknown（host 会跳过比对）',
  )

  // 回归：作用域拿不到时必须**返回失败**，而不是抛异常。
  // 抛异常会被 ErrorBoundary 吞掉，表现就是"点了没反应"。
  const savedScope = sessionsStub.scope
  sessionsStub.scope = () => undefined
  let failed = null
  try {
    failed = actions.stageSpawnForSubagent(sel, S)
  } catch (error) {
    check(false, '拿不到会话作用域时不应抛错 —— ' + error.message)
  }
  check(
    failed !== null && failed.ok === false && typeof failed.reason === 'string',
    '拿不到会话作用域时返回 {ok:false, reason}（不抛错）',
  )
  sessionsStub.scope = savedScope

  // 文案由调用方传入（不用 ctx.locale —— actions 所在 scope 不保证带 locale 面）
  draftWrites.length = 0
  const stagedWithT = actions.stageSpawnForSubagent(sel, S, (key) => '<' + key + '>')
  check(
    stagedWithT.ok === true && draftWrites[0].startsWith('<spawn.instruction>'),
    '使用调用方传入的 t，而不是从 scope 取 locale',
  )
  actions.resolvePendingSpawns()
}

// ---------------------------------------------------------------- 报告

console.log('')
if (problems.length === 0) {
  console.log('✅ 冒烟测试全部通过')
  process.exit(0)
}
console.log(`❌ ${problems.length} 项未通过`)
process.exit(1)
