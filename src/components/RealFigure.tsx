import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Color, Group, MathUtils, Mesh, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from 'three'
import type { AnimState } from '../store'
import { useStore } from '../store'
import { motions } from '../sim/motion'
import { DESK_Z, SEAT_Z, type Hobby } from '../data/agents'
import { mouseOffset, usingMouse } from './StickFigure'

/**
 * Nhân vật người 3D (mô hình mẫu của three.js: nam = avatar Ready Player Me, nữ = Michelle của Mixamo).
 * Không dùng clip hoạt ảnh: mọi tư thế đều tính bằng cách xoay từng đoạn xương về một hướng, nên chạy được
 * với mọi khung xương người kiểu Mixamo. Khi làm việc, tay đặt đúng lên bàn phím / con chuột trên bàn bằng IK hai đoạn.
 */
export const BODY_MODELS = { nam: '/models/readyplayer.me.glb', nữ: '/models/Michelle.glb' } as const
export type Body = keyof typeof BODY_MODELS
for (const url of Object.values(BODY_MODELS)) useGLTF.preload(url)

type Mood = 'speak' | 'think' | 'quiet'
interface Props {
  role: string
  body: Body
  color: string
  hobby: Hobby
  state: AnimState
  mood?: Mood
  phase: number
}

const HIP_SEAT = 0.5 // chiều cao hông khi ngồi ghế (khớp với người que)
/** Dáng cao ráo: chiều cao đỉnh đầu (m) và độ kéo dài chân */
const FIGURE = { nam: { height: 1.82, legs: 1.07 }, nữ: { height: 1.72, legs: 1.08 } } as const

// Bàn làm việc, tính từ chỗ ngồi (toạ độ của agent: +Z = về phía bàn, +X = bên trái người ngồi). Khớp với Office.tsx
const KB_Z = SEAT_Z - (DESK_Z + 0.27) // tâm bàn phím
const KB_TOP = 0.797 // mặt phím
const MOUSE_X = -0.36 // chuột nằm bên phải người ngồi
const MOUSE_TOP = 0.81

const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'] as const
type BoneName = (typeof BONES)[number]
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'] as const
const SIDES = ['Left', 'Right'] as const

const _a = new Vector3()
const _b = new Vector3()
const _t = new Vector3()
const _q = new Quaternion()
const _wq = new Quaternion()
const _pq = new Quaternion()
const _rq = new Quaternion()

/** Xoay `bone` để đoạn bone → child chỉ theo hướng `worldDir` (toạ độ thế giới) */
function aimWorld(bone: Object3D, child: Object3D, worldDir: Vector3) {
  if (!bone.parent) return
  bone.getWorldPosition(_a)
  child.getWorldPosition(_b)
  _b.sub(_a).normalize()
  _q.setFromUnitVectors(_b, _t.copy(worldDir).normalize())
  bone.getWorldQuaternion(_wq).premultiply(_q)
  bone.parent.getWorldQuaternion(_pq).invert()
  bone.quaternion.copy(_wq.premultiply(_pq))
  bone.updateMatrixWorld(true)
}
/** Xoay `bone` quanh trục `axis` (toạ độ thế giới) một góc `angle` */
function rotateWorld(bone: Object3D, axis: Vector3, angle: number) {
  if (!bone.parent || Math.abs(angle) < 1e-4) return
  _q.setFromAxisAngle(_t.copy(axis).normalize(), angle)
  bone.getWorldQuaternion(_wq).premultiply(_q)
  bone.parent.getWorldQuaternion(_pq).invert()
  bone.quaternion.copy(_wq.premultiply(_pq))
  bone.updateMatrixWorld(true)
}
/** Góc có dấu (quanh `axis`) để xoay `from` tới `to`, sau khi chiếu cả hai lên mặt phẳng vuông góc với trục */
function rollAngle(from: Vector3, to: Vector3, axis: Vector3) {
  const n = axis.clone().normalize()
  const a = from.clone().addScaledVector(n, -from.dot(n)).normalize()
  const b = to.clone().addScaledVector(n, -to.dot(n)).normalize()
  return Math.atan2(n.dot(a.clone().cross(b)), a.dot(b))
}

/** Như aimWorld nhưng `dir` theo toạ độ nhân vật: +Z trước mặt, +Y lên, +X bên trái nhân vật */
function aim(root: Object3D, bone: Object3D, child: Object3D, dir: Vector3) {
  aimWorld(bone, child, _t.copy(dir).normalize().applyQuaternion(root.getWorldQuaternion(_rq)).clone())
}

/**
 * IK hai đoạn (vai → khuỷu → cổ tay): tìm khuỷu tay sao cho cổ tay chạm `target`, khuỷu chĩa về phía `pole`.
 * Trả về hướng cánh tay trên và cẳng tay (toạ độ thế giới).
 */
function solveArm(shoulder: Vector3, upper: number, fore: number, target: Vector3, pole: Vector3) {
  const d = target.clone().sub(shoulder)
  const len = MathUtils.clamp(d.length(), Math.abs(upper - fore) + 1e-3, upper + fore - 1e-3)
  const u = d.normalize()
  const x = (upper * upper - fore * fore + len * len) / (2 * len)
  const h = Math.sqrt(Math.max(0, upper * upper - x * x))
  const p = pole.clone().addScaledVector(u, -pole.dot(u)).normalize()
  const elbow = shoulder.clone().addScaledVector(u, x).addScaledVector(p, h)
  const wrist = shoulder.clone().addScaledVector(u, len)
  return { upper: elbow.clone().sub(shoulder), fore: wrist.sub(elbow) }
}

const RUBIK_COLORS = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#f8fafc']

const v = (x: number, y: number, z: number) => new Vector3(x, y, z)
/** Trộn các hướng theo trọng số; phần trọng số còn lại thuộc về tư thế đứng `base` */
function blend(base: Vector3, ...pairs: [number, Vector3 | null][]) {
  const out = new Vector3()
  let rest = 1
  for (const [w, d] of pairs) {
    if (w <= 0.001 || !d) continue
    out.addScaledVector(d.clone().normalize(), w)
    rest -= w
  }
  return out.addScaledVector(base.normalize(), Math.max(0, rest))
}

export function RealFigure({ role, body, color, hobby, state, mood = 'quiet', phase }: Props) {
  const { scene } = useGLTF(BODY_MODELS[body])
  const offset = useRef<Group>(null)
  const props = { read: useRef<Group>(null), game: useRef<Group>(null), rubik: useRef<Group>(null), movie: useRef<Group>(null), phones: useRef<Group>(null) }

  const rig = useMemo(() => {
    const model = clone(scene)
    const find = (n: string) => model.getObjectByName(`mixamorig${n}`) ?? model.getObjectByName(`mixamorig:${n}`) ?? model.getObjectByName(n)
    const bones = {} as Record<BoneName, Object3D>
    for (const n of BONES) bones[n] = find(n)!
    // ngón tay: [đốt 1, đốt 2, đốt 3, đầu ngón] cho từng bên
    const fingers = Object.fromEntries(
      SIDES.map((s) => [s, FINGERS.map((f) => [1, 2, 3, 4].map((i) => find(`${s}Hand${f}${i}`)))]),
    ) as Record<(typeof SIDES)[number], (Object3D | undefined)[][]>
    const all = [...BONES.map((n) => bones[n]), ...Object.values(fingers).flat(2)].filter((b): b is Object3D => !!b)
    const rest = new Map(all.map((b) => [b, b.quaternion.clone()]))
    const mouths: Mesh[] = []
    model.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.frustumCulled = false // xương di chuyển ra ngoài khung bao gốc
      m.material = (m.material as MeshStandardMaterial).clone()
      if (m.morphTargetDictionary?.mouthOpen !== undefined) mouths.push(m)
    })
    const pos = (b: Object3D) => b.getWorldPosition(new Vector3())
    // chân dài hơn một chút (bàn chân giữ nguyên cỡ), rồi phóng cả người lên đúng chiều cao
    const fig = FIGURE[body]
    for (const sd of SIDES) {
      bones[`${sd}UpLeg`].scale.setScalar(fig.legs)
      bones[`${sd}Foot`].scale.setScalar(1 / fig.legs)
    }
    model.updateMatrixWorld(true)
    const top = find('HeadTop_End') ?? bones.Head
    model.scale.setScalar(fig.height / (pos(top).y + (top === bones.Head ? 0.12 : 0.02)))
    model.updateMatrixWorld(true)
    const hipStand = pos(bones.Hips).y
    const shinLen = pos(bones.LeftLeg).distanceTo(pos(bones.LeftFoot))
    const ankle = pos(bones.LeftFoot).y // cổ chân cao bao nhiêu khi đứng
    const arm = (s: 'Left' | 'Right') => ({
      upper: pos(bones[`${s}Arm`]).distanceTo(pos(bones[`${s}ForeArm`])),
      fore: pos(bones[`${s}ForeArm`]).distanceTo(pos(bones[`${s}Hand`])),
    })
    // xoay của đầu so với nhân vật ở tư thế nghỉ: để đồ đội đầu (tai nghe) bám theo đầu đúng hướng
    const headCorr = bones.Head.getWorldQuaternion(new Quaternion()).invert().multiply(model.getWorldQuaternion(new Quaternion()))
    return { model, bones, fingers, rest, mouths, hipStand, shinLen, ankle, headCorr, arms: { Left: arm('Left'), Right: arm('Right') } }
  }, [scene, body])

  // áo mang màu của agent (pha với trắng để giữ vân vải)
  useEffect(() => {
    rig.model.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && /Outfit_Top/.test(m.name)) (m.material as MeshStandardMaterial).color = new Color('#ffffff').lerp(new Color(color), 0.75)
    })
  }, [rig, color])

  const w = useRef({ walk: 0, sit: 1, work: 0, hobby: 0, sleep: 0, listen: 0, speak: 0, think: 0, mouse: 0 })

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + phase
    const k = 1 - Math.exp(-8 * dt)
    const pose: AnimState = motions[role] ? 'walk' : state
    const seated = pose === 'work' || pose === 'listen' || pose === 'hobby' || pose === 'sleep'
    const W = w.current
    const to = (key: keyof typeof W, on: boolean, rate = k) => (W[key] = MathUtils.lerp(W[key], on ? 1 : 0, rate))
    to('walk', pose === 'walk')
    to('sit', seated)
    to('work', pose === 'work')
    to('hobby', pose === 'hobby')
    to('sleep', pose === 'sleep')
    to('listen', pose === 'listen')
    to('speak', mood === 'speak' && (pose === 'talk' || pose === 'idle' || pose === 'listen'))
    to('think', mood === 'think' && pose !== 'walk')
    const mousing = usingMouse(t)
    to('mouse', mousing, 1 - Math.exp(-10 * dt)) // tay phải chuyển nhanh giữa bàn phím và chuột

    const { model, bones: B, fingers, rest, mouths, hipStand, shinLen, ankle, arms, headCorr } = rig
    const g = offset.current
    const step = t * 8 * Math.min(2, useStore.getState().speed)
    const s = Math.sin(step)
    if (g) {
      // hạ người xuống ghế, nhích vào bàn khi làm việc / ngủ gục; nhún nhẹ khi bước
      g.position.y = -(hipStand - HIP_SEAT) * W.sit - 0.06 * W.sleep + Math.abs(Math.cos(step)) * 0.03 * W.walk
      g.position.z = -0.09 * W.sit + 0.16 * W.work + 0.2 * W.sleep // ngồi sát lưng ghế; làm việc / ngủ thì nhích vào bàn
    }

    for (const [b, q] of rest) b.quaternion.copy(q)
    model.updateMatrixWorld(true)

    // ---- thân, đầu: khi làm việc hơi nghiêng về phía bàn, mắt nhìn màn hình, thỉnh thoảng liếc xuống bàn phím ----
    const breathe = Math.sin(t * 1.3) * 0.015
    const hobbySpine =
      hobby === 'music' ? v(Math.sin(t * 3.15) * 0.05, 1, 0.03)
      : hobby === 'movie' ? v(0, 1, -0.06)
      : hobby === 'game' ? v(Math.sin(t * 0.7) * 0.03, 1, 0.14)
      : v(0, 1, 0.1)
    aim(model, B.Spine, B.Spine2, blend(v(breathe, 1, 0.02), [W.sleep * 0.9, v(0, 0.55, 1)], [W.walk, v(0, 1, 0.06)], [W.work, v(breathe, 1, 0.3)], [W.hobby, hobbySpine]))
    const nod = Math.sin(t * 4.2) * 0.12 * W.speak
    const beat = Math.max(0, Math.sin(t * 6.3)) ** 2 // nhịp nhạc ~ 120 bpm
    const pop = Math.max(0, Math.sin(t * 1.3)) ** 4 // đưa bỏng ngô lên miệng
    const flip = Math.max(0, Math.sin(t * 0.8)) ** 12 // lật trang sách
    const hobbyHead =
      hobby === 'music' ? v(Math.sin(t * 3.15) * 0.12, 1, 0.06 + beat * 0.22)
      : hobby === 'movie' ? v(Math.sin(t * 0.3) * 0.05, 1, 0.03 - pop * 0.05)
      : hobby === 'game' ? v(Math.sin(t * 2.3) * 0.04, 1, 0.55)
      : hobby === 'read' ? v(Math.sin(t * 0.6) * 0.08 - flip * 0.06, 1, 0.5)
      : v(Math.sin(t * 0.9) * 0.08, 1, 0.45)
    const glance = Math.max(0, Math.sin(t * 0.37)) ** 10 // liếc bàn phím
    aim(
      model,
      B.Neck,
      B.Head,
      blend(
        v(Math.sin(t * 0.4) * 0.08, 1, 0.05 + nod),
        [W.work, v(Math.sin(t * 0.21) * 0.06 - W.mouse * 0.04, 1, 0.08 + glance * 0.45)],
        [W.hobby, hobbyHead],
        [W.sleep, v(0.15, 0.25, 0.9)],
        [W.think, v(0.1, 1, 0.12)],
      ),
    )

    // ---- chân: đứng thẳng, bước đi, hoặc ngồi (đùi ngang, cẳng chân thả xuống) ----
    // ngồi: cẳng chân thu chéo về phía ghế vừa đủ để bàn chân chạm sàn (chân dài không lún sàn, không thò xa ra trước)
    const sitDrop = Math.min(0.995, (HIP_SEAT - ankle) / shinLen)
    const sitShin = Math.sqrt(1 - sitDrop * sitDrop)
    const leg = (side: 1 | -1, up: Object3D, low: Object3D, foot: Object3D) => {
      const a = 0.45 * s * side // đùi đung đưa ngược pha hai bên
      const bend = Math.max(0, -Math.cos(step) * side) * 0.9 // gập gối khi chân đang đưa ra sau / nhấc lên
      aim(model, up, low, blend(v(0.06 * side, -1, 0), [W.walk, v(0.06 * side, -Math.cos(a), Math.sin(a))], [W.sit, v(0.12 * side, -0.05, 1)]))
      aim(model, low, foot, blend(v(0.01 * side, -1, 0), [W.walk, v(0, -Math.cos(a - bend), Math.sin(a - bend))], [W.sit, v(0.02 * side, -sitDrop, -sitShin)]))
    }
    leg(1, B.LeftUpLeg, B.LeftLeg, B.LeftFoot)
    leg(-1, B.RightUpLeg, B.RightLeg, B.RightFoot)

    // ---- IK khi làm việc: cổ tay đặt lên bàn phím, tay phải sang chuột ----
    type Dirs = Record<'Left' | 'Right', { upper: Vector3; fore: Vector3 } | null>
    const ik: Dirs = { Left: null, Right: null }
    const ikHob: Dirs = { Left: null, Right: null }
    const agentRoot = g?.parent
    const solveBoth = (out: Dirs, targets: Record<'Left' | 'Right', Vector3>) => {
      const mq = model.getWorldQuaternion(new Quaternion())
      const inv = mq.clone().invert()
      for (const side of SIDES) {
        const sign = side === 'Left' ? 1 : -1
        const shoulder = B[`${side}Arm`].getWorldPosition(new Vector3())
        const pole = v(sign * 1.1, -0.8, -0.3).applyQuaternion(mq)
        const r = solveArm(shoulder, arms[side].upper, arms[side].fore, targets[side], pole)
        out[side] = { upper: r.upper.applyQuaternion(inv), fore: r.fore.applyQuaternion(inv) }
      }
    }
    // Vị trí cầm đồ chơi tính theo chính cơ thể nhân vật (vai, hông, đùi, độ dài tay), vì mỗi mô hình một tỉ lệ
    const mqH = model.getWorldQuaternion(new Quaternion())
    const F = v(0, 0, 1).applyQuaternion(mqH)
    const U = v(0, 1, 0).applyQuaternion(mqH)
    const X = v(1, 0, 0).applyQuaternion(mqH)
    const P = (o: Object3D) => o.getWorldPosition(new Vector3())
    const reach = arms.Left.upper + arms.Left.fore
    const chest = P(B.LeftArm).add(P(B.RightArm)).multiplyScalar(0.5)
    const at = (base: Vector3, f: number, u: number, x: number) => base.clone().addScaledVector(F, f).addScaledVector(U, u).addScaledVector(X, x)
    const hips = P(B.Hips)
    const thighLen = P(B.LeftUpLeg).distanceTo(P(B.LeftLeg))
    const bucket = at(hips, thighLen * 0.62, 0.17, 0.02) // xô bỏng ngô trên đùi
    const mouth = at(P(B.Head), 0.1, 0.03, 0)
    const holdAt = (f: number, u: number) => at(chest, reach * f, -reach * u, 0)
    const hold =
      hobby === 'read' ? holdAt(0.55, 0.3)
      : hobby === 'game' ? holdAt(0.5, 0.55)
      : holdAt(0.5, 0.45) // rubik
    if (W.hobby > 0.01 && agentRoot) {
      const onThigh = (up: Object3D, low: Object3D, side: number) => P(up).lerp(P(low), 0.62).addScaledVector(U, 0.07).addScaledVector(X, side * 0.01)
      const targets: Record<'Left' | 'Right', Vector3> =
        hobby === 'music' // tay đặt trên đùi, gõ nhẹ theo nhịp
          ? {
              Left: onThigh(B.LeftUpLeg, B.LeftLeg, 1).addScaledVector(U, beat * 0.015),
              Right: onThigh(B.RightUpLeg, B.RightLeg, -1).addScaledVector(U, Math.max(0, Math.sin(t * 6.3 + 1.6)) ** 2 * 0.015),
            }
          : hobby === 'read' // hai tay cầm hai mép sách; tay phải thỉnh thoảng sang lật trang
            ? { Left: at(hold, 0, 0, 0.11), Right: at(hold, 0.01, flip * 0.03, -0.11 + flip * 0.13) }
            : hobby === 'game' // cầm máy game, hơi rung tay theo trận
              ? { Left: at(hold, 0, Math.sin(t * 2.3) * 0.01, 0.12), Right: at(hold, 0, Math.sin(t * 2.3) * 0.01, -0.12) }
              : hobby === 'rubik' // hai tay ôm khối rubik, thay nhau vặn
                ? { Left: at(hold, 0, Math.sin(t * 2.4) * 0.01, 0.065), Right: at(hold, 0, Math.sin(t * 2.4 + 1.5) * 0.01, -0.065) }
                : // xem phim: tay trái giữ xô bỏng ngô, tay phải bốc rồi đưa lên miệng
                  { Left: at(bucket, 0, 0.02, 0.085), Right: at(bucket, 0, 0.09, -0.01).lerp(mouth, pop) }
      solveBoth(ikHob, targets)
    }
    const burst = Math.sin(t * 0.9) > -0.6 ? 1 : 0.15 // gõ từng đợt, có lúc dừng tay nghĩ
    if (W.work > 0.01 && agentRoot) {
      const world = (x: number, y: number, z: number) => agentRoot.localToWorld(new Vector3(x, y, z))
      const [mdx, mdz] = mousing ? mouseOffset(t) : [0, 0]
      // bàn tay trôi nhẹ trên bàn phím theo phím đang gõ; cổ tay nằm sau hàng phím ~8 cm, nhích lên khi nhấn
      const driftL = Math.sin(t * 1.3) * 0.025 + Math.sin(t * 3.1) * 0.01
      const driftR = Math.sin(t * 1.1 + 2) * 0.025
      const kbY = KB_TOP + 0.03
      const leftT = world(0.1 + driftL, kbY + Math.abs(Math.sin(t * 11)) * 0.006 * burst, KB_Z - 0.1)
      const keyR = world(-0.1 + driftR, kbY + Math.abs(Math.sin(t * 9.5 + 1)) * 0.006 * burst, KB_Z - 0.1)
      // world X của bàn bị lật (agent quay mặt vào bàn) → toạ độ agent dùng -dx, -dz
      const mouseT = world(MOUSE_X - mdx, MOUSE_TOP + 0.02, KB_Z - mdz - 0.075)
      const rightT = keyR.lerp(mouseT, W.mouse)
      solveBoth(ik, { Left: leftT, Right: rightT })
    }

    // ---- tay (L = +X) ----
    const gest = Math.sin(t * 3.1) * 0.5 + Math.sin(t * 1.7) * 0.3
    aim(
      model,
      B.LeftArm,
      B.LeftForeArm,
      blend(
        v(0.15, -1, 0.02),
        [W.walk, v(0.12, -1, -0.45 * s)],
        [W.work, ik.Left?.upper ?? null],
        [W.sleep, v(0.35, -0.25, 1)],
        [W.hobby, ikHob.Left?.upper ?? null],
        [W.listen * (1 - W.think), v(0.12, -0.9, 0.3)],
        [W.think, v(0.1, -0.55, 0.75)],
      ),
    )
    aim(
      model,
      B.LeftForeArm,
      B.LeftHand,
      blend(
        v(0.03, -1, 0.15),
        [W.walk, v(0.03, -1, 0.35)],
        [W.work, ik.Left?.fore ?? null],
        [W.sleep, v(-1, 0.05, 0.25)],
        [W.hobby, ikHob.Left?.fore ?? null],
        [W.listen * (1 - W.think), v(-0.08, -0.3, 1)],
        [W.think, v(-0.25, 1, 0.15)],
      ),
    )
    aim(
      model,
      B.RightArm,
      B.RightForeArm,
      blend(
        v(-0.15, -1, 0.02),
        [W.walk, v(-0.12, -1, 0.45 * s)],
        [W.work, ik.Right?.upper ?? null],
        [W.sleep, v(-0.35, -0.25, 1)],
        [W.hobby, ikHob.Right?.upper ?? null],
        [W.listen * (1 - W.speak), v(-0.12, -0.9, 0.3)],
        [W.speak * 0.85, v(-0.35, -0.8, 0.35 + gest * 0.15)],
      ),
    )
    aim(
      model,
      B.RightForeArm,
      B.RightHand,
      blend(
        v(-0.03, -1, 0.15),
        [W.walk, v(-0.03, -1, 0.35)],
        [W.work, ik.Right?.fore ?? null],
        [W.sleep, v(1, 0.1, 0.25)],
        [W.hobby, ikHob.Right?.fore ?? null],
        [W.listen * (1 - W.speak), v(0.08, -0.3, 1)],
        [W.speak * 0.85, v(0.1, 0.25 + gest * 0.25, 1)],
      ),
    )

    // ---- bàn tay: làm việc thì úp xuống phím/chuột; cầm đồ thì lòng bàn tay quay vào nhau ----
    const handW = Math.min(1, W.work + W.hobby)
    const working = W.work >= W.hobby
    const mq = model.getWorldQuaternion(new Quaternion())
    const pos = (o: Object3D) => o.getWorldPosition(new Vector3())
    /** Hướng gờ ngón trỏ (trỏ − út) và hướng các ngón chĩa tới, theo toạ độ nhân vật */
    const handGoal = (side: 'Left' | 'Right') => {
      const sign = side === 'Left' ? 1 : -1
      if (working) {
        const onMouse = side === 'Right' ? W.mouse : 0
        return { edge: v(-sign, 0, 0), fwd: v(sign * 0.08 * (1 - onMouse), -0.18 - onMouse * 0.12, 1) }
      }
      if (hobby === 'music') return { edge: v(-sign, 0, 0), fwd: v(sign * 0.05, -0.35, 1) } // úp trên đùi
      if (hobby === 'movie' && side === 'Right') return { edge: v(-sign * 0.3, 1, 0), fwd: v(0.15, -0.6 + pop * 1.4, 1) } // bốc bỏng ngô
      return { edge: v(0, 1, 0), fwd: v(-sign * 0.4, 0.15, 1) } // cầm hai bên đồ vật
    }
    if (handW > 0.05) {
      for (const side of SIDES) {
        const fore = B[`${side}ForeArm`]
        const hand = B[`${side}Hand`]
        const index = fingers[side][0][0]
        const middle = fingers[side][1][0]
        const pinky = fingers[side][3][0]
        if (!index || !middle || !pinky) continue
        const goal = handGoal(side)
        const edge = goal.edge.applyQuaternion(mq)
        // 1) xoắn cẳng tay quanh trục của nó để xoay bàn tay (khớp cổ tay không bị vặn)
        const foreAxis = pos(hand).sub(pos(fore))
        rotateWorld(fore, foreAxis, rollAngle(pos(index).sub(pos(pinky)), edge, foreAxis) * handW)
        // 2) bẻ cổ tay cho ngón chĩa đúng hướng
        const cur = pos(middle).sub(pos(hand)).normalize()
        aimWorld(hand, middle, cur.lerp(goal.fwd.applyQuaternion(mq).normalize(), handW))
        // 3) chỉnh nốt độ xoay còn dư ngay tại bàn tay
        const along = pos(middle).sub(pos(hand))
        rotateWorld(hand, along, rollAngle(pos(index).sub(pos(pinky)), edge, along) * handW)
      }
    }

    // ---- ngón tay: gõ phím, ôm chuột (ngón trỏ click), nắm đồ vật, gõ nhịp trên đùi ----
    if (handW > 0.05) {
      for (const side of SIDES) {
        const sign = side === 'Left' ? 1 : -1
        const handPos = pos(B[`${side}Hand`])
        const index = fingers[side][0][0]
        const pinky = fingers[side][3][0]
        if (!index || !pinky) continue
        const edge = pos(index).sub(pos(pinky))
        const onMouse = side === 'Right' ? W.mouse : 0
        fingers[side].forEach((f, i) => {
          const [f1, f2, f3, tip] = f
          if (!f1 || !f2 || !f3) return
          const along = pos(f1).sub(handPos).normalize()
          // phía lòng bàn tay: ngón cong về phía này
          const palm = along.clone().cross(edge).normalize().multiplyScalar(sign)
          const seed = i * 1.9 + (side === 'Left' ? 0 : 0.7)
          let c1: number
          let c2: number
          if (working) {
            const press = Math.max(0, Math.sin(t * (10 + i * 2.3) + seed)) ** 8 * burst // nhấn phím
            const click = i === 0 ? Math.max(0, Math.sin(t * 1.9 + seed)) ** 40 : 0 // click chuột bằng ngón trỏ
            c1 = MathUtils.lerp(0.3 + press * 0.55, 0.55 + click * 0.25 + i * 0.05, onMouse)
            c2 = MathUtils.lerp(0.45 + press * 0.3, 0.5, onMouse)
          } else if (hobby === 'music') {
            const tap = i < 2 ? Math.max(0, Math.sin(t * 6.3 + seed)) ** 6 * 0.35 : 0 // gõ nhịp trên đùi
            c1 = 0.2 + tap
            c2 = 0.3
          } else if (hobby === 'game') {
            c1 = 0.95
            c2 = 0.8
          } else if (hobby === 'read') {
            c1 = 0.45 + (side === 'Right' ? flip * 0.4 : 0)
            c2 = 0.5
          } else if (hobby === 'movie' && side === 'Right') {
            c1 = 0.55 + (1 - pop) * 0.35 // chụm ngón bốc bỏng ngô
            c2 = 0.6
          } else {
            c1 = 0.85 + (hobby === 'rubik' ? Math.max(0, Math.sin(t * 2.4 + seed)) * 0.2 : 0)
            c2 = 0.7
          }
          c1 *= handW
          c2 *= handW
          const dir = (c: number) => along.clone().multiplyScalar(Math.cos(c)).addScaledVector(palm, Math.sin(c))
          aimWorld(f1, f2, dir(c1))
          aimWorld(f2, f3, dir(c1 + c2))
          if (tip) aimWorld(f3, tip, dir(c1 + c2 + 0.25 * handW))
        })
      }
    }

    // ---- đồ vật: đặt giữa hai bàn tay / trên đùi; tai nghe bám theo đầu ----
    if (g) {
      const shown = W.hobby > 0.85
      const toLocal = (p: Vector3) => g.worldToLocal(p.clone())
      for (const h of ['read', 'game', 'rubik', 'movie'] as const) {
        const o = props[h].current
        if (o) o.visible = shown && hobby === h
      }
      if (hobby === 'read' && props.read.current) props.read.current.position.copy(toLocal(at(hold, 0.04, 0.03, 0)))
      if (hobby === 'game' && props.game.current) props.game.current.position.copy(toLocal(at(hold, 0.05, 0.01, 0)))
      if (hobby === 'rubik' && props.rubik.current) {
        props.rubik.current.position.copy(toLocal(at(hold, 0.05, 0.01, 0)))
        props.rubik.current.rotation.set(t * 0.9, t * 1.3, 0)
      }
      if (hobby === 'movie' && props.movie.current) props.movie.current.position.copy(toLocal(bucket))
      const ph = props.phones.current
      if (ph) {
        ph.visible = shown && hobby === 'music' && body === 'nam' // nhân vật nữ có sẵn tai nghe trên mô hình
        if (ph.visible) {
          const q = B.Head.getWorldQuaternion(new Quaternion()).multiply(headCorr)
          const center = pos(B.Head).add(v(0, 0.1, 0.01).applyQuaternion(q))
          ph.position.copy(toLocal(center))
          ph.quaternion.copy(g.getWorldQuaternion(new Quaternion()).invert().multiply(q))
        }
      }
    }


    // ---- miệng mấp máy khi nói (avatar có blendshape) ----
    const open = W.speak * Math.max(0, Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3) * 0.3)
    for (const m of mouths) {
      const d = m.morphTargetDictionary!
      m.morphTargetInfluences![d.mouthOpen] = open * 0.7
      if (d.mouthSmile !== undefined) m.morphTargetInfluences![d.mouthSmile] = 0.25
    }
  })

  return (
    <group ref={offset}>
      <primitive object={rig.model} />
      <group ref={props.read} visible={false} rotation={[0.64, 0, 0]}>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[sd * 0.07, 0, 0]} rotation={[0, sd * 0.35, 0]} castShadow>
            <boxGeometry args={[0.14, 0.2, 0.012]} />
            <meshStandardMaterial color={sd < 0 ? '#fef3c7' : '#fde68a'} />
          </mesh>
        ))}
        <mesh position={[0, 0, 0.012]}>
          <boxGeometry args={[0.02, 0.2, 0.01]} />
          <meshStandardMaterial color="#b91c1c" />
        </mesh>
      </group>
      <group ref={props.game} visible={false} rotation={[-0.64, 0, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.24, 0.03, 0.1]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
        <mesh position={[0, 0.017, 0]}>
          <boxGeometry args={[0.11, 0.005, 0.07]} />
          <meshStandardMaterial color="#0f172a" emissive="#22d3ee" emissiveIntensity={0.9} />
        </mesh>
        {[-0.09, 0.09].map((x) => (
          <mesh key={x} position={[x, 0.018, 0]}>
            <sphereGeometry args={[0.012, 8, 8]} />
            <meshStandardMaterial color={x < 0 ? '#ef4444' : '#3b82f6'} />
          </mesh>
        ))}
      </group>
      <group ref={props.rubik} visible={false}>
        <mesh castShadow>
          <boxGeometry args={[0.08, 0.08, 0.08]} />
          {RUBIK_COLORS.map((c, i) => (
            <meshStandardMaterial key={c} attach={`material-${i}`} color={c} />
          ))}
        </mesh>
      </group>
      <group ref={props.movie} visible={false}>
        <mesh castShadow>
          <cylinderGeometry args={[0.075, 0.055, 0.15, 14]} />
          <meshStandardMaterial color="#dc2626" />
        </mesh>
        <mesh position={[0, 0.08, 0]}>
          <sphereGeometry args={[0.072, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#fef9c3" />
        </mesh>
      </group>
      <group ref={props.phones} visible={false}>
        <mesh>
          <torusGeometry args={[0.108, 0.012, 8, 24, Math.PI]} />
          <meshStandardMaterial color="#111827" />
        </mesh>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[sd * 0.105, -0.01, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.045, 0.045, 0.035, 16]} />
            <meshStandardMaterial color={sd < 0 ? '#ef4444' : '#111827'} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
