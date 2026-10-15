/**
 * dsh-quote-to-agent 交付前门禁。
 *
 * 检查三件事（都是 DSH 客户端插件踩过的坑，见 skill `dsh-client-plugin`）：
 *   1. 中英字典 key 集合严格相等（含占位符集合）
 *   2. 代码里 t('key') 引用的每个 key 都已声明（曾把裸 key 显示到界面上）
 *   3. 每个 CSS var() 都带字面量兜底（变量被移除时 var() 不回落，整条声明失效）
 *
 * 用法：node scripts/check.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const problems = []
const note = (message) => problems.push(message)

// ---------------------------------------------------------------- 字典解析

/** 截出 `const <name> = { ... }` 的块（按缩进配对，够用且不引依赖）。 */
function blockOf(name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start === -1) throw new Error(`dictionary "${name}" not found`)
  let depth = 0
  let index = source.indexOf('{', start)
  const from = index
  for (; index < source.length; index++) {
    const char = source[index]
    if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) return source.slice(from, index + 1)
    }
  }
  throw new Error(`dictionary "${name}" is not closed`)
}

function entriesOf(name) {
  const body = blockOf(name)
  const map = new Map()
  const re = /'([^']+)'\s*:\s*'((?:[^'\\]|\\.)*)'/g
  let match
  while ((match = re.exec(body)) !== null) map.set(match[1], match[2])
  return map
}

const zh = entriesOf('zh')
const en = entriesOf('en')

// --- 门禁 1：key 集合
for (const key of zh.keys()) if (!en.has(key)) note(`字典缺英文 key: ${key}`)
for (const key of en.keys()) if (!zh.has(key)) note(`字典缺中文 key: ${key}`)

// --- 门禁 1b：占位符集合
const placeholders = (value) => new Set([...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
for (const [key, value] of zh) {
  const other = en.get(key)
  if (other === undefined) continue
  const a = placeholders(value)
  const b = placeholders(other)
  for (const name of a) if (!b.has(name)) note(`占位符不一致 ${key}: 中文有 {${name}}，英文没有`)
  for (const name of b) if (!a.has(name)) note(`占位符不一致 ${key}: 英文有 {${name}}，中文没有`)
}

// --- 门禁 2：t('key') 引用完整性
const used = new Set()
for (const match of source.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)) used.add(match[1])
for (const key of used) if (!zh.has(key)) note(`代码引用了未声明的文案 key: ${key}`)

// --- 门禁 3：CSS var() 兜底
const cssStart = source.indexOf('const CSS = [')
const cssEnd = source.indexOf('].join(\'\')', cssStart)
if (cssStart === -1 || cssEnd === -1) note('找不到 CSS 常量')
else {
  const css = source.slice(cssStart, cssEnd)
  for (const match of css.matchAll(/var\(\s*(--[\w-]+)\s*([^)]*)\)/g)) {
    const fallback = match[2].trim()
    if (!fallback.startsWith(',')) note(`var(${match[1]}) 没有字面量兜底`)
  }
}

// --- 门禁 4：jsx/jsxs 的第三个参数必须是 key，不能是 children
//
// 自动 JSX 运行时里 `jsx(type, props, key)` / `jsxs(type, props, key)` 的第三个参数是 **key**；
// children 必须放进 props。把 children 数组当第三参传，元素会渲染成空的 —— 而且不报错。
// 这个坑真机上踩过一次（引用列表整个空白），所以做成永久门禁。
function lineOf(text, index) {
  return text.slice(0, index).split('\n').length
}

function scanJsxArity(text) {
  const found = []
  const re = /\bjsxs?\(/g
  let match
  while ((match = re.exec(text)) !== null) {
    let depth = 1
    let i = match.index + match[0].length
    let inString = null
    const args = []
    let argStart = i
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i]
      if (inString !== null) {
        if (ch === '\\') i++
        else if (ch === inString) inString = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') inString = ch
      else if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth--
        if (depth === 0) {
          args.push(text.slice(argStart, i))
          break
        }
      } else if (ch === ',' && depth === 1) {
        args.push(text.slice(argStart, i))
        argStart = i + 1
      }
    }
    if (args.length < 3) continue
    const third = args[2].trim()
    // 合法的第三参只能是字符串/数字字面量或标识符（含 a.b 成员表达式）作为 key
    const legal = /^(?:'[^']*'|"[^"]*"|`[^`]*`|[0-9]+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/.test(
      third,
    )
    if (!legal) found.push({ line: lineOf(text, match.index), text: third.slice(0, 70) })
  }
  return found
}

for (const bad of scanJsxArity(source)) {
  note(`jsx/jsxs 第三参不是 key（children 必须放 props.children）—— 行 ${bad.line}: ${bad.text}`)
}

// ---------------------------------------------------------------- 报告

const summary = [
  `字典: zh=${zh.size} en=${en.size}`,
  `代码引用 key: ${used.size}`,
  `CSS var(): ${[...source.slice(cssStart, cssEnd).matchAll(/var\(/g)].length}`,
]

for (const line of summary) console.log(line)

if (problems.length === 0) {
  console.log('\n✅ 门禁全部通过')
  process.exit(0)
}
console.log('')
for (const problem of problems) console.log('❌ ' + problem)
console.log(`\n共 ${problems.length} 项未通过`)
process.exit(1)
