# @uachar/dsh-vision-plugin

Vision recognition plugin for **DeepSeek Harness**: paste images into the Web composer, recognize them via **GLM-4V** on the host side, and inject the result into the conversation as a hidden context message. A native dual-face (host + browser) plugin installed as a standalone package.

## Features

- **Paste & send images** — one or more images pasted into the composer are forwarded to the host for recognition.
- **GLM-4V recognition** — the host calls Zhipu GLM-4V and appends the result as a hidden context user message, so the main model answers based on what the image actually shows.
- **Visible thumbnails** — recognized images are stored as durable attachments and rendered as thumbnails in history.
- **Model / API key settings** — a dock above the composer lets you add models (default `glm-4v-flash`) and API keys; persisted to `$DSH_HOME/vision-config.json`.
- **Self-healing dsh patch** — on load, the host half checks the dsh checkout for the attachment-authorization patch and applies it automatically (idempotent one-line change + apiproxy rebuild).

## How to use

1. Open a session — the **视觉识别** dock appears above the composer.
2. Click the gear icon, add a model (default `glm-4v-flash`) and a Zhipu API key (endpoint `https://open.bigmodel.cn/api/paas/v4/chat/completions`).
3. Paste images and send; a bare image auto-fills "请描述这张图片的内容".

> Model entries and API keys persist to a plain local JSON file, `$DSH_HOME/vision-config.json` (default `~/.dsh/vision-config.json`): auto-created empty on first load, rewritten on every config change, re-read on restart. The file is local-only, unencrypted, not tracked by git, and removed automatically when the plugin is uninstalled through the manager panel.

## Installation & removal

> Requires a working `dsh` CLI (pnpm) and a profile, e.g. `web`.

### Install from npm (recommended)

```sh
pnpm dsh plugin --profile web add @uachar/dsh-vision-plugin
```

### Install from the GitHub release tarball

```sh
pnpm dsh plugin --profile web add https://github.com/uAcharGG/dsh-vision/releases/download/v0.1.0/uachar-dsh-vision-plugin-0.1.0.tgz
```

### Build & install from source

```sh
git clone https://github.com/uAcharGG/dsh-vision.git
cd dsh-vision
pnpm install
# host half:
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/tsdown/dist/run.mjs --config tsdown.config.ts
pnpm dsh plugin --profile web add link:<absolute path to this checkout>
```

> The client bundle (`lib/client.js`) and the typert-generated faces (`lib/typert.host.js` / `lib/typert.remote-client.js`) are build-time artifacts produced by the dsh workspace build; the checked-in `tsconfig.client.json` still references the dsh checkout. To rebuild the client half outside the workspace, migrate that config and the typert generation step first.

Restart `dsh` after any install to take effect. The browser half is discovered automatically through the package's `dsh.client` declaration.

### Removal

```sh
pnpm dsh plugin --profile web remove @uachar/dsh-vision-plugin
```

Then restart `dsh`. (Uninstalling through the manager panel also deletes `$DSH_HOME/vision-config.json`.)

## Project structure

| File | Responsibility |
|---|---|
| `src/index.ts` | host half: `VisionService extends TypertRemoteService` — `@Remote` `queue`/`config`/`status` + `agent/pre-step` & `llm/stream` listeners + GLM call |
| `src/client/index.ts` | browser half: `conversation.input.dock` slot — paste capture, submit interception, model/API-key settings menu |
| `src/patch.ts` + `scripts/apply-dsh-patch.mjs` | self-healing dsh attachment-authorization patch |
| `src/types.ts` | cross-face wire types (lossless JSON) |
| `cordis.patch.yml` | bundle composition layer |
| `lib/` | build output (published) |

## Limitations

- Config persistence is a plain unencrypted JSON file under `$DSH_HOME`; the API key is sensitive local data.
- GLM-4V recognition needs a valid Zhipu API key configured in the dock.
- The dsh attachment patch is applied against the local checkout's `api-proxy.ts`; if the checkout layout differs, the script refuses to patch automatically and reports the needed change.

## License

MIT
