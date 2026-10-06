/**
 * Shared data types. Everything in this file is plain data (JSON-compatible
 * where it is persisted) so it can be used by the browser engine, the Node
 * CLI and the tests alike.
 */

import type { Ease } from '../motion/easing.ts'
import type { SpringConfig } from '../motion/spring.ts'

// ---------------------------------------------------------------- format

export interface Format {
  width: number
  height: number
  fps: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Layout helpers for the current composition. Scenes should position with these, never with magic numbers. */
export interface Stage {
  w: number
  h: number
  cx: number
  cy: number
  fps: number
  aspect: number
  portrait: boolean
  landscape: boolean
  square: boolean
  /** Short side / 1080: multiply sizes by this to stay proportional across formats. */
  unit: number
  /** Action-safe area (5% inset). Keep important motion inside. */
  safe: Rect
  /** Title-safe area (10% inset, 12% on portrait sides). Keep text inside. */
  title: Rect
}

// ---------------------------------------------------------------- timing

export type TimingSource = 'ctc' | 'whisperx' | 'heuristic' | 'estimate' | 'tts' | 'manual'

export interface TimedWord {
  i: number
  /** Display text as written in script.md (may contain punctuation). */
  text: string
  /** Normalized for matching: lowercase letters/digits only. */
  norm: string
  start: number
  end: number
  section: string
  sentence: number
  /** Alignment confidence 0..1 when the aligner provides it. */
  conf?: number
}

export interface TimedSentence {
  i: number
  text: string
  start: number
  end: number
  section: string
  first: number
  last: number
}

export interface TimedSection {
  id: string
  title: string
  start: number
  end: number
  first: number
  last: number
}

/** data/timing.json — word-level timing of the voiceover. Times are in voiceover-file seconds. */
export interface TimingData {
  version: 1
  source: TimingSource
  /** Voiceover file the timing was computed from (project-relative), if any. */
  audio?: string
  audioDuration?: number
  /** Hash of the spoken script; used to detect a stale timing file. */
  scriptHash?: string
  words: TimedWord[]
  sentences: TimedSentence[]
  sections: TimedSection[]
}

export interface Span {
  start: number
  end: number
  text?: string
}

// ---------------------------------------------------------------- audio analysis

export interface VoiceAnalysis {
  /** RMS envelope normalized 0..1 at `rate` Hz. */
  envelope: number[]
  /** Speech onset times (s). */
  onsets: number[]
  /** Silence intervals [start, end] (s). */
  silences: Array<[number, number]>
  lufs: number
  peakDb: number
}

export interface MusicAnalysis {
  envelope: number[]
  bpm: number
  /** Beat times (s), in timeline time once the music offset is applied. */
  beats: number[]
  onsets: number[]
}

/** data/audio.json — produced by `mvs analyze`. Times are in source-file seconds. */
export interface AudioAnalysisData {
  version: 1
  rate: number
  duration: number
  voice?: VoiceAnalysis
  music?: MusicAnalysis
}

// ---------------------------------------------------------------- brand

export interface FontSource {
  url: string
  weight?: string
  style?: 'normal' | 'italic'
  unicodeRange?: string
}

export interface FontSpec {
  family: string
  sources: FontSource[]
  /** CSS fallback stack. */
  fallback?: string
  /** OpenType feature settings, e.g. '"ss01", "cv11"'. */
  features?: string
}

export type FontRole = 'display' | 'body' | 'mono' | 'serif'

export interface TypeStyle {
  font: FontRole | string
  size: number
  weight?: number
  /** Letter spacing in em (e.g. -0.02). */
  tracking?: number
  /** Line height multiplier. */
  leading?: number
  italic?: boolean
  uppercase?: boolean
  color?: string
}

export interface ShadowSpec {
  x: number
  y: number
  blur: number
  color: string
}

export type TextPreset = 'rise' | 'fade' | 'blur' | 'mask' | 'pop' | 'slam' | 'type' | 'scramble' | 'karaoke' | 'none'

export interface MotionStyle {
  enter: Ease
  exit: Ease
  move: Ease
  durations: { fast: number; base: number; slow: number }
  /** Default stagger between items (s). */
  stagger: number
  spring: SpringConfig
  /** Distance (px at 1080p) elements travel on entrance. */
  distance: number
  text: { preset: TextPreset; by: 'char' | 'word' | 'line' }
}

export interface Look {
  bloom: { strength: number; radius: number; threshold: number }
  vignette: { strength: number; softness: number }
  grain: { amount: number; size: number }
  /** Chromatic aberration at the frame edge, px at 1080p. */
  aberration: number
  grade: {
    exposure: number
    contrast: number
    saturation: number
    /** Warm (+) / cool (-), roughly -1..1. */
    temperature: number
    /** Green (-) / magenta (+), roughly -1..1. */
    tint: number
    /** Lift shadows (0 = none). */
    lift: number
  }
  motionBlur: {
    /** Shutter as a fraction of the frame interval (0.5 = 180° shutter). */
    shutter: number
    /** Samples per frame for final renders: number or 'auto'. */
    samples: number | 'auto'
    maxSamples: number
  }
}

export interface Brand {
  name: string
  colors: {
    bg: string
    surface: string
    surface2: string
    border: string
    text: string
    muted: string
    primary: string
    accent: string
    success: string
    warning: string
    danger: string
    [key: string]: string
  }
  gradients: Record<string, string[]>
  fonts: Record<FontRole, FontSpec> & Record<string, FontSpec>
  type: Record<'hero' | 'h1' | 'h2' | 'h3' | 'body' | 'label' | 'caption' | 'eyebrow' | 'code', TypeStyle> &
    Record<string, TypeStyle>
  radius: { sm: number; md: number; lg: number; xl: number; pill: number }
  space: { xs: number; sm: number; md: number; lg: number; xl: number; xxl: number }
  shadows: Record<'sm' | 'md' | 'lg' | 'glow', ShadowSpec[]> & Record<string, ShadowSpec[]>
  motion: MotionStyle
  look: Look
  /** Logo files relative to the project folder (e.g. 'assets/brand/logo.svg'). */
  logo?: { full?: string; mark?: string }
  [key: string]: unknown
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

// ---------------------------------------------------------------- audio config & cues

export interface VoiceoverSpec {
  /** Project-relative path, e.g. 'assets/audio/voiceover.wav'. */
  src: string
  /** Seconds of picture before the voice starts. */
  offset?: number
  gain?: number
}

export interface MusicSpec {
  src: string
  offset?: number
  /** Gain in dB (before ducking). */
  gain?: number
  /** How many dB the music ducks under the voice. */
  duck?: number
  fadeIn?: number
  fadeOut?: number
}

export interface AudioConfig {
  voiceover?: VoiceoverSpec
  music?: MusicSpec
  sfx?: {
    /** Bus gain for all SFX (dB). */
    gain?: number
    /** How many dB SFX duck under the voice. */
    duck?: number
  }
  master?: {
    /** Integrated loudness target (LUFS). -14 for web/social, -16 for podcasts, -23 for broadcast. */
    lufs?: number
    /** Peak ceiling (dBFS). */
    ceiling?: number
  }
}

export interface Cue {
  /** SFX name (file in project assets/sfx or the shared library) or project-relative path. */
  sound: string
  /** Timeline time (s). */
  at: number
  /** Gain in dB. */
  gain?: number
  /** Stereo pan -1..1. */
  pan?: number
  /** Playback rate (pitch + speed). */
  rate?: number
  /** 'peak' aligns the sound's loudest moment with `at` (uses library metadata). Default 'start'. */
  align?: 'start' | 'peak'
  /** Free-form label (shows up in the preview timeline). */
  label?: string
}

// ---------------------------------------------------------------- transitions

export type TransitionType = 'cut' | 'fade' | 'dip' | 'slide' | 'push' | 'zoom' | 'wipe' | 'iris' | 'blur' | 'glitch' | 'whip'

export interface TransitionSpec {
  type: TransitionType
  /** Seconds. */
  duration?: number
  ease?: Ease
  direction?: 'left' | 'right' | 'up' | 'down'
  /** Dip color. */
  color?: string
  /** Iris / zoom center in stage pixels. */
  center?: [number, number]
  /** Sound effect for this transition; false to silence the default. */
  sfx?: string | false
  /** Where the transition sits relative to the cut. Default 'center'. */
  align?: 'center' | 'start' | 'end'
}

// ---------------------------------------------------------------- manifest

export interface ManifestScene {
  id: string
  name: string
  start: number
  end: number
  transition?: TransitionSpec
}

/** What the browser reports to the CLI: everything needed to render, mix and check a project. */
export interface Manifest {
  id: string
  title: string
  width: number
  height: number
  fps: number
  duration: number
  frames: number
  scenes: ManifestScene[]
  audio: AudioConfig
  cues: Cue[]
  timing: { source: TimingSource; words: number; stale: boolean; voiceStart: number; voiceEnd: number }
  look: Look
  warnings: string[]
}
