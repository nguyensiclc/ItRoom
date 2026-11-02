import { AGENTS, agentById, HOBBIES } from '../data/agents'
import { useStore, type AnimState, type Stage, type Task } from '../store'
import { useState } from 'react'
import { resetAiBackoff, sendToInbox } from '../sim/ai'
import { AgentDetail } from './AgentDetail'

const STAGES: { ids: Stage[]; label: string }[] = [
  { ids: ['todo', 'meeting'], label: 'Cần làm' },
  { ids: ['dev'], label: 'Đang làm' },
  { ids: ['review'], label: 'Review' },
  { ids: ['test'], label: 'Testing' },
  { ids: ['done'], label: 'Hoàn thành' },
]

function TaskBadge({ task }: { task: Task }) {
  if (task.assignee !== 'team') {
    return <span className="area" style={{ background: agentById(task.assignee).color }}>@{task.assignee}</span>
  }
  if (!task.area) return <span className="area TEAM">TEAM</span>
  return <span className={`area ${task.area}`}>{task.area === 'FULLSTACK' ? 'FS' : task.area}</span>
}

const STATE_LABEL: Record<AnimState, string> = {
  work: 'Đang làm việc',
  hobby: 'Đang rảnh',
  listen: 'Đang nghe',
  walk: 'Đang di chuyển',
  talk: 'Đang trao đổi',
  idle: 'Rảnh',
}

const SPEEDS = [1, 2, 4]

const AI_LABEL = { unknown: 'Claude AI', online: 'Claude AI', offline: 'AI offline' }
const AI_HINT = {
  unknown: 'Đang chờ lượt thoại đầu tiên từ Claude',
  online: 'Câu thoại do Claude CLI tạo theo agents/*.md. Bấm để tắt',
  offline: 'Không gọi được server (npm run server) hoặc Claude CLI. Đang dùng kịch bản, tự thử lại sau 30 giây',
  off: 'Đang dùng kịch bản có sẵn. Bấm để bật Claude AI',
}

export function Hud() {
  const agents = useStore((s) => s.agents)
  const tasks = useStore((s) => s.tasks)
  const log = useStore((s) => s.log)
  const selected = useStore((s) => s.selected)
  const speed = useStore((s) => s.speed)
  const select = useStore((s) => s.select)
  const setSpeed = useStore((s) => s.setSpeed)
  const aiEnabled = useStore((s) => s.aiEnabled)
  const aiStatus = useStore((s) => s.aiStatus)
  const setAi = useStore((s) => s.setAi)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'task' | 'chat'>('task')
  const [chatTo, setChatTo] = useState('team')
  const targets = mode === 'task' ? ['team', ...AGENTS.map((a) => a.id)] : [...AGENTS.map((a) => a.id), 'all']
  const target = targets.includes(chatTo) ? chatTo : targets[0]
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  return (
    <div className="hud">
      <header className="panel top">
        <h1>🏢 IT Room</h1>
        <div className="speed">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)}>
              {s}x
            </button>
          ))}
        </div>
        <button
          className={`ai ${aiEnabled ? aiStatus : 'off'}`}
          title={AI_HINT[aiEnabled ? aiStatus : 'off']}
          onClick={() => {
            if (!aiEnabled) resetAiBackoff()
            setAi({ aiEnabled: !aiEnabled })
          }}
        >
          <i /> {aiEnabled ? AI_LABEL[aiStatus] : 'Kịch bản'}
        </button>
      </header>

      <section className="panel kanban">
        {STAGES.map((st) => {
          const list = tasks.filter((t) => st.ids.includes(t.stage))
          const shown = st.ids[0] === 'done' ? list.slice(-5).reverse() : list
          return (
            <div key={st.label} className="col">
              <h3>
                {st.label} <span>{list.length}</span>
              </h3>
              {shown.map((t) => (
                <div key={t.id} className="card" title={t.request}>
                  <TaskBadge task={t} />
                  #{t.id} {t.title}
                  {t.stage === 'meeting' && <em className="meeting"> 🗣 đang họp</em>}
                  {t.bugs > 0 && <em> 🐞{t.bugs}</em>}
                </div>
              ))}
              {st.ids[0] === 'todo' && tasks.length === 0 && <div className="empty">Chưa có việc. Giao việc ở ô bên dưới, cả team đang ngồi chơi.</div>}
            </div>
          )
        })}
      </section>

      <section className="panel log">
        <h3>Hoạt động</h3>
        {log.slice(0, 8).map((l) => (
          <div key={l.id} className="line" title={l.text}>
            <time>{l.time}</time>
            <b style={{ color: l.who === 'Sếp' ? '#0f172a' : agentById(l.who).color }}>{l.who}</b> {l.text}
          </div>
        ))}
        <form
          className="chatbox"
          onSubmit={async (e) => {
            e.preventDefault()
            const text = draft.trim()
            if (!text) return
            // Gõ thẳng cú pháp ("@FE ..." / "giao @team ...") thì gửi nguyên văn
            const message = /^(giao\s+)?@\w+\s/i.test(text) ? text : mode === 'task' ? `giao @${target} ${text}` : `@${target} ${text}`
            setSending(true)
            const err = await sendToInbox(message)
            setSending(false)
            setChatError(err)
            if (!err) setDraft('')
          }}
        >
          <select value={mode} onChange={(e) => setMode(e.target.value as 'task' | 'chat')} aria-label="Loại">
            <option value="task">Giao việc</option>
            <option value="chat">Nhắn</option>
          </select>
          <select value={target} onChange={(e) => setChatTo(e.target.value)} aria-label="Gửi tới">
            {targets.map((id) => (
              <option key={id} value={id}>@{id}</option>
            ))}
          </select>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={mode === 'task' ? (target === 'team' ? 'Việc chung: cả team họp rồi làm' : `Việc riêng cho ${target}`) : 'Nhắn tin'}
          />
          <button disabled={sending}>Gửi</button>
        </form>
        {chatError && <div className="chat-error">{chatError}</div>}
      </section>

      {selected && <AgentDetail key={selected} role={selected} />}

      <section className="agents">
        {AGENTS.map((a) => {
          const r = agents[a.id]
          return (
            <button
              key={a.id}
              className={`panel agent ${selected === a.id ? 'sel' : ''}`}
              style={{ borderColor: a.color }}
              onClick={() => select(selected === a.id ? null : a.id)}
            >
              <strong style={{ color: a.color }}>{a.id}</strong> {a.name}
              <small>{a.title}</small>
              <span className="state">
                {r.state === 'hobby' ? `${HOBBIES[a.hobby].emoji} ${HOBBIES[a.hobby].label}` : STATE_LABEL[r.state]}
              </span>
            </button>
          )
        })}
      </section>
    </div>
  )
}
