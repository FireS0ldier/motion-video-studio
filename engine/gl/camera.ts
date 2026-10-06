/**
 * 2.5D camera shared by 2D canvas drawing and GPU layers, so parallax planes
 * drawn in 2D and 3D cards drawn by the compositor line up exactly.
 *
 * Model (like CSS perspective / an After Effects one-node camera):
 *  - the camera looks at (x, y) on the z = 0 plane from `perspective` px away
 *  - positive layer z = farther away; positive camera z = dolly in
 *  - zoom scales the image, rotate rolls it (degrees)
 */

import type { Stage } from '../core/types.ts'
import { multiply, rotationZ, translation, type Mat4 } from './mat4.ts'

export interface Camera {
  x: number
  y: number
  z: number
  zoom: number
  rotate: number
  /** Distance from eye to the z = 0 plane in px. Smaller = stronger perspective. */
  perspective: number
  /** Depth of field: z that is in focus, and blur (px) per 1000 units of defocus. */
  focus: number
  aperture: number
}

export function defaultCamera(stage: Stage): Camera {
  return { x: stage.cx, y: stage.cy, z: 0, zoom: 1, rotate: 0, perspective: Math.max(stage.w, stage.h) * 1.4, focus: 0, aperture: 0 }
}

/** Uniform scale of a plane at depth z (relative to z = 0 at zoom 1). */
export function depthScale(cam: Camera, z: number): number {
  const d = cam.perspective + z - cam.z
  return d <= 1 ? 0 : (cam.zoom * cam.perspective) / d
}

/** 2D canvas transform (a, b, c, d, e, f) for drawing a plane at depth z, in stage pixels. */
export function planeTransform(cam: Camera, stage: Stage, z: number): DOMMatrix {
  const k = depthScale(cam, z)
  const m = new DOMMatrix()
  m.translateSelf(stage.cx, stage.cy)
  if (cam.rotate) m.rotateSelf(0, 0, -cam.rotate)
  m.scaleSelf(k, k)
  m.translateSelf(-cam.x, -cam.y)
  return m
}

/** Clip-space projection * view for GPU layers. Stage pixels in, clip space out. */
export function viewProjection(cam: Camera, stage: Stage): Mat4 {
  const proj = new Float32Array(16)
  proj[0] = (2 * cam.zoom) / stage.w
  proj[5] = (-2 * cam.zoom) / stage.h
  proj[10] = 0
  proj[11] = 1 / cam.perspective
  proj[15] = 1
  const view = multiply(rotationZ((-cam.rotate * Math.PI) / 180), translation(-cam.x, -cam.y, -cam.z))
  return multiply(proj, view)
}

/** Defocus blur radius (px at 1080p) for a layer at depth z. */
export function defocus(cam: Camera, z: number): number {
  if (!cam.aperture) return 0
  return (cam.aperture * Math.abs(z - cam.focus)) / 1000
}
