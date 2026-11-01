import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { MeshStandardMaterial } from 'three'
import { AGENTS, CUBICLE_FRONT_Z, CUBICLE_WIDTH, DESK_Z, MEETING_CENTER, SEAT_Z, type AgentDef } from '../data/agents'
import { useStore } from '../store'

function Box({ args, position, color, emissive }: { args: [number, number, number]; position: [number, number, number]; color: string; emissive?: string }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} emissive={emissive ?? '#000'} emissiveIntensity={emissive ? 0.6 : 0} />
    </mesh>
  )
}

/** Màn hình: đổi màu liên tục như đang chiếu phim khi chủ khoang đang xem phim */
function Screen({ owner, position, color }: { owner: AgentDef; position: [number, number, number]; color: string }) {
  const mat = useRef<MeshStandardMaterial>(null)
  const watching = useStore((s) => owner.hobby === 'movie' && s.agents[owner.id].state === 'hobby')
  useFrame(({ clock }) => {
    if (!mat.current) return
    if (watching) {
      const t = clock.elapsedTime
      mat.current.emissive.setHSL((t * 0.07) % 1, 0.7, 0.35 + Math.sin(t * 5) * 0.1)
    } else {
      mat.current.emissive.set(color)
    }
  })
  return (
    <mesh position={position}>
      <boxGeometry args={[0.68, 0.38, 0.01]} />
      <meshStandardMaterial ref={mat} color="#0f172a" emissive={color} emissiveIntensity={0.6} />
    </mesh>
  )
}

function Workstation({ owner }: { owner: AgentDef }) {
  const x = owner.seat[0]
  const color = owner.color
  return (
    <group>
      {/* bàn */}
      <Box args={[1.6, 0.06, 0.8]} position={[x, 0.75, DESK_Z]} color="#c8a27a" />
      {[-0.72, 0.72].map((dx) => (
        <Box key={dx} args={[0.06, 0.75, 0.7]} position={[x + dx, 0.375, DESK_Z]} color="#8b6b4a" />
      ))}
      {/* màn hình */}
      <Box args={[0.75, 0.45, 0.04]} position={[x, 1.08, DESK_Z - 0.25]} color="#1f2937" />
      <Screen owner={owner} position={[x, 1.08, DESK_Z - 0.225]} color={color} />
      <Box args={[0.06, 0.18, 0.06]} position={[x, 0.86, DESK_Z - 0.27]} color="#374151" />
      {/* bàn phím + chuột */}
      <Box args={[0.45, 0.02, 0.15]} position={[x, 0.79, DESK_Z + 0.2]} color="#e5e7eb" />
      <Box args={[0.06, 0.03, 0.1]} position={[x + 0.35, 0.79, DESK_Z + 0.2]} color="#e5e7eb" />
      {/* cốc cà phê */}
      <mesh position={[x - 0.55, 0.83, DESK_Z + 0.1]} castShadow>
        <cylinderGeometry args={[0.04, 0.035, 0.1, 12]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* ghế */}
      <Box args={[0.46, 0.05, 0.46]} position={[x, 0.45, SEAT_Z + 0.05]} color="#334155" />
      <Box args={[0.46, 0.5, 0.05]} position={[x, 0.72, SEAT_Z + 0.28]} color="#334155" />
      <mesh position={[x, 0.22, SEAT_Z + 0.05]}>
        <cylinderGeometry args={[0.03, 0.03, 0.44, 8]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      <mesh position={[x, 0.02, SEAT_Z + 0.05]}>
        <cylinderGeometry args={[0.24, 0.24, 0.04, 16]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
    </group>
  )
}

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.16, 0.4, 16]} />
        <meshStandardMaterial color="#b45309" />
      </mesh>
      <mesh position={[0, 0.7, 0]} castShadow>
        <icosahedronGeometry args={[0.38, 1]} />
        <meshStandardMaterial color="#16a34a" flatShading />
      </mesh>
    </group>
  )
}

function MeetingArea() {
  const [cx, cz] = MEETING_CENTER
  return (
    <group position={[cx, 0, cz]}>
      {/* thảm tròn */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} receiveShadow>
        <circleGeometry args={[1.9, 48]} />
        <meshStandardMaterial color="#c7d2fe" />
      </mesh>
      {/* bàn tròn đứng (standup) */}
      <mesh position={[0, 1.0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.6, 0.6, 0.05, 32]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 1.0, 12]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.04, 24]} />
        <meshStandardMaterial color="#64748b" />
      </mesh>
      {/* laptop + giấy note trên bàn */}
      <Box args={[0.32, 0.015, 0.22]} position={[0.1, 1.035, 0.05]} color="#9ca3af" />
      <Box args={[0.32, 0.2, 0.01]} position={[0.1, 1.14, -0.06]} color="#1f2937" emissive="#38bdf8" />
      <Box args={[0.12, 0.005, 0.12]} position={[-0.3, 1.03, 0.1]} color="#fde047" />
      {/* TV trình chiếu bên phải, quay về bàn họp */}
      <group position={[2.1, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <Box args={[1.6, 0.9, 0.06]} position={[0, 1.6, 0]} color="#111827" />
        <Box args={[1.5, 0.8, 0.01]} position={[0, 1.6, 0.035]} color="#0f172a" emissive="#6366f1" />
        <Box args={[0.08, 1.15, 0.08]} position={[0, 0.575, -0.05]} color="#374151" />
      </group>
    </group>
  )
}

const PANEL_HEIGHT = 1.25
const PANEL_BACK_Z = -3.42

/** Khoang ngồi: sàn tô màu theo vai trò, vách ngăn giữa các khoang, bảng tên trên tường */
function Cubicles() {
  const depth = CUBICLE_FRONT_Z - PANEL_BACK_Z
  const midZ = (CUBICLE_FRONT_Z + PANEL_BACK_Z) / 2
  const xs = AGENTS.map((a) => a.seat[0])
  const walls = [...xs.map((x) => x - CUBICLE_WIDTH / 2), xs[xs.length - 1] + CUBICLE_WIDTH / 2]
  return (
    <group>
      {AGENTS.map((a) => (
        <group key={a.id}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[a.seat[0], 0.004, midZ]} receiveShadow>
            <planeGeometry args={[CUBICLE_WIDTH - 0.08, depth]} />
            <meshStandardMaterial color={a.color} transparent opacity={0.14} />
          </mesh>
          {/* bảng tên khoang trên tường */}
          <Box args={[1.1, 0.16, 0.02]} position={[a.seat[0], 1.55, -3.41]} color={a.color} />
        </group>
      ))}
      {walls.map((x) => (
        <group key={x} position={[x, 0, midZ]}>
          <Box args={[0.06, PANEL_HEIGHT, depth]} position={[0, PANEL_HEIGHT / 2, 0]} color="#cbd5e1" />
          {/* nẹp nhôm trên đỉnh và đầu vách */}
          <Box args={[0.08, 0.03, depth]} position={[0, PANEL_HEIGHT, 0]} color="#94a3b8" />
          <Box args={[0.08, PANEL_HEIGHT, 0.04]} position={[0, PANEL_HEIGHT / 2, depth / 2]} color="#94a3b8" />
        </group>
      ))}
    </group>
  )
}

export function Office() {
  return (
    <group>
      {/* sàn */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16, 10]} />
        <meshStandardMaterial color="#e2e8f0" />
      </mesh>
      {/* thảm lối đi */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, -0.9]} receiveShadow>
        <planeGeometry args={[14.4, 0.9]} />
        <meshStandardMaterial color="#cbd5e1" />
      </mesh>
      {/* tường */}
      <Box args={[16, 3, 0.15]} position={[0, 1.5, -3.5]} color="#f8fafc" />
      <Box args={[0.15, 3, 10]} position={[-8, 1.5, 1.5]} color="#f1f5f9" />
      {/* bảng trắng + logo phòng */}
      <Box args={[3.2, 1.1, 0.04]} position={[0, 2.25, -3.4]} color="#ffffff" />
      <Box args={[3.3, 1.2, 0.02]} position={[0, 2.25, -3.42]} color="#94a3b8" />
      {AGENTS.map((a, i) => (
        <Box key={a.id} args={[0.45, 0.35, 0.01]} position={[(i - (AGENTS.length - 1) / 2) * 0.58, 2.3, -3.37]} color={a.color} />
      ))}

      <Cubicles />
      {AGENTS.map((a) => (
        <Workstation key={a.id} owner={a} />
      ))}

      <MeetingArea />

      <Plant position={[-7.55, 0, -2.9]} />
      <Plant position={[7.55, 0, -2.9]} />
      <Plant position={[-7.4, 0, 3]} />
    </group>
  )
}
