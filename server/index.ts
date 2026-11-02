// Backend: mỗi agent có một session Claude Code CLI riêng (`claude -p --resume <id>`, dùng phiên đăng nhập sẵn có).
// - Persona: agents/_rules.md + agents/<Role>.md (sửa file là có hiệu lực ở câu tiếp theo)
// - Session: office/sessions.json (máy đọc) + office/sessions.md (bạn đọc, có lệnh mở session trong terminal)
// - Trò chuyện: office/chat/<A>-<B>.md cho từng cặp agent, team.md cho cả nhóm,
//   Sep-<Role>.md giữa bạn và từng agent. Mỗi lượt nói, agent chỉ nhận các tin mới chưa đọc
//   trong kênh đó; những gì đã nghe/nói thì nằm sẵn trong session của agent.
// - Nhật ký tổng: office/chat.md (để bạn theo dõi cả phòng, agent không đọc)
// - Hộp thư của bạn: office/inbox.md (dòng bắt đầu bằng @Role, giao @..., reset @...)
// Chạy: npm run server
import http from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 8787)
const ROOT = path.resolve(import.meta.dirname, '..')
const AGENTS_DIR = path.join(ROOT, 'agents')
const CHAT_FILE = path.join(ROOT, 'office', 'chat.md')
const CHANNEL_DIR = path.join(ROOT, 'office', 'chat')
const INBOX_FILE = path.join(ROOT, 'office', 'inbox.md')
const SESSIONS_FILE = path.join(ROOT, 'office', 'sessions.json')
const SESSIONS_MD = path.join(ROOT, 'office', 'sessions.md')
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const CLAUDE_MODEL = process.env.CLAUDE_MODEL // đặt biến này = dùng một model cho mọi việc, bỏ qua agents/_models.md
const MODELS_FILE = path.join(ROOT, 'agents', '_models.md')
const AGY_BIN = process.env.AGY_BIN ?? 'agy'
// agy là agent có công cụ: chạy trong thư mục trống riêng để không đụng vào code dự án
const AGY_WORKSPACE = path.join(ROOT, 'office', 'agy-workspace')
const CLI_TIMEOUT_MS = 120_000
const MAX_PARALLEL = 3

// Mặc định dùng phiên đăng nhập Claude Code: bỏ API key trong env vì nó được ưu tiên hơn login.
// Đặt USE_API_KEY=1 nếu muốn CLI dùng ANTHROPIC_API_KEY.
const childEnv = { ...process.env }
if (process.env.USE_API_KEY !== '1') {
  delete childEnv.ANTHROPIC_API_KEY
  delete childEnv.ANTHROPIC_AUTH_TOKEN
}

const ROLES = ['PM', 'BE', 'FE', 'QA', 'Tester'] as const
type Role = (typeof ROLES)[number]
const NAMES: Record<Role, string> = { PM: 'Lan', BE: 'Minh', FE: 'Khoa', QA: 'Hà', Tester: 'Tú' }

const OUTPUT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    title: { type: 'string' },
    area: { type: 'string', enum: ['', 'BE', 'FE', 'FULLSTACK'] },
    text: { type: 'string' },
  },
  required: ['title', 'area', 'text'],
  additionalProperties: false,
})

interface Line {
  title: string
  area: string
  text: string
}

const toRole = (s: string): Role | undefined => ROLES.find((r) => r.toLowerCase() === s.toLowerCase())
const now = () => new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

// ---------- file .md ----------

function readMd(file: string) {
  return fs.readFileSync(file, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}

/** Loại việc của một câu thoại, quyết định model (xem agents/_models.md) */
const KINDS = ['smalltalk', 'work', 'plan', 'boss'] as const
type Kind = (typeof KINDS)[number]

/** CLI nói thay agent: Claude Code (`claude`) hoặc Antigravity (`agy`) */
type Engine = 'claude' | 'agy'

/** Giá trị `key:` trong phần đầu (frontmatter) của một file .md */
function frontmatter(file: string, key: string): string | undefined {
  try {
    const head = fs.readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
    return head.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1].trim() || undefined
  } catch {
    return undefined
  }
}

/** `cli: antigravity` (hoặc `agy`) trong agents/<Role>.md → dùng agy; mặc định claude */
function engineOf(role: Role): Engine {
  const cli = frontmatter(path.join(AGENTS_DIR, `${role}.md`), 'cli')?.toLowerCase()
  return cli === 'antigravity' || cli === 'agy' ? 'agy' : 'claude'
}

/** Model cho loại việc, đọc từ agents/_models.md (khoá `agy_<loại>` cho agy); trống = model mặc định của CLI */
function modelFor(kind: Kind, engine: Engine): string | undefined {
  if (engine === 'claude' && CLAUDE_MODEL) return CLAUDE_MODEL
  const value = frontmatter(MODELS_FILE, engine === 'agy' ? `agy_${kind}` : kind)
  // chỉ nhận tên model hợp lệ (vd haiku, gemini-3.8-flash-low), không để lọt chuỗi bắt đầu bằng "-" thành cờ CLI
  return value && /^[a-z][a-z0-9._\-]*$/i.test(value) ? value : undefined
}

function systemPrompt(role: Role) {
  return `${readMd(path.join(AGENTS_DIR, '_rules.md'))}\n\n${readMd(path.join(AGENTS_DIR, `${role}.md`))}`
}

function ensureChatFile() {
  fs.mkdirSync(CHANNEL_DIR, { recursive: true })
  if (!fs.existsSync(CHAT_FILE)) {
    fs.writeFileSync(CHAT_FILE, '# Nhật ký tổng phòng IT\n\nServer tự ghi mọi câu nói vào đây để bạn theo dõi. Agent không đọc file này; mỗi agent chỉ đọc file của kênh mình đang nói (office/chat/).\n\n')
  }
}

const who = (role: Role) => `${role} (${NAMES[role]})`
const mdLine = (speaker: string, text: string) => `- ${now()} **${speaker}:** ${text.replace(/\s+/g, ' ')}\n`

function appendLog(speaker: string, text: string) {
  fs.appendFileSync(CHAT_FILE, mdLine(speaker, text))
}

/** Kênh trò chuyện: một đồng đội, cả team, hoặc sếp (người dùng) */
type Channel = Role | 'team' | 'boss'

function channelFile(role: Role, channel: Channel) {
  if (channel === 'team') return { file: path.join(CHANNEL_DIR, 'team.md'), title: 'Kênh chung của team (thông báo, standup)' }
  if (channel === 'boss') return { file: path.join(CHANNEL_DIR, `Sep-${role}.md`), title: `Trò chuyện riêng: Sếp ↔ ${who(role)}` }
  const [a, b] = [role, channel].sort((x, y) => ROLES.indexOf(x) - ROLES.indexOf(y))
  return { file: path.join(CHANNEL_DIR, `${a}-${b}.md`), title: `Trò chuyện riêng: ${who(a)} ↔ ${who(b)}` }
}

function appendChannel(role: Role, channel: Channel, speaker: string, text: string) {
  const { file, title } = channelFile(role, channel)
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${title}\n\n`)
  fs.appendFileSync(file, mdLine(speaker, text))
}

function messages(file: string) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('- '))
}

// Trạng thái từng agent do giao diện gửi lên (đang giữ task gì, đang rảnh chơi gì...)
const statuses: Partial<Record<Role, string>> = {}

// ---------- session riêng của từng agent ----------

interface AgentSession {
  /** claude: session id do server tạo · agy: conversation_id do agy trả về sau lượt đầu */
  id: string
  /** Thiếu ở file cũ = claude */
  engine?: Engine
  started: string
  turns: number
  /** Số tin đã giao cho agent trong từng file kênh (theo tên file) */
  seen: Record<string, number>
}

let sessions: Partial<Record<Role, AgentSession>> = {}
try {
  sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')) as typeof sessions
} catch {
  // chưa có file: tạo session khi agent nói lần đầu
}

function saveSessions() {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2))
  const rows = ROLES.map((r) => {
    const s = sessions[r]
    const engine = s?.engine ?? engineOf(r)
    if (!s?.id) return `| ${who(r)} | ${engine} | (chưa có) | | 0 |`
    const open = engine === 'agy' ? `cd office/agy-workspace && agy --conversation ${s.id}` : `claude --resume ${s.id}`
    return `| ${who(r)} | ${engine} | \`${open}\` | ${s.started} | ${s.turns} |`
  })
  fs.writeFileSync(
    SESSIONS_MD,
    [
      '# Session CLI của từng agent',
      '',
      'Server tự ghi file này. Mỗi agent là một session CLI riêng (Claude Code hoặc Antigravity, theo dòng `cli:` trong agents/<Role>.md),',
      'nhớ mọi thứ mình đã nghe và nói.',
      '',
      'Xem lại hoặc nói chuyện trực tiếp với một agent: mở terminal ở thư mục dự án rồi chạy lệnh ở cột "Mở session".',
      'Nên tắt `npm run server` trước khi nói chuyện trực tiếp, để server và bạn không cùng ghi vào một session.',
      '',
      'Bắt đầu lại từ đầu (agent quên hết): thêm dòng `reset @BE` hoặc `reset @all` vào office/inbox.md.',
      '',
      '| Agent | CLI | Mở session | Bắt đầu | Số lượt |',
      '|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n'),
  )
}

/**
 * Session mới bắt đầu "trắng": coi như đã đọc hết tin cũ, chỉ nhận tin phát sinh từ lúc này.
 * Agent đổi CLI (sửa `cli:`) thì bắt đầu session mới, vì hai CLI không dùng chung trí nhớ.
 */
function sessionOf(role: Role, engine: Engine): AgentSession {
  const current = sessions[role]
  if (current && (current.engine ?? 'claude') !== engine) delete sessions[role]
  if (!sessions[role]) {
    const seen: Record<string, number> = {}
    for (const f of fs.readdirSync(CHANNEL_DIR).filter((n) => n.endsWith('.md'))) {
      seen[f] = messages(path.join(CHANNEL_DIR, f)).length
    }
    sessions[role] = {
      id: engine === 'claude' ? crypto.randomUUID() : '', // agy tự cấp conversation_id ở lượt đầu
      engine,
      started: new Date().toLocaleString('vi-VN'),
      turns: 0,
      seen,
    }
  }
  return sessions[role]
}

function resetSession(role: Role) {
  delete sessions[role]
  stopWorker(role) // tiến trình agy đang gắn với hội thoại cũ
  saveSessions()
  prewarmWorker(role) // bật sẵn tiến trình mới cho session mới
}

/** Tin trong `file` mà agent chưa nhận (bỏ qua câu của chính agent, vì đã nằm trong session) */
function unread(role: Role, s: AgentSession, file: string, cap: number) {
  const all = messages(file)
  const key = path.basename(file)
  const from = s.seen[key] ?? 0 // kênh tạo ra sau khi session bắt đầu: đọc từ đầu
  const text = all
    .slice(from)
    .filter((l) => !l.includes(`**${who(role)}:**`))
    .slice(-cap)
    .join('\n')
  // chỉ đánh dấu đã đọc sau khi agent trả lời thành công
  return { text, markRead: (target: AgentSession) => (target.seen[key] = all.length) }
}

// Mỗi session chỉ được một tiến trình CLI dùng tại một thời điểm
const roleChains = new Map<Role, Promise<unknown>>()
function withRole<T>(role: Role, fn: () => Promise<T>): Promise<T> {
  const next = (roleChains.get(role) ?? Promise.resolve()).then(fn, fn)
  roleChains.set(role, next.catch(() => {}))
  return next
}

// ---------- gọi CLI (Claude Code / Antigravity) ----------

let running = 0
const queue: (() => void)[] = []
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => queue.push(r))
  running++
  try {
    return await fn()
  } finally {
    running--
    queue.shift()?.()
  }
}

/** `resume`: nối tiếp session có sẵn; không thì tạo session mới với đúng id đó */
function runClaude(system: string, prompt: string, sessionId: string, resume: boolean, model?: string): Promise<Line> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', OUTPUT_SCHEMA,
    '--system-prompt', system,
    '--tools', '', // chỉ nói chuyện, không đụng file hay lệnh
    resume ? '--resume' : '--session-id', sessionId,
    '--effort', 'low',
  ]
  if (model) args.push('--model', model) // đổi model giữa các lượt vẫn giữ nguyên trí nhớ của session

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: ROOT, windowsHide: true, env: childEnv })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS)
    child.stdout.setEncoding('utf8') // không cắt đôi ký tự tiếng Việt ở ranh giới các đoạn dữ liệu
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Không chạy được "${CLAUDE_BIN}": ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const result = JSON.parse(out) as {
          is_error?: boolean
          result?: string
          structured_output?: { title?: unknown; area?: unknown; text?: unknown }
        }
        const so = result.structured_output
        if (result.is_error || !so || typeof so.text !== 'string') throw new Error(result.result ?? 'không có structured_output')
        resolve(toLine(so))
      } catch (e) {
        reject(new Error(`claude thoát mã ${code}: ${(e as Error).message} ${err.slice(0, 300)}`))
      }
    })
    child.stdin.end(prompt)
  })
}

function toLine(o: { title?: unknown; area?: unknown; text?: unknown }): Line {
  if (typeof o.text !== 'string' || !o.text.trim()) throw new Error('thiếu text')
  return {
    title: typeof o.title === 'string' ? o.title.trim().slice(0, 60) : '',
    area: typeof o.area === 'string' && ['BE', 'FE', 'FULLSTACK'].includes(o.area) ? o.area : '',
    text: o.text.trim().slice(0, 400),
  }
}

const AGY_FORMAT =
  'Chỉ trả lời đúng MỘT dòng JSON dạng {"title":"","area":"","text":"câu thoại"} (area là "", "BE", "FE" hoặc "FULLSTACK"), ' +
  'không thêm chữ nào khác, không dùng công cụ, không đọc hay sửa file.'

/**
 * Antigravity CLI. agy không có cờ system prompt nên persona nằm trong prompt của lượt đầu.
 * Không dùng --json-schema: khi nối tiếp hội thoại, structured_output của agy trả về kết quả của lượt trước,
 * nên đọc JSON trực tiếp từ `response`.
 */
function runAgy(prompt: string, conversationId: string | undefined, model?: string): Promise<Line & { conversationId: string }> {
  const args = ['--output-format', 'json', '--sandbox']
  if (model) args.push('--model', model)
  if (conversationId) args.push('--conversation', conversationId)
  args.push('-p', prompt) // prompt đã kèm AGY_FORMAT

  fs.mkdirSync(AGY_WORKSPACE, { recursive: true })
  return new Promise((resolve, reject) => {
    const child = spawn(AGY_BIN, args, { cwd: AGY_WORKSPACE, windowsHide: true, env: process.env })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Không chạy được "${AGY_BIN}": ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const result = JSON.parse(out) as { conversation_id?: string; status?: string; response?: string }
        if (result.status !== 'SUCCESS' || !result.conversation_id || typeof result.response !== 'string') {
          throw new Error(`status ${result.status}`)
        }
        resolve({ ...parseAgyResponse(result.response), conversationId: result.conversation_id })
      } catch (e) {
        reject(new Error(`agy thoát mã ${code}: ${(e as Error).message} ${(err || out).slice(0, 300)}`))
      }
    })
  })
}

/** Lấy object JSON cuối cùng trong câu trả lời của agy; không có thì dùng nguyên văn (bỏ markdown) */
function parseAgyResponse(response: string): Line {
  const json = response.match(/\{[^{}]*"text"[^{}]*\}/g)?.pop()
  return json
    ? toLine(JSON.parse(json) as Record<string, unknown>)
    : toLine({ text: response.replace(/[*`#>]/g, '').replace(/\s+/g, ' ') })
}

/**
 * Tiến trình agy chạy liên tục cho một agent (`--input-format stream-json`): khởi động một lần,
 * mỗi lượt nói chỉ ghi một dòng JSON vào stdin, nên nhanh hơn nhiều so với bật agy mỗi câu.
 * Model gắn với tiến trình lúc khởi động; cần model khác thì khởi động lại trên cùng hội thoại.
 */
class AgyWorker {
  alive = true
  conversationId?: string
  readonly role: Role
  readonly model: string | undefined
  private readonly child: ChildProcessWithoutNullStreams
  private buf = ''
  private pending?: { resolve: (r: { response: string; conversationId: string }) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

  // không dùng "constructor(readonly role ...)": Node chạy .ts bằng cách bỏ kiểu, không hỗ trợ cú pháp đó
  constructor(role: Role, conversationId: string | undefined, model: string | undefined) {
    this.role = role
    this.model = model
    const args = ['--output-format', 'stream-json', '--input-format', 'stream-json', '--sandbox']
    if (model) args.push('--model', model)
    if (conversationId) args.push('--conversation', conversationId)
    fs.mkdirSync(AGY_WORKSPACE, { recursive: true })
    this.child = spawn(AGY_BIN, args, { cwd: AGY_WORKSPACE, windowsHide: true, env: process.env })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (d: string) => this.onData(d))
    this.child.stderr.on('data', () => {})
    this.child.on('error', (e) => this.die(e.message))
    this.child.on('close', (code) => this.die(`thoát mã ${code}`))
    console.log(`[agy] bật tiến trình chạy liên tục cho ${role} (model ${model ?? 'mặc định'})`)
  }

  private onData(chunk: string) {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const raw = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!raw.startsWith('{')) continue
      let ev: { event?: string; conversation_id?: string; result?: { status?: string; response?: string; error?: string; conversation_id?: string } }
      try {
        ev = JSON.parse(raw)
      } catch {
        continue
      }
      if (ev.event === 'init' && ev.conversation_id) this.conversationId = ev.conversation_id
      if (ev.event !== 'result' || !this.pending) continue
      const p = this.pending
      this.pending = undefined
      clearTimeout(p.timer)
      const r = ev.result
      const id = r?.conversation_id ?? this.conversationId
      if (r?.status === 'SUCCESS' && typeof r.response === 'string' && id) p.resolve({ response: r.response, conversationId: id })
      else p.reject(new Error(r?.error || `status ${r?.status}`))
    }
  }

  private die(reason: string) {
    if (!this.alive) return
    this.alive = false
    const p = this.pending
    this.pending = undefined
    if (p) {
      clearTimeout(p.timer)
      p.reject(new Error(`tiến trình agy của ${this.role} dừng: ${reason}`))
    }
  }

  /** Một lượt nói. withRole bảo đảm mỗi lúc chỉ có một lượt đang chờ */
  send(text: string): Promise<{ response: string; conversationId: string }> {
    if (!this.alive) return Promise.reject(new Error('tiến trình đã dừng'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('quá thời gian chờ'))
        this.stop()
      }, CLI_TIMEOUT_MS)
      this.pending = { resolve, reject, timer }
      this.child.stdin.write(`${JSON.stringify({ event: 'user', message: { role: 'user', content: text } })}\n`)
    })
  }

  stop() {
    if (this.alive) {
      this.child.stdin.end()
      this.child.kill()
    }
    this.die('đã tắt')
  }
}

const workers = new Map<Role, AgyWorker>()

function stopWorker(role: Role) {
  workers.get(role)?.stop()
  workers.delete(role)
}

/** Bật sẵn tiến trình cho agent agy (dùng model của loại việc "work", phổ biến nhất) */
function prewarmWorker(role: Role) {
  if (engineOf(role) !== 'agy' || workers.get(role)?.alive) return
  workers.set(role, new AgyWorker(role, sessions[role]?.engine === 'agy' ? sessions[role]?.id || undefined : undefined, modelFor('work', 'agy')))
}

const REWARM_AFTER_MS = 20_000
const rewarmTimers = new Map<Role, NodeJS.Timeout>()

/**
 * Sau một câu dùng model khác (vd họp dùng flash-high), nếu agent im lặng một lúc thì chuyển tiến trình
 * về model "work" ở chế độ nền, để câu thường ngày tiếp theo không phải chờ khởi động lại.
 * Trong lúc họp các lượt nói gần nhau nên tiến trình vẫn giữ model của cuộc họp.
 */
function scheduleRewarm(role: Role) {
  clearTimeout(rewarmTimers.get(role))
  rewarmTimers.set(
    role,
    setTimeout(() => {
      void withRole(role, async () => {
        const want = modelFor('work', 'agy')
        const w = workers.get(role)
        if (engineOf(role) !== 'agy' || (w?.alive && w.model === want)) return
        stopWorker(role)
        workers.set(role, new AgyWorker(role, sessions[role]?.id || undefined, want))
      })
    }, REWARM_AFTER_MS),
  )
}

/** Một lượt agy: dùng tiến trình chạy liên tục; lỗi thì tắt nó và gọi agy một lần như cũ */
async function agyTurn(role: Role, s: AgentSession, text: string, model?: string): Promise<Line & { via: string }> {
  clearTimeout(rewarmTimers.get(role))
  try {
    return await agyTurnInner(role, s, text, model)
  } finally {
    // tính 20 giây im lặng từ lúc nói xong
    if (model !== modelFor('work', 'agy')) scheduleRewarm(role)
  }
}

async function agyTurnInner(role: Role, s: AgentSession, text: string, model?: string): Promise<Line & { via: string }> {
  let w = workers.get(role)
  if (w && (!w.alive || w.model !== model)) {
    stopWorker(role) // cần model khác (hoặc tiến trình đã chết): khởi động lại trên cùng hội thoại
    w = undefined
  }
  if (!w) {
    w = new AgyWorker(role, s.id || undefined, model)
    workers.set(role, w)
  }
  try {
    const { response, conversationId } = await w.send(text)
    s.id = conversationId
    return { ...parseAgyResponse(response), via: 'chạy liên tục' }
  } catch (e) {
    console.error(`[agy] ${role}: ${(e as Error).message}, chuyển sang gọi agy từng lần`)
    stopWorker(role)
    const { conversationId, ...line } = await runAgy(text, s.id || undefined, model)
    s.id = conversationId
    return { ...line, via: 'gọi từng lần' }
  }
}

/** Gọi đúng CLI của agent; với agy lượt đầu thì ghép persona vào prompt và ghi lại conversation_id */
async function runEngine(role: Role, s: AgentSession, prompt: string, model?: string): Promise<Line & { via: string }> {
  const first = s.turns === 0
  if ((s.engine ?? 'claude') === 'claude') {
    return { ...(await runClaude(systemPrompt(role), prompt, s.id, !first, model)), via: 'gọi từng lần' }
  }
  const text = `${first ? `${systemPrompt(role)}\n\n---\n\n` : ''}${prompt}\n\n${AGY_FORMAT}`
  return agyTurn(role, s, text, model)
}

/**
 * Một câu thoại của `role`, nói trong session riêng của agent đó.
 * Prompt chỉ gồm trạng thái hiện tại, các tin mới chưa đọc của kênh đang nói (và kênh team), và tình huống.
 */
function speak(role: Role, situation: string, channel?: Channel, kind: Kind = 'work') {
  return withRole(role, async () => {
    const engine = engineOf(role)
    const model = modelFor(kind, engine)
    if (engine !== 'agy') stopWorker(role) // vừa đổi `cli:` sang claude
    let s = sessionOf(role, engine)
    const parts = [`Trạng thái hiện tại của bạn: ${statuses[role] ?? 'không rõ'}`]
    const reads: ((target: AgentSession) => void)[] = []
    if (channel && channel !== 'team') {
      const { file, title } = channelFile(role, channel)
      const u = unread(role, s, file, 12)
      reads.push(u.markRead)
      parts.push(`Tin mới trong ${title}:\n${u.text || '(không có tin mới)'}`)
    }
    const team = unread(role, s, channelFile(role, 'team').file, channel === 'team' ? 12 : 5)
    reads.push(team.markRead)
    if (team.text || channel === 'team') parts.push(`Tin mới trong kênh chung của team:\n${team.text || '(không có tin mới)'}`)
    parts.push(`Tình huống: ${situation}`)
    const prompt = parts.join('\n\n')

    const t0 = Date.now()
    let line: Line & { via: string }
    try {
      line = await withSlot(() => runEngine(role, s, prompt, model))
    } catch (e) {
      if (s.turns === 0) throw e
      // Session không mở lại được (bị xoá, hỏng...): bắt đầu session mới thay vì im lặng
      console.error(`Session của ${role} lỗi, tạo session mới: ${(e as Error).message}`)
      resetSession(role)
      s = sessionOf(role, engine)
      line = await withSlot(() => runEngine(role, s, prompt, model))
    }
    const seconds = ((Date.now() - t0) / 1000).toFixed(1)
    s.turns++
    reads.forEach((markRead) => markRead(s))
    saveSessions()

    if (channel) appendChannel(role, channel, who(role), line.text)
    const to = !channel ? '' : channel === 'team' ? ' → team' : channel === 'boss' ? ' → Sếp' : ` → ${channel}`
    const modelLabel = `${engine}:${model ?? 'mặc định'}`
    appendLog(`${who(role)}${to}`, `${line.text} _(${kind} · ${modelLabel} · ${line.via} · ${seconds}s)_`)
    console.log(`[${role}] ${modelLabel} · ${line.via} · ${seconds}s`)
    return { title: line.title, area: line.area, text: line.text, model: modelLabel, kind, via: line.via, seconds: Number(seconds) }
  })
}

// ---------- sự kiện cho giao diện ----------

interface OfficeEvent {
  id: number
  type: 'user' | 'thinking' | 'reply' | 'error'
  role: Role
  text: string
}
const events: OfficeEvent[] = []
let nextEventId = 1
function emit(type: OfficeEvent['type'], role: Role, text = '') {
  events.push({ id: nextEventId++, type, role, text })
  if (events.length > 200) events.shift()
}

// ---------- hộp thư office/inbox.md ----------

async function answerBoss(role: Role, message: string) {
  emit('thinking', role)
  try {
    const { text } = await speak(role, `Sếp vừa nhắn cho bạn: "${message}". Trả lời sếp.`, 'boss', 'boss')
    emit('reply', role, text)
  } catch (e) {
    console.error((e as Error).message)
    emit('error', role, 'Không gọi được Claude CLI')
  }
}

// Việc sếp giao. Giữ đến khi giao diện báo làm xong; nếu trang đang làm bị đóng/tải lại
// (ngừng hỏi việc quá SESSION_TIMEOUT_MS) thì việc được trả lại cho trang khác nhận.
interface Assignment {
  id: number
  target: Role | 'team'
  text: string
  session?: string
}
const assignments: Assignment[] = []
let nextAssignmentId = 1
const lastSeen = new Map<string, number>()
const SESSION_TIMEOUT_MS = 8000

function claimAssignments(session: string) {
  const t = Date.now()
  lastSeen.set(session, t)
  for (const a of assignments) {
    if (a.session && a.session !== session && t - (lastSeen.get(a.session) ?? 0) > SESSION_TIMEOUT_MS) a.session = undefined
  }
  const mine = assignments.filter((a) => !a.session)
  mine.forEach((a) => (a.session = session))
  return mine.map(({ id, target, text }) => ({ id, target, text }))
}

const CHAT_RE = /^@(\w+)[:,]?\s+(.+)$/
const TASK_RE = /^giao\s+@(\w+)[:,]?\s+(.+)$/i
const RESET_RE = /^reset\s+@(\w+)\s*$/i
const toTarget = (s: string): Role | 'team' | undefined => (['team', 'all'].includes(s.toLowerCase()) ? 'team' : toRole(s))

function assign(target: Role | 'team', text: string) {
  assignments.push({ id: nextAssignmentId++, target, text })
  appendLog(`Sếp giao việc → ${target}`, text)
  if (target === 'team') appendChannel('PM', 'team', 'Sếp', `(giao việc chung) ${text}`)
  else appendChannel(target, 'boss', 'Sếp', `(giao việc) ${text}`)
}

let inboxBusy = false
async function checkInbox() {
  if (inboxBusy || !fs.existsSync(INBOX_FILE)) return
  inboxBusy = true
  try {
    const lines = fs.readFileSync(INBOX_FILE, 'utf8').split(/\r?\n/)
    const jobs: { roles: Role[]; message: string }[] = []
    let changed = false
    const updated = lines.map((line) => {
      const r = line.match(RESET_RE)
      if (r) {
        const roles = r[1].toLowerCase() === 'all' ? [...ROLES] : [toRole(r[1])].filter((x): x is Role => !!x)
        changed = true
        if (roles.length === 0) return `⚠️ ${line}  (không có vai trò "${r[1]}")`
        // Chờ lượt nói đang chạy của agent xong rồi mới xoá session
        for (const role of roles) void withRole(role, async () => resetSession(role))
        appendLog('Sếp', `reset session của ${roles.join(', ')}`)
        return `✅ ${line}`
      }
      const t = line.match(TASK_RE)
      if (t) {
        const target = toTarget(t[1])
        changed = true
        if (!target) return `⚠️ ${line}  (không có "${t[1]}", dùng @team hoặc @PM/@BE/@FE/@QA/@Tester)`
        assign(target, t[2].trim())
        return `✅ ${line}`
      }
      const m = line.match(CHAT_RE)
      if (!m) return line
      changed = true
      const roles = m[1].toLowerCase() === 'all' ? [...ROLES] : [toRole(m[1])].filter((r): r is Role => !!r)
      if (roles.length === 0) return `⚠️ ${line}  (không có vai trò "${m[1]}")`
      jobs.push({ roles, message: m[2].trim() })
      return `✅ ${line}`
    })
    if (!changed) return
    fs.writeFileSync(INBOX_FILE, updated.join('\n'))

    for (const { roles, message } of jobs) {
      appendLog(`Sếp → ${roles.length > 1 ? 'cả team' : roles[0]}`, message)
      for (const role of roles) appendChannel(role, 'boss', 'Sếp', roles.length > 1 ? `(nhắn cả team) ${message}` : message)
      emit('user', roles[0], roles.length > 1 ? `@all ${message}` : message)
      for (const role of roles) await answerBoss(role, message) // lần lượt để người sau đọc được câu người trước
    }
  } finally {
    inboxBusy = false
  }
}

// ---------- HTTP ----------

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 10_000) req.destroy()
    })
    req.on('end', () => {
      try {
        const body: unknown = JSON.parse(raw)
        resolve(typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null)
      } catch {
        resolve(null)
      }
    })
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, engine: 'claude-cli' })

  if (req.method === 'GET' && url.pathname === '/api/events') {
    const since = Number(url.searchParams.get('since') ?? 0)
    return send(res, 200, { events: events.filter((e) => e.id > since), last: nextEventId - 1 })
  }

  if (req.method === 'POST' && url.pathname === '/api/speak') {
    const body = await readJson(req)
    const role = typeof body?.role === 'string' ? toRole(body.role) : undefined
    const situation = body?.situation
    const rawChannel = body?.channel
    const channel: Channel | undefined =
      rawChannel === 'team' || rawChannel === 'boss' ? rawChannel : typeof rawChannel === 'string' ? toRole(rawChannel) : undefined
    const kind: Kind = KINDS.find((k) => k === body?.kind) ?? 'work'
    if (!role || typeof situation !== 'string' || !situation || situation.length > 600 || channel === role) {
      return send(res, 400, { error: 'invalid_request' })
    }
    try {
      return send(res, 200, await speak(role, situation, channel, kind))
    } catch (e) {
      console.error((e as Error).message)
      return send(res, 502, { error: 'claude_cli_failed' })
    }
  }

  // Giao diện nhận các việc sếp giao chưa ai nhận (gọi định kỳ, cũng là tín hiệu "trang còn mở")
  if (req.method === 'POST' && url.pathname === '/api/assignments/claim') {
    const body = await readJson(req)
    const session = typeof body?.session === 'string' ? body.session.slice(0, 64) : ''
    if (!session) return send(res, 400, { error: 'missing_session' })
    return send(res, 200, { assignments: claimAssignments(session) })
  }

  if (req.method === 'POST' && url.pathname === '/api/assignments/done') {
    const body = await readJson(req)
    const i = assignments.findIndex((a) => a.id === body?.id)
    if (i >= 0) assignments.splice(i, 1)
    return send(res, 200, { ok: true })
  }

  if (req.method === 'POST' && url.pathname === '/api/status') {
    const body = await readJson(req)
    const incoming = body?.statuses
    if (typeof incoming === 'object' && incoming !== null) {
      for (const [k, v] of Object.entries(incoming)) {
        const role = toRole(k)
        if (role && typeof v === 'string') statuses[role] = v.slice(0, 200)
      }
    }
    return send(res, 200, { ok: true })
  }

  // Ô chat trên giao diện cũng ghi vào inbox.md, để mọi tin nhắn đi qua cùng một file
  if (req.method === 'POST' && url.pathname === '/api/inbox') {
    const body = await readJson(req)
    const text = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : ''
    const r = text.match(RESET_RE)
    const t = text.match(TASK_RE)
    const m = text.match(CHAT_RE)
    const ok = r
      ? r[1].toLowerCase() === 'all' || !!toRole(r[1])
      : t
        ? !!toTarget(t[1])
        : !!m && (m[1].toLowerCase() === 'all' || !!toRole(m[1]))
    if (!ok || text.length > 500) {
      return send(res, 400, {
        error: 'Nhắn: @PM/@BE/@FE/@QA/@Tester/@all nội dung · Giao việc: giao @team hoặc giao @FE nội dung · Bắt đầu lại: reset @BE hoặc reset @all',
      })
    }
    const current = fs.readFileSync(INBOX_FILE, 'utf8')
    fs.appendFileSync(INBOX_FILE, `${current.endsWith('\n') ? '' : '\n'}${text}\n`)
    void checkInbox()
    return send(res, 200, { ok: true })
  }

  send(res, 404, { error: 'not_found' })
})

ensureChatFile()
saveSessions()
// Bật sẵn tiến trình agy chạy liên tục cho các agent dùng Antigravity; tắt hết khi server dừng
for (const r of ROLES) prewarmWorker(r)
const stopAll = () => workers.forEach((w) => w.stop())
process.on('exit', stopAll)
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0))
setInterval(() => void checkInbox(), 1000)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`IT Room server: http://127.0.0.1:${PORT}`)
  for (const r of ROLES) {
    const engine = engineOf(r)
    console.log(`  ${who(r)}: ${engine} · ${KINDS.map((k) => `${k}=${modelFor(k, engine) ?? 'mặc định'}`).join(', ')}`)
  }
  console.log(`Nhắn agent: sửa ${path.relative(ROOT, INBOX_FILE)}  ·  Nhật ký: ${path.relative(ROOT, CHAT_FILE)}`)
  console.log(`Session từng agent: ${path.relative(ROOT, SESSIONS_MD)}`)
})
