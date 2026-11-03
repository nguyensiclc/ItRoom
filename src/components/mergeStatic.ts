import { useLayoutEffect, useRef } from 'react'
import { Matrix4, Mesh, type BufferGeometry, type Group, type Material, type MeshStandardMaterial } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Đánh dấu nhánh có chuyển động / bấm được: bộ gộp bỏ qua cả nhánh (màn hình, ghế, chuột, đồng hồ...) */
export const DYNAMIC = { dynamic: true } as const

/** Vật liệu giống hệt nhau (khác đối tượng) thì gộp chung được */
function materialKey(m: Material) {
  const s = m as MeshStandardMaterial
  return [
    m.type, s.color?.getHexString(), s.emissive?.getHexString(), s.emissiveIntensity, s.roughness, s.metalness,
    s.map?.uuid, m.transparent, m.opacity, m.side, m.depthWrite,
  ].join('|')
}

/**
 * Phòng dựng từ vài trăm khối nhỏ, mỗi khối một lượt vẽ: sau khi dựng xong, gộp các khối đứng yên cùng vật liệu
 * thành một lưới (đã nhân sẵn vị trí), ẩn khối gốc. Vẽ lại phòng (đổi danh sách agent) thì gộp lại từ đầu.
 */
export function useMergeStatic() {
  const root = useRef<Group>(null)
  useLayoutEffect(() => {
    const g = root.current
    if (!g) return
    g.updateWorldMatrix(true, true)
    const toLocal = new Matrix4().copy(g.matrixWorld).invert()
    const groups = new Map<string, { material: Material; meshes: Mesh[] }>()
    const walk = (o: { children: typeof g.children; userData: Record<string, unknown> }) => {
      for (const c of o.children) {
        if (c.userData.dynamic) continue
        const m = c as Mesh
        // chỉ Mesh thường (không phải chữ, lưới có xương...), một vật liệu, không có sự kiện chuột
        if (m.isMesh && m.constructor === Mesh && !Array.isArray(m.material) && m.visible) {
          const geo = m.geometry
          const key = [materialKey(m.material), m.castShadow, m.receiveShadow, !!geo.index, Object.keys(geo.attributes).sort().join()].join('#')
          const e = groups.get(key) ?? { material: m.material, meshes: [] }
          e.meshes.push(m)
          groups.set(key, e)
        }
        if (c.visible) walk(c)
      }
    }
    walk(g)
    const merged: Mesh[] = []
    const hidden: Mesh[] = []
    for (const { material, meshes } of groups.values()) {
      if (meshes.length < 2) continue
      const geos = meshes.map((m) => {
        const geo = m.geometry.clone()
        for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name)
        return geo.applyMatrix4(new Matrix4().multiplyMatrices(toLocal, m.matrixWorld))
      })
      const geometry = mergeGeometries(geos as BufferGeometry[])
      geos.forEach((x) => x.dispose())
      if (!geometry) continue
      const mesh = new Mesh(geometry, material)
      mesh.castShadow = meshes[0].castShadow
      mesh.receiveShadow = meshes[0].receiveShadow
      mesh.userData.merged = true
      g.add(mesh)
      merged.push(mesh)
      for (const m of meshes) m.visible = false
      hidden.push(...meshes)
    }
    return () => {
      for (const mesh of merged) {
        g.remove(mesh)
        mesh.geometry.dispose()
      }
      for (const m of hidden) m.visible = true
    }
  })
  return root
}
