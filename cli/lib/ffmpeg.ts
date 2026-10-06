import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { CliError } from './log.ts'
import { run, which } from './exec.ts'

export interface ProbeInfo {
  duration: number
  video?: { width: number; height: number; fps: number; codec: string; frames?: number; pixFmt?: string }
  audio?: { rate: number; channels: number; codec: string }
}

export function ffmpegPath(): string {
  const p = process.env.MVS_FFMPEG ?? which('ffmpeg')
  if (!p) throw new CliError('ffmpeg not found on PATH.', 'Install a full ffmpeg build with libx264 (brew install ffmpeg / apt install ffmpeg / winget install ffmpeg), or set MVS_FFMPEG.')
  return p
}

export function ffprobePath(): string {
  const p = process.env.MVS_FFPROBE ?? which('ffprobe')
  if (!p) throw new CliError('ffprobe not found on PATH.', 'It ships with ffmpeg. Set MVS_FFPROBE if it lives elsewhere.')
  return p
}

export async function probe(file: string): Promise<ProbeInfo> {
  const r = await run(ffprobePath(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
  if (r.code !== 0) throw new CliError(`ffprobe failed on ${file}: ${r.stderr.trim()}`)
  const j = JSON.parse(r.stdout) as {
    format: { duration?: string }
    streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; nb_frames?: string; sample_rate?: string; channels?: number; pix_fmt?: string; duration?: string }>
  }
  const info: ProbeInfo = { duration: Number(j.format.duration ?? 0) }
  const v = j.streams.find((s) => s.codec_type === 'video')
  if (v) {
    const [a, b] = (v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : (v.r_frame_rate ?? '0/1')).split('/').map(Number)
    info.video = { width: v.width ?? 0, height: v.height ?? 0, fps: b ? a! / b : 0, codec: v.codec_name, frames: v.nb_frames ? Number(v.nb_frames) : undefined, pixFmt: v.pix_fmt }
    if (!info.duration && v.duration) info.duration = Number(v.duration)
  }
  const au = j.streams.find((s) => s.codec_type === 'audio')
  if (au) info.audio = { rate: Number(au.sample_rate ?? 0), channels: au.channels ?? 0, codec: au.codec_name }
  return info
}

export type EncodePreset = 'final' | 'draft' | 'lossless'

/** H.264 settings. BT.709 tagged, yuv420p (plays everywhere), bit-exact container. */
export function videoEncodeArgs(preset: EncodePreset, crf?: number): string[] {
  const color = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
  const vf = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int+bitexact,format=yuv420p']
  if (preset === 'lossless') return [...vf, '-c:v', 'libx264', '-preset', 'medium', '-qp', '0', ...color]
  if (preset === 'draft') return [...vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf ?? 23), '-g', '60', ...color]
  return [...vf, '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf ?? 16), '-profile:v', 'high', '-bf', '3', '-g', '120', '-x264-params', 'aq-mode=3', ...color]
}

export const BITEXACT = ['-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1']

/** Spawn an encoder that reads raw RGBA frames on stdin. */
export function spawnRawEncoder(o: { width: number; height: number; fps: number; out: string; preset: EncodePreset; crf?: number }): ChildProcessWithoutNullStreams {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${o.width}x${o.height}`,
    '-r',
    String(o.fps),
    '-i',
    '-',
    ...videoEncodeArgs(o.preset, o.crf),
    ...BITEXACT,
    '-movflags',
    '+faststart',
    o.out,
  ]
  return spawn(ffmpegPath(), args, { stdio: ['pipe', 'pipe', 'pipe'] })
}

export async function ffmpeg(args: string[], echo = false): Promise<void> {
  const r = await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { echo })
  if (r.code !== 0) throw new CliError(`ffmpeg failed: ${r.stderr.trim().split('\n').slice(-6).join('\n')}`)
}
