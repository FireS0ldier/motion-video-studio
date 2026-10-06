/** Minimal column-major 4x4 matrix math for the compositor (GL convention). */

export type Mat4 = Float32Array

export function identity(): Mat4 {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

/** out = a * b */
export function multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!
    }
  }
  return out
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity()
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

export function scaling(x: number, y: number, z = 1): Mat4 {
  const m = identity()
  m[0] = x
  m[5] = y
  m[10] = z
  return m
}

export function rotationX(rad: number): Mat4 {
  const m = identity()
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  m[5] = c
  m[6] = s
  m[9] = -s
  m[10] = c
  return m
}

export function rotationY(rad: number): Mat4 {
  const m = identity()
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  m[0] = c
  m[2] = -s
  m[8] = s
  m[10] = c
  return m
}

export function rotationZ(rad: number): Mat4 {
  const m = identity()
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  m[0] = c
  m[1] = s
  m[4] = -s
  m[5] = c
  return m
}

/** Chain: product(m0, m1, m2) = m0 * m1 * m2 (m2 applied first). */
export function product(...ms: Mat4[]): Mat4 {
  let out = ms[0]!
  for (let i = 1; i < ms.length; i++) out = multiply(out, ms[i]!)
  return out
}

export function transformPoint(m: Mat4, x: number, y: number, z: number): [number, number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]!,
  ]
}
