import { useEffect, useState } from 'react'

interface MediaFile {
  path: string
  kind: 'audio' | 'image' | 'video'
  size: number
  time: number
}

const KINDS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'video', label: '🎬 Video' },
  { id: 'image', label: '🖼 Ảnh' },
  { id: 'audio', label: '🎧 Audio' },
] as const

const fileUrl = (f: MediaFile) => `/api/media/file?path=${encodeURIComponent(f.path)}&v=${Math.round(f.time)}`
const sizeLabel = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

/** Sản phẩm của phòng media (thư mục media/ trong dự án): xem ảnh, nghe audio, xem video ngay trên web */
export function MediaGallery() {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState<MediaFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('all')

  const load = async () => {
    try {
      const res = await fetch('/api/media')
      const data = (await res.json()) as { files?: MediaFile[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `Lỗi ${res.status}`)
      setFiles(data.files ?? [])
      setError(null)
    } catch (e) {
      setError((e as Error).message || 'Không tải được danh sách')
    }
  }
  // mở bảng thì tải và cập nhật mỗi 10 giây (agent làm xong là thấy file mới)
  useEffect(() => {
    if (!open) return
    void load()
    const t = setInterval(() => void load(), 10_000)
    return () => clearInterval(t)
  }, [open])

  const shown = (files ?? []).filter((f) => kind === 'all' || f.kind === kind)

  return (
    <>
      <button className="settings-launch" onClick={() => setOpen((o) => !o)} title="Ảnh, audio, video do phòng media làm">
        🎬 Media
      </button>
      {open && (
        <div className="panel media-gallery">
          <header>
            <h2>🎬 Phòng media</h2>
            <div className="mg-tabs">
              {KINDS.map((k) => (
                <button key={k.id} className={k.id === kind ? 'on' : ''} onClick={() => setKind(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
            <button className="s-close" onClick={() => setOpen(false)} aria-label="Đóng">
              ×
            </button>
          </header>
          {error && <p className="s-error">{error}</p>}
          {!files && !error && <p className="s-hint">Đang tải...</p>}
          {files && shown.length === 0 && (
            <p className="s-hint">
              Chưa có sản phẩm. Nhắn riêng cho agent phòng media (vd Vy) một việc như "làm video giới thiệu app 20 giây có lồng tiếng" hoặc "thiết kế banner cho trang đăng nhập".
            </p>
          )}
          <div className="mg-grid">
            {shown.map((f) => (
              <figure key={f.path} className={`mg-item ${f.kind}`}>
                {f.kind === 'image' && (
                  <a href={fileUrl(f)} target="_blank" rel="noreferrer">
                    <img src={fileUrl(f)} alt={f.path} loading="lazy" />
                  </a>
                )}
                {f.kind === 'video' && <video src={fileUrl(f)} controls playsInline preload="metadata" />}
                {f.kind === 'audio' && <audio src={fileUrl(f)} controls preload="none" />}
                <figcaption>
                  <span title={f.path}>{f.path.replace(/^media\//, '')}</span>
                  <small>
                    {sizeLabel(f.size)} · {new Date(f.time).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                  </small>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
