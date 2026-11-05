#!/usr/bin/env node
// Xuất SVG (hoặc HTML) ra PNG đúng kích thước bằng Chrome headless — dùng cho agent phòng media.
// Cách dùng: node tools/svg2png.mjs <vào.svg|vào.html> <ra.png> [rộng=1280] [cao=720]
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [input, output, w = '1280', h = '720'] = process.argv.slice(2)
if (!input || !output) {
  console.error('Cách dùng: node svg2png.mjs <vào.svg|vào.html> <ra.png> [rộng] [cao]')
  process.exit(1)
}
const CHROME = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  // Windows
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => p && fs.existsSync(p))
if (!CHROME) {
  console.error('Không tìm thấy Chrome để xuất ảnh')
  process.exit(1)
}
const src = path.resolve(input)
if (!fs.existsSync(src)) {
  console.error(`Không có file ${input}`)
  process.exit(1)
}
// bọc SVG trong trang HTML không lề để ảnh lấp kín khung
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'svg2png-'))
let page = pathToFileURL(src).href
if (src.toLowerCase().endsWith('.svg')) {
  const html = path.join(tmp, 'page.html')
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;overflow:hidden;background:transparent"><img src="${pathToFileURL(src).href}" style="display:block;width:${w}px;height:${h}px"></body></html>`)
  page = pathToFileURL(html).href
}
const out = path.resolve(output)
const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', `--user-data-dir=${path.join(tmp, 'profile')}`, `--window-size=${w},${Number(h) + 200}`, '--default-background-color=00000000', `--screenshot=${out}`, page], { encoding: 'utf8', timeout: 60_000 })
fs.rmSync(tmp, { recursive: true, force: true })
if (!fs.existsSync(out)) {
  console.error('Xuất ảnh lỗi', r.stderr?.slice(-500))
  process.exit(1)
}
// chụp dư 200px chiều cao (Chrome headless hay lệch mép dưới), rồi cắt đúng khung từ góc trên trái bằng ffmpeg
const big = out.replace(/\.png$/i, '') + '.full.png'
fs.renameSync(out, big)
const ffmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find((p) => fs.existsSync(p)) ?? 'ffmpeg'
const crop = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', big, '-vf', `crop=${w}:${h}:0:0`, out], { encoding: 'utf8' })
fs.rmSync(big, { force: true })
if (crop.status !== 0 || !fs.existsSync(out)) {
  console.error('Cắt ảnh lỗi', crop.stderr?.slice(-300))
  process.exit(1)
}
console.log(`Đã xuất ${output} (${w}x${h})`)
