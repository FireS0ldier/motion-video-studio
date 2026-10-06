import './preview.css'
import { startBridge } from './bridge.ts'
import { renderHome, startPreview } from './preview.ts'

declare const __MVS_DEFAULT_PROJECT__: string

const params = new URLSearchParams(location.search)
const root = document.getElementById('root')!

if (params.get('mode') === 'render') {
  // headless renderer driven by the CLI
  window.__MVS_READY__ = startBridge(params).catch((e: Error) => {
    window.__MVS_ERROR__ = e.stack ?? String(e)
    throw e
  })
} else {
  const project = params.get('project') ?? (__MVS_DEFAULT_PROJECT__ || null)
  if (project) startPreview(root, project, params).catch((e) => console.error(e))
  else renderHome(root)
}
