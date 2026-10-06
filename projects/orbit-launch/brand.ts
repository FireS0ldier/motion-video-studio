import { defineBrand, motionPresets } from '@mvs/engine'

/** Orbit (fictional product) — everything visual that should stay consistent. */
export default defineBrand({
  name: 'Orbit',
  colors: {
    bg: '#07080d',
    surface: '#10131c',
    surface2: '#181c29',
    border: 'rgba(255,255,255,0.08)',
    text: '#f3f5fb',
    muted: '#8a93a8',
    primary: '#7c5cff',
    accent: '#2ee6d6',
    success: '#3ddc97',
    warning: '#ffb547',
    danger: '#ff5d73',
  },
  gradients: {
    brand: ['#7c5cff', '#2ee6d6'],
    hot: ['#ff5d73', '#ffb547'],
  },
  logo: { mark: 'assets/brand/mark.svg' },
  motion: motionPresets.smooth,
  shadows: {
    glow: [{ x: 0, y: 0, blur: 60, color: 'rgba(124,92,255,0.45)' }],
  },
  look: {
    bloom: { strength: 0.42, radius: 0.7, threshold: 0.7 },
    grain: { amount: 0.03, size: 1.2 },
    vignette: { strength: 0.3, softness: 0.65 },
  },
})
