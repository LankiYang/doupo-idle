// ═══ 焚炎异录 · 通用生图工具 ═══
// 用法：
//   node gen-image.cjs "提示词"                     → 生成并保存到 src/assets/sprites/generated-<时间戳>.png
//   node gen-image.cjs "提示词" -o src/assets/xxx.png   → 指定保存路径
//   node gen-image.cjs --list                       → 显示内置素材模板（角色/怪物/场景…可直接引用）
//   node gen-image.cjs --template="角色·萧炎"        → 用内置模板生成
//   node gen-image.cjs --batch batch.json           → 批量生成（json: [{prompt, out}...]）
//   node gen-image.cjs "提示词" --model=xxx          → 临时换模型（默认见下方 MODEL）
//
// 走 cloudsway 网关的 **OpenAI 兼容端点** `/v1/chat/completions`，模型 MaaS_Ge_3.1_flash_image。
// （2026-09-17 从旧的 Gemini 原生端点 `/v1/ai/<id>/generateContent` 迁移过来。）
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
const API_PATH = '/v1/chat/completions'             // OpenAI 兼容端点（2026-09-17 改）
const MODEL = 'MaaS_Ge_3.1_flash_image_20260528'    // 可用 --model= 覆盖
const OUT_DIR = path.join(__dirname, 'src/assets/sprites')

// ── 统一风格后缀：所有素材保持同一种质感 ──
// ⚠️ `square composition, 1:1 aspect ratio` 是**必须的**，不是装饰：
//    MaaS_Ge_3.1_flash_image 会**按提示词自适应出图比例**（实测同一模型：
//    "product photo" → 1408×768 横版；"bust portrait" → 896×1200 竖版；
//    加上这句 → 1024×1024）。而本项目现有素材是 **1024×1024 / 256×256 方图**，
//    去掉这句会让立绘变竖版，直接顶坏 UI 布局。
const STYLE_PORTRAIT = 'square composition, 1:1 aspect ratio, semi-realistic anime illustration, bust portrait, centered composition, dynamic lighting, Chinese xuanhuan cultivation fantasy theme, dou qi energy aura, simple dark gradient background, detailed clothing, vibrant colors, game gacha splash art quality'
const STYLE_MONSTER = 'square composition, 1:1 aspect ratio, pixel art sprite, side view, chibi style, 64x64 pixel proportions, transparent background, game asset, Chinese xuanhuan fantasy theme, warm color palette, clean pixel edges'
const STYLE_ITEM = 'square composition, 1:1 aspect ratio, pixel art icon, centered, simple background, game item icon, Chinese xuanhuan fantasy theme, clean edges, vibrant colors'
const STYLE_SCENE = 'wide landscape orientation, 16:9 aspect ratio, painterly game background scene, Chinese xuanhuan fantasy landscape, warm dramatic color palette, no characters, no people, atmospheric depth, dou qi continent'

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

// ── 从返回体里抠出图片 ──
// ⚠️ 返回体的形状（2026-09-17 实测 MaaS_Ge_3.1_flash_image）：
//   choices[0].message.images[0].image_url.url = "data:image/png;base64,…"  ← 图片在这里
//   choices[0].message.content                 = ""                        ← 是空的，别去读它
//   choices[0].message.reasoning_details[0].signature = "<1.3MB base64>"   ← ⚠️ 不是图片！
//     那是模型的「思考签名」，体积和真图一个量级 —— 无脑扫 base64 会把签名当图存下来。
//     所以下面只认三个明确的图片字段，绝不"哪里像图就取哪里"。
function extractImageRefs(data) {
  const refs = []
  for (const ch of data.choices ?? []) {
    const msg = ch.message ?? {}
    // ① 主路径：OpenAI 兼容的 images 数组
    for (const im of msg.images ?? []) {
      const u = im?.image_url?.url
      if (typeof u === 'string' && u) refs.push(u)
    }
    // ② 兜底：正文里的 markdown 图片（部分网关把图塞进 content）
    if (typeof msg.content === 'string') {
      for (const m of msg.content.matchAll(/!\[[^\]]*\]\(((?:data:image\/|https?:\/\/)[^)\s]+)\)/g)) refs.push(m[1])
    }
    // ③ 兜底：Gemini 原生 inlineData（旧端点的遗留形状，留着以防回退）
    for (const p of ch.content?.parts ?? []) {
      if (p.inlineData?.data) refs.push(`data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`)
    }
  }
  return refs
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('下载图片失败 HTTP ' + res.statusCode)) }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    }).on('error', reject)
  })
}

// 落盘。data URI 直接解码；http(s) 再去拉一次（本网关目前只返回 data URI，但留条后路）
async function saveImage(ref, outputPath) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(ref)
  let buf
  if (m) buf = Buffer.from(m[2], 'base64')
  else if (/^https?:\/\//i.test(ref)) buf = await fetchUrl(ref)
  else throw new Error('无法识别的图片字段（既不是 data:image，也不是 http(s) URL）')
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, buf)
  return buf
}

function generateImage(prompt, outputPath, opts = {}) {
  const model = opts.model || MODEL
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      temperature: 1,
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
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
      res.on('end', async () => {
        try {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}：${body.slice(0, 300)}`))
          const data = JSON.parse(body)
          if (data.error) return reject(new Error(JSON.stringify(data.error)))

          const refs = extractImageRefs(data)
          if (!refs.length) {
            const c = data.choices?.[0]?.message?.content
            return reject(new Error(`响应中没有图片（content=${JSON.stringify((c ?? '').slice(0, 120))}）`))
          }
          for (let i = 0; i < refs.length; i++) {
            // 一次回来多张时，第 2 张起自动加 -2/-3 后缀，避免互相覆盖
            const p = refs.length === 1 ? outputPath : outputPath.replace(/(\.[a-z0-9]+)$/i, `-${i + 1}$1`)
            const buf = await saveImage(refs[i], p)
            console.log(`  ✅ ${path.basename(p)} (${(buf.length / 1024).toFixed(0)}KB)`)
          }
          // 生成成功的旁证：图片 token 数。为 0 说明这次其实没出图
          const imgTokens = data.usage?.completion_tokens_details?.image_tokens
          if (imgTokens) console.log(`  ️ ${data.model ?? model} · image_tokens=${imgTokens}`)
          resolve(outputPath)
        } catch (e) { reject(new Error(e.message)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(postData)
    req.end()
  })
}

async function main() {
  const argv = process.argv.slice(2)

  // --model=xxx 临时换模型（默认见顶部 MODEL）
  const mi = argv.findIndex(a => a.startsWith('--model='))
  const opts = mi >= 0 ? { model: argv[mi].slice('--model='.length) } : {}

  // --list 显示模板
  if (argv.includes('--list')) {
    console.log('内置模板：')
    for (const k of Object.keys(TEMPLATES)) console.log(`  ${k}`)
    console.log('\n用法示例：')
    console.log('  node gen-image.cjs --template="怪物·野猪王"')
    console.log('  node gen-image.cjs "自定义提示词" -o src/assets/sprites/generated/xxx.png')
    console.log(`\n当前模型：${MODEL}（用 --model=xxx 临时覆盖）`)
    return
  }

  // 批量
  const batchIdx = argv.findIndex(a => a === '--batch')
  if (batchIdx >= 0) {
    const file = argv[batchIdx + 1]
    const tasks = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const t of tasks) {
      console.log(`生成: ${t.name ?? t.out}`)
      try { await generateImage(t.prompt, path.join(OUT_DIR, t.out), opts) }
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
  try { await generateImage(prompt, outPath, opts) }
  catch (e) { console.log(`❌ ${e.message}`) }
}

main().catch(console.error)