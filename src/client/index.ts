/**
 * Vision recognition plugin, browser half: the composer dock that captures
 * pasted images, queues them to the Host through the generated `vision`
 * Remote namespace, and exposes the model/API-key settings menu.
 *
 * The `conversation.input.dock` seat is a session-scope standard-kit slot:
 * the component receives `useInput` and `inputActions` from the framework,
 * while the vision verbs arrive through the registration's `inject` face
 * (bound to the mounted `ctx.remote.vision` namespace).
 *
 * Deliberately written with `createElement` (no JSX): the Typert generator's
 * dual-face analysis maps the `./client` export back to `src/client/index.ts`,
 * so the client entry must be plain TypeScript.
 *
 * @module @uachar/dsh-vision-plugin/client
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
// Type-only: pulls the ctx.remote merge and ClientContext through the client assembly.
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation.input.dock slot declaration (InputZone
// owner share) and the standard-kit input members into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputActions, DraftAttachmentId } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/contract.ts'
import visionRemote from '@uachar/dsh-vision-plugin/remote'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { VisionConfigRequest, VisionConfigView, VisionModelEntry, VisionStatus } from '../types.ts'
import css from './vision-dock.module.css'

export type * from '../types.ts'

/** Required services: the slot registry and the Remote carrier (vision namespace mounted async). */
export const inject = ['slots', 'remote']

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Encode bytes as base64 (no Buffer in the browser bundle). */
function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number
    const b1 = i + 1 < bytes.length ? bytes[i + 1] as number : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] as number : 0
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? B64[b2 & 63] : '='
  }
  return out
}

/** One pasted image buffered client-side before the send gesture. */
interface PendingImage {
  dataUrl: string
  name: string
}

/** The injected vision verbs handed to the dock component. */
export interface VisionDockActions {
  /** Queue one image to the Host for the next send. */
  queue: (request: { dataUrl: string; name: string; noPrompt: boolean }) => Promise<RemoteResult<{ ok: boolean; queued?: number; error?: string }>>
  /** Read or mutate the model/API-key configuration. */
  config: (request: VisionConfigRequest) => Promise<RemoteResult<VisionConfigView>>
  /** Read the live recognition status. */
  status: () => Promise<RemoteResult<VisionStatus>>
}

/** Full props of the dock entry: the input-region slot currency + vision verbs. */
export type VisionDockProps = PropsRuntime<'conversation.input.dock'> & VisionDockActions

function ChevronIcon({ open }: { open: boolean }): ReactElement {
  return createElement('svg', {
    width: 12,
    height: 12,
    viewBox: '0 0 14 14',
    className: css.chevron + (open ? ' ' + css.chevronOpen : ''),
    'aria-hidden': true,
  },
    createElement('path', {
      d: 'M3 5l4 4 4-4',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

/**
 * The composer dock entry: status dot, model label, and the settings menu.
 * Pasted images buffer client-side; the send gesture (button or Enter)
 * queues them to the Host and submits.
 */
export function VisionDock({
  useInput,
  inputActions,
  queue,
  config,
  status,
}: VisionDockProps): ReactElement {
  const input = useInput((s) => ({ draft: s.draft, imageIds: s.imageIds }))
  const [statusView, setStatusView] = useState<VisionStatus | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [modelInput, setModelInput] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [entries, setEntries] = useState<VisionModelEntry[]>([])
  const [currentModel, setCurrentModel] = useState('')
  const [savedMsg, setSavedMsg] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const pendingImagesRef = useRef<PendingImage[]>([])
  const submittingRef = useRef(false)
  const originalSubmitRef = useRef<(() => void) | null>(null)
  const inputActionsRef = useRef<InputActions>(inputActions)
  inputActionsRef.current = inputActions
  const draftRef = useRef<string>('')
  draftRef.current = input.draft
  const imageIdsRef = useRef<readonly DraftAttachmentId[]>([])
  imageIdsRef.current = input.imageIds

  // Poll the host status every 3s while the dock is mounted.
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      status().then((result) => {
        if (!alive) return
        if (result.ok) setStatusView(result.value)
        else setStatusView(null)
      }).catch(() => { if (alive) setStatusView(null) })
    }
    tick()
    const timer = window.setInterval(tick, 3000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [status])

  // Send: queue the buffered images to the host, remove the draft thumbnails,
  // then submit. A lock prevents Enter/button double-fire queueing twice.
  const submitWithImages = useCallback((): void => {
    if (submittingRef.current) return
    submittingRef.current = true
    const images = pendingImagesRef.current.slice()
    pendingImagesRef.current = []
    const actions = inputActionsRef.current
    try {
      const draftText = draftRef.current.trim()
      const noPrompt = draftText === '' && images.length > 0
      if (noPrompt && typeof actions.setDraft === 'function') {
        actions.setDraft('请描述这张图片的内容')
      }
      for (const img of images) {
        queue({ dataUrl: img.dataUrl, name: img.name, noPrompt }).catch(() => {})
      }
      const ids = imageIdsRef.current.slice()
      for (const id of ids) {
        if (typeof actions.removeImage === 'function') actions.removeImage(id)
      }
      if (originalSubmitRef.current !== null) originalSubmitRef.current()
    } finally {
      window.setTimeout(() => { submittingRef.current = false }, 300)
    }
  }, [queue])

  // Capture pasted images as data URLs without triggering recognition yet.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const cd = event.clipboardData
      if (cd === null) return
      const images: File[] = []
      const items = cd.items
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item === undefined || item.kind !== 'file') continue
        const f = item.getAsFile()
        if (f !== null && f.type !== '' && f.type.startsWith('image/')) images.push(f)
      }
      if (images.length === 0) return
      let chain: Promise<void> = Promise.resolve()
      for (const file of images) {
        chain = chain.then(() => file.arrayBuffer()).then((buf) => {
          const dataUrl = 'data:' + (file.type || 'image/png') + ';base64,' + bytesToBase64(new Uint8Array(buf))
          pendingImagesRef.current.push({ dataUrl, name: file.name || '图片' })
        }).catch(() => {})
      }
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [])

  // Wrap the composer's submit so buffered images ride the same gesture.
  useEffect(() => {
    const actions = inputActionsRef.current
    if (actions === undefined || typeof actions.submit !== 'function') return
    if (originalSubmitRef.current !== null) return
    originalSubmitRef.current = actions.submit
    actions.submit = () => {
      if (pendingImagesRef.current.length === 0 && imageIdsRef.current.length === 0) {
        originalSubmitRef.current!()
        return
      }
      submitWithImages()
    }
    return () => {
      if (actions !== undefined && originalSubmitRef.current !== null) {
        actions.submit = originalSubmitRef.current
        originalSubmitRef.current = null
      }
    }
  }, [inputActions, submitWithImages])

  // Enter with pending images triggers the same submit path.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.isComposing) return
      const hasImages = pendingImagesRef.current.length > 0 || imageIdsRef.current.length > 0
      if (!hasImages) return
      const actions = inputActionsRef.current
      if (actions === undefined || typeof actions.submit !== 'function') return
      event.preventDefault()
      event.stopPropagation()
      submitWithImages()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [submitWithImages])

  // Click-outside closes the settings menu.
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (event: MouseEvent): void => {
      const node = menuRef.current
      if (node !== null && !node.contains(event.target as Node)) {
        setMenuOpen(false)
        setConfirming(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const loadConfig = useCallback((): Promise<VisionConfigView | null> => {
    return config({ get: true }).then((result) => {
      if (result.ok && result.value.ok) {
        setEntries(result.value.entries)
        setCurrentModel(result.value.model)
        return result.value
      }
      return null
    }).catch(() => null)
  }, [config])

  const openMenu = useCallback((): void => {
    if (menuOpen) {
      setMenuOpen(false)
      setConfirming(null)
      return
    }
    setModelInput('')
    setKeyInput('')
    setErrorMsg(null)
    setSavedMsg(false)
    setConfirming(null)
    void loadConfig().then(() => setMenuOpen(true)).catch(() => setMenuOpen(true))
  }, [menuOpen, loadConfig])

  const pickModel = useCallback((m: string): void => {
    setErrorMsg(null)
    setSavedMsg(false)
    setConfirming(null)
    const entry = entries.find((e) => e.model === m)
    setModelInput(m)
    setKeyInput(entry !== undefined ? entry.maskedApiKey : '')
  }, [entries])

  const startNew = useCallback((): void => {
    setModelInput('')
    setKeyInput('')
    setErrorMsg(null)
    setSavedMsg(false)
    setConfirming(null)
  }, [])

  const requestDelete = useCallback((m: string): void => {
    if (confirming === m) {
      setConfirming(null)
      config({ set: { removeModel: m } }).then(() => loadConfig()).catch(() => {})
    } else {
      setConfirming(m)
    }
  }, [confirming, config, loadConfig])

  const saveSettings = useCallback((): void => {
    const m = modelInput.trim()
    const k = keyInput.trim()
    if (m === '' || k === '') {
      setErrorMsg('保存失败，请输入完整信息')
      return
    }
    setErrorMsg(null)
    config({ set: { model: m, apiKey: k } }).then(() => loadConfig()).then(() => {
      setSavedMsg(true)
      window.setTimeout(() => setSavedMsg(false), 1500)
    }).catch(() => {})
  }, [modelInput, keyInput, config, loadConfig])

  const model = currentModel || (statusView !== null ? statusView.model : '') || '未配置'
  const modelList = entries.length > 0 ? entries.map((e) => e.model) : []

  const menuNode = menuOpen
    ? createElement('div', { className: css.menu, ref: menuRef },
        createElement('div', { className: css.menuHead },
          createElement('span', { className: css.menuTitle }, '视觉模型'),
          createElement('button', { className: css.menuPlus, title: '新建模型配置', onClick: startNew }, '+'),
        ),
        modelList.map((m) => createElement('div', {
          key: m,
          className: css.menuItem
            + (m === model ? ' ' + css.menuItemSel : '')
            + (confirming === m ? ' ' + css.menuItemConfirm : ''),
          onClick: () => pickModel(m),
        },
          createElement('span', { className: css.menuCheck }, m === model ? '✓' : ''),
          createElement('span', { className: css.menuName }, m),
          confirming === m
            ? createElement('span', { className: css.menuConfirmText }, '确认删除？')
            : null,
          createElement('button', {
            className: css.menuDel + (confirming === m ? ' ' + css.menuDelConfirm : ''),
            title: confirming === m ? '再次点击确认删除' : '删除此模型配置',
            onClick: (e: MouseEvent) => { e.stopPropagation(); requestDelete(m) },
          }, confirming === m ? '确认' : '✕'),
        )),
        createElement('div', { className: css.menuDivider }),
        createElement('div', { className: css.menuRow },
          createElement('span', { className: css.menuLabel }, '模型'),
          createElement('input', {
            className: css.menuInput,
            value: modelInput,
            placeholder: '模型名称',
            onChange: (e: { target: { value: string } }) => setModelInput(e.target.value),
          }),
          createElement('span', { className: css.menuSpacer }),
        ),
        createElement('div', { className: css.menuRow },
          createElement('span', { className: css.menuLabel }, 'API Key'),
          createElement('input', {
            className: css.menuInput,
            value: keyInput,
            placeholder: 'API Key',
            onChange: (e: { target: { value: string } }) => setKeyInput(e.target.value),
          }),
          createElement('button', { className: css.menuSave, onClick: saveSettings },
            savedMsg ? '已保存 ✓' : '保存'),
        ),
        errorMsg !== null
          ? createElement('div', { className: css.menuError }, errorMsg)
          : null,
      )
    : null

  return createElement('div', { className: css.dock },
    createElement('span', { className: css.status },
      createElement('span', { className: css.dot }),
    ),
    createElement('span', { className: css.title }, '视觉识别 · ' + model),
    createElement('button', {
      className: css.gear,
      onClick: openMenu,
      title: '模型 / API Key 设置',
      'aria-expanded': menuOpen,
    }, createElement(ChevronIcon, { open: menuOpen })),
    menuNode,
  )
}

/**
 * Client plugin body: mount the generated `vision` Remote contribution so
 * `ctx.remote.vision.*` is callable, then register the composer dock entry.
 *
 * `$mount` is async and provides the `remote.vision` namespace service only
 * after it settles, so the slot registration waits on that service via
 * `ctx.inject(['remote.vision'], ...)` — the inject face reads
 * `ctx.remote.vision` only inside that callback, after the service exists.
 * @param ctx - client Cordis root context.
 */
export function apply(ctx: ClientContext): void {
  void ctx.remote.$mount(visionRemote).then(() => {
    // 注入后的 scoped ctx 才声明了 remote.vision 服务，slot 的 inject face
    // 必须闭包捕获这个 scoped ctx（而非根 ctx）才能访问 ctx.remote.vision。
    ctx.inject(['remote.vision'], (scoped: ClientContext) => {
      scoped.slots.inject('conversation.input.dock', () => scoped.slots.register({
        name: 'conversation.input.dock',
        id: 'vision',
        order: 30,
        label: '视觉识别',
        inject: (): VisionDockActions => ({
          queue: (request) => scoped.remote.vision.queue(request),
          config: (request) => scoped.remote.vision.config(request),
          status: () => scoped.remote.vision.status(),
        }),
      }, VisionDock))
    })
  })
}
