import {
  AGENTS, agentById, AISLE_Z, DESK_Z, HOBBIES, MEETING_CENTER, MEETING_LANE_OFFSET, meetingSpot,
  type DevRole, type Role,
} from '../data/agents'
import { useStore, type Area, type Stage } from '../store'
import { faceTo, fromAisle, motions, toAisle, walkPath, walkTo } from './motion'
import {
  aiLine, markAssignmentDone, realMode, realWork, startAssignmentPolling, startEventPolling, startNamePolling, startProjectPolling, startStatusSync,
  type Assignment, type Channel, type Kind, type WorkRequest, type WorkResult,
} from './ai'

// Agent chỉ làm việc khi sếp giao (qua office/inbox.md hoặc ô giao việc trên giao diện):
// - giao @team ...  → việc chung: cả team họp, PM phân công, rồi BE/FE → QA → Tester
// - giao @FE ...    → việc riêng: chỉ người đó làm, xong báo cáo sếp
// Không có việc chung, việc riêng hay trao đổi công việc nào thì agent ngồi chơi theo sở thích.

const S = () => useStore.getState()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms / S().speed))
const chance = (p: number) => Math.random() < p
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]
/** Tên hiện tại của agent (đổi được ở trang cài đặt) */
const nm = (r: Role) => agentById(r).name

const DEV_FOCUS: Record<DevRole, string> = {
  BE: 'phần backend (API, database, xử lý nghiệp vụ)',
  FE: 'phần frontend (giao diện React, gọi API, responsive)',
}

async function say(id: Role, text: string, ms = 2200, log = true) {
  S().setAgent(id, { bubble: text })
  if (log) S().pushLog(id, text)
  await wait(ms + text.length * 25)
  S().setAgent(id, { bubble: null })
}

/**
 * Hỏi Claude câu thoại (hiện 💭 trong lúc chờ), rồi nói ra. Lỗi/tắt AI thì dùng `fallback`.
 * `channel`: nói với ai (file trò chuyện riêng của cặp đó), 'team' hoặc 'boss'; bỏ trống = tự lẩm bẩm.
 */
async function talk(id: Role, situation: string, fallback: string, ms?: number, channel?: Channel, kind: Kind = 'work') {
  S().setAgent(id, { bubble: '💭 ...' })
  const { text } = await aiLine(id, situation, { text: fallback, title: '' }, channel, kind)
  await say(id, text, ms)
}

// ---------- khoá agent: một người không bị hai việc giành cùng lúc ----------

const locked = new Set<Role>()
let waiters: (() => void)[] = []

async function withAgents<T>(ids: Role[], fn: () => Promise<T>): Promise<T> {
  while (ids.some((id) => locked.has(id))) await new Promise<void>((r) => waiters.push(r))
  ids.forEach((id) => locked.add(id))
  try {
    return await fn()
  } finally {
    ids.forEach((id) => locked.delete(id))
    const ws = waiters
    waiters = []
    ws.forEach((r) => r())
  }
}

/** Đang ngồi ở khoang: có task thì làm việc, không thì chơi theo sở thích */
function settle(id: Role) {
  const a = S().agents[id]
  if (a.state === 'work' || a.state === 'hobby' || a.state === 'listen') {
    S().setAgent(id, { state: a.taskId !== null ? 'work' : 'hobby' })
  }
}

/** Chờ agent đi hết lộ trình đang dở (nếu có) */
async function arrived(id: Role) {
  while (motions[id]) await new Promise((r) => setTimeout(r, 100))
}

/** Về chỗ ngồi; không cần await nếu muốn agent khác làm tiếp ngay */
async function goHome(id: Role) {
  const [x, z] = agentById(id).seat
  S().setAgent(id, { state: 'walk' })
  await walkTo(id, x, z, [x, DESK_Z])
  S().setAgent(id, { state: 'work' })
  settle(id)
}

interface Exchange {
  situation: string
  fallback: string
}

/** `from` đi tới khoang của `to`, nói một câu, `to` đáp lại (ghi vào file trò chuyện riêng của hai người) */
async function visit(from: Role, to: Role, line: Exchange, reply: Exchange) {
  await withAgents([from, to], async () => {
    const [x, z] = agentById(to).seat
    S().setAgent(from, { state: 'walk' })
    // `to` có thể vẫn đang đi về khoang (goHome không await): chờ ngồi xuống rồi mới chuyển sang nghe
    await Promise.all([walkTo(from, x + 0.8, z + 0.4, [x, z]), arrived(to)])
    S().setAgent(from, { state: 'talk' })
    S().setAgent(to, { state: 'listen' })
    faceTo(to, x + 0.8, z + 0.4) // xoay ghế nhìn khách
    await talk(from, `Bạn đang đứng ở khoang của ${agentById(to).name} (${to}). ${line.situation}`, line.fallback, undefined, to)
    await talk(to, `${agentById(from).name} (${from}) vừa đến khoang của bạn. ${reply.situation}`, reply.fallback, 1800, from)
    faceTo(to, x, DESK_Z)
    settle(to)
  })
}

/** Chuyển task sang `to` ở giai đoạn `stage` */
function handOff(taskId: number, from: Role, to: Role, stage: Stage) {
  S().updateTask(taskId, { stage })
  S().setAgent(from, { taskId: null })
  S().setAgent(to, { taskId })
  settle(from)
  settle(to)
}

// ---------- việc thật trên thư mục dự án (agents/_project.md) ----------

const WORK_BUBBLE: Record<WorkRequest['step'], string> = {
  code: '⌨️ Đang code thật...',
  fix: '🔧 Đang sửa code...',
  review: '🔍 Đang review diff...',
  test: '🧪 Đang chạy test...',
  personal: '⌨️ Đang làm việc...',
}

/** Một bước việc thật khi đang ở chế độ dự án thật; null khi mô phỏng hoặc lỗi (bước đó quay về mô phỏng) */
async function work(role: Role, taskId: number, step: WorkRequest['step'], notes = '', merge = false): Promise<WorkResult | null> {
  if (!realMode()) return null
  const t = S().tasks.find((x) => x.id === taskId)!
  S().setAgent(role, { bubble: WORK_BUBBLE[step] })
  const r = await realWork({ role, step, branch: t.branch, title: t.title, request: t.request, notes, merge })
  S().setAgent(role, { bubble: null })
  return r
}

/** Dev ngồi code phần việc của mình: việc thật thì nói tóm tắt đã làm, mô phỏng thì lẩm bẩm */
async function code(dev: DevRole, taskId: number, title: string, what: string, fallback: string, step: 'code' | 'fix' = 'code', notes = DEV_FOCUS[dev]) {
  const r = await work(dev, taskId, step, notes)
  if (r) return say(dev, `${r.verdict === 'fail' ? '⚠️' : '✅'} ${r.summary}`, 2500)
  await talk(dev, `Bạn đang ${what} ${DEV_FOCUS[dev]} của task "${title}". Lẩm bẩm một câu khi làm.`, fallback, 2200)
}

// ---------- họp việc chung ----------

const laneX = (x: number) => MEETING_CENTER[0] + (x < MEETING_CENTER[0] ? -MEETING_LANE_OFFSET : MEETING_LANE_OFFSET)
const isArea = (s: string | undefined): s is Area => s === 'BE' || s === 'FE' || s === 'FULLSTACK'
const AREA_LABEL: Record<Area, string> = { BE: 'backend', FE: 'frontend', FULLSTACK: 'cả backend lẫn frontend' }

/** Đang gọi cả team đi họp: không ai bắt đầu tán gẫu mới, ai đang tán gẫu thì nói nốt rồi đi họp */
let gathering = false

/** Cả team ra bàn họp bàn việc sếp giao; PM đặt tên task và chọn phần việc */
async function teamMeeting(taskId: number, request: string): Promise<{ title: string; area: Area }> {
  gathering = true
  return withAgents(AGENTS.map((a) => a.id), async () => {
    gathering = false
    const spots = AGENTS.map((_, i) => meetingSpot(i))
    // Đi vòng theo hành lang hai bên bàn họp để không xuyên qua bàn
    await Promise.all(
      AGENTS.map(async (a, i) => {
        const [x, z] = spots[i]
        S().setAgent(a.id, { state: 'walk' })
        await walkPath(a.id, [...toAisle(a.id), [laneX(x), AISLE_Z], [laneX(x), z], [x, z]], MEETING_CENTER)
        S().setAgent(a.id, { state: 'idle' })
      }),
    )
    S().updateTask(taskId, { stage: 'meeting' })

    const brief = `Sếp vừa giao việc chung cho team: "${request}".`
    S().setAgent('PM', { state: 'talk', bubble: '💭 ...' })
    const opening = await aiLine(
      'PM',
      `Đang họp ở bàn họp. ${brief} Bạn mở cuộc họp: tóm tắt yêu cầu. Đặt tên task ngắn gọn (tối đa 6 từ) vào "title", ` +
        'chọn "area": BE nếu chỉ cần backend, FE nếu chỉ cần giao diện, FULLSTACK nếu cần cả hai.',
      { title: '', text: 'Họp nhanh nhé, sếp vừa giao việc mới cho team! 📋', area: 'FULLSTACK' },
      'team', 'plan',
    )
    const title = opening.title || S().tasks.find((t) => t.id === taskId)!.title
    const area: Area = isArea(opening.area) ? opening.area : 'FULLSTACK'
    S().updateTask(taskId, { title, area })
    await say('PM', opening.text)
    S().setAgent('PM', { state: 'idle' })

    const ctx = `Đang họp ở bàn họp. ${brief} PM đặt tên task "${title}", phần việc: ${AREA_LABEL[area]}.`
    const speak = async (id: Role, situation: string, fallback: string) => {
      S().setAgent(id, { state: 'talk' })
      await talk(id, `${ctx} ${situation}`, fallback, undefined, 'team', 'plan')
      S().setAgent(id, { state: 'idle' })
    }
    if (area !== 'FE') await speak('BE', 'Nêu ngắn gọn phần backend bạn sẽ làm (API, dữ liệu).', 'Phần backend để mình lo API nhé.')
    if (area !== 'BE') await speak('FE', 'Nêu ngắn gọn phần giao diện bạn sẽ làm.', 'Giao diện để mình dựng nhé.')
    await speak('QA', 'Nêu một điểm bạn sẽ review kỹ cho task này.', 'Mình sẽ soi kỹ phần xử lý lỗi.')
    await speak('Tester', 'Nêu test case quan trọng nhất bạn sẽ chạy.', 'Mình sẽ chuẩn bị test case chính.')
    await speak(
      'PM',
      `Chốt phân công: ${area === 'FULLSTACK' ? `${nm('BE')} làm API trước rồi bàn giao ${nm('FE')} ghép giao diện` : area === 'BE' ? `${nm('BE')} làm` : `${nm('FE')} làm`}, sau đó ${nm('QA')} review, ${nm('Tester')} test. Giục mọi người về khoang.`,
      'Chốt vậy nhé, về khoang làm thôi! 🚀',
    )

    await Promise.all(
      AGENTS.map(async (a, i) => {
        const [x, z] = spots[i]
        const [sx, sz] = a.seat
        S().setAgent(a.id, { state: 'walk' })
        await walkPath(a.id, [[laneX(x), z], [laneX(x), AISLE_Z], ...fromAisle(sx, sz)], [sx, DESK_Z])
        S().setAgent(a.id, { state: 'work' })
        settle(a.id)
      }),
    )
    return { title, area }
  })
}

// ---------- việc chung: họp → dev → review → test → báo cáo sếp ----------

/** Đang có việc chung: ai chưa tới lượt thì ngồi chờ ở khoang, không đi tán gẫu */
let teamTaskActive = false

async function runTeamTask(taskId: number, request: string) {
  teamTaskActive = true
  try {
    await teamTaskFlow(taskId, request)
  } finally {
    teamTaskActive = false
  }
}

async function teamTaskFlow(taskId: number, request: string) {
  const { title, area } = await teamMeeting(taskId, request)

  // Đã phân công trong cuộc họp: dev bắt tay làm luôn. Fullstack: BE làm API trước, rồi FE ghép giao diện
  const firstDev: DevRole = area === 'FE' ? 'FE' : 'BE'
  handOff(taskId, 'PM', firstDev, 'dev')
  await code(firstDev, taskId, title, 'code', 'Đang code... ⌨️')

  let owner: DevRole = firstDev
  if (area === 'FULLSTACK') {
    await visit(
      'BE', 'FE',
      { situation: `API cho task "${title}" đã xong. Báo FE để ghép giao diện, nhắc endpoint cụ thể.`, fallback: `API xong rồi, ${nm('FE')} ghép UI giúp nhé!` },
      { situation: `BE bàn giao API cho task "${title}". Bạn nhận và hỏi/xác nhận một chi tiết về dữ liệu trả về.`, fallback: 'Ok, để mình ghép giao diện!' },
    )
    handOff(taskId, 'BE', 'FE', 'dev')
    void goHome('BE')
    await code('FE', taskId, title, 'ghép API vào', 'Đang ghép giao diện... 🎨', 'code', `${DEV_FOCUS.FE}; ghép với API backend ${nm('BE')} vừa làm trên cùng branch (đọc code backend để biết endpoint)`)
    owner = 'FE'
  }
  let merged = false

  for (;;) {
    // Code review
    await visit(
      owner, 'QA',
      { situation: `Bạn vừa tạo pull request cho ${DEV_FOCUS[owner]} của task "${title}", nhờ QA review.`, fallback: 'Mình tạo PR rồi, review giúp nhé!' },
      { situation: `Bạn nhận review PR ${owner} của task "${title}".`, fallback: 'Để mình xem 🔍' },
    )
    handOff(taskId, owner, 'QA', 'review')
    void goHome(owner)
    // Dự án thật: QA đọc diff thật và kết luận; mô phỏng: tung xúc xắc, Claude chỉ diễn đạt cho hợp tình huống
    const rv = await work('QA', taskId, 'review')
    if (rv) await say('QA', `${rv.verdict === 'fail' ? '📝' : '👍'} ${rv.summary}`, 2500)
    else await talk('QA', `Bạn đang review code ${AREA_LABEL[owner]} của task "${title}". Lẩm bẩm một nhận xét khi đọc code.`, 'Đang review code...', 2500)
    if (rv ? rv.verdict === 'fail' : chance(0.25)) {
      if (rv?.area && area === 'FULLSTACK') owner = rv.area
      await visit(
        'QA', owner,
        {
          situation: rv
            ? `Review task "${title}" KHÔNG đạt. Góp ý bạn đã ghi: ${rv.details.slice(0, 800)}. Nói ngắn điểm cần sửa chính.`
            : `Review ${AREA_LABEL[owner]} task "${title}" KHÔNG đạt. Nêu cụ thể một điểm cần sửa.`,
          fallback: 'Có vài chỗ cần sửa lại nè 📝',
        },
        { situation: 'QA yêu cầu sửa code. Bạn nhận góp ý.', fallback: 'Ok mình sửa liền!' },
      )
      handOff(taskId, 'QA', owner, 'dev')
      void goHome('QA')
      await code(owner, taskId, title, 'sửa theo góp ý review', 'Đang sửa theo review...', 'fix', `Góp ý review của QA: ${rv?.details ?? ''}`)
      continue
    }

    // Testing
    await visit(
      'QA', 'Tester',
      { situation: `Review task "${title}" đã đạt. Chuyển cho Tester kiểm thử.`, fallback: 'Code ổn rồi, test giúp nhé!' },
      { situation: `Bạn nhận kiểm thử task "${title}".`, fallback: 'Nhận! 🧪' },
    )
    handOff(taskId, 'QA', 'Tester', 'test')
    void goHome('QA')
    // Dự án thật: chạy test thật, pass thì server merge branch vào nhánh chính
    const ts = await work('Tester', taskId, 'test', '', true)
    if (ts) await say('Tester', `${ts.verdict === 'fail' ? '🐞' : '✅'} ${ts.summary}`, 2500)
    else await talk('Tester', `Bạn đang chạy test case cho task "${title}".`, 'Đang chạy test case...', 2500)
    if (ts ? ts.verdict === 'fail' : chance(0.35)) {
      const bugOwner: DevRole = ts?.area || (area === 'FULLSTACK' ? pick<DevRole>(['BE', 'FE']) : owner)
      const task = S().tasks.find((t) => t.id === taskId)!
      S().updateTask(taskId, { bugs: task.bugs + 1 })
      await visit(
        'Tester', bugOwner,
        {
          situation: ts
            ? `Kiểm thử task "${title}" phát hiện bug: ${ts.details.slice(0, 800)}. Báo ngắn gọn bug cho người phụ trách.`
            : `Kiểm thử task "${title}" phát hiện bug ở ${DEV_FOCUS[bugOwner]}. Mô tả ngắn gọn bug cụ thể.`,
          fallback: 'Phát hiện bug rồi! 🐞',
        },
        { situation: 'Tester báo bug thuộc phần bạn phụ trách. Bạn nhận fix.', fallback: 'Để mình fix ngay!' },
      )
      handOff(taskId, 'Tester', bugOwner, 'dev')
      void goHome('Tester')
      await code(bugOwner, taskId, title, 'fix bug ở', 'Đang fix bug... 🔧', 'fix', `Bug Tester báo: ${ts?.details ?? ''}`)
      owner = bugOwner
      continue
    }
    merged = !!ts?.merged
    break
  }

  await visit(
    'Tester', 'PM',
    { situation: `Task "${title}" đã pass toàn bộ test case. Báo cho PM.`, fallback: 'Pass hết test case rồi ✅' },
    { situation: `Task "${title}" hoàn thành. Bạn khen team, nói sẽ báo cáo sếp.`, fallback: 'Tuyệt, để mình báo sếp! 🎉' },
  )
  handOff(taskId, 'Tester', 'PM', 'done')
  void goHome('Tester')
  const bugs = S().tasks.find((t) => t.id === taskId)!.bugs
  await talk(
    'PM',
    `Báo cáo sếp: việc chung "${request}" (task "${title}") đã hoàn thành, qua review và test${bugs ? `, đã sửa ${bugs} bug` : ''}` +
      `${merged ? ', code đã merge vào nhánh chính của dự án' : ''}.`,
    `Dạ sếp, task "${title}" đã xong ạ ✅`,
    undefined, 'boss', 'boss',
  )
  S().setAgent('PM', { taskId: null })
  settle('PM')
}

// ---------- việc riêng: chỉ người được giao làm, xong báo cáo sếp ----------

async function runPersonalTask(taskId: number, who: Role, request: string) {
  await withAgents([who], async () => {
    // Đang ngồi ở khoang (hoặc đang đi về): nhận việc tại chỗ
    S().setAgent(who, { taskId })
    S().updateTask(taskId, { stage: 'dev' })
    settle(who)

    S().setAgent(who, { bubble: '💭 ...' })
    const ack = await aiLine(
      who,
      `Sếp giao riêng cho bạn: "${request}". Đặt tên ngắn (tối đa 6 từ) cho việc này vào "title", ` +
        'và trả lời sếp là bạn nhận việc, nói ngắn bạn sẽ làm thế nào.',
      { title: '', text: 'Dạ em nhận việc ạ, làm ngay! 💪' },
      'boss', 'boss',
    )
    if (ack.title) S().updateTask(taskId, { title: ack.title })
    const title = ack.title || request
    await say(who, ack.text)

    // Dự án thật: làm thật trên branch riêng, xong thì merge; mô phỏng: lẩm bẩm vài câu
    const r = await work(who, taskId, 'personal', '', true)
    if (r) {
      await talk(
        who,
        `Bạn vừa ${r.verdict === 'fail' ? 'làm nhưng CHƯA xong' : 'làm xong'} việc sếp giao riêng: "${request}". Kết quả: ${r.summary} ` +
          `Chi tiết: ${r.details.slice(0, 600)}${r.merged ? ' Code đã merge vào nhánh chính.' : ''} Báo cáo ngắn gọn cho sếp.`,
        r.summary, undefined, 'boss', 'boss',
      )
    } else {
      for (const step of ['bắt đầu làm', 'đang làm dở, gặp một chi tiết cần xử lý', 'sắp xong, đang kiểm tra lại']) {
        await wait(4000)
        await talk(who, `Bạn đang làm việc sếp giao riêng: "${request}" (task "${title}"), ${step}. Lẩm bẩm một câu.`, 'Đang làm... ⌨️', 1800)
      }
      await wait(2500)
      await talk(who, `Bạn vừa làm xong việc sếp giao riêng: "${request}". Báo cáo kết quả ngắn gọn cho sếp.`, 'Dạ sếp, em làm xong rồi ạ ✅', undefined, 'boss', 'boss')
    }
    S().updateTask(taskId, { stage: 'done' })
    S().setAgent(who, { taskId: null })
    settle(who)
  })
}

// ---------- hàng đợi việc sếp giao ----------

const queue: { taskId: number; a: Assignment }[] = []
let wake: (() => void) | null = null

function enqueue(a: Assignment) {
  const taskId = S().addTask(a.text, a.target)
  queue.push({ taskId, a })
  wake?.()
}

async function workLoop() {
  for (;;) {
    while (queue.length === 0) await new Promise<void>((r) => (wake = r))
    wake = null
    const { taskId, a } = queue.shift()!
    // Làm lần lượt từng việc theo thứ tự sếp giao
    if (a.target === 'team') await runTeamTask(taskId, a.text)
    else await runPersonalTask(taskId, a.target, a.text)
    markAssignmentDone(a.id)
    await wait(1500)
  }
}

// ---------- lúc rảnh: chơi theo sở thích, thỉnh thoảng sang khoang nhau tán gẫu ----------

const IDLE_TICK_MS = 12_000
/** Lúc rảnh có rủ nhau sang khoang tán gẫu không (tạm tắt: chỉ ngồi chơi và lẩm bẩm về sở thích) */
const IDLE_CHAT = false
const isRelaxing = (id: Role) => S().agents[id].state === 'hobby' && !S().agents[id].bubble
const isIdle = (id: Role) => !locked.has(id) && isRelaxing(id)

async function smallTalk(from: Role, to: Role) {
  const a = agentById(from)
  const b = agentById(to)
  await withAgents([from, to], async () => {
    if (gathering || teamTaskActive || !isRelaxing(from) || !isRelaxing(to)) return // trong lúc chờ khoá, đã có việc
    const [x, z] = b.seat
    S().setAgent(from, { state: 'walk' })
    await walkTo(from, x + 0.8, z + 0.4, [x, z])
    S().setAgent(from, { state: 'talk' })
    S().setAgent(to, { state: 'listen' })
    faceTo(to, x + 0.8, z + 0.4)
    await talk(
      from,
      `Bạn đang rảnh việc (vừa ${HOBBIES[a.hobby].label}), sang khoang ${b.name} (${to}) đang ${HOBBIES[b.hobby].label}. ` +
        'Mở đầu câu chuyện phiếm về sở thích hoặc chuyện ngoài công việc.',
      `${b.name} ơi, đang ${HOBBIES[b.hobby].label} gì đó? 😄`,
      undefined, to, 'smalltalk',
    )
    await talk(
      to,
      `Bạn đang ${HOBBIES[b.hobby].label} lúc rảnh thì ${a.name} (${from}) sang bắt chuyện. Trả lời thân thiện, kể về sở thích của bạn.`,
      `Đang ${HOBBIES[b.hobby].label} cho đỡ căng thẳng nè!`,
      1800, from, 'smalltalk',
    )
    await talk(from, `Bạn kết thúc câu chuyện phiếm với ${b.name} một cách vui vẻ, rồi về khoang.`, 'Hay đấy, lát rủ nhau nhé! 👋', 1500, to, 'smalltalk')
    faceTo(to, x, DESK_Z)
    settle(to)
    await goHome(from)
  })
}

function startIdleLife() {
  const tick = () => {
    const idle = AGENTS.map((a) => a.id).filter(isIdle)
    // Sếp vừa giao việc hoặc đang có việc chung: đừng rủ nhau đi tán gẫu
    const workPending = gathering || teamTaskActive || queue.length > 0
    if (IDLE_CHAT && !workPending && idle.length >= 2 && chance(0.35)) {
      const from = pick(idle)
      void smallTalk(from, pick(idle.filter((id) => id !== from)))
    } else if (idle.length > 0 && chance(0.6)) {
      // lẩm bẩm về sở thích: chỉ hiện bong bóng, không ghi nhật ký, không tốn lượt gọi Claude
      const id = pick(idle)
      void say(id, pick(HOBBIES[agentById(id).hobby].murmurs), 1500, false)
    }
    setTimeout(tick, IDLE_TICK_MS / S().speed)
  }
  setTimeout(tick, IDLE_TICK_MS)
}

// Cờ đặt trên globalThis: khi HMR nạp lại module này, biến cục bộ sẽ bị reset và sinh thêm vòng thứ hai
const g = globalThis as { __itroomStarted?: boolean }

export function startWorkflow() {
  if (g.__itroomStarted) return // tránh chạy 2 lần (StrictMode / HMR)
  g.__itroomStarted = true
  startEventPolling()
  startStatusSync()
  startProjectPolling()
  startNamePolling()
  startAssignmentPolling(enqueue)
  startIdleLife()
  void workLoop()
}
