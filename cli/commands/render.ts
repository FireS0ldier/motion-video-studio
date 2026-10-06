import { once } from 'node:events'
import { existsSync, renameSync, rmSync } from 'node:fs'
import { cpus } from 'node:os'
import { join, resolve } from 'node:path'
import type { Args } from '../lib/args.ts'
import { BITEXACT, ffmpeg, probe, spawnRawEncoder } from '../lib/ffmpeg.ts'
import { CliError, color, fmtDuration, log, progress } from '../lib/log.ts'
import { ensureDir, rel, requireProject, writeJson } from '../lib/paths.ts'
import { openSession } from '../lib/session.ts'
import { prepareAssets } from './assets.ts'
import { ensureMix } from './mix.ts'

export const renderHelp = `mvs render <project> [--draft | --final] [options]

  --draft          fast preview render: half resolution, 30 fps, no motion blur, CRF 23
  --final          (default) full resolution, project fps, adaptive motion blur, CRF 16
  --uhd / --4k     final at scale 2 (3840x2160 for a 1080p project) — slow, ask first
  --scale <n>      render scale (0.5, 1, 2 ...)
  --samples <n>    motion-blur samples per frame: auto | 1 | 4 | 8 ...
  --fps <n>        output frame rate (default: project fps; draft: 30)
  --from <s> --to <s>   render a time range
  --scene <id>     render only one scene
  --workers <n>    parallel browser workers (default: half the CPU cores, max 4)
  --crf <n>        x264 quality (lower = better, bigger)
  --format <name>  render another format (vertical, square, ...) if scenes support it
  --no-audio       skip mixing / muxing audio
  --out <file>     output path (default out/<project>/<project>[-draft].mp4)`

function defaultWorkers(): number {
  const env = Number(process.env.MVS_WORKERS)
  if (env > 0) return env
  return Math.max(1, Math.min(4, Math.floor(cpus().length / 2)))
}

export async function renderCommand(a: Args) {
  const p = requireProject(a._[0])
  const draft = a.bool('draft')
  const uhd = a.bool('uhd') || a.bool('4k')
  const scale = a.num('scale') ?? (uhd ? 2 : draft ? 0.5 : 1)
  const quality = draft ? 'draft' : 'final'
  const samplesArg = a.str('samples') ?? (draft ? '1' : 'auto')
  const samples = samplesArg === 'auto' ? 'auto' : Number(samplesArg)
  if (samples !== 'auto' && !(samples >= 1)) throw new CliError('--samples must be "auto" or a number >= 1')
  const workers = Math.max(1, a.num('workers') ?? defaultWorkers())
  const withAudio = a.bool('audio', true)

  await prepareAssets(p, { quiet: true })
  log.step(`Opening ${workers} render worker${workers > 1 ? 's' : ''} (scale ${scale}, ${quality})`)
  const session = await openSession({ project: p.id, scale, quality, workers, format: a.str('format'), verbose: a.bool('verbose') })
  const t0 = Date.now()
  let encoder: ReturnType<typeof spawnRawEncoder> | null = null
  try {
    const m = session.manifest
    const fps = a.num('fps') ?? (draft ? Math.min(30, m.fps) : m.fps)
    let from = a.num('from') ?? 0
    let to = a.num('to') ?? m.duration
    const sceneId = a.str('scene')
    if (sceneId) {
      const s = m.scenes.find((x) => x.id === sceneId)
      if (!s) throw new CliError(`Scene "${sceneId}" not found.`, `Scenes: ${m.scenes.map((x) => x.id).join(', ')}`)
      from = s.start
      to = s.end
    }
    to = Math.min(to, m.duration)
    if (!(to > from)) throw new CliError(`Empty range: --from ${from} --to ${to}`)
    const f0 = Math.round(from * fps)
    const f1 = Math.max(f0 + 1, Math.round(to * fps))
    const total = f1 - f0
    const W = Math.round(m.width * scale)
    const H = Math.round(m.height * scale)
    if (W % 2 || H % 2) throw new CliError(`Output size ${W}x${H} must be even for H.264. Use another --scale.`)
    for (const w of m.warnings) log.warn(w)

    const suffix = `${draft ? '-draft' : ''}${scale === 2 ? '-4k' : scale !== 1 && !draft ? `-x${scale}` : ''}${sceneId ? `-${sceneId}` : ''}`
    const out = resolve(a.str('out') ?? join(p.out, `${p.id}${suffix}.mp4`))
    ensureDir(resolve(out, '..'))
    const videoOnly = join(ensureDir(join(p.build, 'render')), `video${suffix}.mp4`)
    log.step(`Rendering ${total} frames ${W}x${H} @ ${fps} fps (${(to - from).toFixed(2)} s), samples ${samples} → ${rel(out)}`)

    encoder = spawnRawEncoder({ width: W, height: H, fps, out: videoOnly, preset: draft ? 'draft' : 'final', crf: a.num('crf') })
    let encErr = ''
    encoder.stderr.on('data', (d: Buffer) => (encErr += d.toString()))
    const encDone = once(encoder, 'close')

    // ---- ordered frame writer with back-pressure
    const frameBytes = W * H * 4
    const pending = new Map<number, Buffer>()
    let next = f0
    let pumping = false
    let waiters: Array<() => void> = []
    const notify = () => {
      const w = waiters
      waiters = []
      for (const fn of w) fn()
    }
    const pump = async () => {
      if (pumping) return
      pumping = true
      try {
        while (pending.has(next)) {
          const buf = pending.get(next)!
          pending.delete(next)
          if (!encoder!.stdin.write(buf)) await once(encoder!.stdin, 'drain')
          next++
          notify()
        }
      } finally {
        pumping = false
      }
    }
    const sinkUrl = session.sink('render', async (body, path) => {
      const idx = Number(path.split('/')[1])
      if (body.length !== frameBytes) throw new Error(`frame ${idx}: ${body.length} bytes, expected ${frameBytes}`)
      pending.set(idx, body)
      await pump()
      while (idx - next > workers * 2) await new Promise<void>((r) => waiters.push(r))
    })

    const prog = progress('frames', total)
    let done = 0
    let samplesSum = 0
    const slow: Array<{ frame: number; ms: number }> = []
    await Promise.all(
      session.workers.map(async (w, wi) => {
        for (let f = f0 + wi; f < f1; f += session.workers.length) {
          const stats = await w.send(f, `${sinkUrl}/${f}`, { samples, time: f / fps })
          samplesSum += stats.samples
          slow.push({ frame: f, ms: stats.ms })
          done++
          prog.update(done, samples === 'auto' ? `avg ${(samplesSum / done).toFixed(1)} samples` : '')
        }
      }),
    )
    while (next < f1) await new Promise<void>((r) => waiters.push(r))
    encoder.stdin.end()
    const [code] = (await encDone) as [number]
    if (code !== 0) throw new CliError(`ffmpeg encoder failed (exit ${code}): ${encErr.trim()}`)
    const renderSecs = prog.done(`Rendered ${total} frames`)
    const warnings = await session.workers[0]!.page.evaluate(() => window.__MVS__!.warnings())
    await session.close()

    // ---- audio
    let audioInfo: string | null = null
    if (withAudio) {
      const mix = await ensureMix(p, m)
      if (mix) {
        log.step('Muxing audio')
        await ffmpeg([
          '-i',
          videoOnly,
          '-ss',
          from.toFixed(6),
          '-t',
          (total / fps).toFixed(6),
          '-i',
          mix,
          '-map',
          '0:v',
          '-map',
          '1:a',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-b:a',
          draft ? '192k' : '320k',
          '-ar',
          '48000',
          ...BITEXACT,
          '-movflags',
          '+faststart',
          '-shortest',
          out,
        ])
        rmSync(videoOnly, { force: true })
        audioInfo = rel(mix)
      }
    }
    if (!audioInfo) {
      if (existsSync(out)) rmSync(out)
      renameSync(videoOnly, out)
    }
    const info = await probe(out)
    const report = {
      project: p.id,
      output: rel(out),
      mode: quality,
      width: W,
      height: H,
      fps,
      from,
      to,
      frames: total,
      samples: samplesArg,
      avgSamples: Number((samplesSum / total).toFixed(2)),
      workers,
      renderSeconds: Number(renderSecs.toFixed(1)),
      totalSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
      audio: audioInfo,
      probe: info,
      slowestFrames: slow.sort((x, y) => y.ms - x.ms).slice(0, 5),
      warnings,
    }
    writeJson(out.replace(/\.mp4$/, '.render.json'), report)
    log.ok(`${color.bold(rel(out))}  ${info.video?.width}x${info.video?.height} · ${info.video?.fps.toFixed(2)} fps · ${info.duration.toFixed(2)} s${info.audio ? ' · audio ' + info.audio.codec : ' · no audio'} · total ${fmtDuration(report.totalSeconds)}`)
    for (const w of warnings) log.warn(w)
  } catch (e) {
    encoder?.kill('SIGKILL')
    await session.close().catch(() => {})
    throw e
  }
}
