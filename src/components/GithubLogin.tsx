import { useEffect, useState } from 'react'
import { cancelGithubLogin, fetchGithub, startGithubLogin, type GithubInfo } from '../sim/ai'

/** Đăng nhập GitHub (gh) bằng mã thiết bị: hiện mã, sếp mở github.com/login/device để nhập. `onChange`: báo trạng thái mới */
export function GithubLogin({ onChange }: { onChange?: (info: GithubInfo) => void }) {
  const [info, setInfo] = useState<GithubInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const apply = (r: { data?: GithubInfo; error?: string }) => {
    if (r.data) {
      setInfo(r.data)
      onChange?.(r.data)
    }
    setError(r.error ?? null)
  }
  const refresh = async () => apply(await fetchGithub())
  useEffect(() => void refresh(), [])

  const waiting = info?.login.state === 'waiting' || info?.login.state === 'starting'
  // đang chờ sếp nhập mã trên github.com: hỏi server liên tục để biết khi nào xong
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void refresh(), 2000)
    return () => clearInterval(t)
  }, [waiting])

  const run = async (fn: () => Promise<{ data?: GithubInfo; error?: string }>) => {
    setBusy(true)
    apply(await fn())
    setBusy(false)
  }

  return (
    <section>
      <h4>Tài khoản GitHub</h4>
      {!info && !error && <p className="s-hint">Đang kiểm tra...</p>}
      {error && <p className="s-error">{error}</p>}
      {info?.user && <p className="s-ok">✅ Đã đăng nhập: <b>{info.user}</b>. Server dùng tài khoản này để tạo repo và push code dự án.</p>}
      {info && !info.user && !waiting && (
        <>
          <p className="s-warn">Chưa đăng nhập GitHub (hoặc phiên đăng nhập đã hết hạn).</p>
          {info.login.state === 'error' && <p className="s-error">Đăng nhập lỗi: {info.login.error}</p>}
          <p />
          <button className="primary" disabled={busy} onClick={() => void run(startGithubLogin)}>
            {busy ? 'Đang lấy mã...' : 'Đăng nhập GitHub'}
          </button>
        </>
      )}
      {waiting && info?.login.code && (
        <ol className="s-steps">
          <li>
            Sao chép mã: <code className="s-otp">{info.login.code}</code>
          </li>
          <li>
            <a className="primary s-link" href={info.login.url} target="_blank" rel="noreferrer">
              Mở github.com/login/device ↗
            </a>{' '}
            rồi dán mã, bấm Authorize.
          </li>
          <li className="s-hint">Đang chờ GitHub xác nhận... trang tự cập nhật khi xong.</li>
          <li>
            <button type="button" className="s-link-btn" onClick={() => void run(cancelGithubLogin)}>
              Huỷ
            </button>
          </li>
        </ol>
      )}
    </section>
  )
}
