import { useEffect, useState } from 'react'
import { GithubLogin } from './GithubLogin'
import { cancelAgyLogin, fetchAgyAuth, sendAgyCode, startAgyLogin, type AgyAuth } from '../sim/ai'

/** Đăng nhập Antigravity CLI (agy) ngay trên giao diện: lấy link Google, dán mã xác thực */
export function AgyLogin() {
  const [auth, setAuth] = useState<AgyAuth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [now, setNow] = useState(Date.now())

  const refresh = async () => {
    const r = await fetchAgyAuth()
    if (r.data) setAuth(r.data)
    setError(r.error ?? null)
  }
  useEffect(() => void refresh(), [])

  const state = auth?.login.state
  // đang chờ mã / đang xác thực: hỏi server liên tục để biết kết quả
  useEffect(() => {
    if (state !== 'waiting' && state !== 'verifying' && state !== 'starting') return
    const t = setInterval(() => {
      setNow(Date.now())
      void refresh()
    }, 1500)
    return () => clearInterval(t)
  }, [state])

  const run = async (fn: () => Promise<{ data?: AgyAuth; error?: string }>) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (r.data) setAuth((a) => ({ loggedIn: a?.loggedIn, ...r.data! }))
    setError(r.error ?? null)
  }

  const left = auth?.login.expiresAt ? Math.max(0, Math.round((auth.login.expiresAt - now) / 1000)) : null

  return (
    <div className="s-editor">
      <header className="s-agent-head">
        <span className="s-avatar" style={{ background: '#0f172a' }}>⌥</span>
        <div>
          <strong>GitHub</strong>
          <small>Để server tạo repo và push code dự án lên GitHub (xem thêm ở mục 📁 Dự án & GitHub)</small>
        </div>
      </header>
      <GithubLogin />

      <hr className="s-sep" />

      <header className="s-agent-head">
        <span className="s-avatar" style={{ background: '#1a73e8' }}>G</span>
        <div>
          <strong>Antigravity (agy)</strong>
          <small>CLI trò chuyện của các agent đặt "Antigravity (agy)"</small>
        </div>
      </header>

      <section>
        <h4>Trạng thái</h4>
        {!auth && !error && <p className="s-hint">Đang kiểm tra...</p>}
        {auth?.loggedIn && <p className="s-ok">✅ Đã đăng nhập. Các agent dùng agy nói chuyện được.</p>}
        {auth && !auth.loggedIn && state !== 'waiting' && state !== 'verifying' && <p className="s-warn">Chưa đăng nhập: agent dùng agy sẽ không nói được.</p>}
        {error && <p className="s-error">{error}</p>}
        {state === 'error' && auth?.login.error && <p className="s-error">Đăng nhập lỗi: {auth.login.error}</p>}
      </section>

      {auth && !auth.loggedIn && (
        <section>
          <h4>Đăng nhập</h4>
          {state !== 'waiting' && state !== 'verifying' && (
            <>
              <p className="s-hint">Bấm nút để lấy link đăng nhập Google. Sau khi lấy link bạn có 60 giây để đăng nhập và dán mã.</p>
              <button className="primary" disabled={busy || state === 'starting'} onClick={() => void run(startAgyLogin)}>
                {busy || state === 'starting' ? 'Đang lấy link...' : 'Lấy link đăng nhập'}
              </button>
            </>
          )}

          {(state === 'waiting' || state === 'verifying') && (
            <ol className="s-steps">
              <li>
                <a className="primary s-link" href={auth.login.url} target="_blank" rel="noreferrer">
                  Mở trang đăng nhập Google ↗
                </a>
              </li>
              <li>Đăng nhập, cho phép quyền, rồi sao chép mã xác thực (authorization code) hiện ra.</li>
              <li>
                <form
                  className="s-code"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void run(() => sendAgyCode(code)).then(() => setCode(''))
                  }}
                >
                  <input value={code} placeholder="Dán mã vào đây" autoComplete="off" onChange={(e) => setCode(e.target.value)} disabled={state === 'verifying'} />
                  <button className="primary" disabled={!code.trim() || busy || state === 'verifying'}>
                    {state === 'verifying' ? 'Đang xác thực...' : 'Gửi mã'}
                  </button>
                </form>
              </li>
              {left !== null && state === 'waiting' && <li className="s-hint">Còn {left} giây</li>}
              <li>
                <button type="button" className="s-link-btn" onClick={() => void run(cancelAgyLogin)}>
                  Huỷ
                </button>
              </li>
            </ol>
          )}
        </section>
      )}
    </div>
  )
}
