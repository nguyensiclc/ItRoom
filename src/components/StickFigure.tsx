import { useRef, type ReactNode, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { MathUtils, Vector3, type Group } from 'three'
import type { Hobby, Role } from '../data/agents'
import type { AnimState } from '../store'
import { motions } from '../sim/motion'

const UPPER_ARM = 0.3
const FOREARM = 0.26
const THIGH = 0.45
const SHIN = 0.42
const HIP_Y = 0.9
const _l = new Vector3()
const _r = new Vector3()
const SIT_DROP = 0.4 // hạ hông từ 0.9 xuống 0.5 khi ngồi ghế
const SHOULDER_X = 0.16
const HEAD_SCALE = 1.2 // đầu to kiểu chibi; phụ kiện vẽ theo đầu bán kính 0.14 rồi phóng theo

type HairStyle = 'long' | 'spiky' | 'short' | 'bob'

/** Ngoại hình riêng từng người */
const LOOKS: Record<Role, { skin: string; hair: string; style: HairStyle; pants: string; shoes: string }> = {
  PM: { skin: '#f6d3b3', hair: '#3b2416', style: 'long', pants: '#1e293b', shoes: '#111827' },
  BE: { skin: '#e9bb8f', hair: '#111111', style: 'spiky', pants: '#334155', shoes: '#f8fafc' },
  FE: { skin: '#f1c7a1', hair: '#2b1a10', style: 'short', pants: '#3f5f8f', shoes: '#7c2d12' },
  QA: { skin: '#f8d8bd', hair: '#5b3420', style: 'bob', pants: '#475569', shoes: '#be123c' },
  Tester: { skin: '#dfac83', hair: '#1c1917', style: 'short', pants: '#3f3f46', shoes: '#f8fafc' },
}

function Limb({ len, radius, color }: { len: number; radius: number; color: string }) {
  return (
    <mesh position={[0, -len / 2, 0]} castShadow>
      <capsuleGeometry args={[radius, len, 6, 12]} />
      <meshStandardMaterial color={color} roughness={0.75} />
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

/** Chỏm cầu: theta tính từ đỉnh xuống */
function Cap({ r, theta, color, rotation, position }: { r: number; theta: number; color: string; rotation?: [number, number, number]; position?: [number, number, number] }) {
  return (
    <mesh rotation={rotation} position={position} castShadow>
      <sphereGeometry args={[r, 24, 14, 0, Math.PI * 2, 0, theta]} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  )
}

function Hair({ style, color }: { style: HairStyle; color: string }) {
  switch (style) {
    case 'long': // tóc dài buông sau lưng
      return (
        <group>
          <Cap r={0.15} theta={1.3} color={color} position={[0, 0.005, -0.008]} />
          <Cap r={0.152} theta={1.3} color={color} rotation={[-1.3, 0, 0]} />
          <mesh position={[0, -0.12, -0.08]} castShadow>
            <capsuleGeometry args={[0.1, 0.16, 6, 12]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
        </group>
      )
    case 'bob': // tóc ngắn ngang cằm + búi nhỏ
      return (
        <group>
          <Cap r={0.152} theta={1.3} color={color} position={[0, 0, -0.006]} />
          <Cap r={0.155} theta={1.5} color={color} rotation={[-1.4, 0, 0]} />
          <mesh position={[0, 0.07, -0.16]} castShadow>
            <sphereGeometry args={[0.055, 12, 10]} />
            <meshStandardMaterial color={color} roughness={0.85} />
          </mesh>
        </group>
      )
    case 'spiky': // tóc dựng
      return (
        <group>
          <Cap r={0.148} theta={1.2} color={color} position={[0, 0.004, -0.01]} />
          {[-0.07, -0.025, 0.025, 0.07].map((x, i) => (
            <mesh key={x} position={[x, 0.13, 0.03 - i * 0.02]} rotation={[-0.35, 0, -x * 4]} castShadow>
              <coneGeometry args={[0.035, 0.09, 6]} />
              <meshStandardMaterial color={color} roughness={0.85} />
            </mesh>
          ))}
        </group>
      )
    case 'short':
      return <Cap r={0.148} theta={1.15} color={color} position={[0, 0.006, -0.012]} />
  }
}

/** Mắt (biết chớp), lông mày, miệng cười, má hồng, tai */
function Face({ eyes, skin }: { eyes: RefObject<Group | null>; skin: string }) {
  return (
    <group>
      <group ref={eyes} position={[0, 0.012, 0.124]}>
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 0.05, 0, 0]}>
            <mesh scale={[1, 1.25, 0.6]}>
              <sphereGeometry args={[0.021, 12, 10]} />
              <meshStandardMaterial color="#1f2937" roughness={0.3} />
            </mesh>
            <mesh position={[0.006, 0.008, 0.012]}>
              <sphereGeometry args={[0.006, 6, 6]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}
      </group>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.05, 0.055, 0.127]} rotation={[0, 0, s * -0.12]}>
          <boxGeometry args={[0.038, 0.008, 0.008]} />
          <meshStandardMaterial color="#3f2a1d" />
        </mesh>
      ))}
      <mesh position={[0, -0.036, 0.13]} rotation={[0.25, 0, Math.PI]}>
        <torusGeometry args={[0.024, 0.006, 6, 16, Math.PI]} />
        <meshStandardMaterial color="#9f1239" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.083, -0.025, 0.112]} scale={[1, 0.6, 0.3]}>
          <sphereGeometry args={[0.022, 10, 8]} />
          <meshStandardMaterial color="#fb7185" transparent opacity={0.45} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.138, 0, 0]} scale={[0.5, 1, 0.8]}>
          <sphereGeometry args={[0.03, 10, 8]} />
          <meshStandardMaterial color={skin} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

/** Phụ kiện đội trên đầu (toạ độ theo đầu bán kính 0.14) */
function HeadAccessory({ role }: { role: Role }) {
  switch (role) {
    case 'FE': // mũ nồi kiểu designer
      return (
        <group position={[0.02, 0.12, 0]} rotation={[0, 0, -0.25]}>
          <mesh scale={[1, 0.35, 1]} castShadow>
            <sphereGeometry args={[0.16, 24, 12]} />
            <meshStandardMaterial color="#0f766e" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.058, 0]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial color="#0f766e" />
          </mesh>
        </group>
      )
    case 'BE': // tai nghe gaming có đèn
      return (
        <group>
          <mesh>
            <torusGeometry args={[0.165, 0.016, 8, 32, Math.PI]} />
            <meshStandardMaterial color="#111827" metalness={0.4} roughness={0.4} />
          </mesh>
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.157, -0.01, 0]} rotation={[0, 0, Math.PI / 2]}>
              <mesh>
                <cylinderGeometry args={[0.055, 0.055, 0.045, 20]} />
                <meshStandardMaterial color="#111827" metalness={0.4} roughness={0.4} />
              </mesh>
              <mesh position={[0, -s * 0.024, 0]}>
                <cylinderGeometry args={[0.035, 0.035, 0.005, 20]} />
                <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.2} />
              </mesh>
            </group>
          ))}
        </group>
      )
    case 'QA': // kính gọng tròn
      return (
        <group position={[0, 0.012, 0.138]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.05, 0, 0]}>
              <torusGeometry args={[0.036, 0.006, 8, 20]} />
              <meshStandardMaterial color="#7c2d12" metalness={0.3} roughness={0.4} />
            </mesh>
          ))}
          <mesh>
            <boxGeometry args={[0.03, 0.005, 0.005]} />
            <meshStandardMaterial color="#7c2d12" />
          </mesh>
        </group>
      )
    case 'Tester': // mũ lưỡi trai đội lệch
      return (
        <group rotation={[0, 0.25, 0]}>
          <Cap r={0.153} theta={Math.PI / 2} color="#a855f7" position={[0, 0.01, 0]} />
          <mesh position={[0, 0.025, 0.14]} rotation={[0.12, 0, 0]} scale={[1, 1, 0.75]} castShadow>
            <cylinderGeometry args={[0.12, 0.12, 0.012, 24, 1, false, -Math.PI / 2, Math.PI]} />
            <meshStandardMaterial color="#7e22ce" />
          </mesh>
          <mesh position={[0, 0.163, 0]}>
            <sphereGeometry args={[0.015, 8, 8]} />
            <meshStandardMaterial color="#7e22ce" />
          </mesh>
        </group>
      )
    default:
      return null
  }
}

/** Chi tiết trên áo theo vai trò (toạ độ theo hông) */
function Outfit({ role, color }: { role: Role; color: string }) {
  switch (role) {
    case 'PM': // vest màu, cổ sơ mi trắng, cà vạt đỏ
      return (
        <group>
          <mesh position={[0, 0.45, 0.095]} rotation={[0.25, 0, 0]}>
            <boxGeometry args={[0.09, 0.13, 0.02]} />
            <meshStandardMaterial color="#f8fafc" />
          </mesh>
          <mesh position={[0, 0.38, 0.12]} rotation={[0.1, 0, 0]}>
            <boxGeometry args={[0.032, 0.17, 0.012]} />
            <meshStandardMaterial color="#dc2626" />
          </mesh>
        </group>
      )
    case 'BE': // mũ hoodie sau gáy + dây rút
      return (
        <group>
          <mesh position={[0, 0.56, -0.07]} rotation={[0.9, 0, 0]}>
            <torusGeometry args={[0.085, 0.04, 8, 16]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.035, 0.43, 0.118]}>
              <cylinderGeometry args={[0.006, 0.006, 0.12, 6]} />
              <meshStandardMaterial color="#f8fafc" />
            </mesh>
          ))}
        </group>
      )
    case 'FE': // khăn quàng
      return (
        <mesh position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.085, 0.035, 8, 20]} />
          <meshStandardMaterial color="#fbbf24" roughness={0.9} />
        </mesh>
      )
    case 'QA': // thẻ nhân viên đeo cổ
      return (
        <group>
          <mesh position={[0, 0.47, 0.085]} rotation={[-0.35, 0, Math.PI]}>
            <torusGeometry args={[0.07, 0.005, 6, 16, Math.PI]} />
            <meshStandardMaterial color="#1d4ed8" />
          </mesh>
          <mesh position={[0, 0.36, 0.122]}>
            <boxGeometry args={[0.06, 0.08, 0.008]} />
            <meshStandardMaterial color="#f8fafc" />
          </mesh>
        </group>
      )
    case 'Tester': // hình con bọ trên áo phông
      return (
        <mesh position={[0, 0.36, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.006, 16]} />
          <meshStandardMaterial color="#facc15" />
        </mesh>
      )
  }
}

const RUBIK_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#f8fafc']

/** Đồ vật cầm trên tay khi ngồi chơi; mỗi frame được đặt vào giữa hai bàn tay (bỏng ngô: tay trái) */
function HobbyProp({ hobby, spin }: { hobby: Hobby; spin: RefObject<Group | null> }) {
  switch (hobby) {
    case 'read': // sách mở hình chữ V
      return (
        <group rotation={[-0.7, 0, 0]}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.07, 0, 0]} rotation={[0, s * -0.35, 0]}>
              <boxGeometry args={[0.14, 0.2, 0.012]} />
              <meshStandardMaterial color={s < 0 ? '#fef3c7' : '#fde68a'} />
            </mesh>
          ))}
          <mesh position={[0, 0, -0.012]}>
            <boxGeometry args={[0.02, 0.2, 0.01]} />
            <meshStandardMaterial color="#b91c1c" />
          </mesh>
        </group>
      )
    case 'game': // máy chơi game cầm tay
      return (
        <group rotation={[-0.5, 0, 0]}>
          <mesh>
            <boxGeometry args={[0.26, 0.035, 0.1]} />
            <meshStandardMaterial color="#1f2937" />
          </mesh>
          <mesh position={[0, 0.02, 0]}>
            <boxGeometry args={[0.11, 0.005, 0.07]} />
            <meshStandardMaterial color="#0f172a" emissive="#22d3ee" emissiveIntensity={0.9} />
          </mesh>
          {[-0.095, 0.095].map((x) => (
            <mesh key={x} position={[x, 0.022, 0]}>
              <sphereGeometry args={[0.013, 8, 8]} />
              <meshStandardMaterial color={x < 0 ? '#ef4444' : '#3b82f6'} />
            </mesh>
          ))}
        </group>
      )
    case 'rubik':
      return (
        <group ref={spin}>
          <mesh>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            {RUBIK_COLORS.map((c, i) => (
              <meshStandardMaterial key={c} attach={`material-${i}`} color={c} />
            ))}
          </mesh>
        </group>
      )
    case 'movie': // xô bỏng ngô trên đùi
      return (
        <group position={[0.07, 0.04, 0]}>
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
  /** Khi trò chuyện: đang nói, đang nghĩ (💭) hay đang nghe người kia */
  mood?: Mood
  /** Lệch pha để các agent không cử động y hệt nhau */
  phase: number
}

type Mood = 'speak' | 'think' | 'quiet'

/** Đang rê chuột (khoảng 2,4 giây trong mỗi 7 giây làm việc); t = thời gian + pha của agent, dùng chung với con chuột trên bàn */
export const usingMouse = (t: number) => t % 7 > 4.6

/** Vị trí rê chuột lệch khỏi chỗ đặt chuột, khớp với nhịp tay trong tư thế làm việc */
export const mouseOffset = (t: number): [number, number] => [Math.sin(t * 2.6) * 0.025, Math.cos(t * 2.6) * 0.02]

/** Tư thế tay: [rotX, rotZ] cánh tay trái/phải, rotX cẳng tay, gật đầu hx, nghiêng đầu hy */
interface ArmPose {
  la: number[]
  ra: number[]
  lf: number
  rf: number
  hx: number
  hy: number
}

// Tay trái: rotZ âm = dang ra ngoài; tay phải: rotZ dương = dang ra ngoài. rotX âm = đưa ra trước / gập khuỷu

/** Các kiểu cử chỉ khi nói (đổi kiểu mỗi câu) */
const SPEAK: ((t: number) => ArmPose)[] = [
  // hai tay mở ra giải thích
  (t) => ({ la: [-0.45 + Math.sin(t * 3) * 0.2, -0.35], ra: [-0.45 + Math.sin(t * 3 + 1.5) * 0.2, 0.35], lf: -1.0, rf: -1.0, hx: Math.sin(t * 5) * 0.05, hy: 0 }),
  // khua tay phải
  (t) => ({ la: [0, -0.12], ra: [-0.9 + Math.sin(t * 4) * 0.3, 0.3 + Math.sin(t * 3) * 0.15], lf: 0, rf: -0.7, hx: Math.sin(t * 6) * 0.06, hy: 0 }),
  // tay phải đặt lên ngực, tay trái chỉ về phía người nghe
  (t) => ({ la: [-1.1 + Math.sin(t * 4) * 0.15, -0.1], ra: [-0.5, -0.35], lf: -0.3, rf: -1.9, hx: Math.sin(t * 4) * 0.05, hy: 0.1 }),
  // ngửa hai bàn tay, nhún vai
  (t) => ({ la: [-0.35, -0.7 + Math.sin(t * 5) * 0.1], ra: [-0.35, 0.7 - Math.sin(t * 5) * 0.1], lf: -1.3, rf: -1.3, hx: 0, hy: Math.sin(t * 2) * 0.15 }),
]

/** Đang chờ câu trả lời từ Claude: tay chống cằm suy nghĩ */
const THINK = (t: number): ArmPose => ({ la: [-0.3, 0.45], ra: [-0.9, -0.3], lf: -1.3, rf: -2.1, hx: 0.12, hy: 0.2 + Math.sin(t) * 0.05 })

const nod = (t: number) => Math.max(0, Math.sin(t * 2.2)) ** 3 * 0.15

/** Các kiểu đứng nghe người kia nói */
const LISTEN_STANDING: ((t: number) => ArmPose)[] = [
  // khoanh tay, gật gù
  (t) => ({ la: [-0.9, 0.55], ra: [-0.95, -0.55], lf: -1.5, rf: -1.45, hx: nod(t), hy: 0 }),
  // chắp tay sau lưng
  (t) => ({ la: [0.35, -0.15], ra: [0.35, 0.15], lf: -0.5, rf: -0.5, hx: nod(t), hy: 0 }),
  // chống cằm
  (t) => ({ ...THINK(t), hx: 0.05 + nod(t) }),
  // thả lỏng
  (t) => ({ la: [0, -0.1], ra: [0, 0.1], lf: 0, rf: 0, hx: nod(t), hy: Math.sin(t * 0.8) * 0.1 }),
]

/** Các kiểu ngồi nghe khách nói */
const LISTEN_SEATED: ((t: number) => ArmPose)[] = [
  (t) => ({ la: [-0.4, -0.05], ra: [-0.4, 0.05], lf: -0.9, rf: -0.9, hx: nod(t), hy: 0 }),
  (t) => ({ la: [-0.9, 0.55], ra: [-0.95, -0.55], lf: -1.5, rf: -1.45, hx: nod(t), hy: 0 }),
  (t) => ({ la: [-0.4, -0.05], ra: [-0.9, -0.3], lf: -0.9, rf: -2.1, hx: 0.05 + nod(t), hy: 0.15 }),
]

export function StickFigure({ role, color, hobby, state, mood = 'quiet', phase }: Props) {
  const look = LOOKS[role]
  const spin = useRef<Group>(null)
  const body = useRef<Group>(null)
  const head = useRef<Group>(null)
  const eyes = useRef<Group>(null)
  const lArm = useRef<Group>(null)
  const lFore = useRef<Group>(null)
  const rArm = useRef<Group>(null)
  const rFore = useRef<Group>(null)
  const lThigh = useRef<Group>(null)
  const lShin = useRef<Group>(null)
  const rThigh = useRef<Group>(null)
  const rShin = useRef<Group>(null)
  const sit = useRef(1)
  const hip = useRef<Group>(null)
  const prop = useRef<Group>(null)
  const lHand = useRef<Group>(null)
  const rHand = useRef<Group>(null)
  const moodSeen = useRef<Mood | null>(null)
  const variant = useRef(0)

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + phase
    const k = 1 - Math.exp(-12 * dt)
    // Đang có lộ trình thì luôn bước đi, kể cả khi trạng thái đã đổi sang ngồi (không ngồi mà trượt)
    const pose: AnimState = motions[role] ? 'walk' : state
    const seated = pose === 'work' || pose === 'listen' || pose === 'hobby'
    sit.current = MathUtils.lerp(sit.current, seated ? 1 : 0, k)

    // Tư thế mục tiêu: [rotX, rotZ] cho tay/chân, [rotX, rotY] cho đầu
    let la = [0, -0.1], lf = 0, ra = [0, 0.1], rf = 0
    let lt = 0, ls = 0, rt = 0, rs = 0
    let hx = 0, hy = 0, bob = 0

    switch (pose) {
      case 'walk': {
        const s = Math.sin(t * 9)
        lt = s * 0.6
        rt = -s * 0.6
        ls = Math.max(0, -Math.cos(t * 9)) * 0.7
        rs = Math.max(0, Math.cos(t * 9)) * 0.7
        la = [-s * 0.5, -0.12]
        ra = [s * 0.5, 0.12]
        lf = rf = -0.35
        bob = Math.abs(Math.sin(t * 9)) * 0.04
        break
      }
      case 'work': { // ngồi gõ phím, thỉnh thoảng đưa tay sang rê chuột
        lt = rt = -Math.PI / 2
        ls = rs = Math.PI / 2
        // gõ phím: hai tay nhịp lệch nhau, thỉnh thoảng dừng tay một chút như đang nghĩ
        const burst = Math.sin(t * 0.9) > -0.6 ? 1 : 0.15
        la = [-1.2, 0.12]
        ra = [-1.2, -0.12]
        lf = -0.4 + Math.sin(t * 22) * 0.09 * burst
        rf = -0.4 + Math.sin(t * 19 + 1.7) * 0.09 * burst
        hx = 0.12 + Math.sin(t * 0.7) * 0.05
        if (usingMouse(t)) {
          // ngồi quay vào bàn thì tay trái của mô hình nằm phía chuột (bên phải người ngồi): dang ra, rê nhẹ theo vòng
          la = [-1.05 + Math.cos(t * 2.6) * 0.05, -0.43 + Math.sin(t * 2.6) * 0.06]
          lf = -0.45
          rf = -0.45
          hy = -0.08
        }
        break
      }
      case 'hobby': {
        lt = rt = -Math.PI / 2
        ls = rs = Math.PI / 2
        // mặc định: hai tay cầm đồ vật trước ngực
        la = [-0.6, 0.18]
        ra = [-0.6, -0.18]
        lf = rf = -0.9
        if (hobby === 'read') {
          la = [-0.6, 0.08]
          ra = [-0.6, -0.08]
          hx = 0.4
          rf = -0.9 + Math.max(0, Math.sin(t * 0.8)) ** 12 * 0.5 // thỉnh thoảng lật trang
        } else if (hobby === 'game') {
          la = [-0.6, 0.06]
          ra = [-0.6, -0.06]
          hx = 0.35
          lf = -0.9 + Math.sin(t * 26) * 0.05
          rf = -0.9 + Math.sin(t * 23 + 1) * 0.05
        } else if (hobby === 'rubik') {
          la = [-0.6, 0.2]
          ra = [-0.6, -0.2]
          hx = 0.3
          lf = rf = -1.0
          if (spin.current) spin.current.rotation.set(t * 0.9, t * 1.3, 0)
        } else if (hobby === 'music') {
          la = [-0.4, -0.05]
          ra = [-0.4, 0.05]
          hx = Math.sin(t * 6) * 0.15
          hy = Math.sin(t * 3) * 0.2
          bob = Math.abs(Math.sin(t * 6)) * 0.015
        } else if (hobby === 'movie') {
          const popcorn = Math.max(0, Math.sin(t * 1.3)) ** 4 // đưa bỏng ngô lên miệng
          la = [-0.4, -0.05]
          ra = [-0.5 - popcorn * 0.6, -0.05]
          lf = -0.9
          rf = -0.9 - popcorn * 1.2
          hx = -0.05
        }
        break
      }
      case 'listen': // ngồi trên ghế đã xoay về phía khách
      case 'talk': // đứng nói chuyện
      case 'idle': { // đứng ở bàn họp
        if (pose === 'listen') {
          lt = rt = -Math.PI / 2
          ls = rs = Math.PI / 2
        }
        // mỗi câu nói / mỗi lượt nghe đổi sang một kiểu cử chỉ ngẫu nhiên
        if (mood !== moodSeen.current) {
          moodSeen.current = mood
          variant.current = Math.floor(Math.random() * 12)
        }
        const set = mood === 'speak' ? SPEAK : pose === 'listen' ? LISTEN_SEATED : LISTEN_STANDING
        const p = mood === 'think' ? THINK(t) : set[variant.current % set.length](t)
        ;({ la, ra, lf, rf, hx, hy } = p)
        break
      }
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
    // chớp mắt vài giây một lần
    if (eyes.current) eyes.current.scale.y = (t * 0.27) % 1 < 0.035 ? 0.1 : 1
    if (body.current) {
      body.current.position.y = -SIT_DROP * sit.current + bob
      // ngồi làm việc thì nhích người về phía bàn để tay chạm bàn phím, chuột
      body.current.position.z = MathUtils.lerp(body.current.position.z, pose === 'work' ? 0.12 : 0, k)
    }

    // Đồ vật bám theo bàn tay: chỉ hiện khi đã ngồi hẳn xuống để chơi
    const p = prop.current
    if (p && hip.current && lHand.current && rHand.current) {
      p.visible = pose === 'hobby' && sit.current > 0.9
      hip.current.worldToLocal(lHand.current.getWorldPosition(_l))
      if (hobby === 'movie' || hobby === 'read') p.position.copy(_l) // xô bỏng ngô cầm tay trái; sách giữ bằng tay trái để tay phải lật trang
      else p.position.copy(_l).add(hip.current.worldToLocal(rHand.current.getWorldPosition(_r))).multiplyScalar(0.5)
      if (hobby === 'read') p.position.x = 0 // giữa hai tay, không lệch khi tay phải lật trang
    }
  })

  const arm = (jref: RefObject<Group | null>, fore: RefObject<Group | null>, side: number) => (
    <Joint jref={jref} position={[side * SHOULDER_X, 0.5, 0]}>
      <mesh castShadow>
        <sphereGeometry args={[0.058, 12, 10]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      <Limb len={UPPER_ARM} radius={0.048} color={color} />
      <Joint jref={fore} position={[0, -UPPER_ARM, 0]}>
        <Limb len={FOREARM} radius={0.038} color={look.skin} />
        <group ref={side < 0 ? lHand : rHand} position={[0, -FOREARM - 0.02, 0]} />
        <mesh position={[0, -FOREARM - 0.02, 0]} castShadow>
          <sphereGeometry args={[0.048, 12, 10]} />
          <meshStandardMaterial color={look.skin} roughness={0.7} />
        </mesh>
      </Joint>
    </Joint>
  )

  const leg = (jref: RefObject<Group | null>, shin: RefObject<Group | null>, side: number) => (
    <Joint jref={jref} position={[side * 0.075, 0, 0]}>
      <Limb len={THIGH} radius={0.062} color={look.pants} />
      <Joint jref={shin} position={[0, -THIGH, 0]}>
        <Limb len={SHIN} radius={0.054} color={look.pants} />
        {/* giày */}
        <mesh position={[0, -SHIN - 0.04, 0.04]} scale={[1, 0.6, 1.5]} castShadow>
          <sphereGeometry args={[0.065, 14, 10]} />
          <meshStandardMaterial color={look.shoes} roughness={0.5} />
        </mesh>
      </Joint>
    </Joint>
  )

  return (
    <group ref={body}>
      <group ref={hip} position={[0, HIP_Y, 0]}>
        {/* thân áo */}
        <mesh position={[0, 0.32, 0]} scale={[1, 1, 0.82]} castShadow>
          <capsuleGeometry args={[0.13, 0.27, 8, 20]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>
        {/* hông quần */}
        <mesh position={[0, 0.03, 0]} scale={[1, 0.7, 0.8]} castShadow>
          <sphereGeometry args={[0.135, 18, 12]} />
          <meshStandardMaterial color={look.pants} roughness={0.8} />
        </mesh>
        {/* cổ */}
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.045, 0.05, 0.08, 12]} />
          <meshStandardMaterial color={look.skin} roughness={0.7} />
        </mesh>
        <Outfit role={role} color={color} />

        {/* đầu */}
        <group ref={head} position={[0, 0.78, 0]}>
          <group scale={HEAD_SCALE}>
            <mesh castShadow>
              <sphereGeometry args={[0.14, 32, 20]} />
              <meshStandardMaterial color={look.skin} roughness={0.65} />
            </mesh>
            <Face eyes={eyes} skin={look.skin} />
            <Hair style={look.style} color={look.hair} />
            <HeadAccessory role={role} />
          </group>
        </group>

        {state === 'hobby' && (
          <group ref={prop} visible={false}>
            <HobbyProp hobby={hobby} spin={spin} />
          </group>
        )}

        {arm(lArm, lFore, -1)}
        {arm(rArm, rFore, 1)}
        {leg(lThigh, lShin, -1)}
        {leg(rThigh, rShin, 1)}
      </group>
    </group>
  )
}
