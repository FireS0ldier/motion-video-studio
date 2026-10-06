/**
 * mvs — Motion Video Studio CLI.
 * Run `npx mvs help` for the command list, `npx mvs <command> --help` for details.
 */

import { parseArgs, type Args } from './lib/args.ts'
import { CliError, color, log } from './lib/log.ts'

interface CommandModule {
  run(a: Args): Promise<void>
  help: string
}

interface CommandSpec {
  summary: string
  booleans?: string[]
  load(): Promise<CommandModule>
}

const commands: Record<string, CommandSpec> = {
  new: {
    summary: 'Create a new video project from a template',
    booleans: ['force'],
    load: async () => {
      const m = await import('./commands/new.ts')
      return { run: m.newCommand, help: m.newHelp }
    },
  },
  dev: {
    summary: 'Start the live preview (http://localhost:5173)',
    booleans: ['host', 'open'],
    load: async () => {
      const m = await import('./commands/dev.ts')
      return { run: m.devCommand, help: m.devHelp }
    },
  },
  doctor: {
    summary: 'Check Node, ffmpeg, browser/WebGL, Python/uv and fonts',
    booleans: ['render'],
    load: async () => {
      const m = await import('./commands/doctor.ts')
      return { run: m.doctorCommand, help: m.doctorHelp }
    },
  },
  info: {
    summary: 'Print a project summary: format, duration, scenes, timing, cues',
    booleans: ['json'],
    load: async () => {
      const m = await import('./commands/info.ts')
      return { run: m.infoCommand, help: m.infoHelp }
    },
  },
  voice: {
    summary: 'Generate a voiceover from script.md with local TTS (Kokoro)',
    load: async () => {
      const m = await import('./commands/voice.ts')
      return { run: m.voiceCommand, help: m.voiceHelp }
    },
  },
  align: {
    summary: 'Word-level timing of the voiceover → data/timing.json',
    booleans: ['estimate'],
    load: async () => {
      const m = await import('./commands/align.ts')
      return { run: m.alignCommand, help: m.alignHelp }
    },
  },
  analyze: {
    summary: 'Audio analysis (loudness envelope, onsets, beats) → data/audio.json',
    load: async () => {
      const m = await import('./commands/analyze.ts')
      return { run: m.analyzeCommand, help: m.analyzeHelp }
    },
  },
  assets: {
    summary: 'Prepare assets (screen recordings → frame sequences, image checks)',
    booleans: ['force'],
    load: async () => {
      const m = await import('./commands/assets.ts')
      return { run: m.assetsCommand, help: m.assetsHelp }
    },
  },
  sfx: {
    summary: 'Regenerate / list the procedural sound-effect library',
    booleans: ['list'],
    load: async () => {
      const m = await import('./commands/sfx.ts')
      return { run: m.sfxCommand, help: m.sfxHelp }
    },
  },
  mix: {
    summary: 'Mix voiceover + music + SFX → build/mix.wav (-14 LUFS)',
    booleans: ['force'],
    load: async () => {
      const m = await import('./commands/mix.ts')
      return { run: m.mixCommand, help: m.mixHelp }
    },
  },
  still: {
    summary: 'Render PNG stills (final quality) at given times',
    load: async () => {
      const m = await import('./commands/still.ts')
      return { run: m.stillCommand, help: m.stillHelp }
    },
  },
  render: {
    summary: 'Render the video (--draft fast, --final default, --uhd 4K)',
    booleans: ['draft', 'final', 'uhd', '4k', 'audio'],
    load: async () => {
      const m = await import('./commands/render.ts')
      return { run: m.renderCommand, help: m.renderHelp }
    },
  },
  check: {
    summary: 'Validate a project: timing, anchors, assets, crashes, slow frames, text outside the frame',
    booleans: ['strict'],
    load: async () => {
      const m = await import('./commands/check.ts')
      return { run: m.checkCommand, help: m.checkHelp }
    },
  },
  review: {
    summary: 'Contact sheet + per-scene stills + check report for visual review',
    load: async () => {
      const m = await import('./commands/review.ts')
      return { run: m.reviewCommand, help: m.reviewHelp }
    },
  },
  clean: {
    summary: 'Delete build caches and renders of a project',
    booleans: ['all'],
    load: async () => {
      const m = await import('./commands/clean.ts')
      return { run: m.cleanCommand, help: m.cleanHelp }
    },
  },
}

function printHelp() {
  log.info(`${color.bold('mvs')} — Motion Video Studio\n`)
  log.info('Usage: npx mvs <command> [project] [options]\n')
  const w = Math.max(...Object.keys(commands).map((k) => k.length))
  for (const [name, spec] of Object.entries(commands)) log.info(`  ${color.cyan(name.padEnd(w))}  ${spec.summary}`)
  log.info(`\nTypical flow: new → (voice) → align → analyze → dev → still → render --draft → render`)
  log.info(`Docs: README.md, CLAUDE.md, docs/. Details: npx mvs <command> --help`)
}

async function main() {
  const [name, ...rest] = process.argv.slice(2)
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    printHelp()
    return
  }
  const spec = commands[name]
  if (!spec) {
    log.error(`Unknown command "${name}".`)
    printHelp()
    process.exitCode = 1
    return
  }
  const args = parseArgs(rest, spec.booleans)
  const mod = await spec.load()
  if (args.bool('help')) {
    log.info(mod.help)
    return
  }
  await mod.run(args)
}

main().catch((e: unknown) => {
  if (e instanceof CliError) {
    log.error(e.message)
    if (e.hint) log.info(color.gray(`  ${e.hint}`))
  } else {
    log.error((e as Error)?.stack ?? String(e))
  }
  process.exitCode = 1
})
