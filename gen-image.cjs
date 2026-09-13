// ═══ 焚炎异录 · 通用生图工具 ═══
// 用法：
//   node gen-image.cjs "提示词"                     → 生成并保存到 src/assets/sprites/generated-<时间戳>.png
//   node gen-image.cjs "提示词" -o src/assets/xxx.png   → 指定保存路径
//   node gen-image.cjs --list                       → 显示内置素材模板（角色/怪物/场景…可直接引用）
//   node gen-image.cjs --template="角色·萧炎"        → 用内置模板生成
//   node gen-image.cjs --batch batch.json           → 批量生成（json: [{prompt, out}...]）
//
// 生成的是有背景的图 → 之后用 node remove-bg.cjs 抠掉白底
const https = require('https')
const fs = require('fs')
const path = require('path')

// 密钥从 .env 读（.env 已在 .gitignore 里，不会进仓库），本地开发用；
// 手动解析而不引入 dotenv 依赖，反正只是一次性开发工具脚本
try {
  const envPath = path.join(__dirname, '.env')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
} catch { /* ignore */ }

const API_KEY = process.env.CLOUDSWAY_API_KEY
if (!API_KEY) {
  console.log('❌ 未设置 CLOUDSWAY_API_KEY，在项目根目录建一个 .env 文件写入：CLOUDSWAY_API_KEY=你的密钥')
  process.exit(1)
}
const API_HOST = 'genaiapi-m2.cloudsway.net'
const API_PATH = '/v1/ai/BDXdSENRcnQprSge/generateContent'
const OUT_DIR = path.join(__dirname, 'src/assets/sprites')

// ── 统一风格后缀：所有素材保持同一种质感 ──
const STYLE_PORTRAIT = 'semi-realistic anime illustration, bust portrait, centered composition, dynamic lighting, Chinese xuanhuan cultivation fantasy theme, dou qi energy aura, simple dark gradient background, detailed clothing, vibrant colors, game gacha splash art quality'
const STYLE_MONSTER = 'pixel art sprite, side view, chibi style, 64x64 pixel proportions, transparent background, game asset, Chinese xuanhuan fantasy theme, warm color palette, clean pixel edges'
const STYLE_ITEM = 'pixel art icon, centered, simple background, game item icon, Chinese xuanhuan fantasy theme, clean edges, vibrant colors'
const STYLE_SCENE = 'painterly game background scene, Chinese xuanhuan fantasy landscape, warm dramatic color palette, no characters, no people, wide landscape orientation, atmospheric depth, dou qi continent'

// ── 内置素材模板（省记 prompt 的常用素材）──
const TEMPLATES = {
  '角色·萧炎': { style: STYLE_PORTRAIT, prompt: () => `Xiao Yan, young male cultivator protagonist, black hair, sharp red eyes, black battle robe with flame patterns, orange dou qi flames swirling around fists, confident fierce expression, Battle Through the Heavens (Doupo Cangqiong) style.` },
  '角色·萧薰儿': { style: STYLE_PORTRAIT, prompt: () => `Xiao Xun'er, young female cultivator, long flowing silver-white hair, elegant white and gold robe, calm graceful expression, faint heavenly flame aura, ethereal beauty, Chinese xuanhuan style.` },
  '角色·云韵': { style: STYLE_PORTRAIT, prompt: () => `Yun Yun, Medusa snake-clan queen, purple hair, regal dark purple and green robe with scale patterns, cold commanding expression, faint snake-scale aura, powerful sorceress, Chinese xuanhuan style.` },
  '怪物·马贼头目': { style: STYLE_MONSTER, prompt: () => `A fierce desert bandit leader, ragged dark leather armor, curved saber, scarred face, aggressive stance, Chinese xuanhuan fantasy bandit.` },
  '怪物·魔兽王': { style: STYLE_MONSTER, prompt: () => `A monstrous beast king from the demonic beast mountains, dark fur, glowing qi-infused claws, armored hide, standing aggressively, Chinese xuanhuan mythological beast.` },
  '场景·乌坦城': { style: STYLE_SCENE, prompt: () => `Wutan City, a desert frontier walled city at dusk, sandstone buildings, watchtowers, distant desert dunes, warm orange sky, Chinese xuanhuan fantasy setting.` },
  '场景·魔兽山脉': { style: STYLE_SCENE, prompt: () => `The Demonic Beast Mountains, towering misty peaks with dense ancient forest, dangerous wilderness, dramatic lighting, Chinese xuanhuan fantasy landscape.` },
}

function generateImage(prompt, outputPath) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    })
    const options = {
      hostname: API_HOST, path: API_PATH, method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }
    const req = https.request(options, res => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          if (data.error) return reject(new Error(JSON.stringify(data.error)))
          const parts = data.candidates?.[0]?.content?.parts || []
          let saved = false
          for (const p of parts) {
            if (p.inlineData) {
              const buf = Buffer.from(p.inlineData.data, 'base64')
              fs.mkdirSync(path.dirname(outputPath), { recursive: true })
              fs.writeFileSync(outputPath, buf)
              console.log(`  ✅ ${path.basename(outputPath)} (${(buf.length / 1024).toFixed(0)}KB)`)
              saved = true
            }
          }
          if (!saved) reject(new Error('响应中没有图片'))
          else resolve(outputPath)
        } catch (e) { reject(new Error(e.message)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(postData)
    req.end()
  })
}

async function main() {
  const argv = process.argv.slice(2)

  // --list 显示模板
  if (argv.includes('--list')) {
    console.log('内置模板：')
    for (const k of Object.keys(TEMPLATES)) console.log(`  ${k}`)
    console.log('\n用法示例：')
    console.log('  node gen-image.cjs --template="怪物·野猪王"')
    console.log('  node gen-image.cjs "自定义提示词" -o src/assets/sprites/generated/xxx.png')
    return
  }

  // 批量
  const batchIdx = argv.findIndex(a => a === '--batch')
  if (batchIdx >= 0) {
    const file = argv[batchIdx + 1]
    const tasks = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const t of tasks) {
      console.log(`生成: ${t.name ?? t.out}`)
      try { await generateImage(t.prompt, path.join(OUT_DIR, t.out)) }
      catch (e) { console.log(`  ❌ ${e.message}`) }
    }
    return
  }

  // 模板 or 直接提示词
  const tmplIdx = argv.findIndex(a => a.startsWith('--template='))
  let prompt, outPath
  if (tmplIdx >= 0) {
    const key = argv[tmplIdx].slice('--template='.length)
    const t = Object.keys(TEMPLATES).find(k => k.includes(key))
    if (!t) { console.log(`❌ 无模板匹配 "${key}"，--list 查看`); return }
    prompt = TEMPLATES[t].prompt(key) + ', ' + TEMPLATES[t].style
  } else {
    prompt = argv[0]
    if (!prompt) { console.log('用法：node gen-image.cjs "提示词" 或 --template=xxx'); return }
    // 追加统一风格（可选：如果提示词没带风格后缀）
    if (!prompt.includes(',')) prompt += ', pixel art game asset, Chinese wuxia fantasy theme'
  }

  // 输出路径
  const oi = argv.findIndex(a => a === '-o')
  if (oi >= 0) outPath = argv[oi + 1]
  else {
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    outPath = `generated/图-${ts}.png`
  }
  outPath = path.isAbsolute(outPath) ? outPath : path.join(OUT_DIR, outPath)

  console.log(`生成: ${JSON.stringify(prompt).slice(0, 80)}…`)
  try { await generateImage(prompt, outPath) }
  catch (e) { console.log(`❌ ${e.message}`) }
}

main().catch(console.error)