/**
 * Public engine API. Scenes, timelines and projects import from '@mvs/engine'.
 *
 *   import { defineScene, kit, ease } from '@mvs/engine'
 *
 * Everything exported here is considered stable. Internals (renderer,
 * compositor, player) are not part of the content API.
 */

// definitions
export { defineProject, type ProjectDefinition, type CueSheet } from './core/project.ts'
export { defineScene, type SceneDefinition, type Frame, type Anchor, type CueContext, type Quality } from './core/scene.ts'
export { defineTimeline, type TimelineEntry, type TimelineHelpers, type TimelineDefinition } from './core/timeline.ts'
export { defineBrand, defaultBrand, motionPresets, bundledFonts, defaultLook } from './core/brand.ts'
export { formats, makeStage, type FormatName } from './core/format.ts'
export type * from './core/types.ts'

// graphics
export type {
  Graphics,
  Paint,
  Gradient,
  Blend,
  Box,
  ShapeStyle,
  GroupOptions,
  TextOptions,
  ImageOptions,
  VideoOptions,
  IconOptions,
  LayerOptions,
  ClipShape,
  AnchorPoint,
} from './gfx/graphics.ts'
export { boxRect } from './gfx/graphics.ts'
export type { TextAnimation, TextMark, TextResult } from './gfx/text.ts'
export { alpha, mixColor, shade, parseColor, contrast } from './gfx/color.ts'
export type { Camera } from './gl/camera.ts'

// motion
export { ease, eases, cubicBezier, type Ease, type EaseName } from './motion/easing.ts'
export { spring, springs, springSettle, type SpringConfig } from './motion/spring.ts'
export { clamp, clamp01, lerp, mix, invLerp, remap, smoothstep, progress, interpolate, keyframes, stagger, pingpong, loop, steps, lerpAngle } from './motion/tween.ts'
export { rng, hash01, hash32, noise1, noise2, fbm1, wiggle } from './motion/noise.ts'
export { arc, followPath, cubicPoint, type Waypoint } from './motion/path.ts'

// components and scene templates
export * as kit from './kit/index.ts'
export * as templates from './templates/index.ts'
