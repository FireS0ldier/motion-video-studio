import { defineBrand, motionPresets } from '@mvs/engine'

/**
 * Brand tokens. Change colors, fonts, motion style and logo here; every scene
 * and template reads them. Logo: put an SVG/PNG in assets/brand/ and set
 * logo: { mark: 'assets/brand/mark.svg' } (or full: for a wordmark file).
 */
export default defineBrand({
  name: 'Acme',
  colors: {
    bg: '#0b0b12',
    surface: '#14141f',
    surface2: '#1c1c2b',
    text: '#f5f5fa',
    muted: '#8e8ea6',
    primary: '#5b6cff',
    accent: '#ff7a59',
  },
  gradients: { brand: ['#5b6cff', '#ff7a59'] },
  motion: motionPresets.smooth,
})
