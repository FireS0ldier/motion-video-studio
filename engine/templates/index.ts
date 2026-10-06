/**
 * Scene templates: complete, parameterized scenes. Build a video from config:
 *
 *   import { templates as T } from '@mvs/engine'
 *   export const hook = T.title({ title: 'Your dashboards are **always late**' })
 *
 * Each returns a normal SceneDefinition; to customize deeply, copy the
 * template source into your project's scenes/ and edit it.
 */

export { title, kinetic, quote, montage, type TitleOptions, type KineticOptions, type KineticLine, type QuoteOptions, type MontageWord } from './text.ts'
export { showcase, screenshot, recording, phoneShowcase, type ShowcaseOptions, type PhoneShowcaseOptions, type Media, type Callout } from './media.ts'
export { features, stats, code, cta, logoScene, type FeaturesOptions, type Feature, type Stat, type CodeSceneOptions, type CtaOptions } from './blocks.ts'
export { when, cueWhen, plain } from './common.ts'
