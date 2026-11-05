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
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PORT ?? 8787)
const ROOT = path.resolve(import.meta.dirname, '..')
const AGENTS_DIR = path.join(ROOT, 'agents')
const MODELS_DIR = path.join(ROOT, 'public', 'models')
/** Mô hình nhân vật nam; mọi file khác trong public/models là nữ */
const MALE_MODELS = ['readyplayer.me.glb']
const DEFAULT_MODEL = { nam: 'readyplayer.me.glb', nữ: 'Michelle.glb' }
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
if (process.platform === 'win32') {
  // công cụ cài sau khi mở app (ffmpeg qua winget, Python...) chưa có trong PATH của tiến trình này: đọc lại PATH người dùng
  // từ registry; đẩy WindowsApps xuống cuối vì ở đó `python` chỉ là lối tắt mở Microsoft Store
  const key = Object.keys(childEnv).find((k) => k.toLowerCase() === 'path') ?? 'Path'
  let user = ''
  try {
    user = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8', windowsHide: true }).match(/REG_(?:EXPAND_)?SZ\s+(.*)/)?.[1] ?? ''
  } catch {}
  const expand = (p: string) => p.replace(/%([^%]+)%/g, (_, v: string) => process.env[v] ?? '')
  const dirs = [...user.split(';').map(expand), ...(childEnv[key] ?? '').split(';')].filter(Boolean)
  const uniq = [...new Set(dirs)]
  childEnv[key] = [...uniq.filter((d) => !/WindowsApps/i.test(d)), ...uniq.filter((d) => /WindowsApps/i.test(d))].join(';')
}
if (process.env.USE_API_KEY !== '1') {
  delete childEnv.ANTHROPIC_API_KEY
  delete childEnv.ANTHROPIC_AUTH_TOKEN
}

/** 5 agent gốc giữ khung quy trình việc chung (họp → dev → review → test); sếp thêm được agent khác ở trang cài đặt */
const CORE_ROLES = ['PM', 'BE', 'FE', 'QA', 'Tester']
/** Mã agent = tên file agents/<Mã>.md */
type Role = string
/** Tên mặc định khi file tính cách chưa có dòng `tên:` */
const DEFAULT_NAMES: Record<string, string> = { PM: 'Lan', BE: 'Minh', FE: 'Khoa', QA: 'Hà', Tester: 'Tú' }
/** Vai trò khi làm việc thật (dòng `vai_trò:`): quyết định quyền dùng công cụ */
const FUNCS = ['PM', 'BE', 'FE', 'QA', 'Tester', 'Media', 'Design', 'Audio', 'Video', 'khác'] as const
type Func = (typeof FUNCS)[number]
/** Phòng media: trưởng nhóm (Media), thiết kế đồ hoạ, âm thanh, dựng video */
const MEDIA_FUNCS: Func[] = ['Media', 'Design', 'Audio', 'Video']
const MAX_AGENTS = 12

/** Danh sách agent: 5 agent gốc rồi tới agent thêm mới (theo thứ tự tạo, dòng `tạo_lúc:`) */
function scanRoles(): Role[] {
  const extra = fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => /^[A-Za-z][A-Za-z0-9]*\.md$/.test(f))
    .map((f) => f.slice(0, -3))
    .filter((r) => !CORE_ROLES.includes(r))
    .map((r) => ({ r, at: Number(frontmatter(path.join(AGENTS_DIR, `${r}.md`), 'tạo_lúc')) || 0 }))
    .sort((a, b) => a.at - b.at || a.r.localeCompare(b.r))
    .map((x) => x.r)
  return [...CORE_ROLES, ...extra]
}
let ROLES: Role[] = scanRoles()
const refreshRoles = () => (ROLES = scanRoles())

/** Vai trò của agent: agent gốc = chính mã của nó, agent thêm mới đọc dòng `vai_trò:` */
function funcOf(role: Role): Func {
  if (CORE_ROLES.includes(role)) return role as Func
  const v = frontmatter(path.join(AGENTS_DIR, `${role}.md`), 'vai_trò')
  return FUNCS.find((f) => f.toLowerCase() === v?.toLowerCase()) ?? 'khác'
}

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

/** Chuyên môn của agent (agents/<Role>_skills.md); trống nếu chưa có file */
const skillsFile = (role: Role) => path.join(AGENTS_DIR, `${role}_skills.md`)

function skillsOf(role: Role) {
  const file = skillsFile(role)
  return fs.existsSync(file) ? readMd(file) : ''
}

/** Luật chung + tính cách (agents/<Role>.md) + chuyên môn (agents/<Role>_skills.md) */
function systemPrompt(role: Role) {
  const skills = skillsOf(role)
  const team = ROLES.map((r) => `- ${nameOf(r)} (@${r})${r === role ? ' — chính bạn' : ''}: ${frontmatter(path.join(AGENTS_DIR, `${r}.md`), 'chức_danh') ?? funcOf(r)}`).join('\n')
  return `${readMd(path.join(AGENTS_DIR, '_rules.md'))}\n\n# Thành viên phòng IT hiện tại\n${team}\n\n${readMd(path.join(AGENTS_DIR, `${role}.md`))}${skills ? `\n\n${skills}` : ''}`
}

function ensureChatFile() {
  fs.mkdirSync(CHANNEL_DIR, { recursive: true })
  if (!fs.existsSync(CHAT_FILE)) {
    fs.writeFileSync(CHAT_FILE, '# Nhật ký tổng phòng IT\n\nServer tự ghi mọi câu nói vào đây để bạn theo dõi. Agent không đọc file này; mỗi agent chỉ đọc file của kênh mình đang nói (office/chat/).\n\n')
  }
}

/** Tên agent đọc từ `tên:` trong agents/<Role>.md (đổi được ở trang cài đặt) */
const nameOf = (role: Role) => frontmatter(path.join(AGENTS_DIR, `${role}.md`), 'tên') ?? DEFAULT_NAMES[role] ?? role
const names = () => Object.fromEntries(ROLES.map((r) => [r, nameOf(r)])) as Record<Role, string>
const who = (role: Role) => `${role} (${nameOf(role)})`
const mdLine = (speaker: string, text: string) => `- ${now()} **${speaker}:** ${text.replace(/\s+/g, ' ')}\n`

function appendLog(speaker: string, text: string) {
  fs.appendFileSync(CHAT_FILE, mdLine(speaker, text))
}

// ---------- nhóm chat do sếp tạo (office/groups.json, tin nhắn ở office/chat/Nhom-<id>.md) ----------

const GROUPS_FILE = path.join(ROOT, 'office', 'groups.json')

interface Group {
  id: string
  name: string
  members: Role[]
  created: string
}

let groups: Group[] = []
try {
  groups = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')) as Group[]
} catch {
  // chưa có nhóm nào
}
const saveGroups = () => fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2))
const groupFile = (id: string) => path.join(CHANNEL_DIR, `Nhom-${id}.md`)
const groupById = (id: string) => groups.find((g) => g.id === id)
const groupTitle = (g: Group) => `Nhóm chat "${g.name}" (Sếp, ${g.members.map(who).join(', ')})`

/** Kênh trò chuyện: một đồng đội, cả team, sếp (người dùng), hoặc một nhóm chat sếp tạo */
type Channel = Role | 'team' | 'boss' | `group:${string}`

function channelFile(role: Role, channel: Channel) {
  if (channel.startsWith('group:')) {
    const g = groupById(channel.slice(6))
    return { file: groupFile(channel.slice(6)), title: g ? groupTitle(g) : 'Nhóm chat' }
  }
  if (channel === 'team') return { file: path.join(CHANNEL_DIR, 'team.md'), title: 'Kênh chung của team (thông báo, standup)' }
  if (channel === 'boss') return { file: path.join(CHANNEL_DIR, `Sep-${role}.md`), title: `Trò chuyện riêng: Sếp ↔ ${who(role)}` }
  const [a, b] = [role, channel as Role].sort((x, y) => ROLES.indexOf(x) - ROLES.indexOf(y))
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

/**
 * Bảng tiến độ chung: việc sếp giao và kết quả làm việc thật (review, fix, test, merge...) lấy từ nhật ký office/chat.md.
 * Mọi agent đều đọc cùng một bảng trước khi nói, để không ai trả lời theo trí nhớ cũ (vd BE tưởng còn chờ review khi việc đã merge).
 */
function progressBoard(cap = 10) {
  return messages(CHAT_FILE)
    .filter((l) => /\*\*Sếp giao việc|· làm việc thật/.test(l))
    .slice(-cap)
    .join('\n')
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
  /** agy: dấu vân tay của hồ sơ (tính cách + chuyên môn) đã gửi gần nhất, để biết khi nào cần gửi lại */
  promptHash?: string
  /** Session làm việc thật trong thư mục dự án (Claude CLI lưu session theo thư mục chạy) */
  work?: { id: string; project: string; turns: number; promptHash?: string }
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
    .filter((l) => !l.includes(`**${role} (`)) // theo mã vai trò, để vẫn nhận ra câu cũ của mình sau khi đổi tên
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
// ---------- quota còn lại ----------

interface QuotaWindow {
  /** % đã dùng (0-100) */
  used: number
  /** Thời điểm làm mới (ms) */
  resetsAt: number | null
  status: string
}
/** Claude: lấy từ sự kiện rate_limit_event mà Claude CLI trả về trong mỗi lượt gọi (stream-json) */
let claudeQuota: { fiveHour: QuotaWindow | null; sevenDay: QuotaWindow | null; status: string; updatedAt: number } | null = null
/** Antigravity (agy) không báo con số quota: chỉ ghi lại lần gọi thành công / lỗi hết quota gần nhất */
const agyHealth: { lastOk: number | null; lastError: { at: number; text: string; quota: boolean } | null } = { lastOk: null, lastError: null }

function noteClaudeQuota(info: Record<string, unknown>) {
  const win = (w: unknown): QuotaWindow | null => {
    if (!w || typeof w !== 'object') return null
    const o = w as { utilization?: number; resetsAt?: number; status?: string }
    if (typeof o.utilization !== 'number') return null
    return { used: Math.round(o.utilization * 1000) / 10, resetsAt: typeof o.resetsAt === 'number' ? o.resetsAt * 1000 : null, status: o.status ?? '' }
  }
  const u = (info.unifiedWindows ?? {}) as Record<string, unknown>
  claudeQuota = { fiveHour: win(u.five_hour), sevenDay: win(u.seven_day), status: String(info.status ?? ''), updatedAt: Date.now() }
}

/** Đọc output stream-json của Claude CLI: ghi lại quota, trả về dòng kết quả cuối (giống --output-format json) */
function parseClaudeStream(out: string) {
  let result: Record<string, unknown> | null = null
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    let o: Record<string, unknown>
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o.type === 'rate_limit_event' && o.rate_limit_info) noteClaudeQuota(o.rate_limit_info as Record<string, unknown>)
    if (o.type === 'result') result = o
  }
  if (!result) throw new Error('không có kết quả')
  return result
}

/** Hỏi nhanh Claude (model nhẹ nhất) chỉ để đọc quota, khi chưa có số liệu hoặc số liệu đã cũ */
let quotaProbe: Promise<void> | null = null
function probeClaudeQuota() {
  quotaProbe ??= new Promise<void>((resolve) => {
    const child = spawn(CLAUDE_BIN, ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--tools', '', '--no-session-persistence'], { cwd: ROOT, windowsHide: true, env: childEnv })
    let out = ''
    const timer = setTimeout(() => child.kill(), 60_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.on('error', () => resolve())
    child.on('close', () => {
      clearTimeout(timer)
      try {
        parseClaudeStream(out)
      } catch {
        // không đọc được thì giữ số cũ
      }
      resolve()
    })
    child.stdin.end('Trả lời đúng một chữ: ok')
  }).finally(() => (quotaProbe = null))
  return quotaProbe
}

function runClaude(system: string, prompt: string, sessionId: string, resume: boolean, model?: string): Promise<Line> {
  const args = [
    '-p',
    '--output-format', 'stream-json', '--verbose', // stream-json để đọc được quota (rate_limit_event)
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
        const result = parseClaudeStream(out) as {
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

const promptHash = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 12)

/**
 * Hồ sơ mới (luật + tính cách + chuyên môn) cần gửi kèm tin nhắn khi session đã có từ trước.
 * Claude CLI giữ system prompt của lượt đầu khi --resume (cờ --system-prompt lúc đó bị bỏ qua),
 * còn agy không có cờ system prompt; nên mỗi khi file tính cách / chuyên môn đổi (trang cài đặt hoặc sửa tay)
 * thì lượt tiếp theo gửi lại bản mới trong tin nhắn, để agent luôn làm theo bản mới nhất.
 */
function profileUpdate(system: string, lastHash: string | undefined) {
  return lastHash === promptHash(system) ? '' : `Hồ sơ của bạn vừa được cập nhật. Từ giờ làm theo bản dưới đây, thay cho bản cũ:\n\n${system}\n\n---\n\n`
}

/** Gọi đúng CLI của agent; lượt đầu hồ sơ nằm ở system prompt (claude) hoặc đầu tin nhắn (agy) */
async function runEngine(role: Role, s: AgentSession, prompt: string, model?: string): Promise<Line & { via: string }> {
  const first = s.turns === 0
  const system = systemPrompt(role)
  const update = first ? '' : profileUpdate(system, s.promptHash)
  let line: Line & { via: string }
  if ((s.engine ?? 'claude') === 'claude') {
    line = { ...(await runClaude(system, `${update}${prompt}`, s.id, !first, model)), via: 'gọi từng lần' }
  } else {
    try {
      line = await agyTurn(role, s, `${first ? `${system}\n\n---\n\n` : update}${prompt}\n\n${AGY_FORMAT}`, model)
      agyHealth.lastOk = Date.now()
    } catch (e) {
      const text = (e as Error).message
      agyHealth.lastError = { at: Date.now(), text: text.slice(0, 200), quota: isOutOfTokens(text) }
      throw e
    }
  }
  s.promptHash = promptHash(system)
  return line
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
    const board = progressBoard()
    if (board)
      parts.push(
        'Bảng tiến độ chung của cả team (nguồn sự thật, dòng dưới cùng là mới nhất). Khi nói về tiến độ, việc đã xong hay đang chờ ai, ' +
          `hãy dựa vào bảng này chứ không dựa vào trí nhớ cũ của bạn; việc có "đã merge vào" là đã hoàn thành:\n${board}`,
      )
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
      // Chỉ tạo session mới khi CLI báo không tìm thấy session (bị xoá, hỏng...). Lỗi khác như hết quota,
      // mất mạng thì giữ nguyên session, để agent không mất trí nhớ chỉ vì một lần gọi lỗi
      if (s.turns === 0 || !/no conversation found|not found/i.test((e as Error).message)) throw e
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
    const to = !channel
      ? ''
      : channel === 'team'
        ? ' → team'
        : channel === 'boss'
          ? ' → Sếp'
          : channel.startsWith('group:')
            ? ` → nhóm ${groupById(channel.slice(6))?.name ?? ''}`
            : ` → ${channel}`
    const modelLabel = `${engine}:${model ?? 'mặc định'}`
    appendLog(`${who(role)}${to}`, `${line.text} _(${kind} · ${modelLabel} · ${line.via} · ${seconds}s)_`)
    console.log(`[${role}] ${modelLabel} · ${line.via} · ${seconds}s`)
    return { title: line.title, area: line.area, text: line.text, model: modelLabel, kind, via: line.via, seconds: Number(seconds) }
  })
}

// ---------- làm việc thật trên thư mục dự án (agents/_project.md) ----------

const PROJECT_FILE = path.join(AGENTS_DIR, '_project.md')
const PROJECTS_DIR = path.join(ROOT, 'projects')
const WORK_TIMEOUT_MS = 25 * 60_000

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `project-${Date.now().toString(36)}`
}

/** Thư mục dự án và branch chính; null = chưa cấu hình (chạy mô phỏng) */
function isOutOfTokens(err: string): boolean {
  return /quota|token|credit|rate_limit|resource_exhausted|429|overloaded|usage limit|hết quota|insufficient/i.test(err)
}

function projectConfig() {
  const dir = process.env.PROJECT_DIR ?? frontmatter(PROJECT_FILE, 'path')
  if (!dir) return null
  const base = frontmatter(PROJECT_FILE, 'base_branch') ?? 'main'
  return { dir: path.resolve(ROOT, dir), base: /^[\w./-]+$/.test(base) ? base : 'main' }
}

// ---------- sản phẩm của phòng media (thư mục media/ trong dự án) ----------

const MEDIA_TYPES: Record<string, { kind: 'audio' | 'image' | 'video'; mime: string }> = {
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.aiff': { kind: 'audio', mime: 'audio/aiff' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.svg': { kind: 'image', mime: 'image/svg+xml' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
}

function mediaList() {
  const p = projectConfig()
  if (!p) return []
  const root = path.join(p.dir, 'media')
  const out: { path: string; kind: string; size: number; time: number }[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 4 || !fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else {
        const t = MEDIA_TYPES[path.extname(e.name).toLowerCase()]
        if (!t) continue
        const st = fs.statSync(full)
        out.push({ path: path.relative(p.dir, full), kind: t.kind, size: st.size, time: st.mtimeMs })
      }
    }
  }
  walk(root, 0)
  return out.sort((a, b) => b.time - a.time)
}

/** Gửi một file media, có hỗ trợ Range (Safari / iPhone cần để phát video) */
function sendMedia(req: http.IncomingMessage, res: http.ServerResponse, rel: string) {
  const p = projectConfig()
  if (!p) return send(res, 404, { error: 'Chưa có dự án' })
  const root = path.join(p.dir, 'media')
  const full = path.resolve(p.dir, rel)
  const t = MEDIA_TYPES[path.extname(full).toLowerCase()]
  if (!full.startsWith(root + path.sep) || !t || !fs.existsSync(full)) return send(res, 404, { error: 'Không có file này' })
  const size = fs.statSync(full).size
  const headers: Record<string, string | number> = { 'Content-Type': t.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
  if (t.mime === 'image/svg+xml') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'" // SVG do agent viết: không cho chạy script
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      return res.end()
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    return fs.createReadStream(full, { start, end }).pipe(res)
  }
  res.writeHead(200, { ...headers, 'Content-Length': size })
  fs.createReadStream(full).pipe(res)
}

function git(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', ['-c', 'user.name=IT Room', '-c', 'user.email=itroom@local', ...args], { cwd, windowsHide: true })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (e) => resolve({ code: -1, out: e.message }))
    child.on('close', (code) => resolve({ code: code ?? -1, out: out.trim() }))
  })
}

// ---------- GitHub: đăng nhập (gh), nối repo, push ----------
// Repo GitHub của dự án = remote `origin` trong thư mục dự án (mỗi dự án một repo).
// Tự push sau mỗi lần merge bật / tắt bằng dòng `auto_push: true` trong agents/_project.md.

function ghRun(args: string[], cwd = ROOT): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn('gh', args, { cwd, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1' } })
    let out = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (e) => resolve({ code: -1, out: e.message }))
    child.on('close', (code) => resolve({ code: code ?? -1, out: out.trim() }))
  })
}

/** Ghi một dòng `key: value` vào phần đầu file .md (thêm nếu chưa có) */
function setFrontmatter(file: string, key: string, value: string) {
  const text = fs.readFileSync(file, 'utf8')
  const re = new RegExp(`^${key}:.*$`, 'm')
  fs.writeFileSync(file, re.test(text) ? text.replace(re, `${key}: ${value}`) : text.replace(/^---\r?\n/, `---\n${key}: ${value}\n`))
}

const autoPush = () => frontmatter(PROJECT_FILE, 'auto_push') === 'true'

/** Tài khoản GitHub đang đăng nhập trong gh; null = chưa đăng nhập / token hết hạn */
async function githubUser(): Promise<string | null> {
  const r = await ghRun(['api', 'user', '--jq', '.login'])
  return r.code === 0 && r.out ? r.out.split('\n')[0] : null
}

async function remoteOf(dir: string) {
  const r = await git(dir, ['remote', 'get-url', 'origin'])
  return r.code === 0 ? r.out : null
}

/** "owner/repo" hoặc link GitHub → { slug, url }; không hợp lệ thì null */
function parseRepo(input: string) {
  const m = input.trim().match(/^(?:https:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return m ? { slug: `${m[1]}/${m[2]}`, url: `https://github.com/${m[1]}/${m[2]}.git` } : null
}

/** Push branch chính lên origin (dùng thông tin đăng nhập của gh) */
async function pushBase(p: { dir: string; base: string }) {
  if (!(await remoteOf(p.dir))) return { ok: false, out: 'Dự án chưa nối repo GitHub' }
  await ghRun(['auth', 'setup-git']) // để git dùng token của gh
  const r = await git(p.dir, ['push', '-u', 'origin', p.base])
  appendLog('Hệ thống', r.code === 0 ? `đã push ${p.base} lên GitHub` : `push lên GitHub lỗi: ${r.out.slice(0, 200)}`)
  return { ok: r.code === 0, out: r.out.slice(-500) }
}

/** Đăng nhập GitHub bằng mã thiết bị: gh in mã 1 lần, sếp mở github.com/login/device và nhập mã */
type GhLoginState = 'idle' | 'starting' | 'waiting' | 'ok' | 'error'
const ghLogin: { state: GhLoginState; code?: string; url?: string; error?: string; child?: ReturnType<typeof spawn> } = { state: 'idle' }

function stopGhLogin() {
  ghLogin.child?.kill()
  ghLogin.child = undefined
}

function startGhLogin(): Promise<void> {
  stopGhLogin()
  Object.assign(ghLogin, { state: 'starting', code: undefined, url: undefined, error: undefined })
  // BROWSER=true: không mở trình duyệt trên máy chủ, sếp tự mở link (có thể trên điện thoại)
  const child = spawn('gh', ['auth', 'login', '-h', 'github.com', '-p', 'https', '-w', '--skip-ssh-key'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, BROWSER: 'true' },
  })
  ghLogin.child = child
  let out = ''
  return new Promise((resolve) => {
    const onData = (d: Buffer) => {
      out += d.toString()
      const code = out.match(/one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1]
      if (code && ghLogin.state === 'starting') {
        Object.assign(ghLogin, { state: 'waiting', code, url: out.match(/https:\/\/github\.com\/login\/device\S*/)?.[0] ?? 'https://github.com/login/device' })
        child.stdin?.write('\n') // qua bước "Press Enter to open github.com in your browser"
        resolve()
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (e) => {
      Object.assign(ghLogin, { state: 'error', error: `Không chạy được gh: ${e.message}` })
      resolve()
    })
    child.on('close', (code) => {
      if (ghLogin.child !== child) return resolve()
      ghLogin.child = undefined
      if (code === 0) {
        Object.assign(ghLogin, { state: 'ok', code: undefined, url: undefined })
        void ghRun(['auth', 'setup-git'])
        console.log('[github] đã đăng nhập GitHub từ trang cài đặt')
      } else Object.assign(ghLogin, { state: 'error', code: undefined, error: out.split('\n').filter(Boolean).pop() ?? `gh thoát mã ${code}` })
      resolve()
    })
  })
}

async function githubView() {
  const p = projectConfig()
  const busy = ghLogin.state === 'starting' || ghLogin.state === 'waiting'
  const { state, code, url, error } = ghLogin
  return {
    user: busy ? null : await githubUser(),
    login: { state, code, url, error },
    project: p && fs.existsSync(path.join(p.dir, '.git')) ? { dir: path.relative(ROOT, p.dir) || p.dir, base: p.base, remote: await remoteOf(p.dir), autoPush: autoPush() } : null,
  }
}

/** Nối dự án với repo GitHub: tạo repo mới (gh repo create) hoặc dùng repo có sẵn */
async function connectRepo(input: string, create: boolean, isPrivate: boolean) {
  const p = projectConfig()
  if (!p || !fs.existsSync(path.join(p.dir, '.git'))) return { error: 'Chưa có dự án (agents/_project.md)' }
  if (create) {
    const name = input.trim()
    if (!/^([\w.-]+\/)?[\w.-]+$/.test(name)) return { error: 'Tên repo chỉ gồm chữ, số, . _ - (vd my-app hoặc owner/my-app)' }
    if (await remoteOf(p.dir)) await git(p.dir, ['remote', 'remove', 'origin'])
    const r = await ghRun(['repo', 'create', name, isPrivate ? '--private' : '--public', '--source', p.dir, '--remote', 'origin'], p.dir)
    if (r.code !== 0) return { error: `Tạo repo lỗi: ${r.out.slice(0, 300)}` }
  } else {
    const repo = parseRepo(input)
    if (!repo) return { error: 'Nhập dạng owner/repo hoặc link https://github.com/owner/repo' }
    const has = await remoteOf(p.dir)
    const r = await git(p.dir, has ? ['remote', 'set-url', 'origin', repo.url] : ['remote', 'add', 'origin', repo.url])
    if (r.code !== 0) return { error: r.out.slice(0, 300) }
  }
  appendLog('Sếp', `nối dự án với GitHub: ${await remoteOf(p.dir)}`)
  return { ok: true }
}

/** Tự động khởi tạo thư mục dự án mới trong ROOT/projects/<slug> do PM Lan chủ trì */
async function initProject(name: string, description?: string) {
  const slug = slugify(name)
  const dir = path.join(PROJECTS_DIR, slug)
  fs.mkdirSync(dir, { recursive: true })
  const base = frontmatter(PROJECT_FILE, 'base_branch') ?? 'main'

  if (!fs.existsSync(path.join(dir, '.git'))) {
    await git(dir, ['init', '-b', base])
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\ndist/\n.env\n*.log\n')
    const desc = description ? `\n\n${description}` : ''
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\nDự án do team IT Room khởi tạo và phát triển.${desc}\n`)
    await git(dir, ['add', '-A'])
    await git(dir, ['commit', '-m', `Khởi tạo dự án: ${name}`])
    console.log(`[dự án] PM đã khởi tạo dự án mới: ${dir}`)
  }

  // Tự động cập nhật path trong agents/_project.md (relative path từ ROOT)
  const relativePath = path.relative(ROOT, dir).replace(/\\/g, '/')
  const currentContent = fs.readFileSync(PROJECT_FILE, 'utf8')
  let updatedContent = currentContent
  if (/^path:/m.test(updatedContent)) {
    updatedContent = updatedContent.replace(/^path:.*$/m, `path: ${relativePath}`)
  } else {
    updatedContent = updatedContent.replace(/^---\r?\n/, `---\npath: ${relativePath}\n`)
  }
  fs.writeFileSync(PROJECT_FILE, updatedContent)

  return { dir, base, slug, relativePath }
}

/** Tạo thư mục dự án và repo git nếu chưa có */
async function ensureProject() {
  let p = projectConfig()
  if (!p) {
    const init = await initProject('app-du-an', 'Dự án khởi tạo tự động')
    p = { dir: init.dir, base: init.base }
  }
  fs.mkdirSync(p.dir, { recursive: true })
  if (!fs.existsSync(path.join(p.dir, '.git'))) {
    await git(p.dir, ['init', '-b', p.base])
    if (!fs.existsSync(path.join(p.dir, '.gitignore'))) fs.writeFileSync(path.join(p.dir, '.gitignore'), 'node_modules/\ndist/\n.env\n')
    if (!fs.existsSync(path.join(p.dir, 'README.md'))) fs.writeFileSync(path.join(p.dir, 'README.md'), `# ${path.basename(p.dir)}\n\nDự án do team IT Room làm.\n`)
    await git(p.dir, ['add', '-A'])
    await git(p.dir, ['commit', '-m', 'Khởi tạo dự án'])
    console.log(`[dự án] tạo repo mới ở ${p.dir}`)
  }
  return p
}

// Chỉ có một thư mục làm việc: mỗi lúc một bước việc thật
let projectChain: Promise<unknown> = Promise.resolve()
function withProject<T>(fn: () => Promise<T>): Promise<T> {
  const next = projectChain.then(fn, fn)
  projectChain = next.catch(() => {})
  return next
}

/**
 * Phòng media: giọng đọc (macOS: say + afconvert; Windows: edge-tts / gTTS qua Python), ảnh (SVG → PNG bằng tools/svg2png.mjs),
 * video (ffmpeg, video TikTok từ ảnh bằng tools/tiktok.mjs)
 */
const IS_MAC = process.platform === 'darwin'
const MEDIA_TOOLS = [...(IS_MAC ? ['say', 'afconvert', 'afinfo', 'sips'] : []), 'ffmpeg', 'ffprobe', 'python3', 'python', 'node', 'ls', 'mkdir', 'cp', 'mv'].map((c) => `Bash(${c}:*)`)
const RUN_TOOLS = ['npm', 'npx', 'node', 'pnpm', 'yarn', 'python', 'py', 'pip', 'pytest', 'tsc', 'ls', 'cat', 'mkdir'].map((c) => `Bash(${c}:*)`)
const GIT_READ = ['git status', 'git diff', 'git log', 'git show'].map((c) => `Bash(${c}:*)`)
const READ_TOOLS = ['Read', 'Glob', 'Grep', ...GIT_READ]
const WRITE_TOOLS = ['Edit', 'MultiEdit', 'Write']

/**
 * Trình duyệt cho phòng media (Playwright MCP, Chrome thật với profile riêng đã đăng nhập Google sẵn): tạo ảnh trên Google Flow.
 * Chỉ một vai trò được dùng vì một profile không mở được hai Chrome cùng lúc.
 */
const BROWSER_FUNC: Func = 'Design'
const BROWSER_PROFILE = path.join(ROOT, 'office', 'browser-profile')
const BROWSER_DOWNLOADS = path.join(ROOT, 'office', 'browser-downloads')
const BROWSER_MCP = JSON.stringify({
  mcpServers: {
    browser: {
      command: process.execPath,
      args: [
        path.join(ROOT, 'node_modules', '@playwright', 'mcp', 'cli.js'),
        '--browser', 'chrome',
        '--user-data-dir', BROWSER_PROFILE,
        '--output-dir', BROWSER_DOWNLOADS,
        '--viewport-size', '1366,900',
      ],
    },
  },
})
const FLOW_RULES = `
# Tạo ảnh bằng Google Flow (công cụ mcp__browser__*)

Bạn có trình duyệt Chrome riêng, đã đăng nhập Google sẵn. Dùng nó để tạo ảnh AI trên Google Flow khi việc cần ảnh minh hoạ / ảnh cho video:
- Chỉ mở https://flow.google.com (và trang đăng nhập Google nếu nó tự chuyển tới). Không vào trang khác, không đăng xuất, không đổi cài đặt tài khoản, không mua credit, không chia sẻ / đăng công khai gì.
- Mỗi việc tạo tối đa 8 ảnh (mỗi lần tạo tốn credit của sếp). Prompt tiếng Anh, ghi rõ khổ dọc 9:16 nếu ảnh cho TikTok, giữ cùng một phong cách cho cả bộ ảnh.
- Xem trang bằng browser_snapshot rồi mới bấm; chờ ảnh tạo xong (browser_wait_for) rồi tải về. File tải về nằm trong ${BROWSER_DOWNLOADS}: chép sang \`media/images/\` của dự án bằng cp, đặt tên theo cảnh (vd \`scene-01.png\`), rồi Read lại ảnh để kiểm tra.
- Gặp trang đăng nhập Google, CAPTCHA, hết credit hay lỗi lạ: dừng lại, không tự nhập mật khẩu, báo rõ trong details để sếp xử lý.
- Xong việc thì đóng trình duyệt (browser_close).`

/** Công cụ theo vai trò: dev và tester sửa file + chạy lệnh, QA chỉ đọc, PM đọc và viết tài liệu */
function toolsFor(role: Role) {
  const f = funcOf(role)
  if (f === 'BE' || f === 'FE' || f === 'Tester') return [...READ_TOOLS, ...WRITE_TOOLS, ...RUN_TOOLS]
  if (f === 'PM') return [...READ_TOOLS, ...WRITE_TOOLS]
  if (f === BROWSER_FUNC) return [...READ_TOOLS, ...WRITE_TOOLS, ...MEDIA_TOOLS, 'mcp__browser']
  if (MEDIA_FUNCS.includes(f)) return [...READ_TOOLS, ...WRITE_TOOLS, ...MEDIA_TOOLS]
  return READ_TOOLS
}

const WORK_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    summary: { type: 'string' },
    verdict: { type: 'string', enum: ['done', 'pass', 'fail'] },
    area: { type: 'string', enum: ['', 'BE', 'FE', 'design', 'audio', 'video'] },
    details: { type: 'string' },
  },
  required: ['summary', 'verdict', 'area', 'details'],
  additionalProperties: false,
})

interface WorkResult {
  summary: string
  verdict: 'done' | 'pass' | 'fail'
  area: '' | 'BE' | 'FE' | 'design' | 'audio' | 'video'
  details: string
}

const WORK_RULES = `
# Làm việc thật

Bạn đang làm việc thật trong thư mục dự án (thư mục hiện tại). Server đã chuyển sẵn sang đúng branch của việc này.
- Không commit, không đổi branch, không merge, không push: server tự làm.
- Chỉ đụng vào file trong thư mục dự án.
- Lệnh shell chỉ được dùng: npm, npx, node, pnpm, yarn, python, pip, pytest, tsc, ls, cat, mkdir, git status/diff/log/show. Lệnh khác sẽ bị từ chối.
- Không chạy lệnh chờ mãi (dev server, watch); chạy build/test một lần rồi dừng.
- Trả lời cuối cùng theo đúng schema: summary là 1-2 câu tiếng Việt kể ngắn đã làm gì (để nói với đồng đội), details là chi tiết (file đã đổi, cách chạy, lỗi cụ thể nếu có).`

/** Luật riêng cho agent phòng media (vai trò Media) */
const SVG2PNG = path.join(ROOT, 'tools', 'svg2png.mjs')
const TIKTOK = path.join(ROOT, 'tools', 'tiktok.mjs')
const MEDIA_RULES = `
# Phòng media: làm audio, ảnh, video

Bạn làm ở phòng media. Sản phẩm để trong thư mục \`media/\` của dự án: \`media/audio/\`, \`media/images/\`, \`media/video/\`, video TikTok trong \`media/tiktok/<ten-video>/\` (tạo thư mục nếu chưa có). Đặt tên file ngắn, không dấu, gạch nối (vd \`gioi-thieu-app.mp3\`).
Lệnh shell chỉ được dùng: ${IS_MAC ? 'say, afconvert, afinfo, sips, ' : ''}ffmpeg, ffprobe, python, node, ls, mkdir, cp, mv (không có thư viện ảnh Python như PIL).
${
  IS_MAC
    ? `- Audio / lồng tiếng: \`say -v Linh -o /tmp/x.aiff "nội dung tiếng Việt"\` (giọng Linh tiếng Việt; tiếng Anh dùng -v Samantha), rồi \`afconvert -f m4af -d aac /tmp/x.aiff media/audio/x.m4a\`.`
    : `- Audio / lồng tiếng: viết lời đọc vào file .txt (UTF-8) rồi \`python -m edge_tts --voice vi-VN-HoaiMyNeural -f media/audio/x.txt --write-media media/audio/x.mp3\` (không truyền tiếng Việt qua --text: bị hỏng dấu). edge-tts hay từ chối vài câu tiếng Việt (NoAudioReceived): thử lại, vẫn lỗi thì dùng giọng Google: \`python -c "import sys;from gtts import gTTS;gTTS(open(sys.argv[1],encoding='utf-8').read(),lang='vi').save(sys.argv[2])" media/audio/x.txt media/audio/x.mp3\`.`
} Nhạc nền / hiệu ứng đơn giản: tạo bằng ffmpeg (vd \`ffmpeg -f lavfi -i "sine=frequency=440:duration=2"\`).
- Ảnh: vẽ bằng SVG (viết file .svg: banner, logo, minh hoạ, poster; chữ tiếng Việt dùng font-family="Helvetica, Arial"), rồi xuất PNG đúng cỡ bằng \`node ${SVG2PNG} media/images/x.svg media/images/x.png 1280 720\` (rộng cao tuỳ ý; công cụ này cũng nhận file .html để dựng ảnh phức tạp bằng HTML/CSS). Mở xem lại ảnh PNG (Read) để tự kiểm tra bố cục trước khi báo xong. Chỉnh cỡ / đổi định dạng ảnh: ffmpeg.
- Video thường: dựng bằng ffmpeg từ ảnh + audio, xuất mp4 (H.264 + AAC) để xem được trên trình duyệt và điện thoại.
- Video TikTok (dọc 1080x1920, ghép từ ảnh): đặt ảnh từng cảnh (scene-01.jpg...) và \`kich-ban.json\` vào \`media/tiktok/<ten-video>/\`, rồi chạy \`node ${TIKTOK} media/tiktok/<ten-video>\`. Công cụ tự lồng tiếng bằng VieNeu-TTS (giọng tiếng Việt chạy trên máy, mặc định Trúc Ly; đổi bằng trường "voice": Trúc Ly, Ngọc Huyền, Mai Anh, Đoan Trang, Quỳnh Anh, Ngọc Linh (nữ Bắc), Ngọc Trân (nữ Trung), Thùy Dung, Mỹ Duyên, Thục Đoan, Kim Thanh (nữ Nam)), zoom chậm từng ảnh, chèn phụ đề trong vùng an toàn, xuất \`video.mp4\` và \`caption.txt\`. Mẫu kich-ban.json:
  \`{"scenes":[{"image":"scene-01.jpg","say":"lời đọc cảnh 1","text":"chữ trên hình (ngắn, tuỳ chọn)"}],"caption":"caption đăng TikTok + #hashtag","music":"nhac.mp3 (tuỳ chọn)"}\`
  Mỗi video 15–45 giây, 4–8 cảnh, câu đầu phải móc người xem trong 3 giây; lời đọc ngắn, văn nói; chữ trên hình tối đa ~8 từ. Không gắn nhạc có bản quyền (sếp chọn nhạc TikTok khi đăng).
- Mỗi lần xong, kiểm tra file thật sự tạo ra (ls, ffprobe; với video TikTok trích 1-2 khung hình bằng ffmpeg rồi Read xem phụ đề) và liệt kê đường dẫn file trong details.`

function runClaudeWork(role: Role, cwd: string, system: string, prompt: string, sessionId: string, resume: boolean, model?: string): Promise<WorkResult> {
  const args = [
    '-p',
    '--output-format', 'stream-json', '--verbose',
    '--json-schema', WORK_SCHEMA,
    '--system-prompt', system,
    '--allowedTools', ...toolsFor(role),
    resume ? '--resume' : '--session-id', sessionId,
  ]
  if (funcOf(role) === BROWSER_FUNC) args.push('--mcp-config', BROWSER_MCP, '--strict-mcp-config')
  if (model) args.push('--model', model)
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, { cwd, windowsHide: true, env: childEnv })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), WORK_TIMEOUT_MS)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Không chạy được "${CLAUDE_BIN}": ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        const r = parseClaudeStream(out) as { is_error?: boolean; result?: string; structured_output?: Partial<WorkResult> }
        const so = r.structured_output
        if (r.is_error || !so || typeof so.summary !== 'string') throw new Error(r.result ?? 'không có structured_output')
        resolve({
          summary: so.summary.trim().slice(0, 400),
          verdict: so.verdict === 'pass' || so.verdict === 'fail' ? so.verdict : 'done',
          area: so.area && ['BE', 'FE', 'design', 'audio', 'video'].includes(so.area) ? so.area : '',
          details: (so.details ?? '').trim().slice(0, 4000),
        })
      } catch (e) {
        reject(new Error(`claude (làm việc) thoát mã ${code}: ${(e as Error).message} ${err.slice(0, 300)}`))
      }
    })
    child.stdin.end(prompt)
  })
}

type WorkStep = 'code' | 'fix' | 'review' | 'test' | 'personal' | MediaStep
/** Dây chuyền phòng media: kịch bản → thiết kế → âm thanh → dựng video → trưởng nhóm duyệt (→ sửa) */
type MediaStep = 'script' | 'design' | 'audio' | 'edit' | 'mreview' | 'mfix'
const MEDIA_STEPS: MediaStep[] = ['script', 'design', 'audio', 'edit', 'mreview', 'mfix']

interface WorkRequest {
  role: Role
  step: WorkStep
  branch: string
  title: string
  request: string
  /** Phần việc (backend/frontend) hoặc góp ý review / mô tả bug cần sửa */
  notes: string
  /** Việc chung qua test / việc riêng xong: merge vào branch chính */
  merge: boolean
}

/** Email tác giả commit: <mã viết thường>@itroom.local */
const authorOf = (role: Role) => role.toLowerCase()

function workPrompt(w: WorkRequest, base: string, diff: string) {
  const head = `Việc: "${w.title}" (yêu cầu của sếp: "${w.request}"). Branch: ${w.branch}.`
  switch (w.step) {
    case 'code':
      return `${head}\nPhần của bạn: ${w.notes}\nViết code thật cho phần này, chạy build/test nếu dự án có. verdict = "done" khi xong, "fail" nếu không làm được (nói rõ lý do trong details).`
    case 'fix':
      return `${head}\nCần sửa theo phản hồi sau:\n${w.notes}\nSửa code, chạy lại build/test nếu có. verdict = "done" khi xong.`
    case 'review':
      return `${head}\nReview thay đổi của branch so với ${base}. Diff:\n\`\`\`diff\n${diff || '(không có thay đổi)'}\n\`\`\`\nĐọc thêm code liên quan nếu cần. verdict = "pass" nếu đạt, "fail" nếu cần sửa; khi fail ghi trong details từng điểm cần sửa cụ thể, area = phần cần sửa ("BE" hoặc "FE").`
    case 'test':
      return `${head}\nKiểm thử việc này: chạy test có sẵn (vd npm test), nếu chưa có thì viết test hoặc chạy thử để xác minh yêu cầu. verdict = "pass" nếu đạt, "fail" nếu có bug; khi fail ghi bug và cách tái hiện trong details, area = phần gây lỗi ("BE" hoặc "FE").`
    case 'personal':
      return `${head}\nĐây là việc sếp giao riêng cho bạn. Làm trực tiếp trong dự án theo vai trò của bạn. verdict = "done" khi xong, "fail" nếu không làm được.`
  }
  // ---- dây chuyền phòng media: mọi file của việc này nằm trong một thư mục riêng ----
  const dir = `media/${slugify(w.title) || 'du-an'}`
  const brief = `${dir}/kich-ban.md`
  // video TikTok: dọc 9:16, ảnh tạo trên Google Flow, lồng tiếng + dựng bằng tools/tiktok.mjs (không thu âm riêng)
  if (/tiktok/i.test(`${w.title} ${w.request}`)) {
    const json = `${dir}/kich-ban.json`
    switch (w.step) {
      case 'script':
        return `${head}\nBạn là trưởng nhóm media, đây là video TikTok dọc (ghép ảnh + giọng đọc). KHÔNG tự làm ảnh / video. Viết 2 file:
1) \`${brief}\`: ý tưởng, người xem, câu móc 3 giây đầu, phong cách hình ảnh chung (một phong cách cho cả bộ ảnh), bảng cảnh.
2) \`${json}\` đúng mẫu: {"scenes":[{"image":"scene-01.jpg","say":"lời đọc","text":"chữ trên hình","prompt":"prompt tiếng Anh tạo ảnh"}],"caption":"..."}
- 5–7 cảnh, tổng 25–45 giây (mỗi cảnh 1–2 câu đọc, văn nói tự nhiên). Cảnh 1 là câu móc gây tò mò, cảnh cuối kêu gọi follow / bình luận.
- "text": tối đa ~8 từ, không emoji. "say": tiếng Việt, không viết tắt, số viết bằng chữ nếu khó đọc, từ mượn viết theo cách đọc (vd "ô-xi" thay vì "oxy").
- "prompt": tiếng Anh, mô tả cụ thể cảnh để Google Flow vẽ, cùng một câu phong cách ở cuối mọi prompt, ghi "vertical 9:16", không yêu cầu chữ trong ảnh.
- "caption": 1–2 câu + 3–5 hashtag (gồm cả hashtag cố định của kênh nếu có).
- Nội dung kiến thức phải ĐÚNG và kiểm chứng được (chọn sự thật phổ biến, đã được xác nhận; không bịa số liệu); nếu có chỗ không chắc thì bỏ.${tiktokBrief()}
${w.notes ? `Ghi chú: ${w.notes}` : ''} verdict = "done"; summary kể ngắn chủ đề và câu móc.`
      case 'design':
        return `${head}\nBạn là thiết kế của phòng media. Đọc \`${json}\`: với từng cảnh, tạo ảnh trên Google Flow theo đúng "prompt" (khổ 9:16), tải về và lưu thành \`${dir}/<image>\` (đúng tên trong trường "image", vd scene-01.jpg; nếu file tải về là .png thì đổi "image" trong json cho khớp). Giữ cùng phong cách cho cả bộ. Mở xem lại từng ảnh. ${w.notes ? `Ghi chú của trưởng nhóm: ${w.notes}` : ''} verdict = "done" khi đủ ảnh; details liệt kê file.`
      case 'audio':
        return `${head}\nVideo TikTok này được lồng tiếng tự động khi dựng (tools/tiktok.mjs). Bạn chỉ đọc \`${json}\` và sửa trường "say" cho dễ đọc thành tiếng (câu ngắn, không ký hiệu, số viết bằng chữ). verdict = "done".`
      case 'edit':
        return `${head}\nBạn là người dựng video. Kiểm tra \`${json}\` và đủ ảnh trong ${dir}/, rồi chạy \`node ${TIKTOK} ${dir}\` (tự lồng tiếng, zoom, phụ đề, xuất ${dir}/video.mp4 và caption.txt). Xuất 2 khung hình bằng ffmpeg rồi Read để xem phụ đề không lỗi dấu, không che mặt nhân vật. ${w.notes ? `Thông tin từ đồng đội: ${w.notes}` : ''} verdict = "done"; details ghi đường dẫn video và thời lượng.`
      case 'mreview':
        return `${head}\nBạn là trưởng nhóm media, duyệt video TikTok ${dir}/video.mp4 so với \`${brief}\` và \`${json}\`: ffprobe (dọc 1080x1920, có tiếng, 15–60 giây), xuất vài khung hình rồi Read (ảnh đúng cảnh, phụ đề đúng chính tả và nằm gọn), đọc caption.txt. Không tự sửa. verdict = "pass" nếu đạt; "fail" nếu cần sửa, khi đó area = "design" (ảnh) hoặc "video" (lời đọc / phụ đề / dựng) và details ghi từng điểm cụ thể.`
    }
  }
  switch (w.step) {
    case 'script':
      return `${head}\nBạn là trưởng nhóm media. Viết kịch bản / storyboard vào \`${brief}\` (KHÔNG tự làm ảnh, audio, video: việc đó của đồng đội). Gồm: mục tiêu & người xem, thông điệp chính, thời lượng tổng, phong cách (bảng màu mã hex, font, cảm xúc), bảng cảnh (số cảnh, thời lượng giây, hình ảnh mô tả cụ thể để vẽ, chữ hiện trên hình, lời thoại tiếng Việt), nhạc nền (tâm trạng, tốc độ), và giao việc rõ ràng cho: Thiết kế (ảnh từng cảnh: ${dir}/images/canh-1.png..., 1280x720), Âm thanh (lời thoại từng cảnh ${dir}/audio/canh-1.m4a... và ${dir}/audio/nhac-nen.m4a), Dựng video (${dir}/video/<tên>.mp4). Nếu sếp chỉ xin ảnh hoặc audio thì bỏ phần không cần. ${w.notes ? `Ghi chú: ${w.notes}` : ''} verdict = "done"; summary kể ngắn ý tưởng chính.`
    case 'design':
      return `${head}\nBạn là thiết kế đồ hoạ của phòng media. Đọc \`${brief}\` rồi làm ảnh cho từng cảnh đúng phong cách trong đó: viết SVG và xuất PNG 1280x720 vào ${dir}/images/ (canh-1.svg/png, canh-2...). Mở xem lại từng PNG để kiểm tra chữ tiếng Việt, bố cục, độ tương phản. ${w.notes ? `Ghi chú của trưởng nhóm: ${w.notes}` : ''} verdict = "done" khi đủ ảnh; details liệt kê file.`
    case 'audio':
      return `${head}\nBạn là âm thanh của phòng media. Đọc \`${brief}\` rồi thu lời thoại từng cảnh (giọng Linh) vào ${dir}/audio/canh-1.m4a, canh-2.m4a... và làm nhạc nền nhẹ đúng tâm trạng vào ${dir}/audio/nhac-nen.m4a (dài bằng cả video, fade in/out, âm lượng vừa phải). Đo thời lượng từng file (afinfo / ffprobe). ${w.notes ? `Ghi chú của trưởng nhóm: ${w.notes}` : ''} verdict = "done"; details liệt kê từng file kèm thời lượng giây (người dựng video cần để canh cảnh).`
    case 'edit':
      return `${head}\nBạn là người dựng video của phòng media. Đọc \`${brief}\`, dùng ảnh trong ${dir}/images/ và audio trong ${dir}/audio/ để dựng video mp4 (H.264 + AAC, 1280x720, yuv420p) vào ${dir}/video/: mỗi cảnh dài bằng lời thoại của cảnh đó (+0.5 giây nghỉ), chuyển cảnh mượt (xfade/fade), có thể zoom nhẹ (zoompan), nhạc nền nhỏ hơn lời thoại (khoảng -18 dB) và fade cuối. Kiểm tra bằng ffprobe và xem vài khung hình (xuất PNG rồi Read). ${w.notes ? `Thông tin từ đồng đội: ${w.notes}` : ''} verdict = "done"; details ghi đường dẫn video và thời lượng.`
    case 'mreview':
      return `${head}\nBạn là trưởng nhóm media, duyệt sản phẩm trong ${dir}/ so với \`${brief}\`: kiểm tra video bằng ffprobe (thời lượng, có tiếng), xuất vài khung hình ra PNG rồi xem (Read), xem ảnh, đối chiếu lời thoại / chữ / màu với kịch bản. Không tự sửa. verdict = "pass" nếu đạt; "fail" nếu cần sửa, khi đó area = phần cần sửa ("design", "audio" hoặc "video") và details ghi từng điểm cụ thể.`
    case 'mfix':
      return `${head}\nTrưởng nhóm media yêu cầu sửa phần của bạn trong ${dir}/:\n${w.notes}\nSửa đúng các điểm trên (giữ nguyên tên file để người dựng video dùng lại). verdict = "done" khi xong.`
  }
}

/** Một bước việc thật: chuyển branch, gọi Claude CLI có công cụ, commit thay đổi, merge nếu cần */
function doWork(w: WorkRequest) {
  return withProject(async () => {
    const p = await ensureProject()
    if (!p) throw new Error('chưa cấu hình dự án (agents/_project.md)')
    const branchOk = await git(p.dir, ['rev-parse', '--verify', w.branch])
    const sw = branchOk.code === 0 ? await git(p.dir, ['checkout', w.branch]) : await git(p.dir, ['checkout', '-b', w.branch, p.base])
    if (sw.code !== 0) throw new Error(`không chuyển được sang branch ${w.branch}: ${sw.out}`)

    let diff = ''
    if (w.step === 'review') {
      diff = (await git(p.dir, ['diff', `${p.base}...${w.branch}`])).out
      if (diff.length > 40_000) diff = `${diff.slice(0, 40_000)}\n... (diff dài, đã cắt; đọc file để xem tiếp)`
    }

    const s = sessionOf(w.role, engineOf(w.role))
    if (!s.work || s.work.project !== p.dir) s.work = { id: crypto.randomUUID(), project: p.dir, turns: 0 }
    const work = s.work
    const t0 = Date.now()
    console.log(`[làm việc] ${w.role} · ${w.step} · ${w.branch}`)
    const model = frontmatter(PROJECT_FILE, 'code_model') ?? modelFor('work', 'claude')
    const system = `${systemPrompt(w.role)}\n${WORK_RULES}${MEDIA_FUNCS.includes(funcOf(w.role)) ? `\n${MEDIA_RULES}` : ''}${funcOf(w.role) === BROWSER_FUNC ? `\n${FLOW_RULES}` : ''}`
    const prompt = `${work.turns > 0 ? profileUpdate(system, work.promptHash) : ''}${workPrompt(w, p.base, diff)}`
    let result: WorkResult
    try {
      result = await runClaudeWork(w.role, p.dir, system, prompt, work.id, work.turns > 0, model)
    } catch (e) {
      // lượt đầu lỗi giữa chừng (vd hết quota) nhưng CLI đã tạo session: nối tiếp thay vì tạo lại
      if (!/already in use/i.test((e as Error).message)) throw e
      result = await runClaudeWork(w.role, p.dir, system, prompt, work.id, true, model)
    }
    work.turns++
    work.promptHash = promptHash(system)
    saveSessions()

    // commit những gì agent đã sửa, tác giả là agent đó
    let commit = ''
    if ((await git(p.dir, ['status', '--porcelain'])).out) {
      await git(p.dir, ['add', '-A'])
      const c = await git(p.dir, ['commit', '-m', `${w.title}: ${result.summary}`.slice(0, 200), `--author=${who(w.role)} <${authorOf(w.role)}@itroom.local>`])
      if (c.code === 0) commit = (await git(p.dir, ['rev-parse', '--short', 'HEAD'])).out
    }

    let merged = false
    if (w.merge && result.verdict !== 'fail') {
      await git(p.dir, ['checkout', p.base])
      const m = await git(p.dir, ['merge', '--no-ff', w.branch, '-m', `Merge ${w.branch}: ${w.title}`.slice(0, 200)])
      if (m.code === 0) merged = true
      else {
        await git(p.dir, ['merge', '--abort'])
        result.details += `\n(merge vào ${p.base} lỗi: ${m.out.slice(0, 300)})`
      }
    }
    // bật tự push: merge xong thì đẩy branch chính lên GitHub
    let pushed = false
    if (merged && autoPush() && (await remoteOf(p.dir))) {
      const r = await pushBase(p)
      pushed = r.ok
      if (!r.ok) result.details += `\n(push lên GitHub lỗi: ${r.out.slice(0, 300)})`
    }
    const seconds = Math.round((Date.now() - t0) / 1000)
    appendLog(`${who(w.role)} · làm việc thật (${w.step})`, `${result.summary} _(${w.branch}${commit ? ` · commit ${commit}` : ''}${merged ? ` · đã merge vào ${p.base}` : ''}${pushed ? ' · đã push GitHub' : ''} · ${seconds}s)_`)
    tgSend(`🛠 ${who(w.role)} xong (${w.step}): ${result.summary}${merged ? `\n✅ đã merge vào ${p.base}` : ''}${pushed ? ' · đã push GitHub' : ''}`)
    return { ...result, branch: w.branch, commit, merged, pushed, seconds }
  })
}

// ---------- sự kiện cho giao diện ----------

interface OfficeEvent {
  id: number
  type: 'user' | 'thinking' | 'reply' | 'error'
  role: Role
  text: string
  /** Tên nhóm chat, khi tin nhắn nằm trong một nhóm */
  group?: string
}
const events: OfficeEvent[] = []
let nextEventId = 1
function emit(type: OfficeEvent['type'], role: Role, text = '', group?: string) {
  events.push({ id: nextEventId++, type, role, text, group })
  if (events.length > 200) events.shift()
  if (type === 'reply' || type === 'error') tgSend(`${group ? `👥 ${group}` : '💬 Riêng'} · ${who(role)}${type === 'error' ? ' ⚠️' : ''}:\n${text}`)
}

// ---------- TikTok: kênh phòng media phụ trách ----------
const TT_FILE = path.join(ROOT, 'office', 'tiktok.json')
const TT_PRIVACY = ['public', 'friends', 'private'] as const
const TT_MODES = ['prepare', 'auto'] as const
interface TtConfig {
  /** tên kênh, vd @bancobiet.daily */
  handle: string
  /** chủ đề, người xem, giọng điệu: đưa vào kịch bản của trưởng nhóm media */
  topic: string
  /** hashtag luôn gắn vào caption */
  hashtags: string
  privacy: (typeof TT_PRIVACY)[number]
  /** prepare: tải video lên và điền sẵn, sếp tự bấm Đăng; auto: phòng media tự bấm Đăng */
  mode: (typeof TT_MODES)[number]
}
const TT_DEFAULT: TtConfig = { handle: '', topic: '', hashtags: '', privacy: 'public', mode: 'prepare' }
function loadTt(): TtConfig {
  try {
    return { ...TT_DEFAULT, ...(JSON.parse(fs.readFileSync(TT_FILE, 'utf8')) as Partial<TtConfig>) }
  } catch {
    return { ...TT_DEFAULT }
  }
}
function saveTt(body: Record<string, unknown>) {
  const cur = loadTt()
  const str = (v: unknown, max: number, fallback: string) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : fallback)
  let handle = str(body.handle, 40, cur.handle).replace(/\s+/g, '')
  if (handle && !handle.startsWith('@')) handle = `@${handle}`
  if (handle && !/^@[\w.]{2,30}$/.test(handle)) return { error: 'Tên kênh TikTok chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới (vd @bancobiet.daily)' }
  const hashtags = str(body.hashtags, 200, cur.hashtags)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .join(' ')
  const next: TtConfig = {
    handle,
    topic: str(body.topic, 2000, cur.topic),
    hashtags,
    privacy: TT_PRIVACY.find((p) => p === body.privacy) ?? cur.privacy,
    mode: TT_MODES.find((m) => m === body.mode) ?? cur.mode,
  }
  fs.writeFileSync(TT_FILE, JSON.stringify(next, null, 2))
  appendLog('Sếp', `cập nhật cài đặt kênh TikTok${handle ? ` ${handle}` : ''}`)
  return tiktokView()
}
/** Trình duyệt của agent (profile riêng) đã đăng nhập Google / TikTok chưa: đọc tên cookie (không đọc giá trị) */
function browserLogins() {
  const db = path.join(BROWSER_PROFILE, 'Default', 'Network', 'Cookies')
  if (!fs.existsSync(db)) return { google: false, tiktok: false }
  const tmp = path.join(BROWSER_DOWNLOADS, '.cookies-check.db')
  try {
    fs.mkdirSync(BROWSER_DOWNLOADS, { recursive: true })
    fs.copyFileSync(db, tmp) // Chrome đang mở thì file bị khoá: đọc bản sao
    const conn = new DatabaseSync(tmp, { readOnly: true })
    const has = (host: string, name: string) => !!conn.prepare('select 1 from cookies where host_key like ? and name = ? limit 1').get(`%${host}`, name)
    const r = { google: has('google.com', 'SID'), tiktok: has('tiktok.com', 'sessionid') }
    conn.close()
    return r
  } catch {
    return { google: null, tiktok: null }
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}
/** Chrome đang mở profile của agent (Yuki đang làm việc, hoặc cửa sổ đăng nhập chưa đóng) */
function browserInUse() {
  const lock = path.join(BROWSER_PROFILE, 'lockfile')
  if (!fs.existsSync(lock)) return false
  try {
    fs.closeSync(fs.openSync(lock, 'r+'))
    return false
  } catch {
    return true
  }
}
function tiktokView() {
  return { ...loadTt(), browser: { ...browserLogins(), inUse: browserInUse() } }
}
const CHROME_EXE = [
  process.env.CHROME_BIN,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p))
/** Mở Chrome thường (không tự động hoá, để Google / TikTok không chặn đăng nhập) với profile của agent */
function openAgentBrowser(url: string) {
  if (!CHROME_EXE) return { error: 'Không tìm thấy Chrome trên máy' }
  if (browserInUse()) return { error: 'Trình duyệt của agent đang mở (có thể Yuki đang làm việc). Đóng cửa sổ đó hoặc chờ xong rồi thử lại.' }
  const child = spawn(CHROME_EXE, [`--user-data-dir=${BROWSER_PROFILE}`, '--no-first-run', url], { detached: true, stdio: 'ignore', windowsHide: false })
  child.unref()
  return tiktokView()
}
/** Hồ sơ kênh đưa vào kịch bản TikTok của trưởng nhóm media */
function tiktokBrief() {
  const t = loadTt()
  const lines = [
    t.handle && `Kênh: ${t.handle}`,
    t.topic && `Chủ đề / người xem / giọng điệu của kênh: ${t.topic}`,
    t.hashtags && `Hashtag luôn có trong caption: ${t.hashtags}`,
  ].filter(Boolean)
  return lines.length ? `\nHồ sơ kênh TikTok (sếp đặt trong Cài đặt):\n${lines.join('\n')}` : ''
}

// ---------- Telegram: sếp chat với team qua bot ----------

const TG_FILE = path.join(ROOT, 'office', 'telegram.json')
interface TgConfig {
  token?: string
  /** username của bot (không có @) */
  bot?: string
  /** chat Telegram của sếp, có sau khi ghép đôi bằng /start <mã> */
  chatId?: number
  owner?: string
  pairCode?: string
  /** cuộc chat tin nhắn thường sẽ gửi vào: 'team', 'dm:BE', 'group:<id>' */
  target?: string
}
function loadTg(): TgConfig {
  try {
    return JSON.parse(fs.readFileSync(TG_FILE, 'utf8')) as TgConfig
  } catch {
    return {}
  }
}
let tg: TgConfig = loadTg()
let tgPoll: AbortController | null = null
let tgOffset = 0
let tgError: string | null = null
const saveTg = () => fs.writeFileSync(TG_FILE, JSON.stringify(tg, null, 2), { mode: 0o600 })
const pairCode = () => String(Math.floor(100000 + Math.random() * 900000))

async function tgApi<T = unknown>(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal, token = tg.token): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string }
  if (!j.ok) throw new Error(j.description ?? `Telegram lỗi ${r.status}`)
  return j.result as T
}

function tgReply(chatId: number, text: string) {
  if (!tg.token) return
  void tgApi('sendMessage', { chat_id: chatId, text: text.slice(0, 4000) }).catch((e) => console.error('[telegram]', (e as Error).message))
}
/** Gửi cho sếp (nếu đã ghép đôi) */
function tgSend(text: string) {
  if (tg.chatId) tgReply(tg.chatId, text)
}

const findRole = (s: string) => toRole(s) ?? ROLES.find((r) => nameOf(r).toLowerCase() === s.toLowerCase())
function chatName(chat: string) {
  if (chat === 'team') return 'Cả team'
  if (chat.startsWith('dm:')) return `riêng với ${who(chat.slice(3))}`
  return `nhóm ${groupById(chat.slice(6))?.name ?? '(đã xoá)'}`
}
function tgHelp() {
  return [
    'Nhắn thẳng = gửi vào cuộc chat đang chọn.',
    '/team [nội dung] — chọn chat Cả team',
    `/<mã hoặc tên> [nội dung] — chat riêng, vd /BE hoặc /${nameOf('PM')} (mã: ${ROLES.join(', ')})`,
    '/nhom <tên nhóm> — chọn nhóm chat',
    '/giao <việc> — giao việc (Cả team = việc chung, chat riêng = việc riêng)',
    '/ds — danh sách cuộc chat',
    `Đang chọn: ${chatName(tg.target ?? 'team')}`,
  ].join('\n')
}

function tgSendChat(chat: string, raw: string, task = false) {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return
  if (text.length > 500) return tgSend('Tin dài quá 500 ký tự.')
  const err = sendChat(chat, text, task)
  if (err) tgSend(`⚠️ ${err}`)
  else if (task) tgSend(`📋 Đã giao việc (${chatName(chat)}).`)
}

function tgHandle(msg: { chat: { id: number; type?: string }; from?: { first_name?: string; username?: string }; text?: string }) {
  const text = (msg.text ?? '').trim()
  if (!text) return
  console.log(`[telegram] ${msg.from?.username ?? msg.from?.first_name ?? msg.chat.id}: ${text.slice(0, 80)}`)
  if (!tg.chatId) {
    // ghép đôi: "/start <mã>" (từ link) hoặc gõ thẳng mã 6 số
    const m = text.match(/^(?:\/start(?:@\w+)?\s+)?(\d{6})$/)
    if (tg.pairCode && m?.[1] === tg.pairCode) {
      tg = { ...tg, chatId: msg.chat.id, owner: msg.from?.username ? `@${msg.from.username}` : msg.from?.first_name, pairCode: undefined, target: 'team' }
      saveTg()
      appendLog('Hệ thống', `Sếp kết nối Telegram (${tg.owner ?? msg.chat.id})`)
      tgSend(`✅ Đã kết nối với IT Room. Trả lời của các agent sẽ gửi về đây.\n\n${tgHelp()}`)
    } else tgReply(msg.chat.id, 'Bot chưa ghép đôi. Mở ⚙️ Cài đặt → ✈️ Telegram trên IT Room, rồi gửi cho bot mã 6 số hiện ở đó.')
    return
  }
  if (msg.chat.id !== tg.chatId) return tgReply(msg.chat.id, 'Bot này chỉ nói chuyện với sếp đã kết nối.')

  const cmd = text.match(/^\/([\p{L}\w]+)(?:@\w+)?\s*([\s\S]*)$/u)
  if (!cmd) return tgSendChat(tg.target ?? 'team', text)
  const [, name, rest] = cmd
  const lower = name.toLowerCase()
  if (lower === 'start' || lower === 'help') return tgSend(tgHelp())
  if (lower === 'ds') {
    const lines = chatList().map((c) => `${c.id === tg.target ? '👉 ' : '• '}${c.kind === 'dm' ? `/${c.members[0]} — ${who(c.members[0])}` : c.kind === 'team' ? '/team — Cả team' : `/nhom ${c.name}`}`)
    return tgSend(lines.join('\n'))
  }
  if (lower === 'giao') {
    const target = tg.target ?? 'team'
    if (target.startsWith('group:')) return tgSend('Chỉ giao việc được ở Cả team hoặc chat riêng. Gõ /team hoặc /<mã agent> trước.')
    if (!rest.trim()) return tgSend('Gõ: /giao <việc cần làm>')
    return tgSendChat(target, rest, true)
  }
  let chat: string | undefined
  let body = rest
  if (lower === 'team') chat = 'team'
  else if (lower === 'nhom') {
    const q = rest.trim().toLowerCase()
    const g = groups.find((x) => x.name.toLowerCase() === q) ?? groups.find((x) => q && x.name.toLowerCase().startsWith(q))
    if (!g) return tgSend(`Không có nhóm "${rest.trim()}". Gõ /ds để xem.`)
    chat = `group:${g.id}`
    body = ''
  } else {
    const role = findRole(name)
    if (role) chat = `dm:${role}`
  }
  if (!chat) return tgSend(`Không hiểu lệnh /${name}.\n\n${tgHelp()}`)
  tg.target = chat
  saveTg()
  if (body.trim()) tgSendChat(chat, body)
  else tgSend(`Đã chọn: ${chatName(chat)}. Giờ nhắn thẳng là gửi vào đây.`)
}

async function tgLoop(ctrl: AbortController) {
  await tgApi('deleteWebhook', {}, ctrl.signal).catch(() => {})
  while (!ctrl.signal.aborted) {
    try {
      const updates = await tgApi<{ update_id: number; message?: Parameters<typeof tgHandle>[0] }[]>(
        'getUpdates',
        { offset: tgOffset, timeout: 30, allowed_updates: ['message'] },
        ctrl.signal,
      )
      tgError = null
      for (const u of updates) {
        tgOffset = u.update_id + 1
        if (u.message) {
          try {
            tgHandle(u.message)
          } catch (e) {
            console.error('[telegram]', (e as Error).message)
          }
        }
      }
    } catch (e) {
      if (ctrl.signal.aborted) return
      tgError = (e as Error).message
      console.error('[telegram]', tgError)
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
}
function startTg() {
  tgPoll?.abort()
  tgPoll = null
  if (!tg.token) return
  const c = new AbortController()
  tgPoll = c
  void tgLoop(c)
}
function tgView() {
  return {
    configured: !!tg.token,
    bot: tg.bot ?? null,
    connected: !!tg.chatId,
    owner: tg.owner ?? null,
    pairLink: tg.bot && tg.pairCode && !tg.chatId ? `https://t.me/${tg.bot}?start=${tg.pairCode}` : null,
    pairCode: tg.chatId ? null : (tg.pairCode ?? null),
    target: tg.chatId ? chatName(tg.target ?? 'team') : null,
    error: tgError,
  }
}
async function setTgToken(token: string) {
  const me = await tgApi<{ username: string }>('getMe', {}, undefined, token)
  tg = { token, bot: me.username, pairCode: pairCode(), target: 'team' }
  tgOffset = 0
  tgError = null
  saveTg()
  startTg()
}

// ---------- hộp thư office/inbox.md ----------

/** Đoạn dặn agent tự nhận ra tin nhắn là giao việc (PM nhận thành việc chung, người khác nhận việc riêng) */
function taskHint(role: Role) {
  const pm = funcOf(role) === 'PM'
  return (
    ' Nếu tin này là sếp GIAO VIỆC MỚI (yêu cầu làm / xây / sửa / thêm một thứ cụ thể, kể cả dự án mới) thì ghi tên ngắn của việc (tối đa 6 từ) vào "title" ' +
    `và trả lời rằng bạn nhận việc, ${pm ? 'sẽ gọi cả team họp phân công ngay' : 'bắt tay làm ngay'}. ` +
    'Còn nếu sếp chỉ chào hỏi, hỏi tiến độ, hỏi ý kiến hay trò chuyện thì để "title" rỗng và đừng hứa bắt đầu việc gì.'
  )
}

/** Agent nhận ra sếp giao việc qua tin nhắn thường: tạo việc như khi bật 📋 Giao việc */
function assignFromChat(role: Role, message: string, title: string) {
  if (!title.trim()) return
  const target = funcOf(role) === 'PM' ? 'team' : role
  console.log(`[giao việc] ${who(role)} nhận ra tin nhắn của sếp là giao việc → ${target === 'team' ? 'việc chung' : `việc riêng của ${role}`}: ${title}`)
  assign(target, message)
}

async function answerBoss(role: Role, message: string) {
  emit('thinking', role)
  try {
    const { text, title } = await speak(role, `Sếp vừa nhắn cho bạn: "${message}". Trả lời sếp.${taskHint(role)}`, 'boss', 'boss')
    emit('reply', role, text)
    assignFromChat(role, message, title)
  } catch (e) {
    const msg = (e as Error).message
    console.error(msg)
    emit('error', role, isOutOfTokens(msg) ? 'Hết token / quota rồi... zZz' : 'Không gọi được CLI (hết token / lỗi kết nối)')
  }
}

// ---------- cửa sổ chat kiểu Teams: chat riêng (Sep-<Role>.md) và nhóm chat ----------

/** Ai đang soạn trả lời trong từng cuộc chat (`dm:BE`, `group:<id>`) */
const typing = new Map<string, Set<Role>>()
function setTyping(chat: string, role: Role, on: boolean) {
  const set = typing.get(chat) ?? new Set<Role>()
  if (on) set.add(role)
  else set.delete(role)
  typing.set(chat, set)
}

interface ChatMessage {
  time: string
  /** 'boss' = sếp, '' = dòng hệ thống (thêm/bớt thành viên) */
  from: Role | 'boss' | ''
  text: string
}

function parseMessage(line: string): ChatMessage {
  const m = line.match(/^- (\S+) \*\*(.+?):\*\* (.*)$/)
  if (!m) return { time: '', from: '', text: line.slice(2) }
  const speaker = m[2] === 'Sếp' ? 'boss' : (toRole(m[2].split(' ')[0]) ?? '')
  return { time: m[1], from: speaker, text: m[3] }
}

const chatFile = (chat: string) =>
  chat === 'team'
    ? channelFile('PM', 'team').file
    : chat.startsWith('group:')
      ? groupFile(chat.slice(6))
      : path.join(CHANNEL_DIR, `Sep-${chat.slice(3)}.md`)
const chatExists = (chat: string) => chat === 'team' || (chat.startsWith('dm:') ? !!toRole(chat.slice(3)) : !!groupById(chat.slice(6)))

function chatList() {
  const item = (id: string, kind: 'team' | 'dm' | 'group', name: string, members: Role[]) => {
    const all = messages(chatFile(id))
    return { id, kind, name, members, count: all.length, last: all.length ? parseMessage(all.at(-1)!) : null, typing: [...(typing.get(id) ?? [])] }
  }
  return [
    item('team', 'team', 'Cả team', [...ROLES]),
    ...groups.map((g) => item(`group:${g.id}`, 'group', g.name, g.members)),
    ...ROLES.map((r) => item(`dm:${r}`, 'dm', nameOf(r), [r])),
  ]
}

// Tin trong cùng một cuộc chat được xử lý lần lượt
const chatChains = new Map<string, Promise<unknown>>()
function inChat(chat: string, fn: () => Promise<void>) {
  const next = (chatChains.get(chat) ?? Promise.resolve()).then(fn, fn)
  chatChains.set(chat, next.catch(() => {}))
}

/** Ai trong nhóm được sếp gọi tên (@FE, @Khoa...); không gọi ai thì cả nhóm trả lời */
function mentioned(text: string, members: Role[]) {
  const tags = [...text.matchAll(/@([\p{L}\w]+)/gu)].map((m) => m[1].toLowerCase())
  return members.filter((r) => tags.includes(r.toLowerCase()) || tags.includes(nameOf(r).toLowerCase()))
}

function sendChat(chat: string, text: string, task = false): string | null {
  if (task) {
    // giao việc: "Cả team" = việc chung (họp rồi làm), chat riêng = việc riêng của người đó
    const target = chat === 'team' ? 'team' : chat.startsWith('dm:') ? toRole(chat.slice(3)) : undefined
    if (!target) return 'Chỉ giao việc được trong "Cả team" hoặc chat riêng'
    assign(target, text)
    return null
  }
  if (chat.startsWith('dm:')) {
    const role = toRole(chat.slice(3))
    if (!role) return 'Không có agent này'
    appendLog(`Sếp → ${role}`, text)
    appendChannel(role, 'boss', 'Sếp', text)
    emit('user', role, text)
    inChat(chat, async () => {
      setTyping(chat, role, true)
      try {
        await answerBoss(role, text)
      } finally {
        setTyping(chat, role, false)
      }
    })
    return null
  }
  // "Cả team" (team.md) hoặc nhóm sếp tự tạo
  const g = chat === 'team' ? undefined : groupById(chat.slice(6))
  if (chat !== 'team' && !g) return 'Nhóm không còn tồn tại'
  const name = g?.name ?? 'Cả team'
  const members = g?.members ?? [...ROLES]
  const channel: Channel = g ? (chat as Channel) : 'team'
  const title = g ? groupTitle(g) : 'kênh chung của cả team'
  if (members.length === 0) return 'Nhóm chưa có thành viên'
  appendLog(`Sếp → ${g ? `nhóm ${name}` : 'cả team'}`, text)
  appendChannel(members[0], channel, 'Sếp', text)
  emit('user', members[0], text, name)
  const called = mentioned(text, members)
  const responders = called.length ? called : members
  const pmJudges = (role: Role) => !g && role === 'PM'
  inChat(chat, async () => {
    // lần lượt để người sau đọc được câu người trước trong nhóm
    for (const role of responders) {
      if (g && !groupById(g.id)?.members.includes(role)) continue // bị bớt khỏi nhóm trong lúc chờ
      setTyping(chat, role, true)
      emit('thinking', role)
      try {
        const situation =
          `Sếp vừa nhắn trong ${title}: "${text}". ` +
          (called.length ? 'Sếp gọi tên bạn. ' : '') +
          'Trả lời trong nhóm; nếu đồng đội đã nói rồi thì đừng lặp lại, có thể đáp lại ý của họ.' +
          // ở kênh Cả team, PM nhận ra tin giao việc và mở việc chung (như bật 📋 Giao việc)
          (pmJudges(role) ? taskHint(role) : '')
        const { text: reply, title: taskTitle } = await speak(role, situation, channel, 'boss')
        emit('reply', role, reply, name)
        if (pmJudges(role)) assignFromChat(role, text, taskTitle)
      } catch (e) {
        const msg = (e as Error).message
        console.error(msg)
        emit('error', role, isOutOfTokens(msg) ? 'Hết token / quota rồi... zZz' : 'Không gọi được CLI (hết token / lỗi kết nối)')
      } finally {
        setTyping(chat, role, false)
      }
    }
  })
  return null
}

function cleanMembers(raw: unknown): Role[] {
  if (!Array.isArray(raw)) return []
  return ROLES.filter((r) => raw.some((x) => typeof x === 'string' && toRole(x) === r))
}

function createGroup(name: string, members: Role[]) {
  const g: Group = { id: Date.now().toString(36), name, members, created: new Date().toLocaleString('vi-VN') }
  groups.push(g)
  saveGroups()
  fs.writeFileSync(groupFile(g.id), `# ${groupTitle(g)}\n\n`)
  fs.appendFileSync(groupFile(g.id), mdLine('Hệ thống', `Sếp tạo nhóm "${name}" với ${members.map(who).join(', ')}`))
  appendLog('Sếp', `tạo nhóm chat "${name}" (${members.join(', ')})`)
  return g
}

function updateGroup(g: Group, name: string | undefined, members: Role[] | undefined) {
  const notes: string[] = []
  if (name && name !== g.name) {
    notes.push(`Sếp đổi tên nhóm thành "${name}"`)
    g.name = name
  }
  if (members) {
    const added = members.filter((r) => !g.members.includes(r))
    const removed = g.members.filter((r) => !members.includes(r))
    if (added.length) notes.push(`Sếp thêm ${added.map(who).join(', ')} vào nhóm`)
    if (removed.length) notes.push(`Sếp bớt ${removed.map(who).join(', ')} khỏi nhóm`)
    g.members = members
  }
  saveGroups()
  for (const n of notes) fs.appendFileSync(groupFile(g.id), mdLine('Hệ thống', n))
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

// ---------- đăng nhập Antigravity từ trang cài đặt ----------
// agy chỉ hỏi mã đăng nhập khi chạy trong terminal thật, nên bọc nó trong một pty (python3) để
// server đọc được link đăng nhập và ghi mã xác thực vào. Mã chỉ dùng được cho đúng tiến trình đã tạo link.

const PTY_PY = `import os,pty,sys,select
pid,fd=pty.fork()
if pid==0: os.execvp(sys.argv[1],sys.argv[1:])
while True:
  r,_,_=select.select([fd,0],[],[])
  if fd in r:
    try: d=os.read(fd,4096)
    except OSError: break
    if not d: break
    sys.stdout.buffer.write(d); sys.stdout.flush()
  if 0 in r:
    d=os.read(0,4096)
    if d: os.write(fd,d)
_,st=os.waitpid(pid,0); sys.exit(os.waitstatus_to_exitcode(st))`

type AgyLoginState = 'idle' | 'starting' | 'waiting' | 'verifying' | 'ok' | 'error'
const agyLogin: { state: AgyLoginState; url?: string; error?: string; startedAt?: number; child?: ReturnType<typeof spawn> } = { state: 'idle' }
const AGY_LOGIN_TIMEOUT_MS = 60_000 // agy tự huỷ sau 60 giây chờ

/** Đã đăng nhập agy chưa: `agy models` báo lỗi ngay khi chưa đăng nhập */
function agyLoggedIn(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(AGY_BIN, ['models'], { cwd: AGY_WORKSPACE, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: process.env })
    const timer = setTimeout(() => child.kill(), 15_000)
    child.on('error', () => resolve(false))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

function agyLoginView() {
  const { state, url, error, startedAt } = agyLogin
  return { state, url, error, expiresAt: state === 'waiting' && startedAt ? startedAt + AGY_LOGIN_TIMEOUT_MS : undefined }
}

function stopAgyLogin() {
  agyLogin.child?.kill()
  agyLogin.child = undefined
}

/** Bật agy trong pty, chờ nó in link đăng nhập Google */
function startAgyLogin(): Promise<void> {
  stopAgyLogin()
  fs.mkdirSync(AGY_WORKSPACE, { recursive: true })
  Object.assign(agyLogin, { state: 'starting', url: undefined, error: undefined, startedAt: Date.now() })
  const child = spawn('python3', ['-c', PTY_PY, AGY_BIN, '-p', 'Trả lời đúng một chữ: ok', '--sandbox'], {
    cwd: AGY_WORKSPACE,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: process.env,
  })
  agyLogin.child = child
  let out = ''
  return new Promise((resolve) => {
    const onData = (d: Buffer) => {
      out += d.toString()
      const url = out.match(/https:\/\/accounts\.google\.com\/\S+/)?.[0]
      if (url && agyLogin.state === 'starting') {
        Object.assign(agyLogin, { state: 'waiting', url, startedAt: Date.now() })
        resolve()
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (e) => {
      Object.assign(agyLogin, { state: 'error', error: `Không chạy được agy qua python3: ${e.message}` })
      resolve()
    })
    child.on('close', (code) => {
      if (agyLogin.child !== child) return resolve() // đã có lượt đăng nhập mới
      agyLogin.child = undefined
      if (code === 0) {
        Object.assign(agyLogin, { state: 'ok', url: undefined, error: undefined })
        console.log('[agy] đã đăng nhập Antigravity từ trang cài đặt')
        for (const r of ROLES) {
          if (!workers.get(r)?.alive) stopWorker(r)
          prewarmWorker(r)
        }
      } else if (agyLogin.state !== 'ok') {
        const msg = out.match(/(?:Error|error): (.+)/)?.[1]?.trim() ?? `agy thoát mã ${code}`
        // agy vốn đã đăng nhập thì chạy thẳng, không in link
        if (/already/i.test(out)) Object.assign(agyLogin, { state: 'ok' })
        else Object.assign(agyLogin, { state: 'error', url: undefined, error: msg })
      }
      resolve()
    })
  })
}

// ---------- HTTP ----------

function send(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

function readJson(req: http.IncomingMessage, limit = 10_000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > limit) req.destroy()
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

// ---------- trang cài đặt: sửa tính cách (agents/<Role>.md) và chuyên môn (agents/<Role>_skills.md) ----------

/** Các khoá phần đầu file tính cách sửa trực tiếp trên trang cài đặt (tên đổi riêng vì phải thay cả trong hồ sơ đồng nghiệp; id cố định) */
const EDITABLE_META = ['chức_danh', 'sở_thích', 'cli', 'vai_trò', 'màu', 'nhân_vật'] as const

/** Tách file .md thành phần đầu (giữ nguyên thứ tự khoá) và phần thân */
function splitMd(file: string) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  const meta = (m?.[1] ?? '')
    .split(/\r?\n/)
    .map((l) => l.match(/^([^:\s][^:]*):[ \t]*(.*)$/))
    .filter((x): x is RegExpMatchArray => !!x)
    .map((x) => [x[1].trim(), x[2].trim()] as [string, string])
  return { meta, body: (m ? m[2] : raw).trim() }
}

function agentSettings(role: Role) {
  const persona = splitMd(path.join(AGENTS_DIR, `${role}.md`))
  const meta = Object.fromEntries(persona.meta)
  const file = skillsFile(role)
  return {
    role,
    core: CORE_ROLES.includes(role),
    name: nameOf(role),
    meta: { ...Object.fromEntries(EDITABLE_META.map((k) => [k, meta[k] ?? ''])), vai_trò: funcOf(role) },
    persona: persona.body,
    /** Nguyên văn agents/<Role>_skills.md, sửa tự do */
    skills: fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '',
  }
}

/** Tên hợp lệ: 1-20 ký tự, không trùng agent khác; trả về lỗi hoặc null */
function checkName(role: Role, name: string) {
  if (!name) return 'Tên không được để trống'
  if (name.length > 20) return 'Tên tối đa 20 ký tự'
  if (/[|*:\r\n()@]/.test(name)) return 'Tên không được chứa | * : ( ) @'
  const taken = ROLES.find((r) => r !== role && nameOf(r).toLowerCase() === name.toLowerCase())
  return taken ? `${name} đã là tên của ${taken}` : null
}

/** Thay tên cũ bằng tên mới (đúng nguyên từ, phân biệt hoa thường) trong mọi file hồ sơ agents/*.md */
function renameInProfiles(oldName: string, newName: string) {
  const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, 'gu')
  for (const f of fs.readdirSync(AGENTS_DIR).filter((n) => n.endsWith('.md'))) {
    const file = path.join(AGENTS_DIR, f)
    const text = fs.readFileSync(file, 'utf8')
    const next = text.replace(re, newName)
    if (next !== text) fs.writeFileSync(file, next)
  }
}

/** Ghi lại 2 file của agent từ dữ liệu trang cài đặt; lượt nói tiếp theo dùng ngay nội dung mới */
function saveAgentSettings(role: Role, body: Record<string, unknown>) {
  const file = path.join(AGENTS_DIR, `${role}.md`)
  const current = splitMd(file)
  const oldName = nameOf(role)
  const newName = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : oldName
  if (newName !== oldName) {
    const err = checkName(role, newName)
    if (err) return { error: err }
  }
  const incoming = typeof body.meta === 'object' && body.meta ? (body.meta as Record<string, unknown>) : {}
  const meta = new Map(current.meta)
  for (const k of EDITABLE_META) {
    const v = incoming[k]
    if (typeof v !== 'string') continue
    const clean = v.replace(/[\r\n]+/g, ' ').trim().slice(0, 80)
    if (k === 'cli' && !['claude', 'antigravity'].includes(clean)) continue
    if (k === 'vai_trò' && (CORE_ROLES.includes(role) || !FUNCS.includes(clean as Func))) continue
    if (k === 'màu' && clean && !/^#[0-9a-f]{6}$/i.test(clean)) continue
    if (k === 'nhân_vật' && !['nam', 'nữ', ...modelFiles()].includes(clean)) continue
    meta.set(k, clean)
  }
  const persona = typeof body.persona === 'string' ? body.persona.trim().slice(0, 20_000) : current.body
  fs.writeFileSync(file, `---\n${[...meta].map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${persona}\n`)

  if (typeof body.skills === 'string') fs.writeFileSync(skillsFile(role), `${body.skills.trim().slice(0, 20_000)}\n`)

  if (newName !== oldName) {
    // đổi tên ở dòng `tên:` và trong mọi hồ sơ (persona hay nhắc tên đồng nghiệp), rồi báo cả team
    renameInProfiles(oldName, newName)
    const fixed = splitMd(file)
    const m = new Map(fixed.meta)
    m.set('tên', newName)
    fs.writeFileSync(file, `---\n${[...m].map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${fixed.body}\n`)
    appendChannel(role, 'team', 'Sếp', `(thông báo) Từ giờ ${oldName} (${role}) đổi tên thành ${newName}, mọi người gọi là ${newName} nhé.`)
    appendLog('Sếp', `đổi tên ${role}: ${oldName} → ${newName}`)
  }
  appendLog('Sếp', `sửa cài đặt tính cách / chuyên môn của ${who(role)}`)
  return agentSettings(role)
}

/** Mã mới hợp lệ: chữ cái đầu, chỉ chữ và số, không trùng agent / từ khoá; trả về lỗi hoặc null */
function checkNewRole(role: string) {
  if (!/^[A-Za-z][A-Za-z0-9]{1,15}$/.test(role)) return 'Mã gồm 2-16 chữ cái / chữ số, bắt đầu bằng chữ cái (vd Designer, BE2)'
  if (['all', 'team', 'sep', 'boss', 'he', 'nhom'].includes(role.toLowerCase())) return `Mã "${role}" là từ khoá, chọn mã khác`
  const taken = ROLES.find((r) => r.toLowerCase() === role.toLowerCase())
  return taken ? `Đã có agent mã ${taken}` : null
}

/** Thêm agent mới: tạo agents/<Mã>.md và agents/<Mã>_skills.md, giới thiệu với cả team */
function createAgentFromSettings(body: Record<string, unknown>) {
  const role = typeof body.role === 'string' ? body.role.trim() : ''
  if (ROLES.length >= MAX_AGENTS) return { error: `Phòng chỉ đủ chỗ cho ${MAX_AGENTS} người` }
  const roleErr = checkNewRole(role)
  if (roleErr) return { error: roleErr }
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : ''
  const nameErr = checkName(role, name)
  if (nameErr) return { error: nameErr }
  // ghi khung file rồi dùng chung đường lưu với trang sửa (kiểm tra từng trường)
  fs.writeFileSync(path.join(AGENTS_DIR, `${role}.md`), `---\nid: ${role}\ntên: ${name}\ntạo_lúc: ${Date.now()}\n---\n\n`)
  refreshRoles()
  const saved = saveAgentSettings(role, { ...body, name })
  if ('error' in saved) {
    fs.rmSync(path.join(AGENTS_DIR, `${role}.md`), { force: true })
    refreshRoles()
    return saved
  }
  const title = frontmatter(path.join(AGENTS_DIR, `${role}.md`), 'chức_danh')
  appendChannel(role, 'team', 'Sếp', `(thông báo) Chào mừng thành viên mới: ${name} (@${role})${title ? `, ${title}` : ''}. Mọi người giúp đỡ ${name} nhé!`)
  appendLog('Sếp', `thêm agent mới ${who(role)}`)
  saveSessions()
  prewarmWorker(role)
  return agentSettings(role)
}

/** Xoá agent thêm mới (agent gốc không xoá được): bỏ hồ sơ, session, khỏi các nhóm chat; giữ lịch sử chat */
function deleteAgentFromSettings(role: Role) {
  if (CORE_ROLES.includes(role)) return { error: 'Không xoá được agent gốc' }
  const name = nameOf(role)
  stopWorker(role)
  delete sessions[role]
  delete statuses[role]
  for (const f of [`${role}.md`, `${role}_skills.md`]) fs.rmSync(path.join(AGENTS_DIR, f), { force: true })
  let touched = false
  for (const g of groups) {
    if (g.members.includes(role)) {
      g.members = g.members.filter((r) => r !== role)
      touched = true
    }
  }
  if (touched) saveGroups()
  refreshRoles()
  saveSessions()
  appendChannel(ROLES[0], 'team', 'Sếp', `(thông báo) ${name} (@${role}) đã rời team.`)
  appendLog('Sếp', `xoá agent ${role} (${name})`)
  return { ok: true }
}

/** Các file mô hình nhân vật 3D trong public/models (Mixamo: .fbx, VRoid Studio: .vrm, hoặc .glb / .gltf) */
function modelFiles() {
  try {
    return fs.readdirSync(MODELS_DIR).filter((f) => /\.(glb|gltf|fbx|vrm)$/i.test(f)).sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * Danh sách agent cho giao diện (cảnh 3D, chat, cài đặt).
 * `nhân_vật:` là tên file mô hình, hoặc `nữ` / `nam`. Với `nữ`, mỗi agent được chia một mô hình nữ khác nhau
 * (ưu tiên mô hình chưa ai chọn đích danh, mô hình VRoid trước Michelle), hết mô hình thì quay vòng.
 */
function roster() {
  const files = modelFiles()
  const picks = ROLES.map((r) => frontmatter(path.join(AGENTS_DIR, `${r}.md`), 'nhân_vật') ?? 'nam')
  const isVrm = (f: string) => (/\.vrm$/i.test(f) ? 0 : 1)
  const female = files.filter((f) => !MALE_MODELS.includes(f)).sort((a, b) => isVrm(a) - isVrm(b))
  const free = female.filter((f) => !picks.includes(f))
  const pool = free.length ? free : female
  let next = 0
  return ROLES.map((r, i) => {
    const file = path.join(AGENTS_DIR, `${r}.md`)
    const pick = picks[i]
    const body = files.includes(pick) ? pick : pick !== 'nữ' ? DEFAULT_MODEL.nam : pool.length ? pool[next++ % pool.length] : DEFAULT_MODEL.nữ
    return { id: r, core: CORE_ROLES.includes(r), func: funcOf(r), name: nameOf(r), title: frontmatter(file, 'chức_danh'), color: frontmatter(file, 'màu'), hobby: frontmatter(file, 'sở_thích'), body }
  })
}

/** Thông tin chi tiết một agent cho bảng "chi tiết" trên giao diện */
function agentDetail(role: Role) {
  const file = path.join(AGENTS_DIR, `${role}.md`)
  const engine = engineOf(role)
  const s = sessions[role]
  const w = workers.get(role)
  return {
    role,
    name: nameOf(role),
    title: frontmatter(file, 'chức_danh'),
    hobby: frontmatter(file, 'sở_thích'),
    persona: readMd(file),
    skills: skillsOf(role),
    engine,
    models: Object.fromEntries(KINDS.map((k) => [k, modelFor(k, engine) ?? '(mặc định)'])),
    session: s?.id
      ? {
          id: s.id,
          started: s.started,
          turns: s.turns,
          open: engine === 'agy' ? `cd office/agy-workspace && agy --conversation ${s.id}` : `claude --resume ${s.id}`,
        }
      : null,
    worker: engine === 'agy' ? { alive: !!w?.alive, model: w?.model ?? null } : null,
    status: statuses[role] ?? null,
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, engine: 'claude-cli' })

  // ---- trang cài đặt ----
  if (req.method === 'GET' && url.pathname === '/api/settings/agents') return send(res, 200, { agents: ROLES.map(agentSettings) })
  if (req.method === 'GET' && url.pathname === '/api/names') return send(res, 200, names())
  if (req.method === 'GET' && url.pathname === '/api/models') return send(res, 200, { files: modelFiles(), male: MALE_MODELS })
  if (req.method === 'GET' && url.pathname === '/api/roster') {
    refreshRoles() // phòng khi thêm / xoá file agents/*.md bằng tay
    return send(res, 200, { agents: roster() })
  }
  if (req.method === 'POST' && url.pathname === '/api/settings/agent/create') {
    const body = await readJson(req, 100_000)
    if (!body) return send(res, 400, { error: 'invalid_request' })
    const created = createAgentFromSettings(body)
    return send(res, 'error' in created ? 400 : 200, created)
  }
  if (req.method === 'POST' && url.pathname === '/api/settings/agent/delete') {
    const body = await readJson(req)
    const role = typeof body?.role === 'string' ? toRole(body.role) : undefined
    if (!role) return send(res, 400, { error: 'Không có agent này' })
    const r = deleteAgentFromSettings(role)
    return send(res, 'error' in r ? 400 : 200, r)
  }

  if (req.method === 'POST' && url.pathname === '/api/settings/agent') {
    const body = await readJson(req, 100_000) // tính cách dài tới 20 nghìn ký tự
    const role = typeof body?.role === 'string' ? toRole(body.role) : undefined
    if (!body || !role) return send(res, 400, { error: 'invalid_request' })
    const saved = saveAgentSettings(role, body)
    return send(res, 'error' in saved ? 400 : 200, saved)
  }

  // ---- đăng nhập Antigravity ----
  if (req.method === 'GET' && url.pathname === '/api/agy/auth') {
    const busy = ['starting', 'waiting', 'verifying'].includes(agyLogin.state)
    return send(res, 200, { loggedIn: busy ? false : await agyLoggedIn(), login: agyLoginView() })
  }
  if (req.method === 'POST' && url.pathname === '/api/agy/login') {
    if (await agyLoggedIn()) return send(res, 200, { loggedIn: true, login: agyLoginView() })
    await Promise.race([startAgyLogin(), new Promise((r) => setTimeout(r, 20_000))])
    return send(res, 200, { loggedIn: false, login: agyLoginView() })
  }
  if (req.method === 'POST' && url.pathname === '/api/agy/login/code') {
    const body = await readJson(req)
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!code || code.length > 2000 || /\s/.test(code)) return send(res, 400, { error: 'Mã không hợp lệ' })
    if (agyLogin.state !== 'waiting' || !agyLogin.child?.stdin) return send(res, 400, { error: 'Lượt đăng nhập đã hết hạn, bấm lấy link mới' })
    agyLogin.state = 'verifying'
    agyLogin.child.stdin.write(`${code}\r`)
    return send(res, 200, { login: agyLoginView() })
  }
  if (req.method === 'POST' && url.pathname === '/api/agy/login/cancel') {
    stopAgyLogin()
    Object.assign(agyLogin, { state: 'idle', url: undefined, error: undefined })
    return send(res, 200, { login: agyLoginView() })
  }

  // ---- dự án thật ----
  if (req.method === 'GET' && url.pathname === '/api/quota') {
    // số liệu Claude cũ hơn 10 phút (hoặc sếp bấm làm mới): hỏi nhanh một lượt để cập nhật
    const stale = !claudeQuota || Date.now() - claudeQuota.updatedAt > 10 * 60_000
    if (url.searchParams.get('refresh') === '1' || (stale && url.searchParams.get('auto') === '1')) await probeClaudeQuota()
    const agyAgents = ROLES.filter((r) => engineOf(r) === 'agy')
    const claudeAgents = ROLES.filter((r) => engineOf(r) !== 'agy')
    return send(res, 200, {
      claude: claudeQuota && { ...claudeQuota, agents: claudeAgents },
      agy: { ...agyHealth, agents: agyAgents },
    })
  }

  if (req.method === 'GET' && url.pathname === '/api/media') return send(res, 200, { files: mediaList() })
  if (req.method === 'GET' && url.pathname === '/api/media/file') return sendMedia(req, res, url.searchParams.get('path') ?? '')

  if (req.method === 'GET' && url.pathname === '/api/project') {
    const p = projectConfig()
    return send(res, 200, p ? { enabled: true, dir: p.dir, base: p.base } : { enabled: false })
  }

  // ---- GitHub ----
  if (req.method === 'GET' && url.pathname === '/api/github') return send(res, 200, await githubView())
  if (req.method === 'POST' && url.pathname === '/api/github/login') {
    await Promise.race([startGhLogin(), new Promise((r) => setTimeout(r, 20_000))])
    return send(res, 200, await githubView())
  }
  if (req.method === 'POST' && url.pathname === '/api/github/login/cancel') {
    stopGhLogin()
    Object.assign(ghLogin, { state: 'idle', code: undefined, url: undefined, error: undefined })
    return send(res, 200, await githubView())
  }
  if (req.method === 'POST' && url.pathname === '/api/github/repo') {
    const body = await readJson(req)
    const input = typeof body?.repo === 'string' ? body.repo.slice(0, 200) : ''
    const r = await connectRepo(input, body?.create === true, body?.private !== false)
    return 'error' in r ? send(res, 400, r) : send(res, 200, await githubView())
  }
  if (req.method === 'POST' && url.pathname === '/api/github/settings') {
    const body = await readJson(req)
    if (typeof body?.autoPush === 'boolean') setFrontmatter(PROJECT_FILE, 'auto_push', String(body.autoPush))
    return send(res, 200, await githubView())
  }
  if (req.method === 'POST' && url.pathname === '/api/github/push') {
    const p = projectConfig()
    if (!p) return send(res, 400, { error: 'Chưa có dự án' })
    const r = await pushBase(p)
    return r.ok ? send(res, 200, await githubView()) : send(res, 400, { error: `Push lỗi: ${r.out.slice(0, 300)}` })
  }

  // Khởi tạo dự án mới trong ROOT/projects/<slug> do PM Lan chủ trì
  if (req.method === 'POST' && url.pathname === '/api/project/init') {
    const body = await readJson(req)
    const name = typeof body?.name === 'string' ? body.name.trim() : 'du-an-moi'
    const desc = typeof body?.description === 'string' ? body.description.trim() : undefined
    try {
      const resProj = await initProject(name, desc)
      return send(res, 200, { ok: true, ...resProj })
    } catch (e) {
      return send(res, 500, { error: (e as Error).message })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/work') {
    const body = await readJson(req)
    const role = typeof body?.role === 'string' ? toRole(body.role) : undefined
    const step = (['code', 'fix', 'review', 'test', 'personal', ...MEDIA_STEPS] as const).find((s) => s === body?.step)
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
    const branch = str(body?.branch, 60)
    if (!role || !step || !/^task\/[\w-]+$/.test(branch)) return send(res, 400, { error: 'invalid_request' })
    try {
      const result = await doWork({
        role, step, branch,
        title: str(body?.title, 120),
        request: str(body?.request, 1000),
        notes: str(body?.notes, 4000),
        merge: body?.merge === true,
      })
      return send(res, 200, result)
    } catch (e) {
      const msg = (e as Error).message
      console.error(msg)
      const outOfTokens = isOutOfTokens(msg)
      return send(res, 502, { error: msg.slice(0, 300), outOfTokens })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/agent') {
    const role = toRole(url.searchParams.get('role') ?? '')
    if (!role) return send(res, 400, { error: 'role không hợp lệ' })
    return send(res, 200, agentDetail(role))
  }

  // ---- TikTok ----
  if (req.method === 'GET' && url.pathname === '/api/tiktok') return send(res, 200, tiktokView())
  if (req.method === 'POST' && url.pathname === '/api/tiktok') {
    const r = saveTt((await readJson(req, 20_000)) ?? {})
    return send(res, 'error' in r ? 400 : 200, r)
  }
  if (req.method === 'POST' && url.pathname === '/api/tiktok/login') {
    const body = await readJson(req)
    const r = openAgentBrowser(body?.site === 'google' ? 'https://flow.google.com/' : 'https://www.tiktok.com/login')
    return send(res, 'error' in r ? 409 : 200, r)
  }

  // ---- Telegram ----
  if (req.method === 'GET' && url.pathname === '/api/telegram') return send(res, 200, tgView())
  if (req.method === 'POST' && url.pathname === '/api/telegram/token') {
    const body = await readJson(req)
    const token = typeof body?.token === 'string' ? body.token.trim() : ''
    if (!/^\d+:[\w-]{30,}$/.test(token)) return send(res, 400, { error: 'Token không đúng dạng (vd 123456789:AA...). Lấy từ @BotFather.' })
    try {
      await setTgToken(token)
    } catch (e) {
      return send(res, 400, { error: `Telegram từ chối token: ${(e as Error).message}` })
    }
    return send(res, 200, tgView())
  }
  if (req.method === 'POST' && url.pathname === '/api/telegram/pair') {
    if (!tg.token) return send(res, 400, { error: 'Chưa có token bot' })
    tg = { ...tg, chatId: undefined, owner: undefined, pairCode: pairCode() }
    saveTg()
    return send(res, 200, tgView())
  }
  if (req.method === 'POST' && url.pathname === '/api/telegram/disconnect') {
    tgPoll?.abort()
    tgPoll = null
    tg = {}
    tgError = null
    fs.rmSync(TG_FILE, { force: true })
    return send(res, 200, tgView())
  }

  // ---- cửa sổ chat ----
  if (req.method === 'GET' && url.pathname === '/api/chats') return send(res, 200, { chats: chatList() })

  if (req.method === 'GET' && url.pathname === '/api/chats/messages') {
    const chat = url.searchParams.get('id') ?? ''
    if (!chatExists(chat)) return send(res, 404, { error: 'Không có cuộc chat này' })
    return send(res, 200, { messages: messages(chatFile(chat)).slice(-200).map(parseMessage), typing: [...(typing.get(chat) ?? [])] })
  }

  if (req.method === 'POST' && url.pathname === '/api/chats/send') {
    const body = await readJson(req)
    const chat = typeof body?.id === 'string' ? body.id : ''
    const text = typeof body?.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : ''
    if (!text || text.length > 500) return send(res, 400, { error: 'Tin nhắn trống hoặc dài quá 500 ký tự' })
    const err = sendChat(chat, text, body?.task === true)
    return err ? send(res, 400, { error: err }) : send(res, 200, { ok: true })
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/groups')) {
    const body = await readJson(req)
    const name = typeof body?.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 40) : undefined
    const members = body?.members === undefined ? undefined : cleanMembers(body.members)
    if (url.pathname === '/api/groups') {
      if (!name || !members?.length) return send(res, 400, { error: 'Cần tên nhóm và ít nhất một thành viên' })
      return send(res, 200, createGroup(name, members))
    }
    const g = typeof body?.id === 'string' ? groupById(body.id) : undefined
    if (!g) return send(res, 404, { error: 'Không có nhóm này' })
    if (url.pathname === '/api/groups/update') {
      if (members && !members.length) return send(res, 400, { error: 'Nhóm cần ít nhất một thành viên' })
      updateGroup(g, name, members)
      return send(res, 200, g)
    }
    if (url.pathname === '/api/groups/delete') {
      // giữ lại file Nhom-<id>.md làm lưu trữ, chỉ bỏ nhóm khỏi danh sách
      groups = groups.filter((x) => x.id !== g.id)
      saveGroups()
      appendLog('Sếp', `xoá nhóm chat "${g.name}"`)
      return send(res, 200, { ok: true })
    }
  }

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
      const msg = (e as Error).message
      console.error(msg)
      const outOfTokens = isOutOfTokens(msg)
      return send(res, 502, { error: 'claude_cli_failed', details: msg, outOfTokens })
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
void ensureProject().then((p) => console.log(p ? `Dự án thật: ${p.dir} (branch chính ${p.base})` : 'Chưa cấu hình dự án (agents/_project.md): chạy mô phỏng'))
const stopAll = () => {
  workers.forEach((w) => w.stop())
  stopAgyLogin()
  stopGhLogin()
}
process.on('exit', stopAll)
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => process.exit(0))
setInterval(() => void checkInbox(), 1000)
startTg()
server.listen(PORT, '127.0.0.1', () => {
  console.log(`IT Room server: http://127.0.0.1:${PORT}`)
  for (const r of ROLES) {
    const engine = engineOf(r)
    console.log(`  ${who(r)}: ${engine} · ${KINDS.map((k) => `${k}=${modelFor(k, engine) ?? 'mặc định'}`).join(', ')}`)
  }
  console.log(`Nhắn agent: sửa ${path.relative(ROOT, INBOX_FILE)}  ·  Nhật ký: ${path.relative(ROOT, CHAT_FILE)}`)
  console.log(`Session từng agent: ${path.relative(ROOT, SESSIONS_MD)}`)
})
