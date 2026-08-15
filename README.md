# dsh-vision-plugin

Vision recognition plugin for **DeepSeek Harness**: paste images into the Web composer, recognize them via **GLM-4V** on the host side, and inject the result into the conversation as a hidden context message. A native dual-face (host + browser) plugin, installed and managed through dsh-launcher.

## How it works

1. You paste one or more images into the Web input and send.
2. The browser half (`conversation.input.dock`) forwards the image bytes to the host via `ctx.remote.vision.queue`.
3. The host half, in `agent/pre-step`, saves each image as a durable attachment, writes a `vision-image` block into history (the UI renders the thumbnail; DeepSeek's text-only serializer ignores the block), and calls **GLM-4V**.
4. The recognition result is appended as a hidden context user message, so the main model answers based on what the image actually shows.
5. `llm/stream` strips any remaining `image` blocks from model requests (the DeepSeek serializer does not accept images).

### Self-healing dsh patch

The readAttachment RPC historically authorized only core `image` blocks, so `vision-image` thumbnails in history failed to load (`ATTACHMENT_NOT_REFERENCED`). On load, the host half checks `imageBlockIn` in the dsh checkout and, if the patch is missing, automatically runs `scripts/apply-dsh-patch.mjs` — an idempotent one-line change plus an apiproxy rebuild. No launcher or install-time hook involved; the patch benefits any attachment-bearing plugin block.

## Installation

Install through dsh-launcher (local path → `D:\Pro\dsh-vision`), from the packaged release tarball, or manually:

```sh
# packaged release (GitHub Releases)
pnpm dsh plugin --profile web add https://github.com/uAcharGG/dsh-vision/releases/download/v0.1.0/uachar-dsh-vision-plugin-0.1.0.tgz
# or the source checkout
pnpm dsh plugin --profile web add link:D:\Pro\dsh-vision
```

Restart `dsh` afterwards. The browser half is discovered automatically through the package's `dsh.client` declaration.

## Configuration

Open a session — the **视觉识别** dock appears above the composer:

1. Click the gear icon.
2. Add a model (default `glm-4v-flash`) and an API key (Zhipu open platform, endpoint `https://open.bigmodel.cn/api/paas/v4/chat/completions`).
3. Paste images and send; a bare image auto-fills "请描述这张图片的内容".

> Model entries and API keys persist to a plain local JSON file, `$DSH_HOME/vision-config.json` (default `~/.dsh/vision-config.json`): auto-created empty on first load, rewritten on every config change, re-read on restart — the model and key survive restarts. The file is local-only, unencrypted, not tracked by git, and removed automatically when the plugin is uninstalled through dsh-launcher.

## Structure

| Half | File | Responsibility |
|---|---|---|
| Host | `src/index.ts` | `VisionService extends TypertRemoteService`: `@Remote` `queue`/`config`/`status` + `agent/pre-step` & `llm/stream` listeners + GLM call |
| Client | `src/client/index.ts` | `conversation.input.dock` slot: paste capture, submit interception, model/API-key settings menu |
| Patch | `src/patch.ts` + `scripts/apply-dsh-patch.mjs` | self-healing dsh attachment-authorization patch |
| Types | `src/types.ts` | cross-face wire types (lossless JSON) |

## Building

The host half builds standalone:

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/tsdown/dist/run.mjs --config tsdown.config.ts
```

The client bundle (`lib/client.js`) and the typert-generated faces (`lib/typert.host.js` / `lib/typert.remote-client.js`) are build-time artifacts currently produced by the dsh workspace build; the checked-in `tsconfig.client.json` still references the dsh checkout. To rebuild the client half outside the workspace, migrate that config and the typert generation step first.

## Known limitations

- Config persistence is a plain unencrypted JSON file under `$DSH_HOME`; the API key is sensitive local data.
- GLM-4V recognition needs a valid Zhipu API key configured in the dock.
- The dsh attachment patch is applied against the local checkout's `api-proxy.ts`; if the checkout layout differs, the script refuses to patch automatically and reports the needed change.

## License

MIT
