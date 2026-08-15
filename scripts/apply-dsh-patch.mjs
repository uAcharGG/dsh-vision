#!/usr/bin/env node
/**
 * Apply the dsh core attachment-authorization patch required by this plugin.
 *
 * The readAttachment RPC only authorizes core `image` blocks
 * (`imageBlockIn` in `packages/host/apiproxy/src/api-proxy.ts`), so any
 * plugin-owned block type that carries an `ImageAttachmentRef` (this plugin's
 * durable `vision-image` block) is refused as ATTACHMENT_NOT_REFERENCED and
 * history thumbnails fail to load. This script relaxes that one predicate to
 * "any block carrying an attachment reference", then rebuilds the apiproxy
 * artifact so the running dsh serves the patched behavior.
 *
 * The patch is generic (it benefits every attachment-bearing plugin block),
 * idempotent (a second run is a no-op), and owned by this plugin's install
 * flow — dsh-launcher runs this script after installing the plugin. The dsh
 * checkout itself is not modified beyond the one-line source change plus its
 * rebuild artifacts; the plugin package stays fully independent.
 *
 * Usage:
 *   node scripts/apply-dsh-patch.mjs            apply (idempotent) and rebuild
 *   node scripts/apply-dsh-patch.mjs --check    report status only, exit 0/1
 *   DSH_CHECKOUT=D:/path node scripts/apply-dsh-patch.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const CHECKOUT = process.env.DSH_CHECKOUT ?? 'D:\\AI\\DeepSeekHarness\\deepseek-harness'
const TARGET = join(CHECKOUT, 'packages', 'host', 'apiproxy', 'src', 'api-proxy.ts')
const MARKER = '// dsh attachment authorization: any block carrying an attachment reference is eligible (applied by dsh-vision-plugin install)'

/** The exact predicate line today, before this patch. */
const ORIGINAL = `    if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {`
/** The patched predicate: drop the core-image-only restriction. */
const PATCHED = `    if (typeof block.attachment === 'object' && block.attachment !== null) {`

function status() {
  if (!existsSync(TARGET)) {
    console.error(`[dsh-vision patch] target not found: ${TARGET}`)
    return 'missing'
  }
  const source = readFileSync(TARGET, 'utf8')
  if (source.includes(MARKER)) return 'applied'
  if (source.includes(ORIGINAL)) return 'pending'
  return 'drifted'
}

function apply() {
  const state = status()
  if (state === 'applied') {
    console.log('[dsh-vision patch] already applied (idempotent no-op).')
    return true
  }
  if (state !== 'pending') {
    console.error(
      `[dsh-vision patch] source drifted from the expected shape (${state}); ` +
      'refusing to patch automatically. The needed change: in imageBlockIn, ' +
      'authorize any block carrying an attachment reference (not only core image blocks).',
    )
    return false
  }
  const source = readFileSync(TARGET, 'utf8')
  const patched = source.replace(ORIGINAL, `    ${MARKER}\n${PATCHED}`)
  writeFileSync(TARGET, patched, 'utf8')
  console.log('[dsh-vision patch] api-proxy.ts patched: imageBlockIn now authorizes any attachment-bearing block.')
  return rebuild()
}

function rebuild() {
  console.log('[dsh-vision patch] rebuilding dsh-host-apiproxy artifacts (tsc + tsdown)...')
  const tsc = spawnSync('npx', ['tsc', '-b', 'packages/host/apiproxy'], {
    cwd: CHECKOUT,
    shell: true,
    stdio: 'inherit',
  })
  if (tsc.status !== 0) {
    console.error(`[dsh-vision patch] tsc failed (exit ${tsc.status ?? 'signal'}); patch applied to source but artifacts are stale.`)
    return false
  }
  const tsdown = spawnSync('pnpm', ['exec', 'tsdown', '--env.DSH_BUILD_FACE', 'host', '--filter', '@deepseek-ai/dsh-host-apiproxy'], {
    cwd: CHECKOUT,
    shell: true,
    stdio: 'inherit',
  })
  if (tsdown.status !== 0) {
    console.error(`[dsh-vision patch] tsdown failed (exit ${tsdown.status ?? 'signal'}); patch applied to source but artifacts are stale.`)
    return false
  }
  console.log('[dsh-vision patch] rebuilt. Restart dsh for the authorization change to take effect.')
  return true
}

const mode = process.argv.includes('--check') ? 'check' : 'apply'
if (mode === 'check') {
  const state = status()
  console.log(`[dsh-vision patch] status: ${state}`)
  process.exit(state === 'applied' || state === 'pending' ? 0 : 1)
}
const ok = apply()
process.exit(ok ? 0 : 1)
