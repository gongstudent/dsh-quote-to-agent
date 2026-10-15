/**
 * dsh-quote-to-agent — 浏览器半边。
 *
 * 交互：在会话记录里划词 → 浮出动作
 *   - 在主对话里划词：两个动作（引用到当前对话 / 引用到子对话）
 *   - 在子智能体对话里划词：三个动作（引用到主对话 / 引用到当前对话 / 引用到另一个子对话）
 *   引用落到目标会话输入框最左侧正上方的横向引用条，发送时自动拼进消息。
 *   目标会话不存在子智能体时，挂起引用 + 写派生指令，新子会话一出现就自动接续。
 *
 * 设计决策 D1/D2/D3 与全部接口锚点见 ../需求文档.md。
 *
 * ⚠️ 已知脆弱点（需求文档里标了风险）：
 *   - 划词检测依赖非官方 DOM 锚点（框架没有消息选区 API）
 *   - 发送时注入依赖 DOM 捕获阶段拦截（框架没有"发送前"钩子，见 §6.9）
 */
window.__ModuleLoader__.load({
  id: 'dsh-quote-to-agent',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const jsxRuntime = require('react/jsx-runtime')
    const jsx = jsxRuntime.jsx
    const jsxs = jsxRuntime.jsxs

    // =====================================================================
    // 1. 常量
    // =====================================================================

    const PKG = 'dsh-quote-to-agent'
    const NS = 'dsh-quote-to-agent'

    const CARD_SLOT_ID = 'quote-to-agent-cards'
    const OVERLAY_SLOT_ID = 'quote-to-agent-actions'
    const STYLE_TAG_ID = PKG + '/styles.css'

    /** 选区合法性判定用的 DOM 锚点（0.2.0-rc.2 已核实，需求文档 §6.3）。非官方约定。 */
    const ANCHOR_TRANSCRIPT = '[data-conversation-scroll]'
    const ANCHOR_CONTENT = '[data-conversation-content]'
    const ANCHOR_COMPOSER_SEAT = '[data-composer-seat]'
    const ANCHOR_COMPOSER_CARD = '[data-composer-card]'
    const ANCHOR_FLOW_KEY = '[data-chat-flow-key]'
    const ANCHOR_FLOW_KIND = '[data-chat-flow-kind]'

    /** 官方右侧子会话面板（需求文档 §6.1）。 */
    const SUBAGENT_CHAT_KIND = 'subagentchat'
    const SUBAGENT_CHAT_PREFIX = 'dsh-resource://subagentchat/session/'

    const MAX_QUOTE_CHARS = 2000

    /**
     * 构建标记。**不再渲染到界面上**，只通过 `exports.__test.build` 暴露，
     * 供"浏览器里跑的到底是不是这份代码"这类排查使用。
     */
    const BUILD = 'v1.18'

    // =====================================================================
    // 2. i18n（中英 key 集合必须严格相等）
    // =====================================================================

    const zh = {
      'action.quoteToLead': '引用到主对话',
      'action.quoteToHere': '引用到当前对话',
      'action.quoteToSub': '引用到子对话',
      'action.quoteToOther': '引用到另一个子对话',
      'action.barAria': '引用选中的内容',
      'card.count': '{count} 条引用',
      'card.remove': '删除这条引用',
      'card.truncated': '（已截断）',
      'pick.title': '选择要引用的子智能体',
      'pick.empty': '当前会话还没有子智能体',
      'pick.emptyHint': '点下面的按钮，插件会把「派生一个子智能体处理这段引用」写进输入框；发送后子智能体会自动在右侧打开。',
      'pick.spawn': '派生一个子智能体',
      'pick.loading': '正在读取子智能体列表…',
      'pick.sourceTeam': '团队成员',
      'pick.sourceSubagent': '子智能体',
      'pick.readonly': '只读',
      'spawn.instruction':
        '请派生一个子智能体来处理下面这段引用，用后台模式运行（不要等它出结果）—— 这样它是一个可以继续对话的子会话：',
      'spawn.staged': '已把派生指令写进输入框，发送后子智能体会自动在右侧打开。',
      'spawn.failed': '写不进输入框（会话作用域不可用），请手动让主智能体派生一个。',
      'spawn.timeout': '等了 {minutes} 分钟没等到新的子智能体，已放弃这条挂起的引用。',
      'error.selection': '引用失败：读不到有效的选中内容。',
      'error.dispatch': '打开子智能体会话失败：{reason}',
      'error.oneshot': '{name} 是一次性任务，不支持后续消息，引用未送出。',
    }

    const en = {
      'action.quoteToLead': 'Quote into the main chat',
      'action.quoteToHere': 'Quote into this chat',
      'action.quoteToSub': 'Quote into a subagent',
      'action.quoteToOther': 'Quote into another subagent',
      'action.barAria': 'Quote the selected text',
      'card.count': '{count} quotes',
      'card.remove': 'Remove this quote',
      'card.truncated': ' (truncated)',
      'pick.title': 'Pick a subagent to quote into',
      'pick.empty': 'This chat has no subagents yet',
      'pick.emptyHint':
        'Use the button below: the plugin writes a "spawn a subagent for this quote" instruction into the composer, and opens the new subagent on the right once it appears.',
      'pick.spawn': 'Spawn a subagent',
      'pick.loading': 'Loading subagents…',
      'pick.sourceTeam': 'Team member',
      'pick.sourceSubagent': 'Subagent',
      'pick.readonly': 'read-only',
      'spawn.instruction':
        'Spawn a subagent for the quoted text below, running it in the background (do not wait for its result) so it stays a sub-conversation I can keep talking to:',
      'spawn.staged': 'Spawn instruction written into the composer; the new subagent opens on the right once sent.',
      'spawn.failed': 'Could not write into the composer (session scope unavailable); ask the main agent to spawn one.',
      'spawn.timeout': 'No new subagent appeared within {minutes} minutes; the pending quote was dropped.',
      'error.selection': 'Quote failed: no usable selection.',
      'error.dispatch': 'Could not open the subagent chat: {reason}',
      'error.oneshot': '{name} is a one-shot task and takes no follow-ups; the quote was not sent.',
    }

    // =====================================================================
    // 3. 样式
    // =====================================================================

    // 每个 var() 都带字面量兜底：变量被移除时 var() 不回落，整条声明会失效。
    // 浮层一律「半透明底 + backdrop-filter」，缺了 blur 就会糊在会话内容上看不清。
    const MENU_BG = 'var(--dsw-specific-menu, rgba(248,248,248,.94))'
    const MENU_BG_DARK = 'var(--dsw-specific-menu, rgba(34,34,34,.94))'
    const MENU_BLUR = 'var(--dsw-menu-backdrop-filter, blur(18px) saturate(1.4))'

    const CSS = [
      // --- 引用条：输入框最左侧正上方，横向圆角矩形 ---
      // 承载行复用官方 composer 布局变量，算出与输入框等宽等位的盒子，内部再靠左。
      '.qdq_row{box-sizing:border-box;',
      'width:calc(100% - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-side-clearance,0px)',
      ' - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px)',
      ' - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));',
      'max-width:calc(var(--dsh-composer-card-max-width,100%)',
      ' - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px)',
      ' - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));',
      'margin:0 auto;padding:0 0 4px 0;display:flex;flex-direction:column;align-items:flex-start;',
      'pointer-events:auto}',
      '.qdq_pill{display:inline-flex;align-items:center;gap:8px;height:30px;max-width:100%;',
      'padding:0 10px;border-radius:var(--dsw-radius-md,10px);cursor:pointer;',
      'background:', MENU_BG, ';backdrop-filter:', MENU_BLUR, ';',
      'box-shadow:var(--dsw-elevation-panel,0 1px 3px rgba(0,0,0,.12));',
      'color:var(--dsw-alias-label-secondary,inherit);font-size:12px;line-height:18px}',
      'body[data-ds-dark-theme] .qdq_pill{background:', MENU_BG_DARK, '}',
      '.qdq_pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
      '.qdq_count{flex:none;color:var(--dsw-alias-label-tertiary,inherit)}',
      '.qdq_preview{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.qdq_lead{flex:none;color:var(--dsw-alias-label-tertiary,inherit);display:grid;place-items:center}',
      '.qdq_chev{flex:none;color:var(--dsw-alias-label-tertiary,inherit);display:grid;place-items:center;',
      'transition:transform .12s}',
      '.qdq_chev[data-open=true]{transform:rotate(180deg)}',

      // 展开的引用列表：**文档流内**就地展开（不 portal、不 fixed）。
      // 之前两轮用 portal + position:fixed 都没显示出来，改成流内展开后
      // 只要胶囊能渲染，列表就一定能渲染 —— 物理上不可能被裁掉。
      '.qdq_pop{box-sizing:border-box;width:100%;max-width:100%;margin-top:6px;',
      'max-height:min(46vh,320px);overflow-y:auto;padding:6px;',
      'border-radius:var(--dsw-radius-lg,12px);',
      'background:', MENU_BG, ';backdrop-filter:', MENU_BLUR, ';',
      'box-shadow:var(--dsw-elevation-panel,0 2px 10px rgba(0,0,0,.16));',
      'border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.20))}',
      'body[data-ds-dark-theme] .qdq_pop{background:', MENU_BG_DARK, '}',
      '.qdq_item{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;',
      'border-radius:var(--dsw-radius-sm,6px)}',
      '.qdq_item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
      '.qdq_itemText{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;',
      'color:var(--dsw-alias-label-secondary,inherit);font-size:12px;line-height:18px}',
      '.qdq_remove{flex:none;display:grid;place-items:center;width:20px;height:20px;padding:0;',
      'border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;cursor:pointer;',
      'color:var(--dsw-alias-label-tertiary,inherit)}',
      '.qdq_remove:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));',
      'color:var(--dsw-alias-label-primary,inherit)}',

      // --- 划词动作条：全框浮层，自己 opt-in pointer-events ---
      '.qdq_bar{position:fixed;z-index:80;display:flex;align-items:center;gap:2px;padding:3px;',
      'border-radius:var(--dsw-radius-md,10px);pointer-events:auto;',
      'background:', MENU_BG, ';backdrop-filter:', MENU_BLUR, ';',
      'box-shadow:var(--dsw-elevation-prominent,0 6px 20px rgba(0,0,0,.20));',
      'border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.20))}',
      'body[data-ds-dark-theme] .qdq_bar{background:', MENU_BG_DARK, '}',
      '.qdq_action{display:inline-flex;align-items:center;height:28px;padding:0 10px;',
      'border:0;border-radius:var(--dsw-radius-sm,6px);background:0 0;cursor:pointer;',
      'color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:20px;white-space:nowrap}',
      '.qdq_action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',

      // --- 子智能体选择器 ---
      '.qdq_picker{position:fixed;z-index:85;box-sizing:border-box;',
      'min-width:280px;max-width:min(420px,92vw);max-height:52vh;overflow-y:auto;',
      'padding:6px;border-radius:var(--dsw-radius-lg,12px);pointer-events:auto;',
      'background:', MENU_BG, ';backdrop-filter:', MENU_BLUR, ';',
      'box-shadow:var(--dsw-elevation-prominent,0 8px 28px rgba(0,0,0,.22));',
      'border:.5px solid var(--dsw-alias-border-l1,rgba(127,127,127,.20))}',
      'body[data-ds-dark-theme] .qdq_picker{background:', MENU_BG_DARK, '}',
      '.qdq_pickerTitle{padding:4px 8px 6px 8px;color:var(--dsw-alias-label-tertiary,inherit);',
      'font-size:12px;line-height:18px}',
      '.qdq_pickerRow{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:0;',
      'border-radius:var(--dsw-radius-sm,6px);background:0 0;cursor:pointer;text-align:left;',
      'color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:20px}',
      '.qdq_pickerRow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
      '.qdq_phase{flex:none;width:6px;height:6px;border-radius:50%;',
      'background:var(--dsw-alias-label-tertiary,currentColor)}',
      '.qdq_phase[data-phase=active]{background:var(--dsw-alias-state-business-primary,#3b82f6)}',
      '.qdq_phase[data-phase=failed]{background:var(--dsw-alias-state-error-primary,#ef4444)}',
      '.qdq_tag{flex:none;color:var(--dsw-alias-label-tertiary,inherit);font-size:11px}',
      '.qdq_empty{padding:6px 8px;color:var(--dsw-alias-label-tertiary,inherit);',
      'font-size:12px;line-height:18px}',
      '.qdq_error{padding:6px 8px;color:var(--dsw-alias-state-error-primary,#ef4444);',
      'font-size:12px;line-height:18px;word-break:break-word}',
    ].join('')

    function ensureStyles() {
      if (typeof document === 'undefined') return
      const selector = 'style[data-plugin-css=' + JSON.stringify(STYLE_TAG_ID) + ']'
      const existing = document.querySelector(selector)
      // 按内容比对，不只按 id：client HMR 会不刷新页面换掉代码。
      if (existing !== null && existing.textContent === CSS) return
      const tag = existing !== null ? existing : document.createElement('style')
      tag.dataset.plugin = PKG
      tag.dataset.pluginCss = STYLE_TAG_ID
      tag.textContent = CSS
      if (existing === null && document.head !== null) document.head.appendChild(tag)
    }

    // =====================================================================
    // 4. 引用列表（按会话 id 键控；D3：引用不进草稿文本）
    // =====================================================================

    const EMPTY_LIST = []

    const quoteStore = (() => {
      const bySession = new Map()
      const listeners = new Map()
      let seq = 0

      const emit = (sessionId) => {
        const set = listeners.get(sessionId)
        if (set === undefined) return
        for (const fn of Array.from(set)) {
          try {
            fn()
          } catch (error) {
            console.error('[' + PKG + '] quote listener failed', error)
          }
        }
      }

      return {
        list(sessionId) {
          return bySession.get(sessionId) ?? EMPTY_LIST
        },
        add(sessionId, item) {
          const next = (bySession.get(sessionId) ?? EMPTY_LIST).concat([{ ...item, id: 'q' + ++seq }])
          bySession.set(sessionId, next)
          emit(sessionId)
          return next[next.length - 1]
        },
        remove(sessionId, id) {
          const current = bySession.get(sessionId) ?? EMPTY_LIST
          bySession.set(sessionId, current.filter((q) => q.id !== id))
          emit(sessionId)
        },
        clear(sessionId) {
          bySession.set(sessionId, EMPTY_LIST)
          emit(sessionId)
        },
        subscribe(sessionId, fn) {
          let set = listeners.get(sessionId)
          if (set === undefined) {
            set = new Set()
            listeners.set(sessionId, set)
          }
          set.add(fn)
          return () => {
            set.delete(fn)
            if (set.size === 0) listeners.delete(sessionId)
          }
        },
      }
    })()

    /** 订阅某个会话的引用列表。hook 必须在任何 early return 之前调用。 */
    function useQuotes(sessionId) {
      const [items, setItems] = React.useState(() => quoteStore.list(sessionId))
      React.useEffect(() => {
        setItems(quoteStore.list(sessionId))
        return quoteStore.subscribe(sessionId, () => setItems(quoteStore.list(sessionId)))
      }, [sessionId])
      return items
    }

    // =====================================================================
    // 5. 划词检测（唯一的非官方 DOM 依赖，封装在此模块内）
    // =====================================================================

    /**
     * 「挂起的派生」——A′ 方案的状态。
     *
     * 客户端插件**没有**创建子智能体的能力（客户端 `sessions` 契约里没有任何
     * create/spawn，客户端 catalog 里 subagent 声明为 0 条；全仓 `subagent/*`
     * 事件也全是观测性的）。创建要 `ctx.subagents.start(name, { parent: Agent })`，
     * 而 `Agent` 是 host 侧运行时对象，浏览器拿不到。
     *
     * 所以做法是：把「请派生一个子智能体处理这段引用」写进输入框，让**主对话的模型**
     * 去调 `subagent` 工具；同时在这里挂起这条引用，盯着 `subagentCatalog`，
     * 一旦出现新子会话就自动在右栏打开并投放引用。
     *
     * key 是 lead 会话 id，value 是 `{ quote, knownIds, at }`。
     */
    const PENDING_SPAWN_TTL_MS = 5 * 60 * 1000

    const spawnStore = (() => {
      const pending = new Map()
      return {
        stage(lead, quote, knownIds) {
          pending.set(lead, { quote, knownIds: new Set(knownIds), at: Date.now() })
        },
        take(lead) {
          const entry = pending.get(lead)
          pending.delete(lead)
          return entry
        },
        leads() {
          return Array.from(pending.keys())
        },
        /** 过期清理：不依赖定时器，每次被读取时顺手判断。 */
        expired(lead) {
          const entry = pending.get(lead)
          if (entry === undefined) return false
          if (Date.now() - entry.at < PENDING_SPAWN_TTL_MS) return false
          pending.delete(lead)
          return true
        },
        size() {
          return pending.size
        },
      }
    })()

    function elementOf(node) {
      if (node === null || node === undefined) return null
      if (node.nodeType === 1) return node
      return node.parentElement ?? null
    }

    /**
     * 读取一次合法选区。
     * 合法性：起点与终点都在同一个会话记录区内，且都不在输入框座位内。
     */
    function readSelection() {
      if (typeof window === 'undefined') return null
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
      const text = selection.toString().trim()
      if (text === '') return null

      const range = selection.getRangeAt(0)
      const startEl = elementOf(range.startContainer)
      const endEl = elementOf(range.endContainer)
      if (startEl === null || endEl === null) return null

      const transcript = startEl.closest(ANCHOR_TRANSCRIPT)
      if (transcript === null || endEl.closest(ANCHOR_TRANSCRIPT) !== transcript) return null
      if (startEl.closest(ANCHOR_COMPOSER_SEAT) !== null) return null

      const content = transcript.closest(ANCHOR_CONTENT) ?? transcript
      const flowEl = startEl.closest(ANCHOR_FLOW_KEY)
      const kindEl = startEl.closest(ANCHOR_FLOW_KIND)

      return {
        text,
        rect: range.getBoundingClientRect(),
        sessionId: content.getAttribute('data-conversation-session') ?? undefined,
        flowKey: flowEl?.getAttribute('data-chat-flow-key') ?? undefined,
        flowKind: kindEl?.getAttribute('data-chat-flow-kind') ?? undefined,
      }
    }

    /** 把选区快照成待引用的数据（FR-7.2 截断）。 */
    function toQuoteItem(selection) {
      const raw = selection.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      const truncated = raw.length > MAX_QUOTE_CHARS
      const text = truncated ? raw.slice(0, MAX_QUOTE_CHARS) : raw
      const firstLine = text.split('\n', 1)[0]
      return {
        text,
        truncated,
        preview: firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine,
        sourceSessionId: selection.sessionId,
        sourceFlowKey: selection.flowKey,
        role: selection.flowKind,
        createdAt: Date.now(),
      }
    }

    // =====================================================================
    // 6. 子会话目标解析（需求文档 §6.2）
    // =====================================================================

    /** 从任意会话反查它所属的 lead（官方写法，§6.2）。 */
    function leadSessionIdOf(sessions, sessionId) {
      const binding = sessions.binding(sessionId)
      const address = binding?.session?.getSnapshot?.()?.subagent?.address
      return address?.parentSessionId ?? sessionId
    }

    /**
     * 列出可引用的子会话目标。两个投影都读，按优先级取：
     *   1. `agentTeam` 的 teammate —— 需求原意（"智能体团队中的子智能体"）
     *   2. `subagentCatalog` 的普通子智能体 —— 主智能体派生出来的那些
     *
     * 二者是不同的投影：agentTeam 只覆盖团队 roster，普通 subagent 不在里面。
     */
    function listTargets(sessions, sessionId, excludeId) {
      const lead = leadSessionIdOf(sessions, sessionId)
      let snapshot
      try {
        snapshot = sessions.list.getSnapshot()
      } catch (error) {
        console.error('[' + PKG + '] sessions.list snapshot failed', error)
        return { lead, source: 'none', members: EMPTY_LIST, loading: false }
      }

      const per = snapshot?.projectionsBySession?.[lead]
      const values = per?.values ?? {}

      const drop = (list) => (excludeId === undefined ? list : list.filter((m) => m.id !== excludeId))

      const team = values.agentTeam
      if (team !== undefined && team !== null) {
        const members = drop(
          (team.members ?? EMPTY_LIST)
            .filter((member) => member.role !== 'lead')
            .map((member) => ({
              id: member.id,
              name: member.name,
              phase: member.phase,
              mode: 'continuable',
              source: 'team',
            })),
        )
        if (members.length > 0) return { lead, source: 'team', members, loading: false }
      }

      const catalog = values.subagentCatalog
      if (Array.isArray(catalog)) {
        const members = drop(
          catalog
            .filter((entry) => entry.kind !== 'diagnostic')
            .map((entry) => ({
              id: entry.id,
              name: entry.label ?? entry.id,
              phase: 'active',
              mode: entry.mode ?? 'unknown',
              source: 'subagent',
            })),
        )
        return { lead, source: 'subagent', members, loading: false }
      }

      const loading = per !== undefined && (per.state === undefined || per.state === 'idle' || per.state === 'loading')
      return { lead, source: 'none', members: EMPTY_LIST, loading }
    }

    /**
     * 列出 lead 下**所有**子会话 id（两个投影都算）。
     * 「挂起派生」时用它记录基线：之后出现的不在基线里的 id 就是新派生的子智能体。
     */
    function childIdsOf(sessions, lead) {
      let snapshot
      try {
        snapshot = sessions.list.getSnapshot()
      } catch (error) {
        return EMPTY_LIST
      }
      const values = snapshot?.projectionsBySession?.[lead]?.values ?? {}
      const ids = []
      const team = values.agentTeam
      if (team !== undefined && team !== null) {
        for (const member of team.members ?? EMPTY_LIST) {
          if (member.role !== 'lead') ids.push(member.id)
        }
      }
      const catalog = values.subagentCatalog
      if (Array.isArray(catalog)) {
        for (const entry of catalog) {
          if (entry.kind !== 'diagnostic') ids.push(entry.id)
        }
      }
      return ids
    }

    /**
     * 查某个子会话**真实**的 mode。
     *
     * ⚠️ host 会拿地址里的 mode 和真实 mode 比对：
     * ```js
     * // dsh-api-session-controller：validateAddress
     * if (address.mode !== "unknown" && identity.mode !== address.mode)
     *   throw new RemoteError("subagent/unauthorized", "subagent mode does not match the supplied address")
     * ```
     * 也就是说 **`'unknown'` 永远被接受**（检查直接跳过），写错具体的 mode 才会被拒。
     * 真机上踩过一次：A′ 自动打开路径把 mode 写死成 `'continuable'`，而模型用 `subagent`
     * 工具派生的多半是 one-shot → 历史加载失败（`subagent/unauthorized`）。
     *
     * @returns {'one-shot'|'continuable'|'unknown'} 查不到就返回 `'unknown'`（安全值）
     */
    function childModeOf(sessions, lead, childId) {
      let snapshot
      try {
        snapshot = sessions.list.getSnapshot()
      } catch (error) {
        return 'unknown'
      }
      const values = snapshot?.projectionsBySession?.[lead]?.values ?? {}

      // teammate 一定是可继续子会话
      const team = values.agentTeam
      if (team !== undefined && team !== null) {
        for (const member of team.members ?? EMPTY_LIST) {
          if (member.id === childId && member.role !== 'lead') return 'continuable'
        }
      }

      const catalog = values.subagentCatalog
      if (Array.isArray(catalog)) {
        for (const entry of catalog) {
          if (entry.id === childId) return entry.mode ?? 'unknown'
        }
      }
      return 'unknown'
    }

    /** 构造官方右侧子会话资源地址（§6.1）。 */
    function subagentChatAddress(childSessionId, parentSessionId, mode) {
      const query = new URLSearchParams({ parent: parentSessionId, mode: mode ?? 'unknown' })
      return SUBAGENT_CHAT_PREFIX + encodeURIComponent(childSessionId) + '?' + query.toString()
    }

    // =====================================================================
    // 7. 序列化（FR-6）
    // =====================================================================

    /**
     * 中和引用文本里的 host wire form（v1.12）。
     *
     * ⚠️ **为什么必须做**：host 在 `agent/pre-step` 会对**每条用户输入**跑
     * `parseSessionReferenceText`（`dsh-session-reference`），用这个正则匹配两类东西：
     *
     * ```js
     * /@\[((?:\\.|[^\\\]])*)\]\((dsh-session:[^\s)]*)\)|(dsh-session:[A-Za-z0-9_-]+)/gu
     * ```
     *
     * 命中后交给 `decodeSessionReferenceUri`；只要不是规范的 base64url 会话 id，
     * 就抛 `SESSION_REFERENCE_INVALID_REFERENCE`，**整轮失败**（fail-loud，不静默降级）。
     *
     * 所以被引用的原文里若含这种文本（例如别人解释这个语法时写的示例），
     * 直接透传会让发送失败。**真机上踩过一次**（引用了含 `@[label](dsh-session:…)` 的消息）。
     *
     * 处理：在 `dsh-session` 与冒号之间插一个零宽空格，破坏字面量、正则不再命中。
     * 零宽不可见，视觉与模型可读性都不受影响。
     *
     * 范围：`dsh-session:` 是**唯一**会被 host 从 prompt 文本里解析的 wire form；
     * `dsh-app:` / `dsh-css:` / `dsh-resource:` / `dsh-scope:` / `dsh-tools:` 都是内部标识，
     * 不参与 prompt 解析，所以不碰（避免无谓地改动被引用的代码原文）。
     */
    function neutralizeWireForms(text) {
      return text.replace(/dsh-session:/gu, 'dsh-session\u200B:')
    }

    /**
     * 引用块序列化（FR-6，v1.11 修订）。
     *
     * 每行**左右都有**装饰引号：`❝ 正文 ❞`（`❝` U+275D / `❞` U+275E 是成对的
     * heavy double quotation mark ornament）。这样在纯文本气泡里，引用的边界一眼可见。
     *
     * **为什么不用 Markdown 的 `> `**：DSH 的用户消息**不走 Markdown 渲染** ——
     * `UserStyleBubble` 的正文是 `projectUserText(...)`，它只把文本切成纯文本 span、
     * 把 mention 换成芯片，完全不解析 Markdown。所以 `> ` 会在会话记录里显示成
     * **字面的 `>` 字符**。
     *
     * ⚠️ 这份文本**同时**是模型看到的输入和记录里显示的正文，两者是同一份，
     * 无法分开设计（需求文档 FR-6 有说明）。
     */
    function formatQuoteBlock(items) {
      return items
        .map((item) =>
          neutralizeWireForms(item.text)
            .split('\n')
            .map((line) => '❝ ' + line + ' ❞')
            .join('\n'),
        )
        .join('\n')
    }

    // =====================================================================
    // 8. 发送时注入（D3 的实现义务 2；风险最高的一处，见 §6.9）
    // =====================================================================

    /**
     * 主发送按钮（发送 / 停止共用一个按钮）。
     *
     * 类名 `RlGAzG_primary` 里的哈希前缀随版本变，但 `_primary` 是 CSS Module 的命名约定，
     * 所以用 `[class*="_primary"]` 定位。**这是非官方锚点**，与划词那批同类风险。
     */
    const ANCHOR_PRIMARY_BUTTON = ANCHOR_COMPOSER_CARD + ' button[class*="_primary"]'

    /**
     * 某个会话的**会话容器**。
     *
     * ⚠️ 为什么必须按会话限定：右栏打开子会话后，DOM 里会**同时存在两个 composer**
     * （主对话一个、子会话一个），`document.querySelector` 只会拿到**第一个**
     * —— 通常是主对话那个。真机踩过：主对话的发送按钮是禁用状态（草稿空），
     * 于是子会话的发送被判成"禁用"而跳过注入，**第一次发送丢了引用**，
     * 第二次才带上（那时主对话的状态变了）。
     *
     * 用 `querySelectorAll` 逐个比对属性，而不是拼选择器 —— 避免会话 id 里的特殊字符
     * 破坏 CSS 选择器语法。
     */
    function conversationRootOf(sessionId) {
      if (typeof document === 'undefined' || sessionId === undefined || sessionId === null) return null
      const all = document.querySelectorAll('[data-conversation-content][data-conversation-session]')
      for (const node of all) {
        if (node.getAttribute('data-conversation-session') === sessionId) return node
      }
      return null
    }

    /** 元素是否属于该会话的会话容器。多分栏时用来排除别的会话。 */
    function belongsToSession(element, sessionId) {
      const root = conversationRootOf(sessionId)
      if (root === null) return false
      return root.contains(element)
    }

    /**
     * **本会话**的发送按钮此刻是否被禁用。
     *
     * 用途：图片还在上传（`uploadsPending`）时，回车的提交会被框架挡下并弹
     * "文件仍在上传"。此时如果照样把引用拼进草稿，就会出现「引用进了输入框但消息没发出去」，
     * 而且下一次回车会再拼一遍。所以先看按钮禁用状态，禁用就干脆不注入。
     *
     * ⚠️ 找不到本会话容器时返回 `false`（fail-open）：宁可注入也不静默跳过 ——
     * 静默跳过正是上面那个"第一次发送丢引用"的症状。
     */
    function primaryButtonDisabled(sessionId) {
      const root = conversationRootOf(sessionId)
      if (root === null) return false
      const button = root.querySelector(ANCHOR_PRIMARY_BUTTON)
      return button !== null && button.disabled === true
    }

    /**
     * 在发送手势的**捕获阶段**把引用拼进草稿。
     *
     * 框架没有"发送前"钩子：`matchEnter` 只在草稿以 `/` 或 `@` 开头时轮询；
     * 没有 submit 类 cordis 事件；`conversation.composer` chain 是整条编辑器接管链。
     * 所以只能拦**两条**发送手势：
     *   ① 回车（keydown）
     *   ② 点主发送按钮（click）—— 带图片时用户更常点按钮，只拦回车会漏
     *
     * 捕获阶段监听在 document 上，早于 React 在根容器上的冒泡处理。
     * ⚠️ 两条路都必须先用 `belongsToSession` 排除**别的会话**的 composer。
     */
    function useSubmitInjection(sessionId, inputActions, draftRef, hasContentRef, onInjected) {
      React.useEffect(() => {
        if (inputActions === undefined) return undefined

        // 记录上一次注入的引用块，避免重复拼接：
        // 例如上传未完成导致提交被挡，用户再按一次回车时草稿里已经有引用块了。
        let injectedBlock = null

        const inject = () => {
          const items = quoteStore.list(sessionId)
          if (items.length === 0) return
          if (primaryButtonDisabled(sessionId)) return

          const block = formatQuoteBlock(items)
          const draft = draftRef.current ?? ''
          if (injectedBlock !== null && draft.startsWith(injectedBlock)) return

          injectedBlock = block
          inputActions.setDraft(draft.trim() === '' ? block + '\n' : block + '\n\n' + draft)
          onInjected()
        }

        const onKeyDown = (event) => {
          if (event.key !== 'Enter' || event.shiftKey) return
          if (event.isComposing || event.keyCode === 229) return
          const target = event.target
          if (!(target instanceof Element)) return
          const card = target.closest(ANCHOR_COMPOSER_CARD)
          if (card === null) return
          // 多分栏时只认本会话的 composer
          if (!belongsToSession(card, sessionId)) return
          inject()
        }

        const onClick = (event) => {
          const target = event.target
          if (!(target instanceof Element)) return
          // 只在点中主发送按钮时注入（停止按钮也是它，但那种情况草稿不会被提交）
          const button = target.closest(ANCHOR_PRIMARY_BUTTON)
          if (button === null) return
          // 多分栏时只认本会话的发送按钮
          if (!belongsToSession(button, sessionId)) return
          // 草稿空且无附件时，启用中的主按钮其实是「停止」（发送会被 empty 禁用）——别注入
          if (!hasContentRef.current) return
          inject()
        }

        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('click', onClick, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('click', onClick, true)
        }
      }, [sessionId, inputActions, draftRef, hasContentRef, onInjected])
    }

    /**
     * 引用清空时机（FR-3.9：发送失败时引用不能丢）。
     * 发送成功时输入机会把草稿清空 —— 以此作为"引用已送出"的唯一信号。
     */
    function useQuoteRetirement(sessionId, draft, itemCount, injectedRef) {
      React.useEffect(() => {
        if (draft === '' && itemCount > 0 && injectedRef.current) {
          injectedRef.current = false
          quoteStore.clear(sessionId)
        }
      }, [sessionId, draft, itemCount, injectedRef])
    }

    // =====================================================================
    // 9. 右侧打开子会话（FR-4）
    // =====================================================================

    /**
     * 在右侧**新开一格**打开子智能体会话。
     *
     * 右侧是加法式的：主对话与子会话同屏，分隔条可拖动（官方限定 20%～80%），
     * 这就是「主/子智能体同时存在 + 自由划分区域」。
     *
     * 引用不写进子会话的草稿文本，而是放进**子会话自己的引用列表** ——
     * 这样它会以同一个引用条的形式显示在子会话输入框上方（与主对话表现一致）。
     */
    function openSubagentChat(ctx, member, leadSessionId, items) {
      // 兜底用 'unknown'：host 只在 mode 是具体值时才比对，'unknown' 永远被接受
      const mode = member.mode ?? 'unknown'
      const address = subagentChatAddress(member.id, leadSessionId, mode)
      try {
        ctx.sidebarRight.openResource(address, { kind: SUBAGENT_CHAT_KIND, preferNewPane: true })
      } catch (error) {
        return { opened: false, delivered: false, reason: String(error?.message ?? error) }
      }

      if (mode === 'one-shot') {
        // 只读执行记录，不接受后续消息 —— 不投放引用，明确告知
        return { opened: true, delivered: false, readonly: true }
      }

      for (const item of items) quoteStore.add(member.id, item)
      return { opened: true, delivered: true }
    }

    // =====================================================================
    // 10. 组件
    // =====================================================================

    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        console.error('[' + PKG + '] ' + this.props.label + ' 渲染失败', error)
      }
      render() {
        return this.state.failed ? null : this.props.children
      }
    }

    /** 给每个挂载面包一层边界：失败渲染 null，不给宿主留错误占位。 */
    function guarded(Component, label) {
      function Guarded(props) {
        return jsx(ErrorBoundary, { label, children: jsx(Component, props) })
      }
      Guarded.displayName = 'Guarded(' + label + ')'
      return Guarded
    }

    function QuoteGlyph() {
      return jsx('svg', {
        width: 12,
        height: 12,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        children: jsx('path', {
          fill: 'currentColor',
          d: 'M3.2 3.2h3.6v3.6H4.9v2.7h1.9v3.3H3.2V3.2zm6 0h3.6v3.6h-1.9v2.7h1.9v3.3H9.2V3.2z',
        }),
      })
    }

    function CloseGlyph() {
      return jsx('svg', {
        width: 12,
        height: 12,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        children: jsx('path', {
          fill: 'currentColor',
          d: 'M4.2 3.1 8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z',
        }),
      })
    }

    function ChevronGlyph() {
      return jsx('svg', {
        width: 10,
        height: 10,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        children: jsx('path', {
          fill: 'currentColor',
          d: 'M3.3 5.7 8 10.4l4.7-4.7 1.3 1.3L8 13l-6-6z',
        }),
      })
    }

    /**
     * 引用条：挂在 `conversation.input.dock`（D2）。
     *
     * 形态：输入框**最左侧正上方**的横向圆角矩形。收起时显示条数（只有一条时显示内容预览），
     * 鼠标移到上面展开列表（portal 渲染），逐条显示被引用的原文，每条右侧有 × 删除。
     */
    function QuoteCards(props) {
      const { sessionId, t, useInput, inputActions } = props
      const items = useQuotes(sessionId)
      // hook 必须在任何 early return 之前调用
      const inputState = useInput((state) => state)
      const draft = inputState.draft
      const draftRef = React.useRef(draft)
      // 草稿有字或有附件 —— 用来区分主按钮此刻是「发送」还是「停止」
      const hasContent = draft.trim() !== '' || (inputState.attachmentIds?.length ?? 0) > 0
      const hasContentRef = React.useRef(hasContent)
      const injectedRef = React.useRef(false)
      const [open, setOpen] = React.useState(false)

      React.useEffect(() => {
        draftRef.current = draft
        hasContentRef.current = hasContent
      }, [draft, hasContent])

      const onInjected = React.useCallback(() => {
        injectedRef.current = true
      }, [])

      useSubmitInjection(sessionId, inputActions, draftRef, hasContentRef, onInjected)
      useQuoteRetirement(sessionId, draft, items.length, injectedRef)

      /**
       * 只支持**点击**展开，不支持悬停。
       *
       * 原因：列表在文档流里展开会把输入区往上顶，胶囊随之离开鼠标 →
       * `mouseleave` 关闭 → 布局缩回 → 胶囊回到鼠标下 → `mouseenter` 打开 →
       * 无限闪烁。**展开动作本身移动了触发器**，所以这个位置的 hover 方案不成立。
       */
      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          const target = event.target
          if (target instanceof Element && target.closest('[data-qd-row]') !== null) return
          setOpen(false)
        }
        document.addEventListener('mousedown', onDown, true)
        return () => document.removeEventListener('mousedown', onDown, true)
      }, [open])

      if (items.length === 0) return null

      const first = items[0]
      const headline =
        items.length === 1
          ? first.preview + (first.truncated ? t('card.truncated') : '')
          : t('card.count', { count: items.length })

      return jsx('div', {
        className: 'qdq_row',
        'data-qd-row': '',
        children: [
          jsx('div', {
            className: 'qdq_pill',
            'data-qd-pill': '',
            title: items.map((item) => item.text).join('\n---\n'),
            onClick: () => setOpen((current) => !current),
            children: [
              jsx('span', { className: 'qdq_lead', children: jsx(QuoteGlyph, {}) }),
              jsx('span', { className: 'qdq_preview', children: headline }),
              jsx('span', { className: 'qdq_chev', 'data-open': open ? 'true' : 'false', children: jsx(ChevronGlyph, {}) }),
            ],
          }),
          open &&
            jsx('div', {
              className: 'qdq_pop',
              'data-qd-pop': '',
              children: items.map((item) =>
                jsxs(
                  'div',
                  {
                    className: 'qdq_item',
                    'data-qd-item': item.id,
                    children: [
                      jsx('span', {
                        className: 'qdq_itemText',
                        title: item.text,
                        children: item.text + (item.truncated ? t('card.truncated') : ''),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'qdq_remove',
                        'aria-label': t('card.remove'),
                        onMouseDown: (event) => event.preventDefault(),
                        onClick: () => quoteStore.remove(sessionId, item.id),
                        children: jsx(CloseGlyph, {}),
                      }),
                    ],
                  },
                  item.id,
                ),
              ),
            }),
        ],
      })
    }

    /**
     * 子智能体选择器（D1：多个时让用户选）。
     * 候选来自两个投影，agentTeam 优先，回落 subagentCatalog。
     */
    function SubagentPicker(props) {
      const { t, lead, excludeId, anchor, useSessions, actions, onPick, onSpawn, onDismiss, error } = props
      const signature = useSessions((state) => {
        const per = state?.projectionsBySession?.[lead]
        const team = per?.values?.agentTeam
        const catalog = per?.values?.subagentCatalog
        const teamPart = team === undefined ? '-' : 'T' + (team.members ?? []).length
        const catalogPart = Array.isArray(catalog) ? 'C' + catalog.length : '-'
        return teamPart + '|' + catalogPart
      })
      const [targets, setTargets] = React.useState(() => actions.listTargets(lead, excludeId))

      React.useEffect(() => {
        setTargets(actions.listTargets(lead, excludeId))
      }, [signature, lead, excludeId, actions])

      const style = {
        left: Math.round(Math.max(8, Math.min(anchor.x, window.innerWidth - 440))) + 'px',
        top: Math.round(Math.max(8, Math.min(anchor.y, window.innerHeight - 300))) + 'px',
      }

      const header = jsx('div', { className: 'qdq_pickerTitle', children: t('pick.title') })

      if (targets.members.length === 0) {
        return jsxs('div', {
          className: 'qdq_picker',
          style,
          'data-qd-root': '',
          children: [
            header,
            jsx('div', {
              className: 'qdq_empty',
              children: targets.loading ? t('pick.loading') : t('pick.empty'),
            }),
            targets.loading
              ? null
              : jsx('button', {
                  type: 'button',
                  className: 'qdq_pickerRow',
                  onClick: onSpawn,
                  children: [
                    jsx('span', { className: 'qdq_phase', 'data-phase': 'active' }),
                    jsx('span', { className: 'qdq_preview', children: t('pick.spawn') }),
                  ],
                }),
            targets.loading ? null : jsx('div', { className: 'qdq_empty', children: t('pick.emptyHint') }),
            error === undefined ? null : jsx('div', { className: 'qdq_error', children: '⚠ ' + error }),
          ],
        })
      }

      return jsxs('div', {
        className: 'qdq_picker',
        style,
        'data-qd-root': '',
        onMouseLeave: onDismiss,
        children: [
          header,
          ...targets.members.map((member) =>
            jsxs(
              'button',
              {
                type: 'button',
                className: 'qdq_pickerRow',
                onClick: () => onPick(member),
                children: [
                  jsx('span', { className: 'qdq_phase', 'data-phase': member.phase }),
                  jsx('span', { className: 'qdq_preview', children: member.name || member.id }),
                  jsx('span', {
                    className: 'qdq_tag',
                    children:
                      member.mode === 'one-shot'
                        ? t('pick.readonly')
                        : t(member.source === 'team' ? 'pick.sourceTeam' : 'pick.sourceSubagent'),
                  }),
                ],
              },
              member.id,
            ),
          ),
        ],
      })
    }

    /** 划词动作条：挂在 `shell.overlay`（root 作用域，浮层本身 click-through）。 */
    function SelectionActions(props) {
      const { t, actions, useSessions } = props
      const [state, setState] = React.useState(null)

      React.useEffect(() => {
        const insideSelf = (target) =>
          target instanceof Element && target.closest('[data-qd-root]') !== null

        const snapshot = (event) => {
          if (event !== undefined && insideSelf(event.target)) return
          const selection = readSelection()
          if (selection === null) {
            setState(null)
            return
          }
          setState({ selection, picking: null })
        }

        const onPointerUp = (event) => snapshot(event)
        const onKeyUp = (event) => {
          if (event.key === 'Shift' || event.key.startsWith('Arrow')) snapshot(event)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setState(null)
        }
        const onScroll = () => setState(null)

        document.addEventListener('mouseup', onPointerUp, true)
        document.addEventListener('keyup', onKeyUp, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onScroll, true)
        return () => {
          document.removeEventListener('mouseup', onPointerUp, true)
          document.removeEventListener('keyup', onKeyUp, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', onScroll, true)
        }
      }, [])

      // A′：盯住挂起的「派生」。投影里一出现基线之外的新子会话，就自动在右栏打开它
      // 并投放那条引用。签名只用便宜的字符串，避免会话状态每次变化都重跑。
      const pendingSignature = useSessions((state) => {
        if (actions.pendingSpawnCount() === 0) return ''
        const parts = []
        for (const lead of actions.pendingSpawnLeads()) {
          const per = state?.projectionsBySession?.[lead]
          const catalog = per?.values?.subagentCatalog
          const team = per?.values?.agentTeam
          const count = (Array.isArray(catalog) ? catalog.length : -1) + (team ? (team.members ?? []).length : 0)
          parts.push(lead + ':' + count)
        }
        return parts.join('|')
      })

      React.useEffect(() => {
        if (actions.pendingSpawnCount() === 0) return
        const result = actions.resolvePendingSpawns()
        if (result.delivered > 0) {
          console.info('[' + PKG + '] auto-opened ' + result.delivered + ' newly spawned subagent(s)')
        }
        if (result.expired > 0) {
          console.warn('[' + PKG + '] dropped ' + result.expired + ' expired pending quote(s)')
        }
      }, [pendingSignature, actions])

      if (state === null) return null

      const { selection, picking } = state
      const rect = selection.rect
      const context = actions.resolveContext(selection.sessionId)
      const barStyle = {
        left: Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - 380))) + 'px',
        top: Math.round(Math.min(rect.bottom + 8, window.innerHeight - 48)) + 'px',
      }

      const openPicker = (error) => {
        const targets = actions.listTargets(context.lead, context.isSubagent ? selection.sessionId : undefined)
        if (targets.loading) actions.refreshTargets(targets.lead)
        setState({
          selection,
          picking: {
            anchor: { x: rect.left, y: rect.bottom + 44 },
            lead: targets.lead,
            excludeId: context.isSubagent ? selection.sessionId : undefined,
            error,
          },
        })
      }

      /** 挂起派生。任何失败都必须变成可见的回退，不能让点击"没反应"。 */
      const stageSpawn = () => {
        try {
          return actions.stageSpawnForSubagent(selection, context.lead, t)
        } catch (error) {
          return { ok: false, reason: String(error?.message ?? error) }
        }
      }

      const onQuoteToSub = () => {
        const excludeId = context.isSubagent ? selection.sessionId : undefined
        const targets = actions.listTargets(context.lead, excludeId)
        if (targets.loading) {
          openPicker()
          return
        }
        if (targets.members.length === 1) {
          void actions.quoteToSub(selection, targets.members[0], context.lead)
          setState(null)
          return
        }
        if (targets.members.length === 0) {
          // A′：没有子智能体 → 挂起这条引用，并把「派生一个子智能体」写进输入框。
          // 客户端插件建不了子智能体，只能借主对话的模型去派（见 spawnStore 注释）。
          const staged = stageSpawn()
          if (staged.ok) {
            setState(null)
            return
          }
          console.error('[' + PKG + '] stage spawn failed: ' + staged.reason)
          // 失败必须在界面上看得见：把原因带进选择器
          openPicker(staged.reason)
          return
        }
        openPicker()
      }

      const onSpawn = () => {
        const staged = stageSpawn()
        if (staged.ok) {
          setState(null)
          return
        }
        console.error('[' + PKG + '] stage spawn failed: ' + staged.reason)
        openPicker(staged.reason)
      }

      /**
       * 按钮处理器统一包一层：**React 事件处理器里抛出的异常会被 ErrorBoundary 吞掉**，
       * 表现就是"点了没反应"（甚至整条动作条消失）。任何失败都必须落到 console，
       * 不能静默。
       */
      const safeRun = (label, fn) => () => {
        try {
          fn()
        } catch (error) {
          console.error('[' + PKG + '] ' + label + ' failed: ' + String(error?.message ?? error), error)
        }
      }

      // 在子智能体里划词 → 三个动作；在主对话里划词 → 两个动作
      const buttons = []
      if (context.isSubagent) {
        buttons.push({
          key: 'lead',
          label: t('action.quoteToLead'),
          run: safeRun('quoteToLead', () => {
            actions.quoteTo(context.lead, selection)
            setState(null)
          }),
        })
      }
      buttons.push({
        key: 'here',
        label: t('action.quoteToHere'),
        run: safeRun('quoteToHere', () => {
          actions.quoteTo(selection.sessionId, selection)
          setState(null)
        }),
      })
      buttons.push({
        key: 'sub',
        label: t(context.isSubagent ? 'action.quoteToOther' : 'action.quoteToSub'),
        run: safeRun('quoteToSub', onQuoteToSub),
      })

      return jsxs(React.Fragment, {
        children: [
          jsx('div', {
            className: 'qdq_bar',
            style: barStyle,
            'data-qd-root': '',
            role: 'toolbar',
            'aria-label': t('action.barAria'),
            children: buttons.map((button) =>
              jsx(
                'button',
                {
                  key: button.key,
                  type: 'button',
                  className: 'qdq_action',
                  // 防止点击把 DOM 选区清掉
                  onMouseDown: (event) => event.preventDefault(),
                  onClick: button.run,
                  children: button.label,
                },
                button.key,
              ),
            ),
          }),
          picking !== null &&
            jsx(SubagentPicker, {
              t,
              lead: picking.lead,
              excludeId: picking.excludeId,
              anchor: picking.anchor,
              useSessions,
              actions,
              onPick: (member) => {
                void actions.quoteToSub(selection, member, picking.lead)
                setState(null)
              },
              onSpawn,
              onDismiss: () => setState(null),
              error: picking.error,
            }),
        ],
      })
    }

    // =====================================================================
    // 11. 插件主体
    // =====================================================================

    /** 划词动作条需要的注入面。 */
    function makeActions(ctx) {
      return {
        /** 把引用投放到某个会话的引用条上（不碰草稿，D3）。 */
        quoteTo(targetSessionId, selection) {
          if (targetSessionId === undefined || targetSessionId === null) {
            return { ok: false, reason: 'no target session id (DOM anchor changed?)' }
          }
          quoteStore.add(targetSessionId, toQuoteItem(selection))
          return { ok: true }
        },

        /** 当前选区所在会话的上下文：是否在子智能体里、它属于哪个 lead。 */
        resolveContext(sessionId) {
          if (sessionId === undefined || sessionId === null) {
            return { lead: sessionId, isSubagent: false }
          }
          const lead = leadSessionIdOf(ctx.sessions, sessionId)
          return { lead, isSubagent: lead !== sessionId }
        },

        /** 可引用的子会话目标（teammate 优先，其次普通子智能体）。 */
        listTargets(sessionId, excludeId) {
          return listTargets(ctx.sessions, sessionId, excludeId)
        },

        /** 子智能体目录是懒加载的：催一次投影刷新。 */
        refreshTargets(leadSessionId) {
          try {
            void ctx.sessions.refreshProjections(leadSessionId)
          } catch (error) {
            console.warn('[' + PKG + '] refreshProjections failed', error)
          }
        },

        /** 引用到子对话：右侧新开一格 + 把引用放到它的引用条上。 */
        quoteToSub(selection, member, leadSessionId) {
          const item = toQuoteItem(selection)
          const lead = leadSessionId ?? leadSessionIdOf(ctx.sessions, selection.sessionId)
          const result = openSubagentChat(ctx, member, lead, [item])
          if (!result.opened) {
            console.error('[' + PKG + '] open subagent chat failed: ' + result.reason)
          } else if (result.readonly) {
            console.warn('[' + PKG + '] ' + member.name + ' is a one-shot task; quote not delivered')
          }
          return result
        },

        /**
         * A′：没有子智能体时，挂起这条引用，并把「派生一个子智能体」的指令写进输入框。
         *
         * 客户端插件建不了子智能体（见 spawnStore 的注释），所以只能借主对话的模型去派；
         * 挂起之后由 resolvePendingSpawns 盯着投影自动接续。
         *
         * ⚠️ 整个函数体包了 try/catch：**任何抛出都会让点击处理器静默失效**
         * （React 事件处理器抛错被 ErrorBoundary 吞掉，界面看起来"没反应"）。
         * 失败必须变成可见的返回值，让调用方回退到选择器。
         *
         * `t` 由调用方（组件）传入 —— 不用 `ctx.locale`，因为 actions 所在的 scope 是
         * `ctx.inject(['sessions','sidebarRight','uiWorkspace','conversation'])` 派生的，
         * 不保证带 locale 面。
         */
        stageSpawnForSubagent(selection, leadSessionId, translate) {
          try {
            const lead = leadSessionId ?? leadSessionIdOf(ctx.sessions, selection.sessionId)
            const sessionScope = ctx.sessions.scope(selection.sessionId)
            if (sessionScope === undefined) return { ok: false, reason: 'session scope unavailable' }

            const input = ctx.conversation.input.for(sessionScope)
            if (input === undefined || typeof input.setDraft !== 'function') {
              return { ok: false, reason: 'input.setDraft unavailable' }
            }

            const t = typeof translate === 'function' ? translate : (key) => key
            const item = toQuoteItem(selection)
            const block = formatQuoteBlock([item])
            const head = t('spawn.instruction')

            let current = ''
            try {
              const snapshot = input.state?.getSnapshot?.()
              if (typeof snapshot?.draft === 'string') current = snapshot.draft
            } catch (error) {
              // 读不到当前草稿不算致命：当成空草稿处理
              console.warn('[' + PKG + '] read draft failed', error)
            }

            const next =
              current.trim() === ''
                ? head + '\n\n' + block + '\n'
                : current + '\n\n' + head + '\n\n' + block + '\n'

            input.setDraft(next)
            spawnStore.stage(lead, item, childIdsOf(ctx.sessions, lead))
            return { ok: true }
          } catch (error) {
            return { ok: false, reason: String(error?.message ?? error) }
          }
        },

        /** 挂起数量（供渲染层判断是否需要盯投影）。 */
        pendingSpawnCount() {
          return spawnStore.size()
        },

        /** 挂起所在的 lead 会话 id 列表（供渲染层构造便宜的订阅签名）。 */
        pendingSpawnLeads() {
          return spawnStore.leads()
        },

        /**
         * 盯投影：若挂起的 lead 下出现了基线里没有的子会话，就打开它并投放引用。
         * @returns {{delivered:number, expired:number}}
         */
        resolvePendingSpawns() {
          let delivered = 0
          let expired = 0
          for (const lead of spawnStore.leads()) {
            if (spawnStore.expired(lead)) {
              expired++
              continue
            }
            const entry = spawnStore.take(lead)
            if (entry === undefined) continue
            const fresh = childIdsOf(ctx.sessions, lead).filter((id) => !entry.knownIds.has(id))
            if (fresh.length === 0) {
              // 还没出现，放回去继续等
              spawnStore.stage(lead, entry.quote, entry.knownIds)
              continue
            }
            // 只认第一个新出现的：模型可能派生多个，不猜用户想要哪个
            const childId = fresh[0]
            // ⚠️ mode 必须来自真实投影 —— 写死成 'continuable' 会在 one-shot 子会话上
            // 触发 subagent/unauthorized（"mode does not match the supplied address"）
            const mode = childModeOf(ctx.sessions, lead, childId)
            try {
              ctx.sidebarRight.openResource(
                subagentChatAddress(childId, lead, mode),
                { kind: SUBAGENT_CHAT_KIND, preferNewPane: true },
              )
              if (mode === 'one-shot') {
                // 一次性子会话是只读执行记录，不接受后续消息 —— 不投放，明确记一条
                console.warn('[' + PKG + '] ' + childId + ' is a one-shot subagent; quote not delivered')
              } else {
                quoteStore.add(childId, entry.quote)
                delivered++
              }
            } catch (error) {
              console.error('[' + PKG + '] auto-open spawned subagent failed: ' + String(error?.message ?? error))
            }
          }
          return { delivered, expired }
        },
      }
    }

    /** 挂载面 A：引用条。只依赖 `slots`。 */
    function mountCards(ctx) {
      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: CARD_SLOT_ID,
            order: 20,
            locale: NS,
          },
          guarded(QuoteCards, 'cards'),
        ),
      )
    }

    /** 挂载面 B：划词动作条。需要 sessions / sidebarRight / conversation。 */
    function mountActions(ctx) {
      ctx.inject(['sessions', 'sidebarRight', 'uiWorkspace', 'conversation'], (scope) => {
        scope.slots.inject('shell.overlay', () =>
          scope.slots.register(
            {
              name: 'shell.overlay',
              id: OVERLAY_SLOT_ID,
              order: 20,
              locale: NS,
              inject: () => ({ actions: makeActions(scope) }),
            },
            guarded(SelectionActions, 'actions'),
          ),
        )
      })
    }

    function apply(ctx) {
      ensureStyles()

      // 全部挂载面都要文案，所以统一等 locale。
      // 不把 locale 塞进 exports.inject —— 依赖按面拆分，未来若 locale 改名，
      // 只有文本面消失而不是整包失效。
      ctx.inject(['locale'], (l) => {
        l.effect(() => l.locale.register(NS, { zh, en }), PKG + ': dictionaries')
        mountCards(ctx)
        mountActions(ctx)
      })
    }

    // 必需服务：声明而不是「get 一下拿不到就退出」。
    // 客户端 Loader 对没有未满足依赖的插件会立刻调用 apply()，
    // 那一刻渲染器提供的服务还没就绪。
    const inject = ['slots']

    exports.apply = apply
    exports.inject = inject
    // 测试出口：让 scripts/smoke.mjs 能直接渲染组件、断言真实产出的元素树。
    // 静态检查只能覆盖已知的写法，渲染测试才能抓住"元素渲染成空的"这类问题
    // （真机上踩过：jsx/jsxs 的第三参当成了 children，列表整个空白且不报错）。
    exports.__test = {
      build: BUILD,
      QuoteCards,
      SubagentPicker,
      SelectionActions,
      quoteStore,
      formatQuoteBlock,
      neutralizeWireForms,
      childModeOf,
      subagentChatAddress,
      conversationRootOf,
      belongsToSession,
      primaryButtonDisabled,
    }
    return module.exports
  },
})
