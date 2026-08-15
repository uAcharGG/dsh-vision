/**
 * Vision recognition plugin, Host half: a Typert Remote service exposing
 * `queue`/`config`/`status` to the browser client, plus the agent-loop
 * listeners that save pasted images as attachments, recognize them through
 * GLM-4V, and inject the results into the conversation.
 *
 * The service publishes into the host plane under `ctx.vision`; the generated
 * `./remote` face (built by the workspace typert generator) lets the client
 * half call these methods over the api-proxy transport.
 *
 * @module @uachar/dsh-vision-plugin
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the agent/pre-step event signature into ctx.on typing.
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: pulls the llm/stream event signature into ctx.on typing.
import type {} from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { UserMessage } from '@deepseek-ai/dsh-llm/message'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {
  VisionConfigRequest,
  VisionConfigSet,
  VisionConfigView,
  VisionModelEntry,
  VisionQueueRequest,
  VisionQueueResult,
  VisionStatus,
} from './types.ts'
import { ensureDshAttachmentPatch } from './patch.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface ContentBlockMap {
    /**
     * Vision plugin's durable image block. Carries the attachment reference
     * so the conversation UI can render the thumbnail, but is NOT a core
     * `image` block: DeepSeek's text-only serializer ignores unknown block
     * types (flattenText keeps only `text`), so history containing these
     * blocks never triggers UNSUPPORTED_CONTENT — even after this plugin is
     * uninstalled (the block then simply renders as nothing).
     */
    'vision-image': VisionImageBlock
  }
}

/** Durable vision image block: attachment ref for UI + text placeholder. */
export interface VisionImageBlock {
  type: 'vision-image'
  attachment: ImageAttachmentRef
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Vision recognition service, published by this plugin. */
    vision: VisionService
  }
}

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const PROMPT = '请用中文详细描述这张图片的内容，包括主要物体、场景、人物、文字、颜色、布局等细节。如果图片包含代码、文档或屏幕截图，请尽量准确转录其中的文字内容。'

/** Mask an API key for display: keep 4 head / 4 tail, hide the middle. */
function maskApiKey(key: string): string {
  if (key === '') return ''
  if (key.length <= 8) return '*'.repeat(Math.min(key.length, 6))
  return key.slice(0, 4) + '*'.repeat(Math.min(12, key.length - 8)) + key.slice(-4)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Parse a base64 data URL into host-realm bytes and media type. */
function parseDataUrl(dataUrl: string): { mediaType: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl)
  if (m === null || m[2] === undefined) return null
  const mediaType = m[1] as string
  const b64 = m[3] as string
  const bytes = new Uint8Array(Math.floor(b64.length * 3 / 4))
  let out = 0
  for (let i = 0; i < b64.length; i += 4) {
    const chunk = b64.slice(i, i + 4)
    const vals: number[] = [0, 0, 0, 0]
    for (let j = 0; j < 4; j++) {
      const c = chunk[j]
      if (c === undefined || c === '=') break
      const idx = B64.indexOf(c)
      if (idx < 0) continue
      vals[j] = idx
    }
    const v0 = vals[0] as number
    const v1 = vals[1] as number
    const v2 = vals[2] as number
    const v3 = vals[3] as number
    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3
    bytes[out++] = (triple >> 16) & 0xff
    if (v2 !== 0 || (chunk[2] !== undefined && chunk[2] !== '=')) bytes[out++] = (triple >> 8) & 0xff
    if (v3 !== 0 || (chunk[3] !== undefined && chunk[3] !== '=')) bytes[out++] = triple & 0xff
  }
  return { mediaType, bytes: bytes.slice(0, out) }
}

/** One configured model entry; the API key is kept host-side only. */
interface StoredEntry {
  model: string
  apiKey: string
}

/**
 * Vision recognition service. Model entries live in memory (per-process); a
 * deployment that needs persistence should layer a settings-backed store.
 */
export class VisionService extends TypertRemoteService {
  static inject: string[] = []

  private entries: StoredEntry[] = []
  private current = ''
  private readonly pendingImages: VisionQueueRequest[] = []
  private count = 0

  /** Cordis service constructor: binds `ctx.vision` and the `vision` wire namespace. */
  constructor(ctx: Context) {
    super(ctx, 'vision')
    // Self-heal the dsh attachment-authorization patch (history thumbnails
    // need it); no-op when already applied.
    ensureDshAttachmentPatch(ctx)
    this.install(ctx)
  }

  /** The currently selected model entry, or the first entry as a fallback. */
  private currentEntry(): StoredEntry | undefined {
    return this.entries.find((e) => e.model === this.current) ?? this.entries[0]
  }

  /** Enqueue one pasted image for the next pre-step. */
  @Remote('queue')
  queue(request: VisionQueueRequest): VisionQueueResult {
    if (request === undefined || typeof request.dataUrl !== 'string' || request.dataUrl === '') {
      return { ok: false, error: 'missing dataUrl' }
    }
    this.pendingImages.push({
      dataUrl: request.dataUrl,
      name: typeof request.name === 'string' && request.name !== '' ? request.name : '图片',
      noPrompt: request.noPrompt === true,
    })
    return { ok: true, queued: this.pendingImages.length }
  }

  /** Read and/or mutate the vision-model configuration. */
  @Remote('config')
  config(request: VisionConfigRequest): VisionConfigView {
    const set: VisionConfigSet | undefined = request?.set
    if (set !== undefined && typeof set === 'object') {
      if (typeof set.removeModel === 'string' && set.removeModel.trim() !== '') {
        const target = set.removeModel.trim()
        this.entries = this.entries.filter((e) => e.model !== target)
        if (this.current === target) this.current = this.entries[0]?.model ?? ''
      }
      if (typeof set.model === 'string' && set.model.trim() !== '') {
        const model = set.model.trim()
        const existing = this.entries.find((e) => e.model === model)
        let apiKey = typeof set.apiKey === 'string' && set.apiKey.trim() !== ''
          ? set.apiKey.trim()
          : (existing !== undefined ? existing.apiKey : '')
        // A masked key sent back unchanged means "keep what we have".
        if (apiKey.includes('*') && existing !== undefined) apiKey = existing.apiKey
        if (existing !== undefined) {
          existing.apiKey = apiKey
        } else {
          this.entries.push({ model, apiKey })
        }
        this.current = model
      }
    }
    return {
      ok: true,
      model: this.current,
      entries: this.entries.map((e): VisionModelEntry => ({
        model: e.model,
        hasApiKey: e.apiKey !== '',
        maskedApiKey: maskApiKey(e.apiKey),
      })),
    }
  }

  /** Live status for the dock indicator. */
  @Remote('status')
  status(): VisionStatus {
    const entry = this.currentEntry()
    return {
      enabled: true,
      model: entry?.model ?? '',
      hasApiKey: entry !== undefined && entry.apiKey !== '',
      count: this.count,
      queued: this.pendingImages.length,
    }
  }

  /**
   * Recognize one image through the GLM vision endpoint. Runs a node child
   * through the host subprocess service so the API call happens outside the
   * agent sandbox but inside the harness subprocess policy.
   */
  private async callGLM(dataUrl: string, signal?: AbortSignal): Promise<string> {
    const entry = this.currentEntry()
    if (entry === undefined || entry.apiKey === '') {
      throw new Error('尚未配置视觉模型，请点击输入框上方的视觉识别设置，添加模型与 API Key')
    }
    const subprocess = this.ctx.get('subprocess')
    if (subprocess === undefined) throw new Error('subprocess service unavailable')
    const node = await subprocess.resolveExecutable('node')
    const policy = this.ctx.get('sandboxPolicy')
    const cwd = (policy !== undefined && policy.workspaceRoot !== undefined) ? policy.workspaceRoot : '.'
    const payload = JSON.stringify({
      url: ENDPOINT,
      key: entry.apiKey,
      model: entry.model,
      dataUrl,
      prompt: PROMPT,
    })
    const NODE_SCRIPT = `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',async()=>{try{const r=JSON.parse(s);const res=await fetch(r.url,{method:'POST',headers:{Authorization:'Bearer '+r.key,'Content-Type':'application/json'},body:JSON.stringify({model:r.model,messages:[{role:'user',content:[{type:'image_url',image_url:{url:r.dataUrl}},{type:'text',text:r.prompt}]}]}),signal:AbortSignal.timeout(60000)});const t=await res.text();let j;try{j=JSON.parse(t)}catch{j=null}const c=j&&j.choices&&j.choices[0]&&j.choices[0].message&&j.choices[0].message.content;if(typeof c==='string'&&c.trim()){process.stdout.write(JSON.stringify({ok:true,text:c.trim()}))}else{process.stdout.write(JSON.stringify({ok:false,error:(j&&j.error&&j.error.message)||('HTTP '+res.status+' '+t.slice(0,200))}))}}catch(e){process.stdout.write(JSON.stringify({ok:false,error:String(e&&e.message||e)}))}})`
    const handle = subprocess.spawn({
      argv: [node, '-e', NODE_SCRIPT],
      cwd,
      stdio: {
        stdin: { data: payload },
        stdout: { maxBytes: 500000 },
        stderr: { maxBytes: 50000 },
      },
      graceMs: 5000,
      signal,
    })
    const outcome = await handle.done
    const reader = handle.collected.stdout
    const text = reader !== undefined ? reader.readFrom(0).text : ''
    if (outcome.exitCode !== 0) {
      throw new Error('node exited ' + outcome.exitCode + ': ' + text.slice(0, 200))
    }
    let parsed: { ok?: boolean; text?: string; error?: string }
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('invalid node output: ' + text.slice(0, 200))
    }
    if (parsed.ok !== true || typeof parsed.text !== 'string') {
      throw new Error(parsed.error ?? 'GLM API call failed')
    }
    return parsed.text
  }

  /** Install the agent-loop listeners (host-plane; runs once per process). */
  private install(ctx: Context): void {
    // Before a step enters: strip any image blocks from the incoming user
    // messages (both the plugin's own queued images and dsh-native draft
    // images), recognize the queued ones via GLM, and inject the results as a
    // hidden context message. Stripping at pre-step time is the ONLY safe
    // point: the durable log and deriveMessages() must never carry image
    // blocks, because the DeepSeek serializer rejects them and the
    // llm/stream request is immutable (loop-built requests are frozen and
    // cross-checked against deriveMessages()).
    ctx.on('agent/pre-step', async (payload, next) => {
      const decision: PreStepDecision = await next()
      if (decision.kind === 'reject') return decision

      // 1) Strip dsh-native draft images from the incoming user messages so
      //    they never reach the log / deriveMessages() with image blocks.
      const sanitizedMessages = decision.messages.map((m) => {
        if (m.role !== 'user') return m
        const content = m.content ?? []
        if (!content.some((b) => (b as { type?: string }).type === 'image')) return m
        const text = content.filter((b) => (b as { type?: string }).type === 'text')
        const cleaned: ContentBlock[] = text.length > 0
          ? text
          : [{ type: 'text', text: '[图片]' }]
        return { ...m, content: cleaned }
      })

      if (this.pendingImages.length === 0) {
        // No plugin-queued images: still strip native draft images and continue.
        if (sanitizedMessages === decision.messages) return decision
        return { kind: 'enter', messages: sanitizedMessages }
      }

      const images = this.pendingImages.splice(0)
      const signal = payload.signal
      const session = payload.agent.session
      const noPrompt = images.every((img) => img.noPrompt)
      const results: string[] = []
      const imageBlocks: ImageBlock[] = []
      const attachments = ctx.get('attachments')
      let appendedUser = false

      for (const img of images) {
        try {
          if (attachments !== undefined && attachments !== null) {
            const parsed = parseDataUrl(img.dataUrl)
            if (parsed !== null && parsed.mediaType.startsWith('image/')) {
              const ref: ImageAttachmentRef = await attachments.saveImage({
                data: parsed.bytes,
                mediaType: parsed.mediaType as ImageMediaType,
                ...(img.name !== undefined && img.name !== '' ? { name: img.name } : {}),
              })
              imageBlocks.push({ type: 'image', attachment: ref })
            }
          }
        } catch {
          // Save failure: history omits the image; recognition still runs.
        }
      }

      let firstUserIdx = -1
      let firstUser: UserMessage | undefined
      if (imageBlocks.length > 0) {
        firstUserIdx = sanitizedMessages.findIndex((m) => m.role === 'user' && m.source !== undefined && m.source.kind === 'user')
        if (firstUserIdx >= 0) {
          firstUser = sanitizedMessages[firstUserIdx] as UserMessage
          // Durable history: use vision-image blocks (UI renders the thumbnail;
          // DeepSeek's serializer ignores them, so uninstalling the plugin
          // never leaves UNSUPPORTED_CONTENT behind) plus a text placeholder.
          const durableBlocks: ContentBlock[] = noPrompt
            ? imageBlocks.map((img): VisionImageBlock => ({ type: 'vision-image', attachment: img.attachment }))
            : [...(firstUser.content ?? []).filter((b) => b.type !== 'image' && b.type !== 'vision-image'),
              ...imageBlocks.map((img): VisionImageBlock => ({ type: 'vision-image', attachment: img.attachment }))]
          if (!noPrompt && (firstUser.content ?? []).length > 0) {
            durableBlocks.push({ type: 'text', text: '' })
          }
          const userWithImages: UserMessage = { ...firstUser, content: durableBlocks }
          try {
            session.append('user/message', userWithImages, { surfaceOp: 'append' })
            appendedUser = true
          } catch {
            appendedUser = false
          }
        }
      }

      for (const img of images) {
        let recognized = ''
        try {
          recognized = await this.callGLM(img.dataUrl, signal)
          this.count += 1
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          recognized = '（识别失败：' + message + '，当前模型：' + (this.currentEntry()?.model ?? '未配置') + '）'
        }
        results.push('【图片 ' + img.name + '】' + recognized)
      }

      const contextText = '用户本次发送了 ' + results.length + ' 张图片，以下是每张图片的视觉识别结果：\n' + results.join('\n\n---\n\n')
        + '\n\n请结合以上图片识别结果和用户的消息内容，深入思考后回答。'
      const contextMessage: UserMessage = {
        id: MessageId('vision-' + Date.now() + '-' + Math.floor(Math.random() * 1e6)),
        role: 'user',
        content: [{ type: 'text', text: contextText }],
        source: { kind: 'plugin', plugin: 'vision', form: 'instructions' },
      }

      const messages = sanitizedMessages.slice()
      if (appendedUser && firstUserIdx >= 0) {
        messages.splice(firstUserIdx, 1)
      } else if (imageBlocks.length > 0 && firstUserIdx >= 0 && firstUser !== undefined) {
        // Model-facing messages: text placeholders only (never image blocks),
        // so the request is safe even without the llm/stream stripper.
        const modelBlocks: ContentBlock[] = noPrompt
          ? [{ type: 'text', text: '[图片]' }]
          : [...(messages[firstUserIdx]?.content ?? []).filter((b) => b.type !== 'image' && b.type !== 'vision-image'),
            ...imageBlocks.map(() => ({ type: 'text' as const, text: '[图片]' }))]
        messages[firstUserIdx] = { ...messages[firstUserIdx] as UserMessage, content: modelBlocks }
      }
      return { kind: 'enter', messages: [...messages, contextMessage] }
    }, { prepend: true })
  }
}

/**
 * Plugin entry: the class form lets the loader instantiate the service,
 * bind `ctx.vision`, and run the constructor's agent-loop listener install.
 * The typert generator discovers `@Remote` methods and the gateway resolves
 * the `vision` namespace from the `typertRemote` binding.
 */
export default VisionService
