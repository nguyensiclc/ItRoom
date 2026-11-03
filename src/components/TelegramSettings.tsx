import { useEffect, useState } from 'react'
import { disconnectTelegram, fetchTelegram, repairTelegram, setTelegramToken, type TelegramInfo } from '../sim/ai'

/** Nối một bot Telegram để sếp chat với team / từng agent từ điện thoại */
export function TelegramSettings() {
  const [info, setInfo] = useState<TelegramInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')

  const apply = (r: { data?: TelegramInfo; error?: string }) => {
    if (r.data) setInfo(r.data)
    setError(r.error ?? null)
  }
  useEffect(() => void fetchTelegram().then(apply), [])

  // đang chờ sếp bấm link ghép đôi: hỏi server liên tục
  const pairing = !!info?.configured && !info.connected
  useEffect(() => {
    if (!pairing) return
    const t = setInterval(() => void fetchTelegram().then(apply), 2500)
    return () => clearInterval(t)
  }, [pairing])

  const run = async (fn: () => Promise<{ data?: TelegramInfo; error?: string }>) => {
    setBusy(true)
    apply(await fn())
    setBusy(false)
  }

  return (
    <div className="s-editor">
      <header className="s-agent-head">
        <span className="s-avatar" style={{ background: '#229ED9' }}>✈</span>
        <div>
          <strong>Telegram</strong>
          <small>Chat với cả team hoặc từng agent qua bot Telegram, nhận trả lời và báo việc xong ngay trên điện thoại</small>
        </div>
      </header>

      <section>
        <h4>Trạng thái</h4>
        {!info && !error && <p className="s-hint">Đang kiểm tra...</p>}
        {info?.connected && (
          <p className="s-ok">
            ✅ Đã kết nối bot <b>@{info.bot}</b> với {info.owner ?? 'sếp'}. Đang chat: {info.target}
          </p>
        )}
        {info && !info.configured && <p className="s-warn">Chưa nối bot Telegram.</p>}
        {info?.error && <p className="s-error">Telegram: {info.error}</p>}
        {error && <p className="s-error">{error}</p>}
      </section>

      {info && !info.configured && (
        <section>
          <h4>1. Tạo bot</h4>
          <ol className="s-steps">
            <li>
              Trên Telegram, mở{' '}
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                @BotFather
              </a>
              , gõ <code>/newbot</code>, đặt tên bot.
            </li>
            <li>BotFather gửi lại token dạng <code>123456789:AA...</code>. Dán vào đây:</li>
            <li>
              <form
                className="s-code"
                onSubmit={(e) => {
                  e.preventDefault()
                  void run(() => setTelegramToken(token)).then(() => setToken(''))
                }}
              >
                <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token bot" autoComplete="off" />
                <button className="primary" disabled={busy || !token.trim()}>
                  {busy ? 'Đang kiểm tra...' : 'Lưu token'}
                </button>
              </form>
            </li>
          </ol>
        </section>
      )}

      {pairing && (
        <section>
          <h4>2. Ghép đôi với tài khoản của bạn</h4>
          <ol className="s-steps">
            <li>
              {info.pairLink && (
                <a className="primary s-link" href={info.pairLink} target="_blank" rel="noreferrer">
                  Mở @{info.bot} trên Telegram ↗
                </a>
              )}{' '}
              rồi bấm <b>Start</b>.
            </li>
            <li className="s-hint">
              Hoặc gửi cho bot mã: <code className="s-otp">{info.pairCode}</code>
            </li>
            <li className="s-hint">Đang chờ... trang tự cập nhật khi xong. Chỉ tài khoản ghép đôi mới chat được với team.</li>
          </ol>
        </section>
      )}

      {info?.connected && (
        <section>
          <h4>Cách dùng trên Telegram</h4>
          <ul className="s-steps">
            <li>Nhắn thẳng: gửi vào cuộc chat đang chọn (mặc định Cả team)</li>
            <li>
              <code>/team</code>, <code>/BE</code>, <code>/PM nội dung</code>: chọn chat Cả team hoặc chat riêng (dùng mã hoặc tên agent)
            </li>
            <li>
              <code>/nhom tên nhóm</code>: chọn nhóm chat · <code>/ds</code>: danh sách
            </li>
            <li>
              <code>/giao việc cần làm</code>: giao việc như nút 📋
            </li>
            <li>Mọi trả lời của agent (kể cả khi bạn nhắn trên web) và báo việc xong đều gửi về Telegram.</li>
          </ul>
        </section>
      )}

      {info?.configured && (
        <section>
          {info.connected && (
            <button disabled={busy} onClick={() => void run(repairTelegram)}>
              Ghép đôi lại
            </button>
          )}{' '}
          <button
            className="s-danger"
            disabled={busy}
            onClick={() => confirm('Gỡ bot Telegram khỏi IT Room?') && void run(disconnectTelegram)}
          >
            Gỡ bot
          </button>
        </section>
      )}
    </div>
  )
}
