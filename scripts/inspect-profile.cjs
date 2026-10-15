/**
 * 只读检查：把 profile 的组合树跑一遍，确认本插件确实被加载。
 *
 * 用应用自己的 boot loader，所以能在不解包 app.asar 的前提下读到里面的包。
 *
 * 用法（必须用 Electron 的 Node 跑，asar 的 fs 补丁才生效）：
 *
 *   ELECTRON_RUN_AS_NODE=1 "<安装目录>/DeepSeek Harness.exe" scripts/inspect-profile.cjs \
 *     --asar "<安装目录>/resources/app.asar" [--profile desktop]
 *
 * 环境变量：
 *   DSH_HOME   ~/.dsh 的替代位置（默认取用户主目录下的 .dsh）
 *   DSH_ASAR   app.asar 的绝对路径（等价于 --asar）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function argOf(flag) {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const asar = argOf('--asar') ?? process.env.DSH_ASAR
const profileName = argOf('--profile') ?? 'desktop'
const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const profileDir = path.join(dshHome, 'profiles', profileName)

if (asar === undefined || asar === '') {
  console.error('缺少 app.asar 路径：用 --asar <path> 或环境变量 DSH_ASAR 指定')
  process.exit(2)
}
if (!fs.existsSync(profileDir)) {
  console.error('找不到 profile 目录：' + profileDir)
  process.exit(2)
}

const bootEntry = path.join(asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-app-boot')
const dshManifest = path.join(asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')

let loadProfileDirectory
try {
  ;({ loadProfileDirectory } = require(bootEntry))
} catch (error) {
  console.error('加载 boot loader 失败（必须用 Electron 的 Node 跑）：' + error.message)
  process.exit(2)
}

async function main() {
  let result
  try {
    result = await loadProfileDirectory('dsh', profileDir, dshManifest)
  } catch (error) {
    console.error('组合 profile 失败：' + (error && error.stack ? error.stack : error))
    process.exit(1)
  }

  const layers = Array.isArray(result?.layers) ? result.layers : []
  const self = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).name

  console.log('profile : ' + profileDir)
  console.log('layers  : ' + layers.length)
  console.log('skipped : ' + JSON.stringify(result?.skippedBundles ?? []))
  console.log('')
  console.log('本包在组合树里: ' + (JSON.stringify(result ?? {}).includes(self) ? '是 ✓' : '否 ✗'))

  const skipped = result?.skippedBundles ?? []
  if (skipped.length > 0) {
    console.log('')
    console.log('⚠️ 有 bundle 被跳过，逐个看原因：')
    for (const item of skipped) console.log('   ' + JSON.stringify(item))
  }
}

void main()
