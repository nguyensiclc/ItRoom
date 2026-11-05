import { useEffect, useState } from 'react'
import { fetchTiktok, openAgentLogin, saveTiktok, type TiktokInfo } from '../sim/ai'

type Draft = Pick<TiktokInfo, 'handle' | 'topic' | 'hashtags' | 'privacy' | 'mode'>
const pick = (i: TiktokInfo): Draft => ({ handle: i.handle, topic: i.topic, hashtags: i.hashtags, privacy: i.privacy, mode: i.mode })
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b)

const PRIVACY: { id: Draft['privacy']; label: string }[] = [
  { id: 'public', label: 'Mọi người' },
  { id: 'friends', label: 'Bạn bè' },
  { id: 'private', label: 'Chỉ mình tôi' },
]

/** Kênh TikTok phòng media phụ trách: hồ sơ kênh cho kịch bản, cách đăng, đăng nhập trình duyệt riêng của agent */
export function TiktokSettings() {
  const [info, setInfo] = useState<TiktokInfo | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    fetchTiktok().then((r) => {
      if (r.data) {
        setInfo(r.data)
        setDraft((d) => d ?? pick(r.data!))
      } else setStatus({ ok: false, text: r.error ?? 'Không đọc được cài đặt TikTok' })
    })
  useEffect(() => void load(), [])

  // vừa mở cửa sổ đăng nhập: hỏi lại trạng thái đến khi đóng cửa sổ đó
  const waiting = !!info?.browser.inUse
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [waiting])

  if (!info || !draft) return <p className="s-hint">{status?.text ?? 'Đang tải...'}</p>
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v })
  const dirty = !same(draft, pick(info))

  const save = async () => {
    setBusy(true)
    const r = await saveTiktok(draft)
    setBusy(false)
    if (r.data) {
      setInfo(r.data)
      setDraft(pick(r.data))
      setStatus({ ok: true, text: 'Đã lưu. Kịch bản TikTok tiếp theo của Mei dùng hồ sơ kênh mới.' })
    } else setStatus({ ok: false, text: r.error ?? 'Lưu lỗi' })
  }
  const login = async (site: 'tiktok' | 'google') => {
    const r = await openAgentLogin(site)
    if (r.data) {
      setInfo(r.data)
      setStatus({ ok: true, text: `Đã mở Chrome của agent. Đăng nhập ${site === 'google' ? 'Google' : 'TikTok'} rồi đóng hẳn cửa sổ đó.` })
    } else setStatus({ ok: false, text: r.error ?? 'Không mở được trình duyệt' })
  }
  const state = (v: boolean | null) => (v === null ? '❔ không đọc được' : v ? '✅ đã đăng nhập' : '⚠️ chưa đăng nhập')

  return (
    <div className="s-editor">
      <header className="s-agent-head">
        <span className="s-avatar" style={{ background: '#111' }}>♪</span>
        <div>
          <strong>TikTok {info.handle && <em>{info.handle}</em>}</strong>
          <small>Kênh phòng media phụ trách: hồ sơ kênh cho kịch bản, cách đăng, và tài khoản trong trình duyệt riêng của agent</small>
        </div>
      </header>

      <section>
        <h4>Kênh</h4>
        <div className="s-grid">
          <label>
            Tên kênh
            <input value={draft.handle} maxLength={31} placeholder="@bancobiet.daily" onChange={(e) => set('handle', e.target.value)} />
          </label>
          <label>
            Hashtag luôn gắn
            <input value={draft.hashtags} maxLength={200} placeholder="#bancobiet #hocmoingay" onChange={(e) => set('hashtags', e.target.value)} />
          </label>
        </div>
        <label style={{ marginTop: 10 }}>
          Chủ đề, người xem, giọng điệu
          <textarea
            rows={4}
            value={draft.topic}
            maxLength={2000}
            placeholder={'Vd: "Bạn có biết?" — sự thật khoa học, tự nhiên, lịch sử thú vị cho người trẻ 16–30 tuổi. Giọng vui, tò mò, xưng mình – bạn. Ảnh minh hoạ anime màu ấm.'}
            onChange={(e) => set('topic', e.target.value)}
          />
        </label>
        <p className="s-hint">Mei đọc phần này mỗi lần viết kịch bản TikTok, để các video cùng một hướng.</p>
      </section>

      <section>
        <h4>Khi đăng</h4>
        <div className="s-grid">
          <label>
            Ai xem được
            <select value={draft.privacy} onChange={(e) => set('privacy', e.target.value as Draft['privacy'])}>
              {PRIVACY.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cách đăng
            <select value={draft.mode} onChange={(e) => set('mode', e.target.value as Draft['mode'])}>
              <option value="prepare">Chuẩn bị sẵn, sếp tự bấm Đăng</option>
              <option value="auto">Phòng media tự đăng</option>
            </select>
          </label>
        </div>
        <p className="s-hint">Video luôn được gắn nhãn "Nội dung do AI tạo" (bắt buộc với ảnh / giọng đọc AI).</p>
        {draft.mode === 'auto' && <p className="s-warn">Tự đăng: video lên kênh công khai ngay khi Mei duyệt xong, không qua sếp xem trước.</p>}
      </section>

      <section>
        <h4>Trình duyệt của agent</h4>
        <p className="s-hint">Yuki dùng một Chrome riêng (không phải Chrome của bạn) để tạo ảnh trên Google Flow và đăng TikTok. Đăng nhập một lần, agent dùng lại phiên đó.</p>
        <ul className="s-steps">
          <li>
            Google (tạo ảnh Flow): {state(info.browser.google)}{' '}
            <button className="s-link-btn" disabled={info.browser.inUse} onClick={() => void login('google')}>
              {info.browser.google ? 'mở lại' : 'đăng nhập'}
            </button>
          </li>
          <li>
            TikTok{info.handle ? ` (${info.handle})` : ''}: {state(info.browser.tiktok)}{' '}
            <button className="s-link-btn" disabled={info.browser.inUse} onClick={() => void login('tiktok')}>
              {info.browser.tiktok ? 'mở lại' : 'đăng nhập'}
            </button>
          </li>
        </ul>
        {info.browser.inUse && <p className="s-warn">Chrome của agent đang mở. Đăng nhập xong thì đóng hẳn cửa sổ đó, Yuki mới dùng được.</p>}
      </section>

      <div className="s-actions">
        {status && <span className={status.ok ? 's-ok' : 's-error'}>{status.text}</span>}
        <button disabled={!dirty || busy} onClick={() => setDraft(pick(info))}>
          Hoàn tác
        </button>
        <button className="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
    </div>
  )
}
