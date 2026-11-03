import { useEffect, useState } from 'react'
import { connectGithubRepo, pushGithub, setAutoPush, type GithubInfo } from '../sim/ai'
import { GithubLogin } from './GithubLogin'

type Result = { data?: GithubInfo; error?: string }

/** Dự án thật và GitHub: đăng nhập gh, nối repo (tạo mới hoặc có sẵn), push, bật tự push sau mỗi lần merge */
export function GithubSettings() {
  const [info, setInfo] = useState<GithubInfo | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'create' | 'existing'>('create')
  const [repo, setRepo] = useState('')
  const [isPrivate, setPrivate] = useState(true)

  useEffect(() => {
    // gợi ý tên repo theo thư mục dự án
    if (info?.project && !repo) setRepo(info.project.dir.split('/').pop() ?? '')
  }, [info, repo])

  const run = async (fn: () => Promise<Result>, ok?: string) => {
    setBusy(true)
    setStatus(null)
    const r = await fn()
    setBusy(false)
    if (r.data) setInfo(r.data)
    setStatus(r.error ? { ok: false, text: r.error } : ok ? { ok: true, text: ok } : null)
  }

  const p = info?.project
  const repoUrl = p?.remote?.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/')

  return (
    <div className="s-editor">
      <header className="s-agent-head">
        <span className="s-avatar" style={{ background: '#0f172a' }}>⌥</span>
        <div>
          <strong>Dự án & GitHub</strong>
          <small>Nối dự án agent đang làm với một repo GitHub để push source lên</small>
        </div>
      </header>

      <GithubLogin onChange={setInfo} />

      <section>
        <h4>Repo của dự án</h4>
        {info && !p && <p className="s-warn">Chưa có dự án thật. Giao một việc cho team để PM khởi tạo dự án trước.</p>}
        {p && (
          <>
            <p className="s-hint">
              Thư mục: <code>{p.dir}</code> · branch chính <code>{p.base}</code>
            </p>
            {p.remote ? (
              <p className="s-ok">
                🔗 Đã nối:{' '}
                <a href={repoUrl} target="_blank" rel="noreferrer">
                  {repoUrl}
                </a>
              </p>
            ) : (
              <p className="s-warn">Chưa nối repo GitHub.</p>
            )}

            {info?.user && (
              <form
                className="s-repo"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => connectGithubRepo(repo, mode === 'create', isPrivate), mode === 'create' ? 'Đã tạo repo và nối với dự án.' : 'Đã nối repo.')
                }}
              >
                <div className="s-radio">
                  <label>
                    <input type="radio" checked={mode === 'create'} onChange={() => setMode('create')} /> Tạo repo mới
                  </label>
                  <label>
                    <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Dùng repo có sẵn
                  </label>
                </div>
                <div className="s-code">
                  <input
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder={mode === 'create' ? 'tên repo, vd login-demo' : 'owner/repo hoặc https://github.com/owner/repo'}
                  />
                  {mode === 'create' && (
                    <select value={isPrivate ? 'private' : 'public'} onChange={(e) => setPrivate(e.target.value === 'private')}>
                      <option value="private">Riêng tư</option>
                      <option value="public">Công khai</option>
                    </select>
                  )}
                  <button className="primary" disabled={busy || !repo.trim()}>
                    {p.remote ? 'Đổi repo' : mode === 'create' ? 'Tạo & nối' : 'Nối repo'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </section>

      {p?.remote && (
        <section>
          <h4>Push</h4>
          <label className="s-check">
            <input type="checkbox" checked={p.autoPush} disabled={busy} onChange={(e) => void run(() => setAutoPush(e.target.checked))} />
            Tự push branch {p.base} lên GitHub mỗi khi việc được merge xong
          </label>
          <p />
          <button className="primary" disabled={busy || !info?.user} onClick={() => void run(pushGithub, `Đã push ${p.base} lên GitHub.`)}>
            {busy ? 'Đang chạy...' : `Push ${p.base} ngay`}
          </button>
        </section>
      )}

      {status && <p className={status.ok ? 's-ok' : 's-error'}>{status.text}</p>}
    </div>
  )
}
