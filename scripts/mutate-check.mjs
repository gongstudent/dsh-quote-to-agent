/**
 * 变异测试工具 —— 验证冒烟测试里的回归断言**真的能抓住**对应的 bug。
 *
 * 一个抓不到 bug 的回归测试等于没写。用法：
 *
 *   node scripts/mutate-check.mjs list            # 看有哪些用例
 *   node scripts/mutate-check.mjs apply <case>    # 注入变异
 *   node scripts/smoke.mjs                        # 应当失败
 *   node scripts/mutate-check.mjs restore         # 还原
 *   node scripts/smoke.mjs                        # 应当通过
 *
 * ⚠️ apply 会临时改 lib/client.js 并留一份 .bak；忘了 restore 的话，
 * 下次 apply 会直接失败（有 .bak 就拒绝覆盖）。
 */
import { copyFileSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'lib', 'client.js')
const backup = join(root, 'lib', 'client.js.bak')

/** 每个用例：把「修好的写法」换回「有 bug 的写法」。 */
const CASES = {
  'jsx-arity': {
    why: 'children 被当成 jsx/jsxs 的第三参（key）→ 元素渲染成空的',
    expect: '展开列表里出现第 1 条引用原文 / 每个条目都有 children',
    from: "'data-qd-item': item.id,\n                    children: [",
    to: "'data-qd-item': item.id,\n                    _children: [",
  },
  'dismiss-on-mousedown': {
    why: '收起只在 mouseup 判定，且动作条内部一律早退 —— 点它自己的 padding 不会收起',
    expect: '点在动作条的空白处就收起',
    from: 'if (insideSelf(event.target) && ownButton(event.target)) return',
    to: 'if (insideSelf(event.target)) return',
  },
  'stale-selection-reshow': {
    why: 'mouseup 不比对「刚收起过的选区」，同一份残留选区又浮出来',
    expect: '刚收起过的同一选区不会在 mouseup 又浮出来',
    from: 'if (sameSelectionRange(dismissed, selection.key)) return',
    to: 'if (false) return',
  },
  'multipane-query': {
    why: 'primaryButtonDisabled 用 document.querySelector 查到**别的会话**的发送按钮',
    expect: '子会话的发送按钮不被主对话的禁用状态误伤',
    from: [
      '      const root = conversationRootOf(sessionId)',
      '      if (root === null) return false',
      '      const button = root.querySelector(ANCHOR_PRIMARY_BUTTON)',
      '      return button !== null && button.disabled === true',
    ].join('\n'),
    to: [
      '      const button = document.querySelector(ANCHOR_PRIMARY_BUTTON)',
      '      return button !== null && button.disabled === true',
    ].join('\n'),
  },
}

const [, , action, caseName] = process.argv

if (action === 'list' || action === undefined) {
  console.log('可用变异用例：')
  for (const [name, spec] of Object.entries(CASES)) {
    console.log('  ' + name)
    console.log('      注入的 bug   : ' + spec.why)
    console.log('      应失败的断言 : ' + spec.expect)
  }
  process.exit(action === undefined ? 2 : 0)
}

if (action === 'restore') {
  if (!existsSync(backup)) {
    console.log('没有 .bak 可还原')
    process.exit(2)
  }
  copyFileSync(backup, target)
  unlinkSync(backup)
  console.log('已还原 lib/client.js')
  process.exit(0)
}

if (action === 'apply') {
  const spec = CASES[caseName]
  if (spec === undefined) {
    console.log('未知用例：' + caseName + '（用 list 看可用项）')
    process.exit(2)
  }
  if (existsSync(backup)) {
    console.log('已有 .bak —— 先跑 restore，避免覆盖上一轮的备份')
    process.exit(2)
  }
  copyFileSync(target, backup)
  const source = readFileSync(target, 'utf8')
  if (!source.includes(spec.from)) {
    console.log('变异失败：源里找不到目标片段（代码已改动？）')
    unlinkSync(backup)
    process.exit(2)
  }
  writeFileSync(target, source.replace(spec.from, spec.to))
  console.log('已注入变异 [' + caseName + ']：' + spec.why)
  console.log('现在跑 node scripts/smoke.mjs —— 应当失败于：' + spec.expect)
  process.exit(0)
}

console.log('用法：node scripts/mutate-check.mjs list | apply <case> | restore')
process.exit(2)
