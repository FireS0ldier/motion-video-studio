#!/usr/bin/env node
// Entry point of the `mvs` CLI. Registers tsx so the TypeScript sources run directly.
import { register } from 'tsx/esm/api'

register()
await import('./index.ts')
