// Backend: mỗi vai trò là một lần gọi `claude -p` (Claude Code CLI, dùng phiên đăng nhập sẵn có).
// - Persona: agents/_rules.md + agents/<Role>.md (sửa file là có hiệu lực ở câu tiếp theo)
// - Trò chuyện: office/chat/<A>-<B>.md cho từng cặp agent, team.md cho cả nhóm,
//   Sep-<Role>.md giữa bạn và từng agent. Agent đọc phần cuối file của kênh làm trí nhớ.
// - Nhật ký tổng: office/chat.md (để bạn theo dõi cả phòng, agent không đọc)
// - Hộp thư của bạn: office/inbox.md (dòng bắt đầu bằng @Role)
// Chạy: npm run server
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 8787)
const ROOT = path.resolve(import.meta.dirname, '..')
const AGENTS_DIR = path.join(ROOT, 'agents')
const CHAT_FILE = path.join(ROOT, 'office', 'chat.md')
const CHANNEL_DIR = path.join(ROOT, 'office', 'chat')
const INBOX_FILE = path.join(ROOT, 'office', 'inbox.md')
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const CLAUDE_MODEL = process.env.CLAUDE_MODEL // để trống = model mặc định của Claude Code
const CLI_TIMEOUT_MS = 90_000
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

function tail(file: string, n: number) {
  if (!fs.existsSync(file)) return ''
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('- ')).slice(-n).join('\n')
}

// Trạng thái từng agent do giao diện gửi lên (đang giữ task gì, đang rảnh chơi gì...)
const statuses: Partial<Record<Role, string>> = {}

// ---------- gọi Claude CLI ----------

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

function runClaude(system: string, prompt: string): Promise<Line> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', OUTPUT_SCHEMA,
    '--system-prompt', system,
    '--tools', '', // chỉ nói chuyện, không đụng file hay lệnh
    '--no-session-persistence',
    '--effort', 'low',
  ]
  if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL)

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: ROOT, windowsHide: true, env: childEnv })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS)
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
        resolve({
          title: typeof so.title === 'string' ? so.title.trim().slice(0, 60) : '',
          area: typeof so.area === 'string' && ['BE', 'FE', 'FULLSTACK'].includes(so.area) ? so.area : '',
          text: so.text.trim().slice(0, 400),
        })
      } catch (e) {
        reject(new Error(`claude thoát mã ${code}: ${(e as Error).message} ${err.slice(0, 300)}`))
      }
    })
    child.stdin.end(prompt)
  })
}

/**
 * Một câu thoại của `role`. Agent chỉ đọc lịch sử của kênh đang nói (cặp riêng / team / sếp),
 * cộng vài tin chung của team để biết tình hình.
 */
async function speak(role: Role, situation: string, channel?: Channel) {
  const team = channelFile(role, 'team').file
  const parts = [`Trạng thái hiện tại của bạn: ${statuses[role] ?? 'không rõ'}`]
  if (channel && channel !== 'team') {
    const { file, title } = channelFile(role, channel)
    parts.push(`${title} (mới nhất ở cuối):\n${tail(file, 12) || '(chưa có tin nào)'}`)
  }
  parts.push(`Kênh chung của team (mới nhất ở cuối):\n${tail(team, channel === 'team' ? 12 : 5) || '(chưa có tin nào)'}`)
  parts.push(`Tình huống: ${situation}`)

  const line = await withSlot(() => runClaude(systemPrompt(role), parts.join('\n\n')))
  if (channel) appendChannel(role, channel, who(role), line.text)
  const to = !channel ? '' : channel === 'team' ? ' → team' : channel === 'boss' ? ' → Sếp' : ` → ${channel}`
  appendLog(`${who(role)}${to}`, line.text)
  return line
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
    const { text } = await speak(role, `Sếp vừa nhắn cho bạn: "${message}". Trả lời sếp.`, 'boss')
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
    if (!role || typeof situation !== 'string' || !situation || situation.length > 600 || channel === role) {
      return send(res, 400, { error: 'invalid_request' })
    }
    try {
      return send(res, 200, await speak(role, situation, channel))
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
    const t = text.match(TASK_RE)
    const m = text.match(CHAT_RE)
    const ok = t ? !!toTarget(t[1]) : !!m && (m[1].toLowerCase() === 'all' || !!toRole(m[1]))
    if (!ok || text.length > 500) {
      return send(res, 400, { error: 'Nhắn: @PM/@BE/@FE/@QA/@Tester/@all nội dung · Giao việc: giao @team hoặc giao @FE nội dung' })
    }
    const current = fs.readFileSync(INBOX_FILE, 'utf8')
    fs.appendFileSync(INBOX_FILE, `${current.endsWith('\n') ? '' : '\n'}${text}\n`)
    void checkInbox()
    return send(res, 200, { ok: true })
  }

  send(res, 404, { error: 'not_found' })
})

ensureChatFile()
setInterval(() => void checkInbox(), 1000)
server.listen(PORT, '127.0.0.1', () => {
  console.log(`IT Room server: http://127.0.0.1:${PORT} (Claude CLI: ${CLAUDE_BIN}${CLAUDE_MODEL ? `, model ${CLAUDE_MODEL}` : ''})`)
  console.log(`Nhắn agent: sửa ${path.relative(ROOT, INBOX_FILE)}  ·  Nhật ký: ${path.relative(ROOT, CHAT_FILE)}`)
})
