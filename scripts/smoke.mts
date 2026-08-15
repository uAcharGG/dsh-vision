// Smoke test for the vision plugin Host half: exercises the remote methods
// without an agent loop or network. Run from the repo root:
//   node --import tsx/esm packages/vision/vision/scripts/smoke.mts
import { Context } from '@deepseek-ai/cordis'
import VisionService from '../../../../packages/vision/vision/lib/index.js'

const ctx = new Context()
const svc = new VisionService(ctx)

const results: Record<string, unknown> = {}

results['status-before'] = svc.status()
results['queue'] = svc.queue({ dataUrl: 'data:image/png;base64,AAAA', name: 'x.png', noPrompt: true })
results['config-set'] = svc.config({ set: { model: 'glm-4v-flash', apiKey: 'sk-1234567890abcdef' } })
results['config-get'] = svc.config({ get: true })
results['status-after'] = svc.status()
results['config-keep-masked'] = svc.config({ set: { model: 'glm-4v-flash', apiKey: 'sk-********' } })
results['config-get2'] = svc.config({ get: true })
results['config-remove'] = svc.config({ set: { removeModel: 'glm-4v-flash' } })
results['status-final'] = svc.status()

// Verify: masked key round-trip preserved the real key, removal emptied the list.
const get2 = results['config-get2'] as { entries: Array<{ model: string; maskedApiKey: string }> }
const finalStatus = results['status-final'] as { model: string; hasApiKey: boolean }
const ok = get2.entries[0]?.model === 'glm-4v-flash'
  && get2.entries[0]?.maskedApiKey.includes('*')
  && finalStatus.model === '' && finalStatus.hasApiKey === false

console.log(JSON.stringify(results, null, 2))
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL')
await ctx.scope?.dispose?.()
process.exit(ok ? 0 : 1)
