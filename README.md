# dsh-quote-to-agent

DSH Web 客户端插件：**在会话记录里划词，把选中的内容引用到当前对话，或分派到子智能体对话。**

- 目标版本：**DSH 0.2.0-rc.2**
- 形态：纯客户端插件（`dsh.client`，`platform: "web"`），host 半边为空

## 它做什么

| 场景 | 行为 |
|---|---|
| **主对话里划词** | 两个动作：引用到当前对话 / 引用到子对话 |
| **子智能体里划词** | 三个动作：引用到主对话 / 引用到当前对话 / 引用到另一个子对话 |
| **引用到当前对话** | 落到输入框**最左侧正上方**的横向引用条：点开看被引用的原文、逐条 `×` 删除；发送时自动拼进消息 |
| **引用到子对话** | 右侧**新开一格**打开该子智能体会话（与主对话同屏、分隔条可拖），并把引用放到它的引用条上 |
| **目标没有子智能体** | 挂起这条引用，把「派生一个子智能体…」写进输入框；新子会话一出现就**自动接续** |

有多个子智能体时弹候选列表；只有一个时直接打开。

## 目录

```
package.json          插件清单（dsh.bundle.patch + dsh.client）
cordis.patch.yml      一行 insert，把插件本体插进组合树
lib/index.js          host 半边（空 apply，只为让 Loader 扫到 entry）
lib/client.js         浏览器半边（全部逻辑）
scripts/check.mjs     门禁：i18n key 集合 / t() 引用完整性 / CSS var() 兜底 / jsx 元数
scripts/smoke.mjs     冒烟：bundle 信封、导出、加载期、槽位接线、渲染回归、目标解析
scripts/audit.mjs     自审：包契约、兼容门槛、非官方依赖面、全局副作用
scripts/mutate-check.mjs  变异测试：验证冒烟测试的回归断言真能抓住对应 bug
scripts/inspect-profile.cjs  只读检查 profile 组合树
```

## 安装

全局 `dsh` CLI **管不了 desktop profile**，要用 Desktop 自带的 CLI：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& "<安装目录>\DeepSeek Harness.exe" --expose-internals `
  "<安装目录>\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" `
  plugin --profile desktop add "<本仓库目录>"
```

装完**必须重启 Desktop 应用**（静态客户端插件在服务启动时加载），然后 `Ctrl+Shift+R` 强刷页面。

卸载：

```powershell
# 同上，把 add 换成 remove
... plugin --profile desktop remove dsh-quote-to-agent
```

## 验证

```powershell
node scripts/check.mjs    # 门禁
node scripts/smoke.mjs    # 冒烟
node scripts/audit.mjs    # 自审
```

`smoke.mjs` 在 node 里用桩 `window` / `react` 跑一遍客户端 bundle，断言 `apply(fakeCtx)`
把两个挂载面注册到预期槽位与选项上，并**渲染一遍真实元素树** ——
**不需要浏览器、不需要重启**。

`scripts/inspect-profile.cjs` 是只读的 profile 组合树检查（用应用自己的 boot loader）：

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& "<安装目录>\DeepSeek Harness.exe" scripts/inspect-profile.cjs `
  --asar "<安装目录>\resources\app.asar" --profile desktop
```

## 骨架状态

已完成：

- 包契约、patch、host 半边、客户端 bundle 信封
- 按依赖拆分的挂载面（引用条只等 `slots`；动作条另等 `sessions` / `sidebarRight` / `conversation`）
- 每个挂载面独立 ErrorBoundary（失败渲染 `null`）
- 划词检测（封装为单一模块，全部非官方 DOM 锚点集中在此）
- 引用条：输入框最左侧正上方的横向圆角矩形，收起显示条数、悬停展开原文列表、每条带 × 删除
- 划词动作条 + 子智能体选择器（teammate 优先，回落普通子智能体；只读项标注）
- 右侧子会话打开（复用官方 `subagentchat` tab，`preferNewPane` 与主对话同屏）
- 引用块序列化、中英双语文案、CSS 主题变量兜底

## 自审（`node scripts/audit.mjs`）

### 符合官方插件设定 ✓

包契约 7 项全过：`type: module`、`main`、`exports` 的 `.` 与 `./client`、
`dsh.bundle.patch`、`dsh.client.platform: "web"`、`dsh.client.inject`、**不声明 peerDependencies**。

**兼容门槛永不触发** —— `evaluatePluginCompatibility`（`dsh-app-boot`）：

```js
if (!Object.hasOwn(fields, "peerDependencies")) return undefined          // ← 直接放行
if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue
```

不声明 `peerDependencies` 就永远不会被版本门槛拒绝；即便声明，`@deepseek-ai/cordis`
也不在检查范围内。`dsh.client.inject: []` 也正确 —— 只 `require` 平台种子表里的
`react` / `react/jsx-runtime`。

### 升级 DSH 后的失效面（**按脆弱度排序**）

| 依赖面 | 具体 | 失效后果 | 失败是否可见 |
|---|---|---|---|
| **DOM 锚点** | `[data-conversation-scroll]` `-content` `-session`、`[data-composer-seat]` `-card`、`[data-chat-flow-key]` `-kind` | 划词检测 / 发送注入失效 | ❌ **静默** |
| **CSS Module 选择器** | `button[class*="_primary"]` | 点按钮发送不带引用 | ❌ 静默（回车仍可用） |
| **槽位 key** | `conversation.input.dock`、`shell.overlay` | 引用条 / 动作条不出现 | ❌ **静默** |
| 资源地址 | `dsh-resource://subagentchat/session/` | 右侧打不开子会话 | ✅ 可见（throw） |
| 宿主行为 | `mode` 校验、`dsh-session:` 解析 | 历史加载失败 / 整轮失败 | ✅ 可见 |

**缓解**：所有非官方锚点集中在文件顶部常量区（`ANCHOR_*`）与 `readSelection()` 一个函数里；
不依赖任何 `slash/*` 事件（0 处）；不声明 peerDependencies。

**升级后自检清单**（四步，全部是静默失败面）：

1. 划词 → 动作条出不出来？（DOM 锚点）
2. 引用条在不在输入框左上方？（slot key）
3. 回车 / 点发送按钮，引用带不带进消息？（DOM 锚点 + 主按钮选择器）
4. 点「引用到子对话」→ 右侧能不能打开？（资源地址）

### 不会影响宿主与其他插件 ✓

| 检查项 | 结果 |
|---|---|
| 全局变量赋值 | **0** |
| 原生定时器（`setTimeout`/`setInterval`） | **0** |
| 全局监听器 | 7 个，全部 capture，但 **0 处 `preventDefault` / `stopPropagation`** —— 只观察不拦截 |
| `preventDefault` | 仅 2 处，都挂在**插件自己的按钮**上（`onMouseDown`） |
| 依赖的官方 `slash/*` 事件 | **0** |
| 槽位 id / locale 命名空间 | 全部私有前缀（`quote-to-agent-*` / `dsh-quote-to-agent`） |
| 渲染期异常 | 每个挂载面独立 ErrorBoundary，失败渲染 `null` |
| 草稿写入 | 只用官方路径（`inputActions.setDraft` / `ctx.conversation.input.for().setDraft`），不碰 DOM 状态 |

**唯一的两处"侵入"**（都是功能本身）：
① 发送时把引用拼进草稿；② 给被引用原文里的 `dsh-session:` 插零宽字符（只动我拼进去的那段）。

**内存**：两个模块级 Map。`quoteStore` 的监听器正确清理、`spawnStore` 有 5 分钟 TTL；
`quoteStore.bySession` 的键在插件生命周期内不删除（按会话数增长，有界，可接受）。

### 名称

`dsh-quote-to-agent` —— 前缀 `dsh-quote-*` 与生态一致
（`dsh-quote-reply` / `-annotate` / `-selection` / `-followup`），
`to-agent` 点明了本插件相对同类插件**唯一的差异**：把引用分派到**子智能体对话**，
并在没有子智能体时自动派生一个。

（v1.17 之前叫 `dsh-quote-dispatch`。改名同步了 package.json 的 `name`、`cordis.patch.yml`
的 `name` 与 `id`、客户端 bundle 的 loader `id`、locale 命名空间、槽位 id 前缀与文档。）

## 变更记录

**v1.18**（修「首次引用到子对话，引用不跟着发出去」）

- **修**：右栏打开子会话后，**第一次发送丢引用**，第二次才带上。
  **根因**：多分栏时 DOM 里同时存在两个 composer，而我的 `primaryButtonDisabled()`
  用的是 `document.querySelector` —— 只拿到**第一个**（主对话那个）。主对话草稿为空时
  它的发送按钮是禁用的，于是子会话的发送被误判成"禁用"而跳过注入。
  第二次之所以能带上，是因为那时主对话的状态变了。
- **修法**：三处查询全部**限定在本会话的容器内** —— 新增
  `conversationRootOf(sessionId)`（遍历 `[data-conversation-content][data-conversation-session]`
  逐个比对属性，避免拼选择器）+ `belongsToSession(element, sessionId)`；
  `primaryButtonDisabled(sessionId)` 与 keydown / click 两条手势都过一遍该判定。
- **改**：找不到本会话容器时 **fail-open**（返回 false 继续注入）—— 静默跳过正是这个 bug 的症状。
- **加测试**：冒烟测试造了「主对话（按钮禁用）+ 子会话（可发送）」的假 DOM，
  断言子会话不被主对话的禁用状态误伤；并用变异测试确认该断言真能抓住这个 bug。
- **整理**：两个一次性变异脚本合并为 `scripts/mutate-check.mjs`（`list` / `apply <case>` / `restore`）。

**v1.17**（改名 + 收尾）

- **改**：`dsh-quote-dispatch` → **`dsh-quote-to-agent`**（仓库名一致）。
  同步了 package.json、cordis.patch.yml、客户端 bundle 的 loader id、locale 命名空间、
  两个槽位 id（`quote-to-agent-cards` / `quote-to-agent-actions`）。
- **整理**：脚本里写死的本机路径全部去掉 —— `inspect-profile.cjs` 改为
  `--asar` / `--profile` / `DSH_HOME` 参数化；`audit.mjs` 不再依赖本机抽出的参考源码；
  文档里的个人路径改为 `<安装目录>` / `%APPDATA%` 这类通用写法。
- **加**：`package.json` 的 `scripts`（`check` / `smoke` / `audit`）。

**v1.16**（拿到可继续的子会话，而不是一次性记录）

- **改**：A′ 的派生指令改成明确要求**后台模式**：
  「请派生一个子智能体来处理下面这段引用，**用后台模式运行（不要等它出结果）**
  —— 这样它是一个可以继续对话的子会话」。
- **为什么**：`subagent` 工具有三条执行路线，产物完全不同 ——

  | 路线 | 产物 |
  |---|---|
  | `run_in_background: false`（前台、等结果） | **one-shot** 子会话（只读记录） |
  | `run_in_background: true` | **continuable** 子会话（可继续对话）✅ |

  本机 base 配置里 `backgroundMode: continuable`，所以**后台 = 可继续**。
  真机症状是右侧显示「一次性子智能体记录 / 一次性任务不支持后续消息」——
  根因是模型选了前台模式（它想拿到结果）。
- **备选路子**：让模型创建 **teammate**（`spawn_teammate`）也一定是 continuable，
  但它会进团队 roster、语义更重，且官方策略要求"仅在用户明确要求时才创建 teammate"。
  所以默认走后台 subagent 这条更轻的路。

**v1.15**（修 `subagent/unauthorized`）

- **修**：A′ 自动打开的子智能体报「历史加载失败：subagent mode does not match the supplied address」。
  **根因**：我把地址里的 `mode` **写死成 `'continuable'`**，而模型用 `subagent` 工具派生的
  多半是 **one-shot** → host 校验不符 → `subagent/unauthorized`。
  host 的规则是：`address.mode !== "unknown" && identity.mode !== address.mode` 才抛错 ——
  也就是 **`'unknown'` 永远被接受**。
- **修法**：mode 改从**真实投影**取（`childModeOf`）；查不到就退到 `'unknown'`；
  `member.mode` 缺省也用 `'unknown'`。
- **补**：`mode === 'one-shot'` 的子会话是只读执行记录，**不投放引用**，只记一条 warn。
- **加测试**：回归用例断言「地址里用的是投影给出的真实 mode」与「one-shot 不投放」。

**v1.14**（修「点了没反应」）

- **修**：没有子智能体时点「引用到子对话」**没有任何反应**。两个原因都改了：
  1. `stageSpawnForSubagent` 里用了 `ctx.locale.bind(NS)`，但 actions 所在的 scope 是
     `ctx.inject(['sessions','sidebarRight','uiWorkspace','conversation'])` 派生的，
     **不保证带 locale 面** —— 取不到就抛异常。现在文案 `t` 由组件传入。
  2. **任何处理器抛异常都会被 ErrorBoundary 吞掉**，表现就是"点了没反应"（甚至整条动作条消失）。
     现在 `stageSpawnForSubagent` 整体包 try/catch 返回 `{ok:false, reason}`；
     所有按钮处理器过一层 `safeRun`，失败必落 console。
- **改**：挂起失败时把**原因显示在选择器里**（`⚠ …`），不再只写 console —— 没开 DevTools 也能看到。
- **加测试**：回归用例覆盖「拿不到会话作用域时返回失败而不是抛错」与「使用调用方传入的 t」。

**v1.13**（A′：没有子智能体时自动接续）

- **加**：点「引用到子对话」而该会话**还没有子智能体**时，不再只给空态 ——
  把这条引用**挂起**，并把「请派生一个子智能体来处理下面这段引用：❝ … ❞」写进输入框。
  你按发送后，主对话的模型会调 `subagent` 工具；插件同时盯着投影，
  **一出现新子会话就自动在右侧打开它并投放那条引用**。
- **为什么只能借模型去派生**：客户端插件**建不了子智能体**。客户端 `sessions` 契约里
  没有任何 create/spawn（`forkSession`/`startSession` 开的是顶层会话，不是子智能体）；
  客户端 catalog 里 subagent 声明 **0 条**；全仓 `subagent/*` 事件全是观测性的。
  根因是创建要 `ctx.subagents.start(name, { parent: Agent })`，而 `Agent` 是 host 侧对象。
- **边界**：模型不派/派多个时只认第一个新出现的；挂起项 5 分钟 TTL；
  用户自己手打同样的指令也会触发接续（判据是"投影里出现新子会话"，与谁写的无关）。
- **加测试**：冒烟测试覆盖「挂起 → 无新子会话时不投放 → 新子会话出现后自动打开并投放」。

**v1.12**（严重：引用含 `dsh-session:` 会让整轮失败）

- **修**：引用一段含 `@[label](dsh-session:…)` 或裸 `dsh-session:xxx` 的文字后发送，
  本轮直接报 `invalid session reference URI` 并失败。
  **根因**：host 在 `agent/pre-step` 对每条用户输入跑 `parseSessionReferenceText`
  （`dsh-session-reference`），正则同时匹配 Markdown mention 和裸 URI，命中后
  `decodeSessionReferenceUri` 对不规范的值**抛错 → 整轮失败**（fail-loud）。
  而被引用的原文是原样透传的，所以别人解释这个语法时写的示例就足以炸掉一轮。
- **修法**：在 `dsh-session` 与冒号之间插零宽空格（U+200B），破坏字面量、正则不再命中；
  零宽不可见，去掉后原文一字不差。
- **范围**：`dsh-session:` 是唯一会被 host 从 prompt 文本解析的 wire form，
  其余 `dsh-*:` scheme 都是内部标识，不碰（避免无谓改动被引用的代码原文）。
- **加测试**：冒烟测试**直接拿 host 的正则**断言产出物不命中。

**v1.11**

- **改**：引用块的装饰引号改成**左右成对**：`❝ 正文 ❞`（原来只有左侧 `❝ `）。
  每行都成对，在纯文本气泡里引用边界一眼可见。

**v1.10**（发送后的显示形态）

- **改**：引用块的序列化从 `> 第一行` 改成 `❝ 第一行`。
  **原因是一个被推翻的假设**：v1.3 我假设会话记录按 Markdown 渲染用户消息，
  所以 `> ` 会变成引用块。实际上 **DSH 的用户消息完全不解析 Markdown** ——
  `UserStyleBubble` 的正文用的是 `projectUserText(...)`（`dsh-client-ui-primitives`），
  它只切纯文本 span + 换 mention 芯片。所以 `> ` 一直显示成**字面的 `>` 字符**，
  是纯噪音。
- **记录了一条不可绕开的约束**：记录里显示的文本 = 模型看到的文本，**同一份**。
  想做成别的软件那种"气泡上方独立胶囊"需要接管官方用户消息渲染器
  （`conversation.chat.node` 的 `user` 键），要重实现 `UserStyleBubble` 的全部内容，
  升级必炸 —— 已否决。
- **加测试**：冒烟测试新增序列化格式断言（禁用 `>`、每行必须左右成对）。

**v1.9**（带附件的发送路径）

- **修**：**带图片时引用不会被带上**。原因是只拦了回车，而带附件时用户更习惯**点发送按钮**，
  那条路完全没拦。现在两条路都拦：
  ① 回车 `keydown`；② 点主发送按钮 `click`（`[data-composer-card] button[class*="_primary"]`）。
- **修**：上传未完成时的重复拼接。框架的 `uploadsPending` 会挡下提交并弹"文件仍在上传"，
  但那时引用已经被写进草稿了，再按一次回车会**再拼一遍**。现在：
  先看发送按钮是否禁用（禁用说明这次提交会被挡下），禁用就不注入；并记录上次注入的块，
  草稿已以它开头时跳过。
- **修**：草稿空且无附件时，启用中的主按钮其实是「停止」（发送被 `empty` 禁用），
  点它不该注入 —— 用 `hasContent`（有字或有附件）区分。
- **加测试**：冒烟测试新增"两条发送手势的捕获监听都已注册"的断言。

**v1.8**（收尾）

- **改**：去掉展开面板顶部的标题行（`2 条引用 · v1.7`）—— 内容本身就是引用原文，标题是多余的。
- **改**：去掉胶囊上的 `BUILD` 标记。构建标记改为只通过 `exports.__test.build` 暴露。
- **保留** `exports.__test`：`scripts/smoke.mjs` 的渲染回归测试依赖它。

**v1.7**（第五轮真机验收）—— **找到真正的根因**

- **修**：引用列表**整个空白**。根因是 `jsx`/`jsxs` 的**第三个参数用错了**：
  自动 JSX 运行时里 `jsx(type, props, key)` 的第三参是 **key**，children 必须放进 `props`。
  我把 children 数组当第三参传了，于是条目 div 渲染出来是**空的，而且不报任何错**。
  v1.2 起用户看到的"空白一片"从头到尾都是这一个 bug。
- **加门禁**：`scripts/check.mjs` 新增 jsx/jsxs 元数检查（第三参必须是 key）。
- **加回归测试**：`scripts/smoke.mjs` 新增真实元素树渲染断言，并**用变异测试验证过它确实能抓住
  这个 bug**（`scripts/mutate-check.mjs` 把 children 改名后，3 项断言失败）。

**v1.6**（第四轮真机验收）

- **修**：悬停展开会**无限闪烁**。根因是结构性的：列表在文档流内展开会把输入区往上顶，
  胶囊随之离开鼠标 → `mouseleave` 关闭 → 布局缩回 → 胶囊回到鼠标下 → `mouseenter` 打开 →
  循环。**展开动作本身移动了触发器**，所以这个位置的 hover 方案根本不成立。
- **改**：按用户要求**去掉 hover，只保留点击**。点胶囊展开/收起，点外部收起。

**v1.5**（诊断版）

- **加**：胶囊上显示 `BUILD` 标记 —— 用来判断"浏览器里跑的到底是不是这份代码"。
  这一步定位了关键事实：**代码确实加载了、事件也确实到达了胶囊**（箭头会翻转）。

**v1.4**（第三轮真机验收）

- **改**：展开的引用列表**彻底放弃 portal**，改为在文档流内就地展开（胶囊下方）。
- **删**：不再 `require('react-dom')`，少一个未知量。
- **加**：胶囊右侧的 ▾/▴ 箭头 —— 兼作诊断。
- 代价：展开时会把输入框往上顶（因为在文档流里），这是为换取可见性的有意取舍。

**v1.3**（第二轮真机验收后的修正）

- **修**：悬停引用条弹出层空白。根因是弹出层渲染在 composer 栈内，被祖先 `overflow` 裁剪。
  改为 portal 到 `document.body` + `position: fixed`（用胶囊 rect 定位，底边重叠 2px 保 hover）。
- **修**：子智能体选择器几乎全透明。根因是 `--dsw-specific-menu` 是半透明色、必须配
  `backdrop-filter` 使用，而我漏了 blur，兜底色又只有 10% 不透明度。
  现在统一「半透明底 + backdrop-filter + 描边」，并给浅/深色各自的兜底底色。
- **改**：引用到子对话不再把文本写进子会话草稿，而是放进**子会话自己的引用列表** ——
  于是它以完全相同的引用条形态出现在子会话输入框上方。顺带删掉了脆弱的
  `retain → ready → setDraft` 时序依赖。
- **新**：在**子智能体里划词时动作变成三个** —— 引用到主对话 / 引用到当前对话 / 引用到另一个子对话。
  「另一个」的候选会排除当前子会话。
- **改**：序列化去掉 `【引用】/【引用结束】` 标记，只输出标准 Markdown 引用块。

**v1.2**（第一轮真机验收后的修正）

- **修**：「引用到子对话」误报"还没有子智能体"。原因是只读了 `agentTeam` 投影，
  而普通子智能体走 `subagentCatalog`。现在两个投影都读，并区分"目录为空"与"目录加载中"。
- **改**：引用条从"输入框上方居中的小卡片"改为**输入框最左侧正上方的横向圆角矩形**，
  收起显示条数、悬停展开原文列表、每条右侧 × 删除。
- **补**：one-shot 子智能体打开后明确标注只读，不尝试投放引用。

## 已知未做

- 引用条**跨刷新持久化**（有意不做：与 DSH 自己的草稿持久化解耦，降复杂度）
- **点击引用跳回原文并高亮**
- 候选列表只列**直接子会话**，不列孙代 —— `subagentCatalog` 投影是按父会话组织的，
  客户端拿不到 `listDescendants`

## 仍需真机确认

**发送时注入**（`useSubmitInjection`）靠 DOM 捕获阶段拦两条发送手势：回车 `keydown`、
主发送按钮 `click`（`[data-composer-card] button[class*="_primary"]`）。

主路径已实测可用，但下面几条**没验过**：

- `Shift+Enter` 换行是否原样放行
- 中文输入法组合中按回车（`isComposing` / `keyCode 229`）是否被正确跳过
- 图片上传未完成时的 busy-enter 路径

不稳的话，退路是改用官方引用芯片（`inputTriggers` + `codec`）——
代价是引用会以行内 chip 出现，且草稿里也能看到。
