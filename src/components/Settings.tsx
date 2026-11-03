import { useEffect, useState } from 'react'
import { AGENTS, agentById, FUNCS, HOBBIES, MAX_AGENTS, type Role } from '../data/agents'
import { useStore } from '../store'
import { AgyLogin } from './AgyLogin'
import { GithubSettings } from './GithubSettings'
import { TelegramSettings } from './TelegramSettings'
import { createAgent, deleteAgent, fetchAgentSettings, fetchModels, saveAgentSettings, type AgentSettings } from '../sim/ai'
import { refreshRoster } from '../sim/roster'

/** Các nhóm cài đặt; nhóm chưa làm hiện mờ để biết trước sẽ có gì */
const SECTIONS = [
  { id: 'agents', label: '🧑‍💻 Agent', ready: true },
  { id: 'login', label: '🔑 Đăng nhập', ready: true },
  { id: 'models', label: '🤖 Model', ready: false },
  { id: 'project', label: '📁 Dự án & GitHub', ready: true },
  { id: 'telegram', label: '✈️ Telegram', ready: true },
  { id: 'room', label: '🏢 Phòng', ready: false },
] as const

const PALETTE = ['#ec4899', '#eab308', '#06b6d4', '#84cc16', '#6366f1', '#ef4444', '#0ea5e9', '#d946ef']
/** Mục "thêm agent" trong dãy tab */
const NEW = '__new__'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function blankAgent(): AgentSettings {
  const used = new Set(AGENTS.map((a) => a.color))
  return {
    role: '',
    name: '',
    meta: { chức_danh: '', sở_thích: HOBBIES.music.label, cli: 'claude', vai_trò: 'khác', nhân_vật: 'nữ', màu: PALETTE.find((c) => !used.has(c)) ?? PALETTE[0] },
    persona: 'Bạn là ..., làm ... trong phòng IT.\n\n## Tính cách\n- \n\n## Cách nói chuyện\n- \n\n## Quan hệ đồng nghiệp\n- ',
    skills: '# Chuyên môn\n\n## Kỹ năng\n- \n\n## Công cụ\n- \n',
  }
}

function AgentEditor({
  saved,
  creating,
  onSaved,
  onDeleted,
  onDirty,
}: {
  saved: AgentSettings
  creating: boolean
  onSaved: (s: AgentSettings) => void
  onDeleted: () => void
  onDirty: (dirty: boolean) => void
}) {
  const [draft, setDraft] = useState(saved)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [models, setModels] = useState<{ files: string[]; male: string[] }>({ files: [], male: [] })
  useEffect(() => {
    fetchModels().then((r) => r.data && setModels(r.data))
  }, [])
  const color = draft.meta.màu || agentById(saved.role).color
  const dirty = creating || !same(draft, saved)
  useEffect(() => onDirty(creating ? !same(draft, saved) : dirty), [creating, draft, saved, dirty, onDirty])

  const setMeta = (k: keyof AgentSettings['meta'], v: string) => setDraft((d) => ({ ...d, meta: { ...d.meta, [k]: v } }))
  const save = async () => {
    setSaving(true)
    const res = await (creating ? createAgent(draft) : saveAgentSettings(draft))
    setSaving(false)
    if (res.data) {
      setDraft(res.data)
      await refreshRoster()
      onSaved(res.data)
      setStatus({ ok: true, text: creating ? 'Đã thêm agent. Agent vào khoang mới và được giới thiệu với cả team.' : 'Đã lưu. Agent dùng nội dung mới từ câu nói tiếp theo.' })
    } else setStatus({ ok: false, text: res.error ?? 'Lưu không được' })
  }
  const remove = async () => {
    if (!window.confirm(`Xoá ${saved.name} (@${saved.role})? File hồ sơ và session trò chuyện của agent này sẽ bị xoá, không lấy lại được.`)) return
    setSaving(true)
    const res = await deleteAgent(saved.role)
    setSaving(false)
    if (res.error) return setStatus({ ok: false, text: res.error })
    await refreshRoster()
    onDeleted()
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
        <span className="s-avatar" style={{ background: color }}>{(draft.name || '?')[0]}</span>
        <div>
          <strong>
            {draft.name || (creating ? 'Agent mới' : '…')} <em style={{ color }}>@{draft.role || '…'}</em>
          </strong>
          <small>{draft.role ? `agents/${draft.role}.md · agents/${draft.role}_skills.md` : 'Điền thông tin rồi bấm Thêm agent'}</small>
        </div>
      </header>

      <section>
        <h4>Thông tin</h4>
        <div className="s-grid">
          {creating && (
            <label>
              Mã gọi (@mã)
              <input value={draft.role} maxLength={16} placeholder="vd Designer, BE2" onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value.replace(/[^A-Za-z0-9]/g, '') }))} />
            </label>
          )}
          <label>
            Tên
            <input value={draft.name} maxLength={20} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </label>
          <label>
            Chức danh
            <input value={draft.meta.chức_danh} maxLength={80} onChange={(e) => setMeta('chức_danh', e.target.value)} />
          </label>
          <label>
            Vai trò khi làm việc
            <select value={draft.meta.vai_trò || saved.role} disabled={saved.core} onChange={(e) => setMeta('vai_trò', e.target.value)}>
              {FUNCS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sở thích
            <input value={draft.meta.sở_thích} maxLength={80} list="s-hobbies" onChange={(e) => setMeta('sở_thích', e.target.value)} />
            <datalist id="s-hobbies">
              {Object.values(HOBBIES).map((h) => (
                <option key={h.label} value={h.label} />
              ))}
            </datalist>
          </label>
          <label>
            CLI trò chuyện
            <select value={draft.meta.cli || 'claude'} onChange={(e) => setMeta('cli', e.target.value)}>
              <option value="claude">Claude Code</option>
              <option value="antigravity">Antigravity (agy)</option>
            </select>
          </label>
          <label>
            Nhân vật 3D
            <select value={draft.meta.nhân_vật || 'nam'} onChange={(e) => setMeta('nhân_vật', e.target.value)}>
              <option value="nữ">Nữ (tự chia mô hình)</option>
              <option value="nam">Nam</option>
              {models.files.map((f) => (
                <option key={f} value={f}>
                  {f.replace(/\.[^.]+$/, '')}
                  {models.male.includes(f) ? ' (nam)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            Màu
            <input type="color" className="s-color" value={color} onChange={(e) => setMeta('màu', e.target.value)} />
          </label>
        </div>
        {saved.core && <p className="s-hint">Agent gốc giữ khung quy trình việc chung (họp → dev → review → test), nên không đổi vai trò hay xoá được.</p>}
        {!saved.core && (
          <p className="s-hint">
            Agent thêm mới cùng họp và trò chuyện với team, nhận việc riêng khi bạn giao trong chat riêng. Vai trò quyết định quyền khi làm việc thật: dev và tester sửa code, chạy lệnh; PM đọc và viết tài liệu; QA và "khác" chỉ đọc.
          </p>
        )}
        {!creating && draft.name.trim() !== saved.name && (
          <p className="s-warn">
            Đổi tên: tên {saved.name} trong mọi file hồ sơ (kể cả hồ sơ đồng nghiệp) sẽ thay bằng {draft.name.trim() || '…'}, và cả team được báo trong kênh chung.
          </p>
        )}
        {!creating && draft.meta.cli !== saved.meta.cli && <p className="s-warn">Đổi CLI thì agent bắt đầu session trò chuyện mới, quên những gì đã nói trước đó.</p>}
      </section>

      <section>
        <h4>Tính cách</h4>
        <p className="s-hint">Tính cách, cách nói chuyện, quan hệ đồng nghiệp, vai trò trong công việc. Viết như đang mô tả cho chính agent ("Bạn là ...").</p>
        <textarea className="s-persona" value={draft.persona} rows={14} onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))} />
      </section>

      <section>
        <h4>Chuyên môn</h4>
        <p className="s-hint">Kỹ năng, công cụ / tech stack, giới hạn... viết tự do. Được gửi kèm tính cách cho agent.</p>
        <textarea className="s-persona" value={draft.skills} rows={12} onChange={(e) => setDraft((d) => ({ ...d, skills: e.target.value }))} />
      </section>

      <footer className="s-actions">
        {status && <span className={status.ok ? 's-ok' : 's-error'}>{status.text}</span>}
        {!creating && !saved.core && (
          <button type="button" className="s-danger" disabled={saving} onClick={() => void remove()}>
            Xoá agent
          </button>
        )}
        {!creating && (
          <button type="button" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
            Hoàn tác
          </button>
        )}
        <button className="primary" disabled={saving || (!creating && !dirty) || (creating && (!draft.role || !draft.name.trim()))}>
          {saving ? 'Đang lưu...' : creating ? 'Thêm agent' : 'Lưu'}
        </button>
      </footer>
    </form>
  )
}

/** Trang cài đặt phòng IT: agent (thêm / sửa / xoá) và đăng nhập CLI */
export function Settings() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  useStore((s) => s.namesVersion) // vẽ lại dãy tab khi danh sách agent đổi
  const [agents, setAgents] = useState<AgentSettings[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [role, setRole] = useState<Role>('PM')
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('agents')
  const [dirty, setDirty] = useState(false)
  const [blank, setBlank] = useState(blankAgent)
  /** Hỏi trước khi bỏ thay đổi chưa lưu (đổi agent, đóng trang) */
  const leave = (then: () => void) => {
    if (!dirty || window.confirm('Có thay đổi chưa lưu. Bỏ thay đổi?')) {
      setDirty(false)
      then()
    }
  }
  const reload = () =>
    fetchAgentSettings().then(({ data, error }) => {
      setAgents(data?.agents ?? null)
      setError(error ?? null)
    })

  useEffect(() => {
    if (open) void reload()
  }, [open])

  if (!open) return null
  const creating = role === NEW
  const current = creating ? blank : agents?.find((a) => a.role === role)
  const full = AGENTS.length >= MAX_AGENTS

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
          <button key={s.id} className={`s-section ${s.id === section ? 'on' : ''}`} disabled={!s.ready} onClick={() => s.id !== section && leave(() => setSection(s.id))}>
            {s.label}
            {!s.ready && <small>sắp có</small>}
          </button>
        ))}
      </nav>

      <main className="s-main">
        {section === 'login' && <AgyLogin />}
        {section === 'project' && <GithubSettings />}
        {section === 'telegram' && <TelegramSettings />}
        {section === 'agents' && (
          <>
            <div className="s-tabs">
              {AGENTS.map((a) => (
                <button key={a.id} className={a.id === role ? 'on' : ''} style={{ '--c': a.color } as React.CSSProperties} onClick={() => a.id !== role && leave(() => setRole(a.id))}>
                  <span className="s-dot" style={{ background: a.color }} />
                  {a.name}
                  <small>{a.id}</small>
                </button>
              ))}
              <button
                className={`s-add ${creating ? 'on' : ''}`}
                disabled={full && !creating}
                title={full ? `Phòng tối đa ${MAX_AGENTS} người` : 'Thêm agent mới'}
                onClick={() =>
                  !creating &&
                  leave(() => {
                    setBlank(blankAgent())
                    setRole(NEW)
                  })
                }
              >
                ＋ Thêm agent
              </button>
            </div>
            {error && !agents && <p className="s-error">{error}</p>}
            {!agents && !error && <p className="s-hint">Đang tải...</p>}
            {agents && current && (
              <AgentEditor
                key={creating ? `new-${blank.meta.màu}` : current.role}
                saved={current}
                creating={creating}
                onSaved={(s) => {
                  setDirty(false)
                  // đổi tên thì hồ sơ đồng nghiệp cũng đổi: nạp lại để không ghi đè tên cũ khi lưu agent khác
                  void reload().then(() => setRole(s.role))
                }}
                onDeleted={() => {
                  setDirty(false)
                  setRole('PM')
                  void reload()
                }}
                onDirty={setDirty}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
