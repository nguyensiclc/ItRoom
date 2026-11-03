import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { CanvasTexture, MathUtils, RepeatWrapping, SRGBColorSpace, type Group, type Mesh, type MeshStandardMaterial } from 'three'
import { AGENTS, CUBICLE_FRONT_Z, CUBICLE_WIDTH, DESK_Z, MEDIA_ROOM, MEETING_CENTER, SEAT_Z, inMediaRoom, mediaDeskWidth, FLOORS, type AgentDef, type Floor } from '../data/agents'
import { useStore } from '../store'
import { positions, yaws } from '../sim/motion'
import { mouseOffset, usingMouse } from './StickFigure'
import { DYNAMIC, useMergeStatic } from './mergeStatic'

type V3 = [number, number, number]

function Box({ args, position, color, emissive, rotation, roughness = 0.7, metalness = 0 }: { args: V3; position: V3; color: string; emissive?: string; rotation?: V3; roughness?: number; metalness?: number }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} emissive={emissive ?? '#000'} emissiveIntensity={emissive ? 0.8 : 0} roughness={roughness} metalness={metalness} />
    </mesh>
  )
}

function Soft({ args, position, color, radius = 0.03, rotation, roughness = 0.6 }: { args: V3; position: V3; color: string; radius?: number; rotation?: V3; roughness?: number }) {
  return (
    <RoundedBox args={args} radius={radius} smoothness={3} position={position} rotation={rotation} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} />
    </RoundedBox>
  )
}

function Cyl({ args, position, color, rotation, metalness = 0, roughness = 0.6 }: { args: [number, number, number, number?]; position: V3; color: string; rotation?: V3; metalness?: number; roughness?: number }) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[args[0], args[1], args[2], args[3] ?? 20]} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={roughness} />
    </mesh>
  )
}

/** Số ngẫu nhiên cố định theo seed, để texture giống nhau mỗi lần tải */
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

/** Sàn gỗ lát ván vẽ bằng canvas */
function useWoodTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 1024
    const g = c.getContext('2d')!
    const rand = rng(7)
    const rowH = 64
    for (let y = 0; y < c.height; y += rowH) {
      let x = -rand() * 400
      while (x < c.width) {
        const w = 260 + rand() * 260
        const l = 62 + rand() * 10
        g.fillStyle = `hsl(${28 + rand() * 6}, ${42 + rand() * 10}%, ${l}%)`
        g.fillRect(x, y, w, rowH)
        // vân gỗ
        g.strokeStyle = 'rgba(120, 72, 32, 0.10)'
        g.lineWidth = 1.5
        for (let i = 0; i < 5; i++) {
          const yy = y + 8 + rand() * (rowH - 16)
          g.beginPath()
          g.moveTo(x, yy)
          g.bezierCurveTo(x + w * 0.3, yy + rand() * 6 - 3, x + w * 0.7, yy + rand() * 6 - 3, x + w, yy)
          g.stroke()
        }
        g.fillStyle = 'rgba(70, 40, 20, 0.35)'
        g.fillRect(x, y, 2, rowH)
        x += w
      }
      g.fillStyle = 'rgba(70, 40, 20, 0.3)'
      g.fillRect(0, y, c.width, 2)
    }
    const tex = new CanvasTexture(c)
    tex.wrapS = tex.wrapT = RepeatWrapping
    tex.repeat.set(4, 2.5)
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [])
}

const codeTextures = new Map<string, CanvasTexture>()

/** Màn hình đang mở code, tô theo màu của chủ khoang */
function codeTexture(accent: string) {
  let tex = codeTextures.get(accent)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 144
  const g = c.getContext('2d')!
  g.fillStyle = '#0b1220'
  g.fillRect(0, 0, 256, 144)
  g.fillStyle = '#111a2e'
  g.fillRect(0, 0, 48, 144)
  g.fillStyle = accent
  g.fillRect(0, 0, 256, 8)
  const rand = rng(accent.length * 977 + accent.charCodeAt(2) * 31)
  const palette = [accent, '#94a3b8', '#e2e8f0', '#fbbf24', '#f472b6', '#38bdf8']
  for (let y = 16; y < 140; y += 9) {
    let x = 56 + Math.floor(rand() * 3) * 10
    const n = 1 + Math.floor(rand() * 4)
    for (let i = 0; i < n; i++) {
      const w = 12 + rand() * 46
      g.fillStyle = palette[Math.floor(rand() * palette.length)]
      g.fillRect(x, y, w, 4)
      x += w + 6
    }
    g.fillStyle = '#334155'
    g.fillRect(6, y, 30 * rand() + 8, 3)
  }
  tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  codeTextures.set(accent, tex)
  return tex
}

const mediaTextures = new Map<string, CanvasTexture>()

/** Màn hình phòng media: màn chính là phần mềm dựng phim (khung xem + timeline nhiều track), màn phụ là sóng âm / chỉnh ảnh */
function mediaTexture(owner: AgentDef, side: boolean) {
  const key = `${owner.id}:${side}`
  let tex = mediaTextures.get(key)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 144
  const g = c.getContext('2d')!
  const rand = rng(owner.id.length * 71 + (side ? 5 : 1))
  g.fillStyle = '#111318'
  g.fillRect(0, 0, 256, 144)
  if (!side) {
    // khung xem trước: bầu trời hoàng hôn + núi
    const sky = g.createLinearGradient(0, 8, 0, 70)
    sky.addColorStop(0, '#f472b6')
    sky.addColorStop(1, '#fbbf24')
    g.fillStyle = sky
    g.fillRect(70, 8, 116, 64)
    g.fillStyle = '#1e1b4b'
    g.beginPath()
    g.moveTo(70, 72)
    g.lineTo(110, 40)
    g.lineTo(135, 58)
    g.lineTo(160, 34)
    g.lineTo(186, 72)
    g.fill()
    // timeline: track video, track audio có sóng âm, đầu đọc đỏ
    const tracks = [owner.color, '#38bdf8', '#a78bfa', '#4ade80']
    tracks.forEach((col, i) => {
      const y = 82 + i * 14
      let x = 6
      while (x < 250) {
        const w = 18 + rand() * 50
        g.fillStyle = col
        g.globalAlpha = 0.85
        g.fillRect(x, y, Math.min(w, 250 - x), 10)
        if (i >= 2) {
          g.fillStyle = '#0f172a'
          for (let k = x + 2; k < x + w - 2 && k < 248; k += 3) g.fillRect(k, y + 5 - (rand() * 4), 1, rand() * 8)
        }
        x += w + 3
      }
    })
    g.globalAlpha = 1
    g.fillStyle = '#ef4444'
    g.fillRect(120, 78, 2, 62)
  } else {
    // màn phụ: sóng âm lớn + thanh mức âm lượng
    g.strokeStyle = owner.color
    g.lineWidth = 1
    g.beginPath()
    for (let x = 0; x < 256; x++) {
      const a = (Math.sin(x * 0.11) * 0.5 + Math.sin(x * 0.037) * 0.5) * (0.4 + rand() * 0.6) * 34
      g.moveTo(x, 50 - a)
      g.lineTo(x, 50 + a)
    }
    g.stroke()
    for (let i = 0; i < 24; i++) {
      const h = 10 + rand() * 40
      g.fillStyle = h > 40 ? '#ef4444' : h > 28 ? '#facc15' : '#22c55e'
      g.fillRect(8 + i * 10, 138 - h, 7, h)
    }
  }
  tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  mediaTextures.set(key, tex)
  return tex
}

const sideTextures = new Map<string, CanvasTexture>()

/** Màn hình phụ: BE xem log terminal, người khác xem bản chạy thử của web app */
function sideTexture(owner: AgentDef) {
  let tex = sideTextures.get(owner.id)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 144
  const g = c.getContext('2d')!
  const rand = rng(owner.id.length * 131 + owner.color.charCodeAt(3) * 17)
  if (owner.func === 'BE') {
    g.fillStyle = '#05080f'
    g.fillRect(0, 0, 256, 144)
    for (let y = 8; y < 140; y += 8) {
      g.fillStyle = rand() < 0.15 ? '#fbbf24' : rand() < 0.5 ? '#4ade80' : '#94a3b8'
      g.fillRect(6, y, 20, 3)
      g.fillRect(32, y, 30 + rand() * 170, 3)
    }
  } else {
    g.fillStyle = '#f8fafc'
    g.fillRect(0, 0, 256, 144)
    g.fillStyle = owner.color
    g.fillRect(0, 0, 256, 18)
    g.fillStyle = '#ffffff'
    for (let i = 0; i < 4; i++) g.fillRect(150 + i * 25, 7, 18, 4)
    g.fillStyle = '#e2e8f0'
    g.fillRect(12, 28, 120, 10)
    g.fillRect(12, 44, 90, 6)
    for (let i = 0; i < 3; i++) {
      g.fillStyle = '#ffffff'
      g.fillRect(12 + i * 80, 62, 72, 66)
      g.fillStyle = ['#fde68a', '#bfdbfe', '#fbcfe8'][i]
      g.fillRect(16 + i * 80, 66, 64, 36)
      g.fillStyle = '#cbd5e1'
      g.fillRect(16 + i * 80, 108, 50, 4)
      g.fillStyle = owner.color
      g.fillRect(16 + i * 80, 117, 30, 7)
    }
  }
  tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  sideTextures.set(owner.id, tex)
  return tex
}

const lockTextures = new Map<string, CanvasTexture>()

/** Màn hình khoá: hình nền theo màu chủ khoang, ổ khoá, tên và chữ "Đã khoá" */
function lockTexture(owner: AgentDef) {
  let tex = lockTextures.get(owner.id)
  if (tex) return tex
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 288
  const g = c.getContext('2d')!
  const bg = g.createLinearGradient(0, 0, 512, 288)
  bg.addColorStop(0, '#0f172a')
  bg.addColorStop(1, owner.color)
  g.fillStyle = bg
  g.fillRect(0, 0, 512, 288)
  // ổ khoá
  g.strokeStyle = '#f8fafc'
  g.lineWidth = 10
  g.beginPath()
  g.arc(256, 104, 26, Math.PI, 0)
  g.lineTo(282, 122)
  g.moveTo(230, 104)
  g.lineTo(230, 122)
  g.stroke()
  g.fillStyle = '#f8fafc'
  g.beginPath()
  g.roundRect(214, 118, 84, 62, 10)
  g.fill()
  g.fillStyle = '#0f172a'
  g.beginPath()
  g.arc(256, 144, 8, 0, Math.PI * 2)
  g.fill()
  g.fillRect(253, 144, 6, 20)
  g.fillStyle = '#f8fafc'
  g.textAlign = 'center'
  g.font = '600 26px system-ui, sans-serif'
  g.fillText(owner.name, 256, 222)
  g.font = '18px system-ui, sans-serif'
  g.fillStyle = 'rgba(248, 250, 252, 0.75)'
  g.fillText('Đã khoá', 256, 250)
  tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  lockTextures.set(owner.id, tex)
  return tex
}

/** Chủ khoang đã rời chỗ ngồi (đi họp, sang khoang khác...) */
const awayFromSeat = (owner: AgentDef) => {
  const p = positions[owner.id]
  return Math.hypot(p.x - owner.seat[0], p.z - owner.seat[1]) > 0.3
}

/**
 * Màn hình: hiện code (màn chính) hoặc màn phụ; màn chính đổi màu liên tục như đang chiếu phim khi chủ khoang xem phim.
 * Chủ khoang rời chỗ thì cả hai màn hình chuyển sang màn hình khoá.
 */
function Screen({ owner, position, side = false }: { owner: AgentDef; position: V3; side?: boolean }) {
  const movie = useRef<MeshStandardMaterial>(null)
  const lock = useRef<Mesh>(null)
  const watching = useStore((s) => !side && owner.hobby === 'movie' && s.agents[owner.id].state === 'hobby')
  const tex = useMemo(() => (inMediaRoom(owner) ? mediaTexture(owner, side) : side ? sideTexture(owner) : codeTexture(owner.color)), [owner, side])
  const lockTex = useMemo(() => lockTexture(owner), [owner])
  useFrame(({ clock }) => {
    if (lock.current) lock.current.visible = awayFromSeat(owner)
    if (!movie.current || !watching) return
    const t = clock.elapsedTime
    movie.current.emissive.setHSL((t * 0.07) % 1, 0.7, 0.35 + Math.sin(t * 5) * 0.1)
  })
  return (
    <group position={position} userData={DYNAMIC}>
      <mesh>
        <planeGeometry args={[0.55, 0.32]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.001]} visible={watching}>
        <planeGeometry args={[0.55, 0.32]} />
        <meshStandardMaterial ref={movie} color="#000" emissive="#6366f1" emissiveIntensity={0.9} />
      </mesh>
      <mesh ref={lock} position={[0, 0, 0.002]} visible={false}>
        <planeGeometry args={[0.55, 0.32]} />
        <meshStandardMaterial map={lockTex} emissiveMap={lockTex} emissive="#ffffff" emissiveIntensity={0.85} roughness={0.3} />
      </mesh>
    </group>
  )
}

/** Ghế văn phòng: đệm màu theo chủ, chân sao 5 cánh có bánh xe */
/** Ghế văn phòng xoay theo chủ khoang khi họ ngồi (vd quay sang nói chuyện với khách) */
function Chair({ x, z, owner }: { x: number; z: number; owner: AgentDef }) {
  const color = owner.color
  const ref = useRef<Group>(null)
  useFrame((_, dt) => {
    const g = ref.current
    if (!g) return
    const p = positions[owner.id]
    const seated = Math.hypot(p.x - owner.seat[0], p.z - owner.seat[1]) < 0.05
    // người ngồi quay mặt vào bàn (góc π) thì ghế ở góc 0
    const target = seated ? yaws[owner.id] - Math.PI : 0
    const d = MathUtils.euclideanModulo(target - g.rotation.y + Math.PI, Math.PI * 2) - Math.PI
    g.rotation.y += d * (1 - Math.exp(-8 * dt))
  })
  return (
    <group ref={ref} position={[x, 0, z]} userData={DYNAMIC}>
      <Soft args={[0.5, 0.08, 0.48]} position={[0, 0.46, 0]} color={color} radius={0.035} roughness={0.9} />
      <Soft args={[0.48, 0.55, 0.07]} position={[0, 0.78, 0.25]} color={color} radius={0.035} roughness={0.9} rotation={[-0.08, 0, 0]} />
      <Box args={[0.04, 0.3, 0.04]} position={[0, 0.55, 0.25]} color="#1f2937" />
      {[-1, 1].map((s) => (
        <group key={s}>
          <Box args={[0.03, 0.18, 0.03]} position={[s * 0.24, 0.56, 0.02]} color="#1f2937" />
          <Soft args={[0.06, 0.03, 0.26]} position={[s * 0.24, 0.65, 0.02]} color="#1f2937" radius={0.012} />
        </group>
      ))}
      <Cyl args={[0.028, 0.028, 0.34]} position={[0, 0.25, 0]} color="#94a3b8" metalness={0.8} roughness={0.25} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2
        return (
          <group key={i} rotation={[0, a, 0]}>
            <Box args={[0.04, 0.03, 0.28]} position={[0, 0.07, 0.14]} color="#1f2937" />
            <mesh position={[0, 0.03, 0.27]}>
              <sphereGeometry args={[0.03, 10, 8]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

function DeskLamp({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <Cyl args={[0.07, 0.08, 0.02]} position={[0, 0.01, 0]} color="#1f2937" />
      <Cyl args={[0.01, 0.01, 0.32]} position={[0.04, 0.16, 0]} rotation={[0, 0, -0.25]} color="#1f2937" />
      <Cyl args={[0.01, 0.01, 0.22]} position={[0.14, 0.33, 0.04]} rotation={[0.4, 0, 0.9]} color="#1f2937" />
      <group position={[0.24, 0.36, 0.1]} rotation={[0.6, 0, -0.5]}>
        <mesh castShadow>
          <coneGeometry args={[0.07, 0.1, 20, 1, true]} />
          <meshStandardMaterial color="#1f2937" side={2} />
        </mesh>
        <mesh position={[0, -0.03, 0]}>
          <sphereGeometry args={[0.03, 12, 8]} />
          <meshStandardMaterial color="#fff7d6" emissive="#ffe8a3" emissiveIntensity={2} />
        </mesh>
      </group>
    </group>
  )
}

function Succulent({ position, potColor = '#f8fafc' }: { position: V3; potColor?: string }) {
  return (
    <group position={position}>
      <Cyl args={[0.06, 0.045, 0.09]} position={[0, 0.045, 0]} color={potColor} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} position={[Math.cos(i) * 0.025, 0.12, Math.sin(i) * 0.025]} rotation={[Math.cos(i) * 0.6, 0, Math.sin(i) * 0.6]} scale={[0.5, 1, 0.5]} castShadow>
          <sphereGeometry args={[0.05, 8, 6]} />
          <meshStandardMaterial color={i % 2 ? '#4ade80' : '#22c55e'} roughness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

/** Đồ cá nhân trên bàn theo sở thích */
function DeskItems({ owner, x }: { owner: AgentDef; x: number }) {
  const z = DESK_Z
  switch (owner.hobby) {
    case 'read': // chồng sách
      return (
        <group position={[x + 0.7, 0.78, z + 0.1]}>
          {['#b91c1c', '#1d4ed8', '#ca8a04'].map((c, i) => (
            <Box key={c} args={[0.24 - i * 0.02, 0.045, 0.17]} position={[0, 0.025 + i * 0.047, 0]} rotation={[0, i * 0.2 - 0.2, 0]} color={c} />
          ))}
        </group>
      )
    case 'game': // tay cầm chơi game
      return (
        <group position={[x + 0.7, 0.8, z + 0.15]} rotation={[0, 0.4, 0]}>
          <Soft args={[0.16, 0.03, 0.08]} position={[0, 0, 0]} color="#111827" radius={0.012} />
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[0.04, 0.005, 0.02]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1} />
          </mesh>
        </group>
      )
    case 'music': // loa nhỏ
      return (
        <group position={[x + 0.72, 0.78, z + 0.05]}>
          <Soft args={[0.12, 0.2, 0.12]} position={[0, 0.1, 0]} color="#334155" radius={0.02} />
          <Cyl args={[0.04, 0.04, 0.01]} position={[0, 0.12, 0.061]} rotation={[Math.PI / 2, 0, 0]} color="#0f172a" />
        </group>
      )
    case 'movie': // poster phim mini
      return (
        <group position={[x + 0.7, 0.78, z + 0.05]} rotation={[-0.15, -0.3, 0]}>
          <Box args={[0.16, 0.22, 0.015]} position={[0, 0.11, 0]} color="#7f1d1d" />
          <Box args={[0.12, 0.08, 0.005]} position={[0, 0.14, 0.009]} color="#fbbf24" emissive="#f59e0b" />
        </group>
      )
    case 'rubik': // khối rubik để bàn
      return (
        <mesh position={[x + 0.7, 0.82, z + 0.12]} rotation={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[0.08, 0.08, 0.08]} />
          {['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#f8fafc'].map((c, i) => (
            <meshStandardMaterial key={c} attach={`material-${i}`} color={c} />
          ))}
        </mesh>
      )
  }
}

/** Chuột trên bàn: trượt theo tay khi chủ khoang đang làm việc và rê chuột (cùng nhịp với StickFigure) */
function DeskMouse({ owner, position }: { owner: AgentDef; position: V3 }) {
  const ref = useRef<Mesh>(null)
  const phase = AGENTS.indexOf(owner) * 1.37 // cùng pha Agent truyền cho StickFigure
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    const t = clock.elapsedTime + phase
    const active = useStore.getState().agents[owner.id].state === 'work' && !awayFromSeat(owner) && usingMouse(t)
    const [dx, dz] = active ? mouseOffset(t) : [0, 0]
    m.position.x = MathUtils.lerp(m.position.x, position[0] + dx, 0.2)
    m.position.z = MathUtils.lerp(m.position.z, position[2] + dz, 0.2)
  })
  return (
    <mesh ref={ref} position={position} scale={[0.7, 0.45, 1]} castShadow userData={DYNAMIC}>
      <sphereGeometry args={[0.045, 14, 10]} />
      <meshStandardMaterial color="#f1f5f9" roughness={0.4} />
    </mesh>
  )
}

function Workstation({ owner }: { owner: AgentDef }) {
  const x = owner.seat[0]
  return (
    <group>
      {/* bàn: mặt gỗ bo góc, chân kim loại */}
      <Soft args={[1.7, 0.05, 0.85]} position={[x, 0.75, DESK_Z]} color="#d8b48a" radius={0.02} roughness={0.55} />
      {[-0.78, 0.78].map((dx) => (
        <group key={dx}>
          <Box args={[0.05, 0.72, 0.05]} position={[x + dx, 0.36, DESK_Z - 0.33]} color="#374151" metalness={0.6} roughness={0.35} />
          <Box args={[0.05, 0.72, 0.05]} position={[x + dx, 0.36, DESK_Z + 0.33]} color="#374151" metalness={0.6} roughness={0.35} />
          <Box args={[0.05, 0.04, 0.7]} position={[x + dx, 0.02, DESK_Z]} color="#374151" metalness={0.6} roughness={0.35} />
        </group>
      ))}
      {/* tủ hồ sơ nhỏ dưới bàn */}
      <Soft args={[0.4, 0.55, 0.5]} position={[x - 0.5, 0.3, DESK_Z - 0.1]} color="#e5e7eb" radius={0.02} />
      {[0.42, 0.24].map((y) => (
        <Box key={y} args={[0.12, 0.015, 0.01]} position={[x - 0.5, y, DESK_Z + 0.155]} color="#94a3b8" metalness={0.6} />
      ))}
      {/* hai màn hình viền mỏng trên tay đỡ đôi, xoay nhẹ vào giữa cho người ngồi */}
      <Soft args={[0.26, 0.015, 0.18]} position={[x, 0.785, DESK_Z - 0.3]} color="#9ca3af" radius={0.006} />
      <Box args={[0.04, 0.34, 0.04]} position={[x, 0.95, DESK_Z - 0.32]} color="#9ca3af" metalness={0.7} roughness={0.3} />
      <Box args={[0.56, 0.03, 0.03]} position={[x, 1.1, DESK_Z - 0.31]} color="#9ca3af" metalness={0.7} roughness={0.3} />
      {[-1, 1].map((s) => (
        <group key={s} position={[x + s * 0.3, 1.1, DESK_Z - 0.26]} rotation={[0, -s * 0.25, 0]}>
          <Soft args={[0.58, 0.36, 0.025]} position={[0, 0, 0]} color="#111827" radius={0.01} roughness={0.4} />
          <Screen owner={owner} position={[0, 0, 0.0135]} side={s > 0} />
        </group>
      ))}
      {/* bàn phím + chuột + lót chuột */}
      <Soft args={[0.46, 0.02, 0.15]} position={[x, 0.785, DESK_Z + 0.27]} color="#f1f5f9" radius={0.008} />
      <Box args={[0.22, 0.004, 0.2]} position={[x + 0.36, 0.777, DESK_Z + 0.27]} color="#1e293b" />
      <DeskMouse owner={owner} position={[x + 0.36, 0.79, DESK_Z + 0.27]} />
      {/* cốc cà phê có quai */}
      <group position={[x - 0.45, 0.775, DESK_Z + 0.22]}>
        <Cyl args={[0.04, 0.035, 0.1]} position={[0, 0.05, 0]} color={owner.color} roughness={0.35} />
        <mesh position={[0.045, 0.05, 0]}>
          <torusGeometry args={[0.022, 0.007, 6, 12]} />
          <meshStandardMaterial color={owner.color} roughness={0.35} />
        </mesh>
        <Cyl args={[0.034, 0.034, 0.005]} position={[0, 0.092, 0]} color="#3f2a1d" />
      </group>
      <DeskLamp position={[x - 0.74, 0.775, DESK_Z + 0.05]} />
      <Succulent position={[x + 0.72, 0.775, DESK_Z - 0.3]} />
      <DeskItems owner={owner} x={x} />
      {/* giấy note dán trên viền màn hình */}
      <Box args={[0.06, 0.06, 0.003]} position={[x + 0.52, 1.25, DESK_Z - 0.19]} rotation={[0, -0.25, 0.1]} color="#fde047" />
      <Chair x={x} z={SEAT_Z + 0.05} owner={owner} />
    </group>
  )
}

/** Cây cảnh: chậu + tán lá nhiều lớp */
function Plant({ position, scale = 1 }: { position: V3; scale?: number }) {
  const leaves = useMemo(() => {
    const rand = rng(Math.round(position[0] * 100 + position[2] * 7) + 500)
    return Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2 + rand()
      const r = 0.1 + rand() * 0.15
      return { p: [Math.cos(a) * r, 0.65 + rand() * 0.45, Math.sin(a) * r] as V3, s: 0.16 + rand() * 0.1, c: ['#15803d', '#16a34a', '#22c55e'][i % 3] }
    })
  }, [position])
  return (
    <group position={position} scale={scale}>
      <Cyl args={[0.22, 0.17, 0.42]} position={[0, 0.21, 0]} color="#e7e5e4" roughness={0.5} />
      <Cyl args={[0.235, 0.235, 0.04]} position={[0, 0.42, 0]} color="#d6d3d1" />
      <Cyl args={[0.2, 0.2, 0.02]} position={[0, 0.43, 0]} color="#3f2a1d" />
      <Cyl args={[0.02, 0.025, 0.5]} position={[0, 0.65, 0]} color="#78350f" />
      {leaves.map((l, i) => (
        <mesh key={i} position={l.p} castShadow>
          <icosahedronGeometry args={[l.s, 1]} />
          <meshStandardMaterial color={l.c} roughness={0.8} flatShading />
        </mesh>
      ))}
    </group>
  )
}

function MeetingArea() {
  const [cx, cz] = MEETING_CENTER
  return (
    <group position={[cx, 0, cz]}>
      {/* thảm tròn có viền */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
        <circleGeometry args={[1.9, 64]} />
        <meshStandardMaterial color="#c7d2fe" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} receiveShadow>
        <ringGeometry args={[1.72, 1.8, 64]} />
        <meshStandardMaterial color="#818cf8" roughness={1} />
      </mesh>
      {/* bàn tròn đứng (standup) mặt gỗ */}
      <Cyl args={[0.62, 0.62, 0.05, 48]} position={[0, 1.0, 0]} color="#d8b48a" roughness={0.5} />
      <Cyl args={[0.05, 0.05, 1.0, 16]} position={[0, 0.5, 0]} color="#374151" metalness={0.6} roughness={0.35} />
      <Cyl args={[0.3, 0.32, 0.04, 32]} position={[0, 0.02, 0]} color="#374151" metalness={0.6} roughness={0.35} />
      {/* laptop + giấy note + cốc trên bàn */}
      <Soft args={[0.32, 0.015, 0.22]} position={[0.1, 1.035, 0.05]} color="#cbd5e1" radius={0.006} />
      <group position={[0.1, 1.04, -0.06]} rotation={[-0.25, 0, 0]}>
        <Soft args={[0.32, 0.2, 0.012]} position={[0, 0.1, 0]} color="#cbd5e1" radius={0.006} />
        <Box args={[0.29, 0.17, 0.002]} position={[0, 0.1, 0.007]} color="#0f172a" emissive="#38bdf8" />
      </group>
      <Box args={[0.12, 0.005, 0.12]} position={[-0.3, 1.03, 0.1]} rotation={[0, 0.3, 0]} color="#fde047" />
      <Box args={[0.12, 0.005, 0.12]} position={[-0.22, 1.033, -0.2]} rotation={[0, -0.2, 0]} color="#f9a8d4" />
      {/* ánh đèn ấm trên bàn họp (không vẽ chao đèn: nhìn từ trên xuống dễ tưởng là vật trên sàn) */}
      <pointLight position={[0, 2.2, 0]} intensity={2.5} distance={4} decay={2} color="#ffe8c2" />
      {/* TV trình chiếu bên phải, quay về bàn họp */}
      <group position={[2.1, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <Soft args={[1.6, 0.92, 0.05]} position={[0, 1.6, 0]} color="#111827" radius={0.015} roughness={0.35} />
        <Box args={[1.52, 0.84, 0.005]} position={[0, 1.6, 0.027]} color="#0f172a" emissive="#4f46e5" />
        {/* biểu đồ sprint trên TV */}
        {[0.25, 0.4, 0.3, 0.55, 0.45].map((h, i) => (
          <Box key={i} args={[0.12, h, 0.004]} position={[-0.45 + i * 0.22, 1.3 + h / 2, 0.031]} color="#a5b4fc" emissive="#a5b4fc" />
        ))}
        <Box args={[0.08, 1.15, 0.08]} position={[0, 0.575, -0.06]} color="#374151" metalness={0.6} roughness={0.35} />
        <Box args={[0.7, 0.04, 0.4]} position={[0, 0.02, -0.06]} color="#374151" metalness={0.6} roughness={0.35} />
      </group>
    </group>
  )
}

/** Góc nghỉ phía trước bên trái: sofa, bàn trà, ghế bành, quầy cà phê */
function Lounge() {
  return (
    <group position={[-3.4, 0, 2.1]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.4, 0.006, 0]} receiveShadow>
        <planeGeometry args={[2.6, 2.4]} />
        <meshStandardMaterial color="#fde7c7" roughness={1} />
      </mesh>
      {/* sofa quay sang bàn trà */}
      <group position={[-1.1, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <Soft args={[1.9, 0.3, 0.8]} position={[0, 0.25, 0]} color="#475569" radius={0.06} roughness={0.95} />
        <Soft args={[1.9, 0.5, 0.2]} position={[0, 0.55, -0.32]} color="#475569" radius={0.08} roughness={0.95} />
        {[-1, 1].map((s) => (
          <Soft key={s} args={[0.2, 0.45, 0.8]} position={[s * 0.95, 0.37, 0]} color="#475569" radius={0.08} roughness={0.95} />
        ))}
        {[-0.42, 0.42].map((dx) => (
          <Soft key={dx} args={[0.8, 0.12, 0.6]} position={[dx, 0.45, 0.05]} color="#64748b" radius={0.05} roughness={0.95} />
        ))}
        <Soft args={[0.36, 0.3, 0.12]} position={[-0.6, 0.62, -0.15]} rotation={[0.2, 0.2, 0.1]} color="#f59e0b" radius={0.05} roughness={0.95} />
        <Soft args={[0.34, 0.3, 0.12]} position={[0.62, 0.62, -0.15]} rotation={[0.2, -0.2, -0.1]} color="#f472b6" radius={0.05} roughness={0.95} />
      </group>
      {/* bàn trà */}
      <Cyl args={[0.4, 0.4, 0.04, 40]} position={[0.2, 0.4, 0]} color="#d8b48a" roughness={0.5} />
      <Cyl args={[0.04, 0.06, 0.38]} position={[0.2, 0.2, 0]} color="#374151" metalness={0.6} />
      <Succulent position={[0.1, 0.42, 0.1]} potColor="#fca5a5" />
      <group position={[0.35, 0.42, -0.1]}>
        <Cyl args={[0.035, 0.03, 0.08]} position={[0, 0.04, 0]} color="#f8fafc" roughness={0.3} />
      </group>
      {/* ghế bành */}
      <group position={[1.1, 0, 0.6]} rotation={[0, -2.3, 0]}>
        <Soft args={[0.7, 0.3, 0.65]} position={[0, 0.25, 0]} color="#0d9488" radius={0.06} roughness={0.95} />
        <Soft args={[0.7, 0.45, 0.16]} position={[0, 0.55, -0.26]} color="#0d9488" radius={0.07} roughness={0.95} />
      </group>
      {/* quầy cà phê */}
      <group position={[-1.2, 0, -1.6]}>
        <Soft args={[0.5, 0.9, 0.9]} position={[0, 0.45, 0]} color="#f1f5f9" radius={0.02} />
        <Soft args={[0.55, 0.04, 0.95]} position={[0, 0.92, 0]} color="#d8b48a" radius={0.01} />
        <Soft args={[0.3, 0.38, 0.26]} position={[0, 1.13, 0.15]} color="#1f2937" radius={0.03} roughness={0.35} />
        <Box args={[0.02, 0.06, 0.1]} position={[0.155, 1.2, 0.15]} color="#22c55e" emissive="#22c55e" />
        {[-0.25, -0.13].map((z) => (
          <Cyl key={z} args={[0.035, 0.03, 0.08]} position={[0.05, 0.98, z]} color={z < -0.2 ? '#fca5a5' : '#93c5fd'} roughness={0.3} />
        ))}
      </group>
    </group>
  )
}

function Window({ z }: { z: number }) {
  return (
    <group position={[-7.91, 1.65, z]} rotation={[0, Math.PI / 2, 0]}>
      <Box args={[1.5, 1.3, 0.04]} position={[0, 0, 0]} color="#ffffff" />
      <mesh position={[0, 0, 0.025]}>
        <planeGeometry args={[1.36, 1.16]} />
        <meshStandardMaterial color="#bae6fd" emissive="#e0f2fe" emissiveIntensity={0.9} />
      </mesh>
      <Box args={[0.04, 1.2, 0.03]} position={[0, 0, 0.035]} color="#ffffff" />
      <Box args={[1.4, 0.04, 0.03]} position={[0, 0.1, 0.035]} color="#ffffff" />
      <Box args={[1.62, 0.05, 0.14]} position={[0, -0.67, 0.06]} color="#f1f5f9" />
    </group>
  )
}

function WallClock({ position }: { position: V3 }) {
  const minute = useRef<Group>(null)
  const hour = useRef<Group>(null)
  useFrame(() => {
    const d = new Date()
    if (minute.current) minute.current.rotation.z = -((d.getMinutes() + d.getSeconds() / 60) / 60) * Math.PI * 2
    if (hour.current) hour.current.rotation.z = -(((d.getHours() % 12) + d.getMinutes() / 60) / 12) * Math.PI * 2
  })
  return (
    <group position={position} userData={DYNAMIC}>
      <Cyl args={[0.24, 0.24, 0.04, 40]} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} color="#1f2937" />
      <Cyl args={[0.21, 0.21, 0.045, 40]} position={[0, 0, 0.003]} rotation={[Math.PI / 2, 0, 0]} color="#ffffff" />
      <group ref={hour} position={[0, 0, 0.03]}>
        <Box args={[0.02, 0.11, 0.005]} position={[0, 0.05, 0]} color="#111827" />
      </group>
      <group ref={minute} position={[0, 0, 0.034]}>
        <Box args={[0.012, 0.17, 0.005]} position={[0, 0.08, 0]} color="#111827" />
      </group>
    </group>
  )
}

const PANEL_HEIGHT = 1.15
const GLASS_HEIGHT = 0.3
const PANEL_BACK_Z = -3.42

/** Khoang ngồi: thảm theo màu vai trò, vách vải + kính mờ, bảng tên trên tường */
// ---------- đồ dùng văn phòng ----------

/** Máy in đa năng trên tủ thấp, xấp giấy vừa in và thùng giấy A4 bên cạnh */
function PrinterStation({ position, rotation }: { position: V3; rotation: V3 }) {
  return (
    <group position={position} rotation={rotation}>
      <Soft args={[0.8, 0.62, 0.5]} position={[0, 0.31, 0]} color="#e2e8f0" radius={0.02} />
      <Box args={[0.78, 0.008, 0.01]} position={[0, 0.31, 0.251]} color="#94a3b8" />
      <Soft args={[0.62, 0.3, 0.46]} position={[0, 0.77, 0]} color="#f8fafc" radius={0.03} />
      <Soft args={[0.62, 0.06, 0.46]} position={[0, 0.95, 0]} color="#475569" radius={0.02} />
      {/* màn hình cảm ứng + đèn báo */}
      <Box args={[0.14, 0.06, 0.01]} position={[0.18, 0.86, 0.232]} rotation={[-0.4, 0, 0]} color="#0f172a" emissive="#38bdf8" />
      <mesh position={[0.28, 0.86, 0.235]}>
        <sphereGeometry args={[0.01, 8, 8]} />
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.5} />
      </mesh>
      {/* khay giấy ra */}
      <Box args={[0.36, 0.01, 0.22]} position={[-0.06, 0.72, 0.3]} rotation={[0.12, 0, 0]} color="#cbd5e1" />
      <Box args={[0.3, 0.012, 0.2]} position={[-0.06, 0.735, 0.3]} rotation={[0.12, 0, 0]} color="#ffffff" />
      {/* thùng giấy A4 */}
      <Box args={[0.36, 0.26, 0.26]} position={[0.62, 0.13, 0.05]} rotation={[0, 0.2, 0]} color="#c8a26b" />
      <Box args={[0.36, 0.01, 0.12]} position={[0.62, 0.265, 0.05]} rotation={[0, 0.2, 0]} color="#b08850" />
    </group>
  )
}

/** Cây nước nóng lạnh với bình nước xanh và chồng cốc giấy */
function WaterCooler({ position, rotation }: { position: V3; rotation: V3 }) {
  return (
    <group position={position} rotation={rotation}>
      <Soft args={[0.34, 0.95, 0.34]} position={[0, 0.475, 0]} color="#f8fafc" radius={0.03} />
      <Box args={[0.22, 0.24, 0.01]} position={[0, 0.62, 0.171]} color="#cbd5e1" />
      {[-0.05, 0.05].map((x, i) => (
        <Box key={x} args={[0.03, 0.05, 0.04]} position={[x, 0.7, 0.19]} color={i ? '#3b82f6' : '#ef4444'} />
      ))}
      <Box args={[0.2, 0.02, 0.08]} position={[0, 0.52, 0.2]} color="#64748b" />
      <mesh position={[0, 1.15, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.36, 24]} />
        <meshStandardMaterial color="#7dd3fc" transparent opacity={0.6} roughness={0.1} />
      </mesh>
      <Cyl args={[0.06, 0.13, 0.06]} position={[0, 0.97, 0]} color="#7dd3fc" />
      {/* cốc giấy gắn bên hông */}
      <Cyl args={[0.035, 0.035, 0.22]} position={[0.2, 0.75, 0.05]} color="#e2e8f0" />
      <Cyl args={[0.04, 0.03, 0.05]} position={[0.2, 0.63, 0.05]} color="#ffffff" />
    </group>
  )
}

/** Tủ hồ sơ cao 4 ngăn, trên nóc có hộp tài liệu */
function FilingCabinet({ position, rotation }: { position: V3; rotation: V3 }) {
  return (
    <group position={position} rotation={rotation}>
      <Soft args={[0.5, 1.32, 0.55]} position={[0, 0.66, 0]} color="#9ca3af" radius={0.015} roughness={0.45} />
      {[0, 1, 2, 3].map((i) => (
        <group key={i} position={[0, 0.17 + i * 0.32, 0.278]}>
          <Box args={[0.46, 0.29, 0.01]} position={[0, 0, 0]} color="#a8b0bb" roughness={0.45} />
          <Box args={[0.16, 0.025, 0.02]} position={[0, -0.04, 0.01]} color="#475569" metalness={0.6} />
          <Box args={[0.1, 0.05, 0.004]} position={[0, 0.06, 0.007]} color="#f8fafc" />
        </group>
      ))}
      {['#1d4ed8', '#b91c1c', '#15803d'].map((c, i) => (
        <Box key={c} args={[0.08, 0.3, 0.26]} position={[-0.14 + i * 0.09, 1.47, 0]} rotation={[0, 0, i === 2 ? -0.2 : 0]} color={c} />
      ))}
    </group>
  )
}

/** Thùng rác nhỏ có vài cục giấy vo */
function TrashBin({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.15, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.1, 0.3, 18, 1, true]} />
        <meshStandardMaterial color="#334155" side={2} roughness={0.6} />
      </mesh>
      <Cyl args={[0.1, 0.1, 0.01]} position={[0, 0.01, 0]} color="#334155" />
      {[[0.03, 0.26, 0.02], [-0.04, 0.24, -0.03]].map((p, i) => (
        <mesh key={i} position={p as V3}>
          <icosahedronGeometry args={[0.04, 0]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.9} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/** Cửa ra vào trên tường trái, có biển EXIT phát sáng */
function Door({ z }: { z: number }) {
  return (
    <group position={[-7.92, 0, z]} rotation={[0, Math.PI / 2, 0]}>
      <Box args={[1.1, 2.2, 0.06]} position={[0, 1.1, 0]} color="#e7e1d6" />
      <Box args={[0.96, 2.1, 0.05]} position={[0, 1.05, 0.02]} color="#a0764e" roughness={0.6} />
      <Box args={[0.3, 0.6, 0.01]} position={[0, 1.55, 0.05]} color="#bae6fd" roughness={0.1} />
      <Box args={[0.16, 0.03, 0.04]} position={[0.36, 1.0, 0.07]} color="#d1d5db" metalness={0.8} roughness={0.25} />
      {/* biển EXIT */}
      <Soft args={[0.42, 0.16, 0.05]} position={[0, 2.42, 0.02]} color="#15803d" radius={0.015} />
      <Box args={[0.36, 0.1, 0.005]} position={[0, 2.42, 0.048]} color="#22c55e" emissive="#4ade80" />
    </group>
  )
}

/** Cây treo áo: áo khoác và túi xách */
function CoatRack({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <Cyl args={[0.18, 0.2, 0.04]} position={[0, 0.02, 0]} color="#1f2937" />
      <Cyl args={[0.025, 0.025, 1.75]} position={[0, 0.9, 0]} color="#5b4636" />
      {[0, 1, 2, 3].map((i) => (
        <Cyl key={i} args={[0.012, 0.012, 0.16]} position={[Math.cos(i * 1.57) * 0.07, 1.68, Math.sin(i * 1.57) * 0.07]} rotation={[Math.sin(i * 1.57) * 0.9, 0, -Math.cos(i * 1.57) * 0.9]} color="#5b4636" />
      ))}
      {/* áo khoác */}
      <mesh position={[0.11, 1.32, 0]} scale={[0.7, 1, 1]} castShadow>
        <capsuleGeometry args={[0.1, 0.4, 6, 12]} />
        <meshStandardMaterial color="#475569" roughness={0.9} />
      </mesh>
      {/* túi xách */}
      <Soft args={[0.24, 0.2, 0.08]} position={[-0.12, 1.3, 0.04]} color="#b45309" radius={0.02} />
      <mesh position={[-0.12, 1.47, 0.04]}>
        <torusGeometry args={[0.07, 0.008, 6, 16, Math.PI]} />
        <meshStandardMaterial color="#78350f" />
      </mesh>
    </group>
  )
}

/** Bình chữa cháy treo tường */
function FireExtinguisher({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <Box args={[0.02, 0.3, 0.14]} position={[-0.06, 0.1, 0]} color="#374151" />
      <Cyl args={[0.06, 0.06, 0.4]} position={[0, 0, 0]} color="#dc2626" roughness={0.35} />
      <Cyl args={[0.025, 0.04, 0.08]} position={[0, 0.24, 0]} color="#111827" />
      <Box args={[0.1, 0.015, 0.03]} position={[0.03, 0.29, 0]} color="#111827" />
      <Box args={[0.01, 0.14, 0.1]} position={[0.061, -0.02, 0]} color="#f8fafc" />
    </group>
  )
}

/** Máy lạnh treo tường, đèn xanh đang chạy */
function AirConditioner({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <Soft args={[1.0, 0.3, 0.22]} position={[0, 0, 0]} color="#f8fafc" radius={0.05} />
      <Box args={[0.86, 0.02, 0.01]} position={[0, -0.1, 0.11]} color="#cbd5e1" />
      <Box args={[0.86, 0.04, 0.06]} position={[0, -0.13, 0.08]} rotation={[0.5, 0, 0]} color="#e2e8f0" />
      <mesh position={[0.4, 0.06, 0.112]}>
        <sphereGeometry args={[0.012, 8, 8]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={2} />
      </mesh>
    </group>
  )
}

function Cubicles() {
  useStore((s) => s.namesVersion) // có người vào / ra thì xếp lại khoang
  const depth = CUBICLE_FRONT_Z - PANEL_BACK_Z
  const midZ = (CUBICLE_FRONT_Z + PANEL_BACK_Z) / 2
  const row = AGENTS.filter((a) => !inMediaRoom(a))
  if (!row.length) return null
  const xs = row.map((a) => a.seat[0])
  const walls = [...xs.map((x) => x - CUBICLE_WIDTH / 2), xs[xs.length - 1] + CUBICLE_WIDTH / 2]
  return (
    <group>
      {row.map((a) => (
        <group key={a.id}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[a.seat[0], 0.004, midZ + 0.1]} receiveShadow>
            <planeGeometry args={[CUBICLE_WIDTH - 0.3, depth - 0.3]} />
            <meshStandardMaterial color={a.color} transparent opacity={0.2} roughness={1} />
          </mesh>
          {/* bảng tên khoang trên tường */}
          <Soft args={[1.1, 0.2, 0.03]} position={[a.seat[0], 1.62, -3.41]} color={a.color} radius={0.01} />
          <Box args={[0.9, 0.04, 0.005]} position={[a.seat[0], 1.62, -3.393]} color="#ffffff" emissive="#ffffff" />
        </group>
      ))}
      {walls.map((x) => (
        <group key={x} position={[x, 0, midZ]}>
          <Box args={[0.06, PANEL_HEIGHT, depth]} position={[0, PANEL_HEIGHT / 2, 0]} color="#c9d3df" roughness={1} />
          {/* kính mờ phía trên */}
          <mesh position={[0, PANEL_HEIGHT + GLASS_HEIGHT / 2, 0]}>
            <boxGeometry args={[0.02, GLASS_HEIGHT, depth]} />
            <meshStandardMaterial color="#e0f2fe" transparent opacity={0.35} roughness={0.1} />
          </mesh>
          {/* nẹp nhôm */}
          <Box args={[0.08, 0.03, depth]} position={[0, PANEL_HEIGHT, 0]} color="#94a3b8" metalness={0.7} roughness={0.3} />
          <Box args={[0.05, 0.02, depth]} position={[0, PANEL_HEIGHT + GLASS_HEIGHT, 0]} color="#94a3b8" metalness={0.7} roughness={0.3} />
          <Box args={[0.08, PANEL_HEIGHT + GLASS_HEIGHT, 0.04]} position={[0, (PANEL_HEIGHT + GLASS_HEIGHT) / 2, depth / 2]} color="#94a3b8" metalness={0.7} roughness={0.3} />
        </group>
      ))}
    </group>
  )
}

// ---------- phòng media: thu âm, chụp ảnh, dựng video ----------

const ACOUSTIC = '#334155'

/** Micro thu âm trên tay đỡ, có lưới chắn hơi */
function StudioMic({ position }: { position: V3 }) {
  return (
    <group position={position}>
      <Cyl args={[0.025, 0.03, 0.04]} position={[0, 0.02, 0]} color="#1f2937" metalness={0.6} />
      <Cyl args={[0.008, 0.008, 0.36]} position={[0, 0.2, 0]} color="#475569" metalness={0.7} />
      <Cyl args={[0.008, 0.008, 0.3]} position={[0, 0.38, 0.13]} rotation={[Math.PI / 2.6, 0, 0]} color="#475569" metalness={0.7} />
      <group position={[0, 0.43, 0.27]}>
        <Cyl args={[0.028, 0.028, 0.11]} position={[0, -0.03, 0]} color="#0f172a" metalness={0.5} roughness={0.3} />
        <mesh position={[0, -0.03, 0.08]}>
          <torusGeometry args={[0.055, 0.005, 6, 20]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        <mesh position={[0, -0.03, 0.08]}>
          <circleGeometry args={[0.055, 20]} />
          <meshStandardMaterial color="#111827" transparent opacity={0.45} side={2} />
        </mesh>
      </group>
    </group>
  )
}

/** Loa kiểm âm đặt bàn */
function Speaker({ position, rotation }: { position: V3; rotation?: V3 }) {
  return (
    <group position={position} rotation={rotation}>
      <Soft args={[0.13, 0.2, 0.15]} position={[0, 0.1, 0]} color="#18181b" radius={0.01} />
      <Cyl args={[0.042, 0.042, 0.01]} position={[0, 0.075, 0.076]} rotation={[Math.PI / 2, 0, 0]} color="#facc15" />
      <Cyl args={[0.02, 0.02, 0.01]} position={[0, 0.155, 0.076]} rotation={[Math.PI / 2, 0, 0]} color="#3f3f46" />
    </group>
  )
}

/** Đèn softbox trên chân đèn ba càng */
function Softbox({ position, rotation }: { position: V3; rotation: V3 }) {
  return (
    <group position={position} rotation={rotation}>
      {[0, 1, 2].map((i) => (
        <Box key={i} args={[0.02, 0.02, 0.45]} position={[Math.sin((i * 2 * Math.PI) / 3) * 0.18, 0.08, Math.cos((i * 2 * Math.PI) / 3) * 0.18]} rotation={[0.35, (i * 2 * Math.PI) / 3, 0]} color="#1f2937" />
      ))}
      <Cyl args={[0.012, 0.012, 1.55]} position={[0, 0.85, 0]} color="#374151" metalness={0.7} />
      <group position={[0, 1.6, 0]} rotation={[0.25, 0, 0]}>
        <Box args={[0.6, 0.6, 0.25]} position={[0, 0, -0.08]} color="#111827" />
        <mesh position={[0, 0, 0.05]}>
          <planeGeometry args={[0.56, 0.56]} />
          <meshStandardMaterial color="#ffffff" emissive="#fff7e6" emissiveIntensity={1.2} side={2} />
        </mesh>
      </group>
    </group>
  )
}

/** Máy quay trên chân máy */
function CameraRig({ position, rotation }: { position: V3; rotation: V3 }) {
  return (
    <group position={position} rotation={rotation}>
      {[0, 1, 2].map((i) => (
        <Box key={i} args={[0.02, 1.15, 0.02]} position={[Math.sin((i * 2 * Math.PI) / 3) * 0.18, 0.55, Math.cos((i * 2 * Math.PI) / 3) * 0.18]} rotation={[Math.cos((i * 2 * Math.PI) / 3) * -0.16, 0, Math.sin((i * 2 * Math.PI) / 3) * 0.16]} color="#111827" />
      ))}
      <group position={[0, 1.18, 0]}>
        <Soft args={[0.14, 0.13, 0.26]} position={[0, 0.03, 0]} color="#18181b" radius={0.015} />
        <Cyl args={[0.05, 0.055, 0.12]} position={[0, 0.03, 0.18]} rotation={[Math.PI / 2, 0, 0]} color="#0f172a" metalness={0.4} roughness={0.25} />
        <Cyl args={[0.04, 0.04, 0.005]} position={[0, 0.03, 0.242]} rotation={[Math.PI / 2, 0, 0]} color="#1e3a8a" metalness={0.9} roughness={0.1} />
        <Box args={[0.08, 0.06, 0.005]} position={[0.08, 0.06, -0.05]} rotation={[0, Math.PI / 2, 0]} color="#0ea5e9" emissive="#0ea5e9" />
        <mesh position={[0, 0.11, 0.06]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshStandardMaterial color="#ef4444" emissive="#ef4444" emissiveIntensity={2} />
        </mesh>
      </group>
    </group>
  )
}

/** Đèn "ON AIR" nhấp nháy khi có người trong phòng đang làm việc */
function OnAir({ position }: { position: V3 }) {
  const mat = useRef<MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    const live = AGENTS.some((a) => inMediaRoom(a) && useStore.getState().agents[a.id]?.state === 'work')
    if (mat.current) mat.current.emissiveIntensity = live ? 1.6 + Math.sin(clock.elapsedTime * 3) * 0.4 : 0.15
  })
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 80
    const g = c.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.font = 'bold 56px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('ON AIR', 128, 42)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }, [])
  return (
    <group position={position} userData={DYNAMIC}>
      <Soft args={[0.62, 0.22, 0.06]} position={[0, 0, 0]} color="#1f2937" radius={0.02} />
      <mesh position={[0, 0, 0.032]}>
        <planeGeometry args={[0.56, 0.17]} />
        <meshStandardMaterial ref={mat} color="#7f1d1d" emissive="#ef4444" emissiveIntensity={0.15} emissiveMap={tex} map={tex} />
      </mesh>
    </group>
  )
}

/** Biển tên phòng phát sáng */
function RoomSign({ position, text }: { position: V3; text: string }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 96
    const g = c.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.font = 'bold 60px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 256, 52)
    const t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    return t
  }, [text])
  return (
    <mesh position={position}>
      <planeGeometry args={[1.6, 0.3]} />
      <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#e879f9" emissiveIntensity={1.4} transparent color="#000" />
    </mesh>
  )
}

function MediaRoom() {
  useStore((s) => s.namesVersion)
  const { x0, x1, z0, z1, doorZ } = MEDIA_ROOM
  const w = x1 - x0
  const cx = (x0 + x1) / 2
  const d = z1 - z0
  const cz = (z0 + z1) / 2
  const crew = AGENTS.filter(inMediaRoom)
  const dw = mediaDeskWidth()
  const root = useMergeStatic()
  return (
    <group ref={root}>
      {/* sàn thảm tối + lối vào */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.002, cz]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color="#2a2438" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.006, (doorZ[0] + doorZ[1]) / 2]} receiveShadow>
        <planeGeometry args={[w, 0.82]} />
        <meshStandardMaterial color="#4c4363" roughness={1} />
      </mesh>
      {/* tường sau, tường phải; tường trước thấp bằng kính để nhìn vào */}
      <Box args={[w + 0.15, 3, 0.15]} position={[cx, 1.5, z0]} color="#26213a" roughness={0.95} />
      <Box args={[0.15, 3, d]} position={[x1, 1.5, cz]} color="#26213a" roughness={0.95} />
      <group position={[cx, 0, z1]}>
        <Box args={[w, 0.1, 0.08]} position={[0, 0.05, 0]} color="#475569" metalness={0.6} />
        <mesh position={[0, 0.55, 0]}>
          <boxGeometry args={[w, 1.0, 0.03]} />
          <meshStandardMaterial color="#c7d2fe" transparent opacity={0.18} roughness={0.05} />
        </mesh>
        <Box args={[w, 0.05, 0.08]} position={[0, 1.07, 0]} color="#475569" metalness={0.6} />
      </group>
      {/* tường trái (tầng 2 tách khỏi văn phòng), cửa cầu thang xuống tầng 1 ở lối đi */}
      <Box args={[0.15, 3, doorZ[0] - z0]} position={[x0, 1.5, (z0 + doorZ[0]) / 2]} color="#26213a" roughness={0.95} />
      <Box args={[0.15, 3, z1 - doorZ[1]]} position={[x0, 1.5, (doorZ[1] + z1) / 2]} color="#26213a" roughness={0.95} />
      <StairDoor x={x0} toFloor={0} />
      <RoomSign position={[cx, 2.45, z1 + 0.05]} text="🎬 MEDIA ROOM" />

      {/* tấm tiêu âm trên tường sau */}
      {Array.from({ length: 6 * 3 }, (_, i) => {
        const col = i % 6
        const r = Math.floor(i / 6)
        return <Soft key={i} args={[0.5, 0.5, 0.06]} position={[x0 + 0.75 + col * 0.9, 1.75 + r * 0.55, z0 + 0.1]} color={(col + r) % 2 ? ACOUSTIC : '#3b2f5c'} radius={0.03} roughness={1} />
      })}
      <OnAir position={[cx, 2.72, z0 + 0.12]} />

      {crew.map((a) => (
        <Workstation key={a.id} owner={a} />
      ))}
      {crew.map((a) => (
        <TrashBin key={a.id} position={[a.seat[0] + 0.6, 0, DESK_Z + 0.05]} />
      ))}
      {/* đồ trên bàn của từng người: micro, loa kiểm âm, đèn viền màu */}
      {crew.map((a) => {
        const x = a.seat[0]
        return (
          <group key={a.id}>
            <StudioMic position={[x - 0.62, 0.775, DESK_Z + 0.25]} />
            <Speaker position={[x - 0.62, 0.775, DESK_Z - 0.25]} rotation={[0, 0.35, 0]} />
            <Speaker position={[x + 0.62, 0.775, DESK_Z - 0.25]} rotation={[0, -0.35, 0]} />
            <mesh position={[x, 0.79, DESK_Z - 0.42]}>
              <boxGeometry args={[Math.min(1.6, dw - 0.2), 0.01, 0.01]} />
              <meshStandardMaterial color={a.color} emissive={a.color} emissiveIntensity={2} />
            </mesh>
          </group>
        )
      })}

      {/* góc quay: phông xanh, máy quay, hai đèn softbox */}
      <Box args={[0.04, 2.4, 2.4]} position={[x1 - 0.1, 1.3, 1.4]} color="#16a34a" roughness={1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x1 - 1.1, 0.01, 1.4]}>
        <planeGeometry args={[2.0, 2.4]} />
        <meshStandardMaterial color="#16a34a" roughness={1} />
      </mesh>
      <Cyl args={[0.05, 0.05, 2.5]} position={[x1 - 0.15, 2.55, 1.4]} rotation={[Math.PI / 2, 0, 0]} color="#1f2937" />
      <CameraRig position={[x0 + 2.6, 0, 1.4]} rotation={[0, Math.PI / 2, 0]} />
      <Softbox position={[x1 - 1.6, 0, 0.1]} rotation={[0, -Math.PI / 2 - 0.6, 0]} />
      <Softbox position={[x1 - 1.6, 0, 2.7]} rotation={[0, -Math.PI / 2 + 0.6, 0]} />
      {/* ghế đẩu trước phông xanh */}
      <Cyl args={[0.18, 0.18, 0.05]} position={[x1 - 1.0, 0.62, 1.4]} color="#f8fafc" />
      <Cyl args={[0.02, 0.02, 0.6]} position={[x1 - 1.0, 0.31, 1.4]} color="#94a3b8" metalness={0.7} />
      <Cyl args={[0.15, 0.15, 0.02]} position={[x1 - 1.0, 0.01, 1.4]} color="#94a3b8" metalness={0.7} />

      {/* ánh sáng màu tím hồng của phòng */}
      <pointLight position={[cx, 2.6, -1.2]} intensity={6} distance={7} color="#c084fc" />
      <pointLight position={[x1 - 1.2, 2.2, 1.4]} intensity={4} distance={5} color="#f0abfc" />
      <Plant position={[x1 - 0.45, 0, z0 + 0.45]} />
    </group>
  )
}

/** Cửa cầu thang giữa hai tầng (khung cửa tường x, ở lối đi). Bấm vào để sang tầng kia */
function StairDoor({ x, toFloor }: { x: number; toFloor: Floor }) {
  const { doorZ } = MEDIA_ROOM
  const zc = (doorZ[0] + doorZ[1]) / 2
  const wd = doorZ[1] - doorZ[0]
  const out = toFloor === 1 ? 1 : -1 // phía sau cửa (lòng cầu thang)
  const f = FLOORS[toFloor]
  return (
    <group
      userData={DYNAMIC}
      onClick={(e) => {
        e.stopPropagation()
        useStore.getState().setFloor(toFloor)
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
    >
      {/* lòng cầu thang tối phía sau cửa + vài bậc */}
      <Box args={[0.05, 2.7, wd]} position={[x + out * 0.9, 1.35, zc]} color="#1e293b" roughness={1} />
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} args={[0.22, 0.12 + i * 0.12, wd - 0.05]} position={[x + out * (0.15 + i * 0.2), (0.12 + i * 0.12) / 2, zc]} color={i % 2 ? '#64748b' : '#94a3b8'} roughness={0.9} />
      ))}
      <Box args={[0.9, 0.05, wd]} position={[x + out * 0.45, 2.75, zc]} color="#334155" />
      <Box args={[0.9, 2.75, 0.05]} position={[x + out * 0.45, 1.37, doorZ[0]]} color="#334155" />
      <Box args={[0.9, 2.75, 0.05]} position={[x + out * 0.45, 1.37, doorZ[1]]} color="#334155" />
      {/* khung cửa */}
      <Box args={[0.2, 2.75, 0.1]} position={[x, 1.37, doorZ[0]]} color="#475569" metalness={0.6} />
      <Box args={[0.2, 2.75, 0.1]} position={[x, 1.37, doorZ[1]]} color="#475569" metalness={0.6} />
      <Box args={[0.2, 0.12, wd + 0.1]} position={[x, 2.72, zc]} color="#475569" metalness={0.6} />
      {/* biển chỉ tầng chìa ra từ tường, mặt quay về phía camera */}
      <group position={[x - out * 0.9, 2.4, doorZ[1] + 0.12]}>
        <Soft args={[1.75, 0.36, 0.04]} position={[0, 0, -0.03]} color="#0f172a" radius={0.02} />
        <RoomSign position={[0, 0, 0]} text={`${toFloor === 1 ? '⬆' : '⬇'} ${f.label.split(' · ')[0]} ${f.icon}`} />
      </group>
    </group>
  )
}

export function Building() {
  const floor = useStore((s) => s.floor)
  return floor === 1 ? <MediaRoom /> : <Office />
}

export function Office() {
  useStore((s) => s.namesVersion) // danh sách agent đổi thì vẽ lại khoang, bàn, bảng
  const wood = useWoodTexture()
  const root = useMergeStatic()
  return (
    <group ref={root}>
      {/* sàn gỗ */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial map={wood} roughness={0.55} />
      </mesh>
      {/* thảm lối đi có viền */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, -0.9]} receiveShadow>
        <planeGeometry args={[14.6, 1.0]} />
        <meshStandardMaterial color="#64748b" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -0.9]} receiveShadow>
        <planeGeometry args={[14.4, 0.82]} />
        <meshStandardMaterial color="#94a3b8" roughness={1} />
      </mesh>

      {/* tường sau: phần dưới ốp gỗ, nẹp chân tường */}
      <Box args={[16, 3, 0.15]} position={[0, 1.5, -3.5]} color="#f5f1ea" roughness={0.95} />
      <Box args={[16, 0.12, 0.03]} position={[0, 0.06, -3.41]} color="#8b6b4a" />
      {/* tường trái có cửa sổ */}
      <Box args={[0.15, 3, 10]} position={[-8, 1.5, 1.5]} color="#efe9df" roughness={0.95} />
      <Box args={[0.03, 0.12, 10]} position={[-7.91, 0.06, 1.5]} color="#8b6b4a" />
      <Window z={-1.6} />
      <Window z={0.8} />
      {/* luồng nắng từ cửa sổ */}
      <directionalLight position={[-12, 5, 0]} intensity={0.5} color="#fff1d6" />

      {/* bảng trắng sprint */}
      <Soft args={[3.3, 1.2, 0.04]} position={[0, 2.35, -3.42]} color="#94a3b8" radius={0.015} />
      <Box args={[3.2, 1.1, 0.02]} position={[0, 2.35, -3.395]} color="#ffffff" roughness={0.3} />
      {AGENTS.map((a, i) => (
        <group key={a.id} position={[(i - (AGENTS.length - 1) / 2) * Math.min(0.6, 3 / AGENTS.length), 2.35, -3.38]}>
          <Box args={[0.5, 0.06, 0.006]} position={[0, 0.42, 0]} color={a.color} />
          {[0.25, 0.05, -0.15].map((y, j) => (
            <Box key={y} args={[0.18, 0.15, 0.004]} position={[j === 1 ? 0.1 : -0.1, y, 0.004]} rotation={[0, 0, (j - 1) * 0.06]} color={['#fde047', '#f9a8d4', '#86efac'][(i + j) % 3]} />
          ))}
        </group>
      ))}
      <WallClock position={[-3.2, 2.45, -3.4]} />
      {/* tranh treo tường */}
      <group position={[4.2, 2.4, -3.41]}>
        <Box args={[0.9, 0.65, 0.03]} position={[0, 0, 0]} color="#1f2937" />
        <Box args={[0.8, 0.55, 0.005]} position={[0, 0, 0.017]} color="#fef3c7" />
        <mesh position={[-0.1, -0.05, 0.022]}>
          <circleGeometry args={[0.14, 24]} />
          <meshStandardMaterial color="#f97316" />
        </mesh>
        <Box args={[0.6, 0.12, 0.005]} position={[0.05, -0.18, 0.021]} color="#0ea5e9" />
      </group>
      {/* kệ treo tường */}
      <group position={[-6.8, 2.25, -3.38]}>
        <Box args={[1.0, 0.04, 0.22]} position={[0, 0, 0.06]} color="#8b6b4a" />
        {['#b91c1c', '#1d4ed8', '#15803d', '#ca8a04', '#7c3aed'].map((c, i) => (
          <Box key={c} args={[0.06, 0.24 - (i % 2) * 0.04, 0.16]} position={[-0.4 + i * 0.075, 0.14 - (i % 2) * 0.02, 0.06]} color={c} />
        ))}
        <Succulent position={[0.3, 0.02, 0.06]} />
      </group>

      <Cubicles />
      {AGENTS.filter((a) => !inMediaRoom(a)).map((a) => (
        <Workstation key={a.id} owner={a} />
      ))}

      <MeetingArea />
      <Lounge />

      {/* tường phải, cửa cầu thang lên tầng 2 (phòng media) ở cuối lối đi */}
      <Box args={[0.15, 3, MEDIA_ROOM.doorZ[0] + 3.5]} position={[MEDIA_ROOM.x0, 1.5, (MEDIA_ROOM.doorZ[0] - 3.5) / 2]} color="#efe9df" roughness={0.95} />
      <Box args={[0.15, 3, 5 - MEDIA_ROOM.doorZ[1]]} position={[MEDIA_ROOM.x0, 1.5, (MEDIA_ROOM.doorZ[1] + 5) / 2]} color="#efe9df" roughness={0.95} />
      <StairDoor x={MEDIA_ROOM.x0} toFloor={1} />

      {/* góc tiện ích bên phải: máy in, cây nước, tủ hồ sơ */}
      <PrinterStation position={[6.9, 0, 0.5]} rotation={[0, -Math.PI / 2, 0]} />
      <WaterCooler position={[7.1, 0, 1.7]} rotation={[0, -Math.PI / 2, 0]} />
      <FilingCabinet position={[7.05, 0, 2.6]} rotation={[0, -Math.PI / 2, 0]} />
      {/* cửa ra vào, cây treo áo, bình chữa cháy */}
      <Door z={3.4} />
      <CoatRack position={[-7.4, 0, 2.3]} />
      <FireExtinguisher position={[-7.85, 0.75, 4.6]} />
      <AirConditioner position={[-5.0, 2.7, -3.3]} />
      {AGENTS.filter((a) => !inMediaRoom(a)).map((a) => (
        <TrashBin key={a.id} position={[a.seat[0] + 0.6, 0, DESK_Z + 0.05]} />
      ))}

      <Plant position={[-7.45, 0, -2.95]} />
      <Plant position={[7.45, 0, -2.95]} />
      <Plant position={[7.3, 0, 3.6]} scale={1.2} />
      <Plant position={[-7.4, 0, 4.3]} scale={0.9} />
    </group>
  )
}
