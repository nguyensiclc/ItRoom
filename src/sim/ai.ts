import { AGENTS, agentById, HOBBIES, type Role } from '../data/agents'
import { useStore } from '../store'
import { motions, positions } from './motion'

export function isOutOfTokens(err: string): boolean {
  return /quota|token|credit|rate_limit|resource_exhausted|429|overloaded|usage limit|hết quota|insufficient/i.test(err)
}

/** Đặt agent vào trạng thái ngủ tại ghế khi hết token/quota hoặc lỗi gọi CLI */
export function putAgentToSleep(role: Role, reason = 'Hết token rồi... ngủ tí đã!') {
  const { setAgent, pushLog } = useStore.getState()
  setAgent(role, { state: 'sleep', bubble: `💤 ${reason} zZz...` })
  pushLog(role, `💤 ${agentById(role).name} gục xuống ghế ngủ khò khò... (${reason})`)
  const def = agentById(role)
  positions[role].set(def.seat[0], 0, def.seat[1])
  delete motions[role]
}

const RETRY_AFTER_MS = 30_000
const TIMEOUT_MS = 95_000 // một lần `claude -p` mất vài giây, đôi khi lâu hơn
let lastFailure = 0

export interface Line {
  text: string
  title: string
  /** Chỉ có khi PM tạo task mới: 'BE' | 'FE' | 'FULLSTACK' */
  area?: string
}

/** Nói với một đồng đội (file riêng của cặp), cả team (team.md) hoặc sếp (Sep-<Role>.md) */
export type Channel = Role | 'team' | 'boss'

/** Loại việc của câu thoại; server chọn model theo agents/_models.md (tán gẫu → haiku...) */
export type Kind = 'smalltalk' | 'work' | 'plan' | 'boss'

/** Việc sếp giao: 'team' = việc chung, hoặc giao đích danh một agent */
export interface Assignment {
  id: number
  target: Role | 'team'
  text: string
}

const SESSION = Math.random().toString(36).slice(2) + Date.now().toString(36)

/** Báo server việc đã xong, để không bị giao lại khi tải lại trang */
export function markAssignmentDone(id: number) {
  void fetch('/api/assignments/done', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => {})
}

/** Nhận việc sếp giao từ server (qua office/inbox.md hoặc ô giao việc) */
export function startAssignmentPolling(onAssignment: (a: Assignment) => void) {
  const poll = async () => {
    try {
      const res = await fetch('/api/assignments/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: SESSION }),
      })
      if (res.ok) {
        const { assignments } = (await res.json()) as { assignments: Assignment[] }
        for (const a of assignments) {
          useStore.getState().pushLog('Sếp', `giao việc ${a.target === 'team' ? 'chung' : `cho ${a.target}`}: ${a.text}`)
          onAssignment(a)
        }
      }
    } catch {
      // server chưa chạy: thử lại ở lượt sau
    }
    setTimeout(poll, 1500)
  }
  void poll()
}

/**
 * Xin Claude (qua server gọi Claude CLI) một câu thoại cho `role` trong `situation`.
 * Trả về `fallback` khi AI tắt, server chưa chạy hoặc lỗi.
 */
export async function aiLine(role: Role, situation: string, fallback: Line, channel?: Channel, kind: Kind = 'work'): Promise<Line> {
  const { aiEnabled, setAi } = useStore.getState()
  if (!aiEnabled || Date.now() - lastFailure < RETRY_AFTER_MS) return fallback

  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, situation, channel, kind }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { outOfTokens?: boolean; error?: string; details?: string }
      if (err?.outOfTokens || isOutOfTokens(err?.details || err?.error || '')) {
        putAgentToSleep(role)
      }
      throw new Error(`HTTP ${res.status}`)
    }
    const line = (await res.json()) as Line
    if (!line.text) throw new Error('empty')
    setAi({ aiStatus: 'online' })
    return { text: line.text, title: line.title || fallback.title, area: line.area || fallback.area }
  } catch {
    lastFailure = Date.now()
    setAi({ aiStatus: 'offline' })
    return fallback
  }
}

/** Gọi khi người dùng bật lại AI để thử kết nối ngay */
export function resetAiBackoff() {
  lastFailure = 0
}

const STAGE_LABEL = { todo: 'chưa bắt đầu', meeting: 'đang họp', dev: 'đang làm', review: 'đang review', test: 'đang test', done: 'xong' }

/** Mô tả ngắn agent đang làm gì, để server đưa vào prompt (nhất là khi trả lời sếp) */
function statusOf(role: Role): string {
  const { agents, tasks } = useStore.getState()
  const a = agents[role]
  const task = tasks.find((t) => t.id === a.taskId)
  const def = AGENTS.find((d) => d.id === role)!
  if (task) {
    const kind = task.assignee === 'team' ? `việc chung${task.area ? `, ${task.area}` : ''}` : 'việc sếp giao riêng'
    return `Đang giữ task "${task.title}" (${kind}, ${STAGE_LABEL[task.stage]}).`
  }
  const waiting = tasks.filter((t) => t.stage === 'todo').length
  if (a.state === 'hobby') {
    return `Không có việc nào (sếp chưa giao${waiting ? `, ${waiting} việc đang chờ đến lượt` : ''}), ngồi ${HOBBIES[def.hobby].label} ở khoang của mình.`
  }
  if (a.state === 'idle' || a.state === 'talk') return 'Đang ở ngoài khoang (họp hoặc trao đổi với đồng đội).'
  if (a.state === 'walk') return 'Đang đi lại trong phòng.'
  return 'Đang ngồi ở khoang.'
}

/** Gửi trạng thái cả phòng lên server mỗi vài giây */
export function startStatusSync() {
  const sync = async () => {
    const statuses = Object.fromEntries(AGENTS.map((a) => [a.id, statusOf(a.id)]))
    try {
      await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statuses }),
      })
    } catch {
      // server chưa chạy: bỏ qua
    }
    setTimeout(sync, 3000)
  }
  void sync()
}

interface OfficeEvent {
  id: number
  type: 'user' | 'thinking' | 'reply' | 'error'
  role: Role
  text: string
  group?: string
}

const chatTimers: Partial<Record<Role, ReturnType<typeof setTimeout>>> = {}

function showChat(role: Role, text: string, ms: number | null) {
  const { setAgent } = useStore.getState()
  clearTimeout(chatTimers[role])
  setAgent(role, { chat: text })
  if (ms !== null) chatTimers[role] = setTimeout(() => setAgent(role, { chat: null }), ms)
}

/** Lấy tin nhắn sếp ↔ agent từ server (kể cả tin viết thẳng vào inbox.md) và hiện lên phòng */
export function startEventPolling() {
  let since = -1 // lần đầu chỉ lấy mốc, bỏ qua sự kiện cũ
  const poll = async () => {
    try {
      const res = await fetch(`/api/events?since=${Math.max(since, 0)}`)
      if (res.ok) {
        const { events, last } = (await res.json()) as { events: OfficeEvent[]; last: number }
        if (since >= 0) {
          const { pushLog } = useStore.getState()
          for (const e of events) {
            const where = e.group ? `[${e.group}] ` : ''
            if (e.type === 'user') pushLog('Sếp', e.group ? `${where}${e.text}` : e.text.startsWith('@all') ? e.text : `@${e.role} ${e.text}`)
            if (e.type === 'thinking') showChat(e.role, '💭 đang soạn trả lời sếp...', null)
            if (e.type === 'reply') {
              pushLog(e.role, `↩ ${where}${e.text}`)
              showChat(e.role, e.text, 6000 + e.text.length * 60)
            }
            if (e.type === 'error') {
              showChat(e.role, `⚠️ ${e.text}`, 5000)
              putAgentToSleep(e.role, e.text)
            }
          }
        }
        since = last
      }
    } catch {
      // server chưa chạy: thử lại ở lượt sau
    }
    setTimeout(poll, 1500)
  }
  void poll()
}

export interface AgentDetail {
  role: Role
  name: string
  title?: string
  hobby?: string
  persona: string
  /** Nội dung agents/<Role>_skills.md (bảng kỹ năng + mức sao) */
  skills: string
  engine: 'claude' | 'agy'
  models: Record<Kind, string>
  session: { id: string; started: string; turns: number; open: string } | null
  worker: { alive: boolean; model: string | null } | null
  status: string | null
}

/** Chi tiết agent từ server (persona, session CLI, model, kênh chat); null khi server không chạy */
export async function fetchAgentDetail(role: Role): Promise<AgentDetail | null> {
  try {
    const res = await fetch(`/api/agent?role=${role}`)
    return res.ok ? ((await res.json()) as AgentDetail) : null
  } catch {
    return null
  }
}

// ---------- cửa sổ chat kiểu Teams ----------

export interface ChatMessage {
  time: string
  /** 'boss' = sếp, '' = dòng hệ thống */
  from: Role | 'boss' | ''
  text: string
}

export interface ChatSummary {
  /** `team`, `dm:BE` hoặc `group:<id>` */
  id: string
  kind: 'team' | 'dm' | 'group'
  name: string
  members: Role[]
  count: number
  last: ChatMessage | null
  typing: Role[]
}

async function api<T>(url: string, body?: unknown): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    return res.ok ? { data } : { error: data.error ?? `Lỗi ${res.status}` }
  } catch {
    return { error: 'Không kết nối được server (npm run server)' }
  }
}

export const fetchChats = () => api<{ chats: ChatSummary[] }>('/api/chats')
export const fetchMessages = (id: string) => api<{ messages: ChatMessage[]; typing: Role[] }>(`/api/chats/messages?id=${encodeURIComponent(id)}`)
/** `task`: giao việc (Cả team = việc chung, chat riêng = việc riêng) thay vì nhắn tin */
export const sendChatMessage = (id: string, text: string, task = false) => api<{ ok: true }>('/api/chats/send', { id, text, task })
export const createGroup = (name: string, members: Role[]) => api<{ id: string }>('/api/groups', { name, members })
export const updateGroup = (id: string, patch: { name?: string; members?: Role[] }) => api<{ id: string }>('/api/groups/update', { id, ...patch })
export const deleteGroup = (id: string) => api<{ ok: true }>('/api/groups/delete', { id })

// ---------- làm việc thật trên thư mục dự án ----------

let project: { dir: string; base: string } | null = null

/** Hỏi server dự án thật đang cấu hình (agents/_project.md); null = mô phỏng */
export function startProjectPolling() {
  const poll = async () => {
    try {
      const res = await fetch('/api/project')
      const p = res.ok ? ((await res.json()) as { enabled: boolean; dir?: string; base?: string }) : null
      project = p?.enabled && p.dir ? { dir: p.dir, base: p.base ?? 'main' } : null
    } catch {
      project = null
    }
    setTimeout(poll, 10_000)
  }
  void poll()
}

/** Đang làm việc thật: có dự án, server chạy và đang bật Claude AI */
export const realMode = () => !!project && useStore.getState().aiEnabled

/** Thông tin dự án hiện tại */
export const currentProject = () => project

/** PM tự khởi tạo dự án mới trong ROOT/projects/<slug> */
export async function initProjectApi(name: string, description?: string) {
  const res = await api<{ ok: boolean; dir: string; base: string; slug: string; relativePath: string }>('/api/project/init', { name, description })
  if (res.data?.ok && res.data.dir) {
    project = { dir: res.data.dir, base: res.data.base ?? 'main' }
  }
  return res.data
}

export interface WorkResult {
  summary: string
  verdict: 'done' | 'pass' | 'fail'
  area: '' | 'BE' | 'FE'
  details: string
  branch: string
  commit: string
  merged: boolean
  seconds: number
}

export interface WorkRequest {
  role: Role
  step: 'code' | 'fix' | 'review' | 'test' | 'personal'
  branch: string
  title: string
  request: string
  notes?: string
  merge?: boolean
}

/** Một bước việc thật (có thể mất vài phút); null khi lỗi, để quy trình quay về mô phỏng cho bước đó */
export async function realWork(w: WorkRequest): Promise<WorkResult | null> {
  try {
    const res = await fetch('/api/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(w),
      signal: AbortSignal.timeout(30 * 60_000),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { outOfTokens?: boolean; error?: string }
      if (err?.outOfTokens || isOutOfTokens(err?.error || '')) {
        putAgentToSleep(w.role, 'Hết token khi đang code')
      }
      return null
    }
    return (await res.json()) as WorkResult
  } catch {
    return null
  }
}

// ---------- trang cài đặt ----------

export interface AgentSettings {
  role: Role
  name: string
  meta: { chức_danh: string; sở_thích: string; cli: string }
  /** Phần thân agents/<Role>.md: tính cách, quan hệ đồng nghiệp, vai trò */
  persona: string
  /** Nguyên văn agents/<Role>_skills.md: chuyên môn, công cụ, giới hạn (viết tự do) */
  skills: string
}

export const fetchAgentSettings = () => api<{ agents: AgentSettings[] }>('/api/settings/agents')
export const saveAgentSettings = (s: AgentSettings) => api<AgentSettings>('/api/settings/agent', s)

// ---------- tên agent (dòng `tên:` trong agents/<Role>.md, đổi được ở trang cài đặt) ----------

/** Gán tên mới vào danh sách AGENTS dùng chung; báo store để nhãn 3D, chat... vẽ lại */
export function applyNames(names: Partial<Record<Role, string>>) {
  let changed = false
  for (const a of AGENTS) {
    const n = names[a.id]
    if (n && n !== a.name) {
      a.name = n
      changed = true
    }
  }
  if (changed) useStore.getState().bumpNames()
}

/** Lấy tên từ server lúc mở trang và định kỳ (phòng khi sửa tay file .md) */
export function startNamePolling() {
  const poll = async () => {
    const { data } = await api<Record<Role, string>>('/api/names')
    if (data) applyNames(data)
    setTimeout(poll, 15_000)
  }
  void poll()
}
