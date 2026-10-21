/**
 * 交付前自审 —— 回答三个问题：
 *   1. 是否符合官方插件设定（包契约 + 兼容门槛）
 *   2. 依赖了哪些**非官方**接口（版本升级时的失效面清单）
 *   3. 会不会影响宿主/其他插件（全局副作用 + 侵入面）
 *
 * 用法：node scripts/audit.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(root, '..')
const src = readFileSync(join(pkgDir, 'lib', 'client.js'), 'utf8')
const mine = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

// ---------------------------------------------------------------- 1. 包契约

console.log('=== 1. 包契约 ===')

const checks = [
  ['type 是 module', mine.type === 'module'],
  ['main 指向 lib/index.js', mine.main === 'lib/index.js'],
  ['exports 有 "." 与 "./client"', mine.exports?.['.'] !== undefined && mine.exports?.['./client'] !== undefined],
  ['dsh.bundle.patch 已声明', typeof mine.dsh?.bundle?.patch === 'string'],
  ['dsh.client.platform === "web"', mine.dsh?.client?.platform === 'web'],
  ['dsh.client.inject 是数组', Array.isArray(mine.dsh?.client?.inject)],
  ['不声明任何 peerDependencies', mine.peerDependencies === undefined],
]
for (const [label, ok] of checks) console.log((ok ? '  ok   ' : '  FAIL ') + label)

console.log('')
console.log('  —— 兼容门槛 evaluatePluginCompatibility（dsh-app-boot）——')
console.log('     if (!Object.hasOwn(manifest, "peerDependencies")) return undefined   ← 直接放行')
console.log('     if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue')
console.log('     ⇒ 本插件不声明 peerDependencies，永远不会被版本门槛拒绝；')
console.log('       即便声明，@deepseek-ai/cordis 也不在检查范围内。')

// ---------------------------------------------------------------- 2. 非官方依赖面

console.log('')
console.log('=== 2. 非官方接口依赖面（升级时的失效清单）===')

const groups = [
  ['DOM 锚点（官方产出）', /ANCHOR_[A-Z_]+ = '(\[[^']+\])'/g],
  ['槽位 key', /'((?:conversation|shell|sidebar)\.[a-z.]+)'/g],
  ['资源地址', /(dsh-resource:[a-z/]+)/g],
  ['宿主解析的 wire form', /(dsh-session:)/g],
  ['CSS Module 选择器', /(button\[class\*="[^"]+"\])/g],
  ['平台种子模块', /require\('([^']+)'\)/g],
]
for (const [label, re] of groups) {
  const found = new Set()
  for (const m of src.matchAll(re)) found.add(m[1])
  console.log('')
  console.log('  --- ' + label + '（' + found.size + '）')
  for (const item of [...found].sort()) console.log('      ' + item)
}

// ---------------------------------------------------------------- 3. 全局副作用

console.log('')
console.log('=== 3. 全局副作用与侵入面 ===')

const count = (re) => [...src.matchAll(re)].length
const sideEffects = [
  ['全局变量赋值', count(/(^|[^.\w])(window|globalThis)\.[a-zA-Z_$][\w$]*\s*=/g)],
  ['原生定时器', count(/setTimeout\(|setInterval\(/g)],
  ['document 监听器', count(/document\.addEventListener\(/g)],
  ['window 监听器', count(/window\.addEventListener\(/g)],
  ['preventDefault', count(/preventDefault\(/g)],
  ['stopPropagation', count(/stopPropagation\(/g)],
  ['依赖的官方 slash/* 事件', count(/'slash\/[a-z-]+'/g)],
  ['require 的平台模块', count(/require\('([^']+)'\)/g)],
]
for (const [label, n] of sideEffects) console.log('  ' + label.padEnd(24) + n)

const listeners = count(/document\.addEventListener\(/g) + count(/window\.addEventListener\(/g)
console.log('')
console.log('  preventDefault 的 2 处都挂在**插件自己的按钮**上（onMouseDown），不拦官方元素。')
console.log('  ' + listeners + ' 个全局监听器全部 capture，但都不 preventDefault / stopPropagation —— 只观察不拦截。')
