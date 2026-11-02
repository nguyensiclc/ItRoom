import { useEffect, useState } from 'react'
import { agentById, HOBBIES, type Role } from '../data/agents'
import { useStore, type AnimState } from '../store'
import { fetchAgentDetail, type AgentDetail as Detail } from '../sim/ai'

const STATE_LABEL: Record<AnimState, string> = {
  work: 'Đang làm việc',
  hobby: 'Đang rảnh',
  listen: 'Đang nghe',
  walk: 'Đang di chuyển',
  talk: 'Đang trao đổi',
  idle: 'Đứng họp',
}

const STAGE_LABEL = { todo: 'chưa bắt đầu', meeting: 'đang họp', dev: 'đang làm', review: 'review', test: 'testing', done: 'xong' }

const KIND_LABEL = { smalltalk: 'Tán gẫu', work: 'Làm việc', plan: 'Họp', boss: 'Với sếp' }

export function AgentDetail({ role }: { role: Role }) {
  const def = agentById(role)
  const runtime = useStore((s) => s.agents[role])
  const tasks = useStore((s) => s.tasks)
  const select = useStore((s) => s.select)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [showPersona, setShowPersona] = useState(false)

  useEffect(() => {
    let alive = true
    setDetail(null)
    setLoaded(false)
    const load = async () => {
      const d = await fetchAgentDetail(role)
      if (!alive) return
      setDetail(d)
      setLoaded(true)
    }
    void load()
    const timer = setInterval(load, 4000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [role])

  const task = tasks.find((t) => t.id === runtime.taskId)
  const mine = tasks.filter((t) => t.assignee === role)
  const doneMine = mine.filter((t) => t.stage === 'done').length
  const doneTeam = tasks.filter((t) => t.assignee === 'team' && t.stage === 'done').length
  const hobby = HOBBIES[def.hobby]

  return (
    <aside className="panel detail" style={{ borderColor: def.color }}>
      <header>
        <span className="avatar" style={{ background: def.color }}>{def.name[0]}</span>
        <div>
          <strong>
            {def.name} <em style={{ color: def.color }}>@{role}</em>
          </strong>
          <small>{detail?.title ?? def.title}</small>
        </div>
        <button className="dm" onClick={() => useStore.getState().openChat(`dm:${role}`)} title={`Nhắn riêng cho ${def.name}`}>
          💬 Nhắn
        </button>
        <button className="close" onClick={() => select(null)} aria-label="Đóng">
          ×
        </button>
      </header>

      <dl>
        <dt>Trạng thái</dt>
        <dd>{runtime.state === 'hobby' ? `${hobby.emoji} ${hobby.label}` : STATE_LABEL[runtime.state]}</dd>
        <dt>Task</dt>
        <dd>{task ? `#${task.id} ${task.title} (${STAGE_LABEL[task.stage]})` : '—'}</dd>
        <dt>Sở thích</dt>
        <dd>
          {hobby.emoji} {detail?.hobby ?? hobby.label}
        </dd>
        <dt>Đã xong</dt>
        <dd>
          {doneMine} việc riêng · {doneTeam} việc chung
        </dd>
      </dl>

      <h3>CLI &amp; trí nhớ</h3>
      {!loaded ? (
        <p className="muted">Đang tải…</p>
      ) : !detail ? (
        <p className="muted">Server chưa chạy (npm run server), không có thông tin session.</p>
      ) : (
        <>
          <dl>
            <dt>CLI</dt>
            <dd>
              {detail.engine === 'agy' ? 'Antigravity (agy)' : 'Claude Code'}
              {detail.worker && (
                <span className={`pill ${detail.worker.alive ? 'on' : ''}`}>
                  {detail.worker.alive ? `chạy liên tục · ${detail.worker.model ?? ''}` : 'chưa bật tiến trình'}
                </span>
              )}
            </dd>
            <dt>Session</dt>
            <dd>
              {detail.session ? (
                <>
                  {detail.session.turns} lượt · từ {detail.session.started}
                  <code title="Lệnh mở session này trong terminal">{detail.session.open}</code>
                </>
              ) : (
                'chưa có (tạo khi nói lần đầu)'
              )}
            </dd>
          </dl>
          <div className="models">
            {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
              <span key={k}>
                {KIND_LABEL[k]} <b>{detail.models[k]}</b>
              </span>
            ))}
          </div>

          <button className="link" onClick={() => setShowPersona((v) => !v)}>
            {showPersona ? 'Ẩn' : 'Xem'} tính cách (agents/{role}.md)
          </button>
          {showPersona && <pre className="persona">{detail.persona}</pre>}
        </>
      )}

    </aside>
  )
}
