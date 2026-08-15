/**
 * Shared wire types for the vision plugin: the JSON payloads that cross the
 * Host/Client boundary through Typert Remote methods. Lossless JSON only —
 * image bytes travel as base64 data URLs, never as typed arrays.
 *
 * @module @uachar/dsh-vision-plugin/types
 */

/** One queued image request from the composer. */
export interface VisionQueueRequest {
  /** Base64 data URL (`data:image/...;base64,...`) of the pasted image. */
  dataUrl: string
  /** Display name, e.g. the pasted file name. */
  name: string
  /** True when the message carried no prompt text (pure image send). */
  noPrompt: boolean
}

/** Outcome of enqueueing an image. */
export interface VisionQueueResult {
  ok: boolean
  error?: string
  queued?: number
}

/** A configured vision model entry, keyed by model name. */
export interface VisionModelEntry {
  model: string
  hasApiKey: boolean
  maskedApiKey: string
}

/** Snapshot of the current vision-model configuration. */
export interface VisionConfigView {
  ok: boolean
  model: string
  entries: VisionModelEntry[]
  error?: string
}

/** Mutation requested from the settings menu. */
export interface VisionConfigSet {
  /** Replace/insert the entry with this model name. */
  model?: string
  /** API key for {@link VisionConfigSet.model}; masked keys are rejected. */
  apiKey?: string
  /** Remove the entry with this model name. */
  removeModel?: string
}

/** Request shape for `config`: read the view, apply a mutation, or both. */
export interface VisionConfigRequest {
  get?: boolean
  set?: VisionConfigSet
}

/** Live status line for the dock indicator. */
export interface VisionStatus {
  enabled: boolean
  model: string
  hasApiKey: boolean
  count: number
  queued: number
}
