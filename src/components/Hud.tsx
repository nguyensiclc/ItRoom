import { agentById } from '../data/agents'
import { useStore, type Stage, type Task } from '../store'
import { resetAiBackoff } from '../sim/ai'
import { AgentDetail } from './AgentDetail'
import { ChatLauncher, TeamsChat } from './TeamsChat'

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

const AI_LABEL = { unknown: 'Claude AI', online: 'Claude AI', offline: 'AI offline' }
const AI_HINT = {
  unknown: 'Đang chờ lượt thoại đầu tiên từ Claude',
  online: 'Câu thoại do Claude CLI tạo theo agents/*.md. Bấm để tắt',
  offline: 'Không gọi được server (npm run server) hoặc Claude CLI. Đang dùng kịch bản, tự thử lại sau 30 giây',
  off: 'Đang dùng kịch bản có sẵn. Bấm để bật Claude AI',
}

export function Hud() {
  const tasks = useStore((s) => s.tasks)
  const selected = useStore((s) => s.selected)
  const aiEnabled = useStore((s) => s.aiEnabled)
  const aiStatus = useStore((s) => s.aiStatus)
  const setAi = useStore((s) => s.setAi)

  return (
    <div className="hud">
      <header className="panel top">
        <h1>🏢 IT Room</h1>
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
        <ChatLauncher />
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
              {st.ids[0] === 'todo' && tasks.length === 0 && <div className="empty">Chưa có việc. Giao việc qua 💬 Chat, cả team đang ngồi chơi.</div>}
            </div>
          )
        })}
      </section>

      {selected && <AgentDetail key={selected} role={selected} />}
      <TeamsChat />
    </div>
  )
}
