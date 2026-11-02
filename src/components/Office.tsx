import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Group, type MeshStandardMaterial } from 'three'
import { AGENTS, CUBICLE_FRONT_Z, CUBICLE_WIDTH, DESK_Z, MEETING_CENTER, SEAT_Z, type AgentDef } from '../data/agents'
import { useStore } from '../store'

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

/** Màn hình: hiện code; đổi màu liên tục như đang chiếu phim khi chủ khoang xem phim */
function Screen({ owner, position }: { owner: AgentDef; position: V3 }) {
  const movie = useRef<MeshStandardMaterial>(null)
  const watching = useStore((s) => owner.hobby === 'movie' && s.agents[owner.id].state === 'hobby')
  const tex = useMemo(() => codeTexture(owner.color), [owner.color])
  useFrame(({ clock }) => {
    if (!movie.current || !watching) return
    const t = clock.elapsedTime
    movie.current.emissive.setHSL((t * 0.07) % 1, 0.7, 0.35 + Math.sin(t * 5) * 0.1)
  })
  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[0.7, 0.4]} />
        <meshStandardMaterial map={tex} emissiveMap={tex} emissive="#ffffff" emissiveIntensity={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.001]} visible={watching}>
        <planeGeometry args={[0.7, 0.4]} />
        <meshStandardMaterial ref={movie} color="#000" emissive="#6366f1" emissiveIntensity={0.9} />
      </mesh>
    </group>
  )
}

/** Ghế văn phòng: đệm màu theo chủ, chân sao 5 cánh có bánh xe */
function Chair({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0, z]}>
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
        <group position={[x + 0.6, 0.78, z - 0.2]}>
          {['#b91c1c', '#1d4ed8', '#ca8a04'].map((c, i) => (
            <Box key={c} args={[0.24 - i * 0.02, 0.045, 0.17]} position={[0, 0.025 + i * 0.047, 0]} rotation={[0, i * 0.2 - 0.2, 0]} color={c} />
          ))}
        </group>
      )
    case 'game': // tay cầm chơi game
      return (
        <group position={[x + 0.58, 0.8, z + 0.05]} rotation={[0, 0.4, 0]}>
          <Soft args={[0.16, 0.03, 0.08]} position={[0, 0, 0]} color="#111827" radius={0.012} />
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[0.04, 0.005, 0.02]} />
            <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1} />
          </mesh>
        </group>
      )
    case 'music': // loa nhỏ
      return (
        <group position={[x + 0.6, 0.78, z - 0.2]}>
          <Soft args={[0.12, 0.2, 0.12]} position={[0, 0.1, 0]} color="#334155" radius={0.02} />
          <Cyl args={[0.04, 0.04, 0.01]} position={[0, 0.12, 0.061]} rotation={[Math.PI / 2, 0, 0]} color="#0f172a" />
        </group>
      )
    case 'movie': // poster phim mini
      return (
        <group position={[x + 0.6, 0.78, z - 0.25]} rotation={[-0.15, -0.3, 0]}>
          <Box args={[0.16, 0.22, 0.015]} position={[0, 0.11, 0]} color="#7f1d1d" />
          <Box args={[0.12, 0.08, 0.005]} position={[0, 0.14, 0.009]} color="#fbbf24" emissive="#f59e0b" />
        </group>
      )
    case 'rubik': // khối rubik để bàn
      return (
        <mesh position={[x + 0.6, 0.82, z - 0.15]} rotation={[0, 0.6, 0]} castShadow>
          <boxGeometry args={[0.08, 0.08, 0.08]} />
          {['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#f8fafc'].map((c, i) => (
            <meshStandardMaterial key={c} attach={`material-${i}`} color={c} />
          ))}
        </mesh>
      )
  }
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
      {/* màn hình viền mỏng trên chân đế */}
      <Soft args={[0.76, 0.45, 0.03]} position={[x, 1.1, DESK_Z - 0.25]} color="#111827" radius={0.012} roughness={0.4} />
      <Screen owner={owner} position={[x, 1.1, DESK_Z - 0.233]} />
      <Box args={[0.05, 0.25, 0.03]} position={[x, 0.9, DESK_Z - 0.29]} color="#9ca3af" metalness={0.7} roughness={0.3} />
      <Soft args={[0.24, 0.015, 0.16]} position={[x, 0.785, DESK_Z - 0.27]} color="#9ca3af" radius={0.006} />
      {/* bàn phím + chuột + lót chuột */}
      <Soft args={[0.46, 0.02, 0.15]} position={[x, 0.785, DESK_Z + 0.18]} color="#f1f5f9" radius={0.008} />
      <Box args={[0.22, 0.004, 0.2]} position={[x + 0.36, 0.777, DESK_Z + 0.18]} color="#1e293b" />
      <mesh position={[x + 0.36, 0.79, DESK_Z + 0.18]} scale={[0.7, 0.45, 1]} castShadow>
        <sphereGeometry args={[0.045, 14, 10]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.4} />
      </mesh>
      {/* cốc cà phê có quai */}
      <group position={[x - 0.6, 0.775, DESK_Z + 0.15]}>
        <Cyl args={[0.04, 0.035, 0.1]} position={[0, 0.05, 0]} color={owner.color} roughness={0.35} />
        <mesh position={[0.045, 0.05, 0]}>
          <torusGeometry args={[0.022, 0.007, 6, 12]} />
          <meshStandardMaterial color={owner.color} roughness={0.35} />
        </mesh>
        <Cyl args={[0.034, 0.034, 0.005]} position={[0, 0.092, 0]} color="#3f2a1d" />
      </group>
      <DeskLamp position={[x - 0.68, 0.775, DESK_Z - 0.28]} />
      <Succulent position={[x + 0.25 + (owner.hobby === 'read' || owner.hobby === 'music' || owner.hobby === 'movie' ? 0.1 : 0.35), 0.775, DESK_Z - 0.3]} />
      <DeskItems owner={owner} x={x} />
      {/* giấy note dán trên viền màn hình */}
      <Box args={[0.06, 0.06, 0.003]} position={[x + 0.34, 1.29, DESK_Z - 0.232]} rotation={[0, 0, 0.1]} color="#fde047" />
      <Chair x={x} z={SEAT_Z + 0.05} color={owner.color} />
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
    <group position={position}>
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
function Cubicles() {
  const depth = CUBICLE_FRONT_Z - PANEL_BACK_Z
  const midZ = (CUBICLE_FRONT_Z + PANEL_BACK_Z) / 2
  const xs = AGENTS.map((a) => a.seat[0])
  const walls = [...xs.map((x) => x - CUBICLE_WIDTH / 2), xs[xs.length - 1] + CUBICLE_WIDTH / 2]
  return (
    <group>
      {AGENTS.map((a) => (
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

export function Office() {
  const wood = useWoodTexture()
  return (
    <group>
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
        <group key={a.id} position={[(i - (AGENTS.length - 1) / 2) * 0.6, 2.35, -3.38]}>
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
      {AGENTS.map((a) => (
        <Workstation key={a.id} owner={a} />
      ))}

      <MeetingArea />
      <Lounge />

      <Plant position={[-7.45, 0, -2.95]} />
      <Plant position={[7.45, 0, -2.95]} />
      <Plant position={[7.3, 0, 3.6]} scale={1.2} />
      <Plant position={[-7.4, 0, 4.3]} scale={0.9} />
    </group>
  )
}
