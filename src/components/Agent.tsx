import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { MathUtils, type Group } from 'three'
import { HOBBIES, type AgentDef } from '../data/agents'
import { useStore } from '../store'
import { facing, motions, positions, yaws } from '../sim/motion'
import { StickFigure } from './StickFigure'

const WALK_SPEED = 1.6 // m/s

function lerpAngle(a: number, b: number, t: number) {
  const d = MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI
  return a + d * t
}

export function Agent({ def, index }: { def: AgentDef; index: number }) {
  const root = useRef<Group>(null)
  const yaw = useRef(Math.PI) // ban đầu ngồi quay mặt vào bàn
  const runtime = useStore((s) => s.agents[def.id])
  const selected = useStore((s) => s.selected === def.id)
  const select = useStore((s) => s.select)
  useStore((s) => s.namesVersion) // vẽ lại nhãn tên khi đổi tên ở trang cài đặt
  // Mount <Html> sau frame đầu: mount ngay thì root của nó có thể bị huỷ ở lần re-render đầu tiên (nhãn trống)
  const [labelReady, setLabelReady] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setLabelReady(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  useFrame((_, dt) => {
    const pos = positions[def.id]
    const m = motions[def.id]
    if (m) {
      const target = m.path[0]
      const dx = target.x - pos.x
      const dz = target.z - pos.z
      const d = Math.hypot(dx, dz)
      const step = WALK_SPEED * useStore.getState().speed * dt
      if (d <= step) {
        pos.copy(target)
        m.path.shift()
        if (m.path.length === 0) {
          delete motions[def.id]
          if (m.faceTo) yaw.current = Math.atan2(m.faceTo.x - pos.x, m.faceTo.z - pos.z)
          m.resolve()
        }
      } else {
        pos.x += (dx / d) * step
        pos.z += (dz / d) * step
        yaw.current = Math.atan2(dx, dz)
      }
    } else if (facing[def.id]) {
      const f = facing[def.id]!
      yaw.current = Math.atan2(f.x - pos.x, f.z - pos.z)
      delete facing[def.id]
    }
    const g = root.current
    if (!g) return
    g.position.set(pos.x, 0, pos.z)
    g.rotation.y = lerpAngle(g.rotation.y, yaw.current, 1 - Math.exp(-6 * dt))
    yaws[def.id] = g.rotation.y
  })

  return (
    <group
      ref={root}
      rotation={[0, Math.PI, 0]}
      onClick={(e) => {
        e.stopPropagation()
        select(selected ? null : def.id)
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'auto')}
    >
      <StickFigure
        role={def.id}
        color={def.color}
        hobby={def.hobby}
        state={runtime.state}
        mood={!runtime.bubble ? 'quiet' : runtime.bubble.startsWith('💭') ? 'think' : 'speak'}
        phase={index * 1.37}
      />

      {/* vùng click rộng hơn nét người que */}
      <mesh position={[0, 0.9, 0]} visible={false}>
        <boxGeometry args={[0.6, 1.8, 0.6]} />
      </mesh>

      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.38, 0.46, 40]} />
          <meshBasicMaterial color={def.color} />
        </mesh>
      )}

      {labelReady && (
        <Html position={[0, 2.05, 0]} center distanceFactor={9} zIndexRange={[10, 0]} pointerEvents="none">
          <div className="tag">
            {runtime.chat && <div className="bubble chat">{runtime.chat}</div>}
            {runtime.bubble && <div className="bubble">{runtime.bubble}</div>}
            <div className="name" style={{ background: def.color }}>
              {runtime.state === 'hobby' && `${HOBBIES[def.hobby].emoji} `}
              {def.id} · {def.name}
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}
