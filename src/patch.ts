/**
 * Self-healing dsh core patch for attachment authorization.
 *
 * The readAttachment RPC authorizes only core `image` blocks
 * (`imageBlockIn` in `packages/host/apiproxy/src/api-proxy.ts`), so this
 * plugin's durable `vision-image` blocks are refused as
 * ATTACHMENT_NOT_REFERENCED and history thumbnails fail to load. This module
 * runs when the plugin's host half loads (i.e. whenever dsh boots with the
 * plugin installed) and, if the patch is missing, invokes the plugin's own
 * `scripts/apply-dsh-patch.mjs` — an idempotent one-line source change plus
 * an apiproxy rebuild — fully from inside the plugin package. Nothing in
 * dsh-launcher or the pnpm install flow is involved.
 *
 * The check is a cheap source read; the patch runs once and is idempotent.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** Marker the apply script writes next to the patched predicate. */
const MARKER = '// dsh attachment authorization: any block carrying an attachment reference is eligible (applied by dsh-vision-plugin install)'

/**
 * Resolve the dsh checkout, or undefined. Candidates in order: DSH_CHECKOUT,
 * the process working directory (the launcher starts dsh from the checkout
 * root), and the common local-checkout default.
 */
function resolveCheckout(): string | undefined {
  const candidates = [
    process.env.DSH_CHECKOUT,
    process.cwd(),
    'D:\\AI\\DeepSeekHarness\\deepseek-harness',
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    const source = join(candidate, 'packages', 'host', 'apiproxy', 'src', 'api-proxy.ts')
    if (existsSync(source)) return candidate
  }
  return undefined
}

/** Whether the apiproxy source already carries the attachment patch. */
function patchApplied(checkout: string): boolean {
  const source = join(checkout, 'packages', 'host', 'apiproxy', 'src', 'api-proxy.ts')
  return existsSync(source) && readFileSync(source, 'utf8').includes(MARKER)
}

/**
 * Ensure the dsh attachment-authorization patch is applied. Cheap when the
 * patch is already present; otherwise runs the plugin's apply script
 * asynchronously and logs the outcome.
 * @param ctx - Host Cordis context (for logging).
 */
export function ensureDshAttachmentPatch(ctx: Context): void {
  const checkout = resolveCheckout()
  if (checkout === undefined) return // headless profile without the web api-proxy
  if (patchApplied(checkout)) return

  // The bundled lib/index.js lives at <pkg>/lib, so one level up is the
  // package root where scripts/ sits.
  const script = join(import.meta.dirname, '..', 'scripts', 'apply-dsh-patch.mjs')
  ctx.logger.info(`[dsh-vision] dsh attachment-authorization patch missing — applying via ${script}`)
  const child = spawn(process.execPath, [script], {
    cwd: checkout,
    env: { ...process.env, DSH_CHECKOUT: checkout },
    stdio: 'inherit',
  })
  child.on('error', (error) => {
    ctx.logger.warn(`[dsh-vision] could not start the attachment patch: ${error.message}`)
  })
  child.on('exit', (code) => {
    if (code === 0) {
      ctx.logger.info('[dsh-vision] attachment-authorization patch applied and apiproxy rebuilt; restart dsh to fully take effect.')
    } else {
      ctx.logger.warn(`[dsh-vision] attachment patch exited ${code ?? 'with a signal'}; history image thumbnails may fail to load.`)
    }
  })
}
