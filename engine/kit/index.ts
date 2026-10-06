/**
 * Component kit: building blocks for product / app / marketing videos.
 * Everything is positioned by its center and reads time from g.f.
 *
 *   import { kit } from '@mvs/engine'
 *   kit.background(g, { kind: 'mesh' })
 *   kit.browser(g, { x, y, w, h, url: 'app.orbit.dev' }, (screen) => g.image('screens/dashboard.png', { ... }))
 */

export { responsive, row, grid, split, center, fitBox, inset, type Responsive } from './layout.ts'
export { background, meshGradient, gridLines, dots, aurora, particles, sheen, type BackgroundOptions, type BackgroundKind } from './backgrounds.ts'
export { browser, phone, glass, type BrowserOptions, type PhoneOptions } from './devices.ts'
export { card, button, pill, toggle, avatar, progressBar, check, toast, cursorPath, cursor, type ButtonOptions, type CursorState } from './ui.ts'
export { barChart, lineChart, donut, ring, counter, formatNumber, type BarChartOptions, type LineChartOptions } from './charts.ts'
export { codeBlock, terminal, tokenizeLine, codeTheme, type CodeOptions, type TerminalLine, type Token, type TokenType } from './code.ts'
export { captions, chunkWords, type CaptionOptions } from './captions.ts'
export { logo, logoReveal } from './logo.ts'
export { drift, punch, shake, move, combine, type Offset } from './camera.ts'
export { headline, type HeadlineOptions } from './headline.ts'
