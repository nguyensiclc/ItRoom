import { useEffect, useState } from 'react'
import { AGENTS, agentById, type Role } from '../data/agents'
import { useStore } from '../store'
import { fetchAgentSettings, saveAgentSettings, type AgentSettings } from '../sim/ai'

/** Các nhóm cài đặt; nhóm chưa làm hiện mờ để biết trước sẽ có gì */
const SECTIONS = [
  { id: 'agents', label: '🧑‍💻 Agent', ready: true },
  { id: 'models', label: '🤖 Model', ready: false },
  { id: 'project', label: '📁 Dự án', ready: false },
  { id: 'room', label: '🏢 Phòng', ready: false },
] as const

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function AgentEditor({ saved, onSaved, onDirty }: { saved: AgentSettings; onSaved: (s: AgentSettings) => void; onDirty: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState(saved)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const def = agentById(saved.role)
  const dirty = !same(draft, saved)
  useEffect(() => onDirty(dirty), [dirty, onDirty])

  const setMeta = (k: keyof AgentSettings['meta'], v: string) => setDraft((d) => ({ ...d, meta: { ...d.meta, [k]: v } }))
  const save = async () => {
    setSaving(true)
    const res = await saveAgentSettings(draft)
    setSaving(false)
    if (res.data) {
      onSaved(res.data)
      setDraft(res.data)
      setStatus({ ok: true, text: 'Đã lưu. Agent dùng nội dung mới từ câu nói tiếp theo.' })
    } else setStatus({ ok: false, text: res.error ?? 'Lưu không được' })
  }

  return (
    <form
      className="s-editor"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <header className="s-agent-head">
        <span className="s-avatar" style={{ background: def.color }}>{def.name[0]}</span>
        <div>
          <strong>
            {saved.name} <em style={{ color: def.color }}>@{saved.role}</em>
          </strong>
          <small>agents/{saved.role}.md · agents/{saved.role}_skills.md</small>
        </div>
      </header>

      <section>
        <h4>Thông tin</h4>
        <div className="s-grid">
          <label>
            Chức danh
            <input value={draft.meta.chức_danh} maxLength={80} onChange={(e) => setMeta('chức_danh', e.target.value)} />
          </label>
          <label>
            Sở thích
            <input value={draft.meta.sở_thích} maxLength={80} onChange={(e) => setMeta('sở_thích', e.target.value)} />
          </label>
          <label>
            CLI trò chuyện
            <select value={draft.meta.cli || 'claude'} onChange={(e) => setMeta('cli', e.target.value)}>
              <option value="claude">Claude Code</option>
              <option value="antigravity">Antigravity (agy)</option>
            </select>
          </label>
        </div>
        {draft.meta.cli !== saved.meta.cli && <p className="s-warn">Đổi CLI thì agent bắt đầu session trò chuyện mới, quên những gì đã nói trước đó.</p>}
      </section>

      <section>
        <h4>Tính cách</h4>
        <p className="s-hint">Tính cách, cách nói chuyện, quan hệ đồng nghiệp, vai trò trong công việc. Viết như đang mô tả cho chính agent ("Bạn là ...").</p>
        <textarea className="s-persona" value={draft.persona} rows={14} onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))} />
      </section>

      <section>
        <h4>Chuyên môn</h4>
        <p className="s-hint">Kỹ năng, công cụ / tech stack, giới hạn... viết tự do. Toàn bộ nội dung ô này là file agents/{saved.role}_skills.md, được gửi kèm tính cách cho agent.</p>
        <textarea className="s-persona" value={draft.skills} rows={12} onChange={(e) => setDraft((d) => ({ ...d, skills: e.target.value }))} />
      </section>

      <footer className="s-actions">
        {status && <span className={status.ok ? 's-ok' : 's-error'}>{status.text}</span>}
        <button type="button" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
          Hoàn tác
        </button>
        <button className="primary" disabled={!dirty || saving}>
          {saving ? 'Đang lưu...' : 'Lưu'}
        </button>
      </footer>
    </form>
  )
}

/** Trang cài đặt phòng IT: trước mắt là tính cách và chuyên môn của từng agent */
export function Settings() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const [agents, setAgents] = useState<AgentSettings[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<Role>('PM')
  const [dirty, setDirty] = useState(false)
  /** Hỏi trước khi bỏ thay đổi chưa lưu (đổi agent, đóng trang) */
  const leave = (then: () => void) => {
    if (!dirty || window.confirm('Có thay đổi chưa lưu. Bỏ thay đổi?')) {
      setDirty(false)
      then()
    }
  }

  useEffect(() => {
    if (!open) return
    void fetchAgentSettings().then(({ data, error }) => {
      setAgents(data?.agents ?? null)
      setError(error ?? null)
    })
  }, [open])

  if (!open) return null
  const current = agents?.find((a) => a.role === role)

  return (
    <div className="panel settings" role="dialog" aria-label="Cài đặt">
      <nav className="s-nav">
        <header>
          <h2>⚙️ Cài đặt</h2>
          <button className="s-close" onClick={() => leave(() => setOpen(false))} aria-label="Đóng">
            ×
          </button>
        </header>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`s-section ${s.id === 'agents' ? 'on' : ''}`} disabled={!s.ready}>
            {s.label}
            {!s.ready && <small>sắp có</small>}
          </button>
        ))}
      </nav>

      <main className="s-main">
        <div className="s-tabs">
          {AGENTS.map((a) => (
            <button key={a.id} className={a.id === role ? 'on' : ''} style={{ '--c': a.color } as React.CSSProperties} onClick={() => a.id !== role && leave(() => setRole(a.id))}>
              <span className="s-dot" style={{ background: a.color }} />
              {a.name}
              <small>{a.id}</small>
            </button>
          ))}
        </div>
        {error && !agents && <p className="s-error">{error}</p>}
        {!agents && !error && <p className="s-hint">Đang tải...</p>}
        {current && (
          <AgentEditor
            key={current.role}
            saved={current}
            onSaved={(s) => setAgents((list) => list?.map((a) => (a.role === s.role ? s : a)) ?? null)}
            onDirty={setDirty}
          />
        )}
      </main>
    </div>
  )
}
