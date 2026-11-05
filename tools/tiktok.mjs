#!/usr/bin/env node
// Dựng video TikTok (1080x1920) từ ảnh + lời đọc — dùng cho agent phòng media.
// Cách dùng: node tools/tiktok.mjs <thư mục video>
// Thư mục chứa kich-ban.json:
// {
//   "voice": "Trúc Ly",                       (tuỳ chọn; giọng VieNeu-TTS, vd Trúc Ly, Ngọc Huyền, Mai Anh;
//                                              tên kết thúc bằng "Neural" = giọng edge-tts, vd vi-VN-HoaiMyNeural)
//   "scenes": [{ "image": "scene-01.jpg", "say": "lời đọc cảnh 1", "text": "chữ trên hình (tuỳ chọn, mặc định = say)" }],
//   "music": "nhac-nen.mp3",                  (tuỳ chọn; nhạc nền đặt nhỏ dưới giọng đọc)
//   "caption": "caption đăng TikTok #hashtag" (tuỳ chọn; ghi ra caption.txt)
// }
// Ra: <thư mục>/video.mp4 (H.264 + AAC, 30fps) và caption.txt
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const W = 1080
const H = 1920
const FPS = 30
const PAD = 0.35 // nghỉ sau mỗi câu (giây)
const FADE = 0.25

const dir = process.argv[2]
if (!dir) {
  console.error('Cách dùng: node tools/tiktok.mjs <thư mục có kich-ban.json>')
  process.exit(1)
}
const root = path.resolve(dir)
const script = JSON.parse(fs.readFileSync(path.join(root, 'kich-ban.json'), 'utf8'))
const scenes = script.scenes ?? []
if (!scenes.length) {
  console.error('kich-ban.json chưa có scenes')
  process.exit(1)
}

/** Tìm công cụ: biến môi trường, PATH, rồi chỗ winget / Python cài trên Windows */
function tool(name, envKey, extra = []) {
  if (process.env[envKey]) return process.env[envKey]
  for (const p of extra) if (p && fs.existsSync(p)) return p
  return name
}
function wingetFfmpeg(exe) {
  const base = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages')
  try {
    for (const pkg of fs.readdirSync(base).filter((d) => /ffmpeg/i.test(d))) {
      for (const sub of fs.readdirSync(path.join(base, pkg))) {
        const p = path.join(base, pkg, sub, 'bin', exe)
        if (fs.existsSync(p)) return p
      }
    }
  } catch {}
  return ''
}
const win = process.platform === 'win32'
const FFMPEG = tool('ffmpeg', 'FFMPEG', win ? [wingetFfmpeg('ffmpeg.exe')] : ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'])
const FFPROBE = tool('ffprobe', 'FFPROBE', win ? [wingetFfmpeg('ffprobe.exe')] : ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe'])
const PYTHON = tool(win ? 'python' : 'python3', 'PYTHON', win ? [path.join(process.env.LOCALAPPDATA ?? '', 'Python', 'bin', 'python.exe')] : [])
// VieNeu-TTS (giọng tiếng Việt chạy trên máy) nằm trong môi trường Python riêng ở gốc repo: .venv-vieneu
const REPO = path.resolve(import.meta.dirname, '..')
const VIENEU_PY = path.join(REPO, '.venv-vieneu', win ? 'Scripts/python.exe' : 'bin/python')
const VIENEU_JOB = path.join(import.meta.dirname, 'vieneu_tts.py')
const EDGE_VOICE = 'vi-VN-HoaiMyNeural'
const FONT = [
  'C:/Windows/Fonts/arialbd.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].find((p) => fs.existsSync(p))

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 })
  if (r.status !== 0) {
    console.error(`Lỗi khi chạy ${path.basename(cmd)}:`, (r.stderr || r.error?.message || '').slice(-800))
    process.exit(1)
  }
  return r.stdout
}
/**
 * Đọc bằng edge-tts. Lời đọc ghi ra file UTF-8 (trên Windows, python.exe của trình cài Python làm hỏng chữ có dấu
 * khi truyền qua tham số); dịch vụ giọng đọc hay chập chờn (NoAudioReceived) nên thử lại vài lần
 */
function speak(voice, text, out) {
  const textFile = out.replace(/\.mp3$/, '.say.txt')
  fs.writeFileSync(textFile, text)
  const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  const ok = () => fs.existsSync(out) && fs.statSync(out).size > 1000
  let last = ''
  for (let i = 0; i < 3; i++) {
    const r = spawnSync(PYTHON, ['-m', 'edge_tts', '--voice', voice, '-f', textFile, '--write-media', out], { encoding: 'utf8', env })
    if (r.status === 0 && ok()) return
    last = (r.stderr || r.error?.message || '').trim().split('\n').pop()
    spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${1500 * (i + 1)})`]) // chờ rồi thử lại
  }
  // máy chủ edge-tts từ chối hẳn một số cụm tiếng Việt (vd "bắt đầu thế nào"): đọc bằng Google (gTTS) thay
  const lang = voice.split('-')[0]
  const g = spawnSync(PYTHON, ['-c', 'import sys;from gtts import gTTS;gTTS(open(sys.argv[1],encoding="utf-8").read(),lang=sys.argv[3]).save(sys.argv[2])', textFile, out, lang], { encoding: 'utf8', env })
  if (g.status === 0 && ok()) {
    console.log(`  (edge-tts không đọc được câu này, dùng giọng Google)`)
    return
  }
  console.error('Không tạo được giọng đọc:', last, (g.stderr || '').trim().split('\n').pop())
  process.exit(1)
}
const duration = (file) => Number(run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim())

/** Ngắt dòng phụ đề cho vừa khung dọc (~20 ký tự / dòng) */
function wrap(text, max = 20) {
  const lines = []
  let cur = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + word).length > max) {
      lines.push(cur)
      cur = word
    } else cur = cur ? `${cur} ${word}` : word
  }
  if (cur) lines.push(cur)
  return lines.join('\n')
}
// đường dẫn trong filter ffmpeg: dùng / và thoát dấu : (ổ đĩa Windows)
const ff = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tiktok-'))
const voice = script.voice || 'Trúc Ly'
const edge = /Neural$/.test(voice)

/** Đọc mọi câu bằng VieNeu-TTS một lượt (nạp mô hình một lần); câu nào lỗi thì để giọng dự phòng đọc */
function speakAllVieneu() {
  if (edge || !fs.existsSync(VIENEU_PY)) return []
  const items = scenes.map((s, i) => ({ text: s.say, out: path.join(tmp, `voice-${String(i + 1).padStart(2, '0')}.wav`) }))
  const job = path.join(tmp, 'vieneu.json')
  fs.writeFileSync(job, JSON.stringify({ voice, items }))
  spawnSync(VIENEU_PY, [VIENEU_JOB, job], {
    encoding: 'utf8',
    maxBuffer: 16 << 20,
    timeout: 15 * 60_000, // lần đầu còn tải mô hình
    env: { ...process.env, PYTHONUTF8: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' },
  })
  return items.map((it) => (fs.existsSync(it.out) && fs.statSync(it.out).size > 1000 ? it.out : null))
}
const vieneu = speakAllVieneu()

const clips = []
scenes.forEach((s, i) => {
  const img = path.resolve(root, s.image)
  if (!fs.existsSync(img)) {
    console.error(`Không có ảnh ${s.image}`)
    process.exit(1)
  }
  const n = String(i + 1).padStart(2, '0')
  // giọng đọc: VieNeu-TTS, không có / lỗi thì edge-tts (rồi tới Google)
  let voiceFile = vieneu[i]
  if (!voiceFile) {
    voiceFile = path.join(tmp, `voice-${n}.mp3`)
    if (!edge) console.log(`  (VieNeu không đọc được cảnh ${n}, dùng giọng dự phòng)`)
    speak(edge ? voice : EDGE_VOICE, s.say, voiceFile)
  }
  const dur = duration(voiceFile) + PAD
  const frames = Math.ceil(dur * FPS)
  // phụ đề: ghi ra file để khỏi phải thoát ký tự trong lệnh
  const textFile = path.join(tmp, `text-${n}.txt`)
  // bỏ emoji: font không có, hiện thành ô vuông (emoji để trong caption)
  fs.writeFileSync(textFile, wrap((s.text ?? s.say).replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim()))
  // ảnh phủ kín khung dọc, zoom chậm vào giữa (cảnh chẵn zoom ra) cho đỡ tĩnh
  const zoom = i % 2 === 0 ? `min(1+0.10*on/${frames},1.10)` : `max(1.10-0.10*on/${frames},1)`
  const vf = [
    `scale=${W * 1.5}:${H * 1.5}:force_original_aspect_ratio=increase`,
    `crop=${W * 1.5}:${H * 1.5}`,
    `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
    // phụ đề trong vùng an toàn (trên cụm nút / caption của TikTok ở 1/4 dưới)
    `drawtext=${FONT ? `fontfile='${ff(FONT)}':` : ''}textfile='${ff(textFile)}':fontsize=66:fontcolor=white:line_spacing=14:` +
      `box=1:boxcolor=black@0.45:boxborderw=26:x=(w-text_w)/2:y=h*0.70-text_h/2:text_align=C`,
    `fade=t=in:st=0:d=${FADE}`,
    `fade=t=out:st=${(dur - FADE).toFixed(2)}:d=${FADE}`,
    'format=yuv420p',
  ].join(',')
  const clip = path.join(tmp, `clip-${n}.mp4`)
  run(FFMPEG, [
    '-y', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-i', img, '-i', voiceFile,
    '-vf', vf, '-af', `apad=pad_dur=${PAD}`, '-t', dur.toFixed(2),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2', clip,
  ])
  clips.push(clip)
  console.log(`Cảnh ${n}: ${dur.toFixed(1)}s`)
})

// ghép các cảnh
const list = path.join(tmp, 'list.txt')
fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n'))
const joined = path.join(tmp, 'joined.mp4')
run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined])

const out = path.join(root, 'video.mp4')
if (script.music && fs.existsSync(path.resolve(root, script.music))) {
  // nhạc nền nhỏ dưới giọng đọc, lặp cho đủ dài, nhỏ dần ở cuối
  const total = duration(joined)
  run(FFMPEG, [
    '-y', '-loglevel', 'error', '-i', joined, '-stream_loop', '-1', '-i', path.resolve(root, script.music),
    '-filter_complex', `[1:a]volume=0.15,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[m];[0:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out,
  ])
} else {
  run(FFMPEG, ['-y', '-loglevel', 'error', '-i', joined, '-c', 'copy', '-movflags', '+faststart', out])
}
fs.rmSync(tmp, { recursive: true, force: true })
if (script.caption) fs.writeFileSync(path.join(root, 'caption.txt'), script.caption.trim() + '\n')
console.log(`Đã xuất ${path.relative(process.cwd(), out)} (${duration(out).toFixed(1)}s, ${W}x${H})`)
