import { useRef, type ReactNode, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { MathUtils, type Group } from 'three'
import type { Hobby, Role } from '../data/agents'
import type { AnimState } from '../store'

const R = 0.045 // bán kính "nét" người que
const UPPER_ARM = 0.3
const FOREARM = 0.28
const THIGH = 0.45
const SHIN = 0.45
const HIP_Y = 0.9
const SIT_DROP = 0.4 // hạ hông từ 0.9 xuống 0.5 khi ngồi ghế

function Bone({ len, color }: { len: number; color: string }) {
  return (
    <mesh position={[0, -len / 2, 0]} castShadow>
      <capsuleGeometry args={[R, len, 4, 8]} />
      <meshStandardMaterial color={color} />
    </mesh>
  )
}

/** Khớp xoay; con của nó treo xuống theo trục -y */
function Joint({ jref, position, children }: { jref: RefObject<Group | null>; position: [number, number, number]; children: ReactNode }) {
  return (
    <group ref={jref} position={position}>
      {children}
    </group>
  )
}

function Accessory({ role }: { role: Role }) {
  switch (role) {
    case 'PM': // cà vạt
      return (
        <mesh position={[0, -0.32, 0.05]}>
          <boxGeometry args={[0.06, 0.2, 0.015]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
      )
    case 'FE': // mũ nồi kiểu designer
      return (
        <group position={[0.02, 0.11, 0]} rotation={[0, 0, -0.25]}>
          <mesh scale={[1, 0.35, 1]}>
            <sphereGeometry args={[0.15, 20, 12]} />
            <meshStandardMaterial color="#0f766e" />
          </mesh>
          <mesh position={[0, 0.055, 0]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial color="#0f766e" />
          </mesh>
        </group>
      )
    case 'BE': // tai nghe
      return (
        <group>
          <mesh>
            <torusGeometry args={[0.155, 0.018, 8, 24, Math.PI]} />
            <meshStandardMaterial color="#111827" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.05, 0.05, 0.04, 16]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
          ))}
        </group>
      )
    case 'QA': // kính
      return (
        <group position={[0, 0.02, 0.13]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.05, 0, 0]}>
              <torusGeometry args={[0.035, 0.008, 6, 16]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
          ))}
        </group>
      )
    case 'Tester': // mũ lưỡi trai
      return (
        <group>
          <mesh>
            <sphereGeometry args={[0.148, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#a855f7" />
          </mesh>
          <mesh position={[0, 0.02, 0.15]}>
            <boxGeometry args={[0.2, 0.015, 0.12]} />
            <meshStandardMaterial color="#7e22ce" />
          </mesh>
        </group>
      )
  }
}

const RUBIK_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#f8fafc']

/** Đồ vật cầm trên tay khi ngồi chơi, đặt theo toạ độ hông (trước ngực, ngang tay) */
function HobbyProp({ hobby, spin }: { hobby: Hobby; spin: RefObject<Group | null> }) {
  switch (hobby) {
    case 'read': // sách mở hình chữ V
      return (
        <group position={[0, 0.27, 0.4]} rotation={[-0.7, 0, 0]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.065, 0, 0]} rotation={[0, s * -0.35, 0]}>
              <boxGeometry args={[0.13, 0.19, 0.012]} />
              <meshStandardMaterial color={s < 0 ? '#fef3c7' : '#fde68a'} />
            </mesh>
          ))}
          <mesh position={[0, 0, -0.012]}>
            <boxGeometry args={[0.02, 0.19, 0.01]} />
            <meshStandardMaterial color="#b91c1c" />
          </mesh>
        </group>
      )
    case 'game': // máy chơi game cầm tay
      return (
        <group position={[0, 0.24, 0.42]} rotation={[-0.5, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.22, 0.035, 0.09]} />
            <meshStandardMaterial color="#1f2937" />
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[0.09, 0.005, 0.06]} />
            <meshStandardMaterial color="#0f172a" emissive="#22d3ee" emissiveIntensity={0.8} />
          </mesh>
          {[-0.08, 0.08].map((x) => (
            <mesh key={x} position={[x, 0.022, 0]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshStandardMaterial color={x < 0 ? '#ef4444' : '#3b82f6'} />
            </mesh>
          ))}
        </group>
      )
    case 'rubik':
      return (
        <group ref={spin} position={[0, 0.24, 0.42]}>
          <mesh>
            <boxGeometry args={[0.09, 0.09, 0.09]} />
            {RUBIK_COLORS.map((c, i) => (
              <meshStandardMaterial key={c} attach={`material-${i}`} color={c} />
            ))}
          </mesh>
        </group>
      )
    case 'movie': // xô bỏng ngô trên đùi
      return (
        <group position={[0.13, 0.1, 0.25]}>
          <mesh>
            <cylinderGeometry args={[0.07, 0.05, 0.13, 12]} />
            <meshStandardMaterial color="#dc2626" />
          </mesh>
          <mesh position={[0, 0.075, 0]}>
            <sphereGeometry args={[0.068, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#fef9c3" />
          </mesh>
        </group>
      )
    case 'music': // không cầm gì, lắc lư theo nhạc
      return null
  }
}

interface Props {
  role: Role
  color: string
  hobby: Hobby
  state: AnimState
  /** Lệch pha để các agent không cử động y hệt nhau */
  phase: number
}

export function StickFigure({ role, color, hobby, state, phase }: Props) {
  const spin = useRef<Group>(null)
  const body = useRef<Group>(null)
  const head = useRef<Group>(null)
  const lArm = useRef<Group>(null)
  const lFore = useRef<Group>(null)
  const rArm = useRef<Group>(null)
  const rFore = useRef<Group>(null)
  const lThigh = useRef<Group>(null)
  const lShin = useRef<Group>(null)
  const rThigh = useRef<Group>(null)
  const rShin = useRef<Group>(null)
  const sit = useRef(1)

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + phase
    const k = 1 - Math.exp(-12 * dt)
    const seated = state === 'work' || state === 'listen' || state === 'hobby'
    sit.current = MathUtils.lerp(sit.current, seated ? 1 : 0, k)

    // Tư thế mục tiêu: [rotX, rotZ] cho tay/chân, [rotX, rotY] cho đầu
    let la = [0, -0.1], lf = 0, ra = [0, 0.1], rf = 0
    let lt = 0, ls = 0, rt = 0, rs = 0
    let hx = 0, hy = 0, bob = 0

    switch (state) {
      case 'walk': {
        const s = Math.sin(t * 9)
        lt = s * 0.6
        rt = -s * 0.6
        ls = Math.max(0, -Math.cos(t * 9)) * 0.7
        rs = Math.max(0, Math.cos(t * 9)) * 0.7
        la = [-s * 0.5, -0.15]
        ra = [s * 0.5, 0.15]
        lf = rf = -0.35
        bob = Math.abs(Math.sin(t * 9)) * 0.04
        break
      }
      case 'work': // ngồi gõ phím
        lt = rt = -Math.PI / 2
        ls = rs = Math.PI / 2
        la = [-0.9, -0.1]
        ra = [-0.9, 0.1]
        lf = -0.7 + Math.sin(t * 22) * 0.08
        rf = -0.7 + Math.sin(t * 22 + 1.7) * 0.08
        hx = 0.12 + Math.sin(t * 0.7) * 0.05
        break
      case 'hobby': {
        lt = rt = -Math.PI / 2
        ls = rs = Math.PI / 2
        // mặc định: hai tay cầm đồ vật trước ngực
        la = [-0.6, -0.15]
        ra = [-0.6, 0.15]
        lf = rf = -0.9
        if (hobby === 'read') {
          hx = 0.4
          rf = -0.9 + Math.max(0, Math.sin(t * 0.8)) ** 12 * 0.5 // thỉnh thoảng lật trang
        } else if (hobby === 'game') {
          hx = 0.35
          lf = -0.9 + Math.sin(t * 26) * 0.05
          rf = -0.9 + Math.sin(t * 23 + 1) * 0.05
        } else if (hobby === 'rubik') {
          hx = 0.3
          lf = rf = -1.0
          if (spin.current) spin.current.rotation.set(t * 0.9, t * 1.3, 0)
        } else if (hobby === 'music') {
          la = [-0.4, -0.1]
          ra = [-0.4, 0.1]
          hx = Math.sin(t * 6) * 0.15
          hy = Math.sin(t * 3) * 0.2
          bob = Math.abs(Math.sin(t * 6)) * 0.015
        } else if (hobby === 'movie') {
          const popcorn = Math.max(0, Math.sin(t * 1.3)) ** 4 // đưa bỏng ngô lên miệng
          la = [-0.4, -0.1]
          ra = [-0.5 - popcorn * 0.6, 0.1]
          lf = -0.9
          rf = -0.9 - popcorn * 1.2
          hx = -0.05
        }
        break
      }
      case 'listen': // ngồi, quay đầu sang khách
        lt = rt = -Math.PI / 2
        ls = rs = Math.PI / 2
        la = [-0.4, -0.1]
        ra = [-0.4, 0.1]
        lf = rf = -0.9
        hy = -0.7
        hx = Math.sin(t * 5) * 0.08
        break
      case 'talk': // đứng, tay phải khua khi nói
        ra = [-0.9 + Math.sin(t * 4) * 0.3, 0.3 + Math.sin(t * 3) * 0.15]
        rf = -0.7
        la = [0, -0.12]
        hx = Math.sin(t * 6) * 0.06
        break
      case 'idle':
        la = [0, -0.1 - Math.sin(t * 2) * 0.03]
        ra = [0, 0.1 + Math.sin(t * 2) * 0.03]
        break
    }

    const lerpX = (g: Group | null, x: number) => g && (g.rotation.x = MathUtils.lerp(g.rotation.x, x, k))
    const lerpZ = (g: Group | null, z: number) => g && (g.rotation.z = MathUtils.lerp(g.rotation.z, z, k))
    lerpX(lArm.current, la[0]); lerpZ(lArm.current, la[1])
    lerpX(rArm.current, ra[0]); lerpZ(rArm.current, ra[1])
    lerpX(lFore.current, lf); lerpX(rFore.current, rf)
    lerpX(lThigh.current, lt); lerpX(rThigh.current, rt)
    lerpX(lShin.current, ls); lerpX(rShin.current, rs)
    if (head.current) {
      lerpX(head.current, hx)
      head.current.rotation.y = MathUtils.lerp(head.current.rotation.y, hy, k)
    }
    if (body.current) body.current.position.y = -SIT_DROP * sit.current + bob
  })

  return (
    <group ref={body}>
      <group position={[0, HIP_Y, 0]}>
        {/* thân */}
        <mesh position={[0, 0.27, 0]} castShadow>
          <capsuleGeometry args={[R, 0.5, 4, 8]} />
          <meshStandardMaterial color={color} />
        </mesh>

        {/* đầu */}
        <group ref={head} position={[0, 0.72, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.14, 24, 16]} />
            <meshStandardMaterial color="#fef3c7" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.048, 0.02, 0.128]}>
              <sphereGeometry args={[0.018, 8, 8]} />
              <meshStandardMaterial color="#111827" />
            </mesh>
          ))}
          {role !== 'PM' && <Accessory role={role} />}
        </group>
        {role === 'PM' && (
          <group position={[0, 0.52, 0]}>
            <Accessory role={role} />
          </group>
        )}

        {state === 'hobby' && <HobbyProp hobby={hobby} spin={spin} />}

        {/* tay */}
        <Joint jref={lArm} position={[-0.07, 0.5, 0]}>
          <Bone len={UPPER_ARM} color={color} />
          <Joint jref={lFore} position={[0, -UPPER_ARM, 0]}>
            <Bone len={FOREARM} color={color} />
          </Joint>
        </Joint>
        <Joint jref={rArm} position={[0.07, 0.5, 0]}>
          <Bone len={UPPER_ARM} color={color} />
          <Joint jref={rFore} position={[0, -UPPER_ARM, 0]}>
            <Bone len={FOREARM} color={color} />
          </Joint>
        </Joint>

        {/* chân */}
        <Joint jref={lThigh} position={[-0.07, 0, 0]}>
          <Bone len={THIGH} color={color} />
          <Joint jref={lShin} position={[0, -THIGH, 0]}>
            <Bone len={SHIN} color={color} />
          </Joint>
        </Joint>
        <Joint jref={rThigh} position={[0.07, 0, 0]}>
          <Bone len={THIGH} color={color} />
          <Joint jref={rShin} position={[0, -THIGH, 0]}>
            <Bone len={SHIN} color={color} />
          </Joint>
        </Joint>
      </group>
    </group>
  )
}
