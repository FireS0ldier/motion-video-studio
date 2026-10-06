import type { Manifest } from '../../engine/core/types.ts'
import type { ProjectPaths } from './paths.ts'
import { openSession } from './session.ts'

/**
 * Load the project in a headless page and return its manifest (format,
 * scenes, audio config, SFX cues, warnings). The browser is the single source
 * of truth because it runs exactly the code that renders.
 */
export async function loadManifest(p: ProjectPaths): Promise<Manifest> {
  const session = await openSession({ project: p.id, scale: 0.25, quality: 'draft', workers: 1 })
  try {
    return session.manifest
  } finally {
    await session.close()
  }
}
