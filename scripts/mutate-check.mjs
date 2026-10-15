// 临时脚本：验证渲染回归测试确实能抓住「children 被当成第三参」这个 bug。
// 用法：node scripts/mutate-check.mjs apply | restore
import { copyFileSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'lib', 'client.js')
const backup = join(root, 'lib', 'client.js.bak')

const mode = process.argv[2]

if (mode === 'apply') {
  copyFileSync(target, backup)
  const source = readFileSync(target, 'utf8')
  // 把条目 props 里的 children 改名 —— 等价于"children 没进 props"，
  // 也就是真机上那个 bug 的效果。
  const mutated = source.replace(/'data-qd-item': item\.id,(\s+)children:/, "'data-qd-item': item.id,$1_children:")
  if (mutated === source) {
    console.log('MUTATION FAILED: pattern not found')
    process.exit(2)
  }
  writeFileSync(target, mutated)
  console.log('mutation applied (children -> _children)')
} else if (mode === 'restore') {
  if (!existsSync(backup)) {
    console.log('no backup to restore')
    process.exit(2)
  }
  copyFileSync(backup, target)
  unlinkSync(backup)
  console.log('restored')
} else {
  console.log('usage: node scripts/mutate-check.mjs apply|restore')
  process.exit(2)
}
