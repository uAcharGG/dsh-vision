# @uachar/dsh-vision-plugin（视觉识别）

DeepSeek Harness 的视觉识别插件：把图片粘贴到 Web 输入框，Host 侧经 **GLM-4V** 识别，并把识别结果作为隐藏上下文消息注入对话。原生双面（Host + 浏览器）插件，作为独立包安装。

## 插件功能

- **粘贴即识别** —— 输入框中粘贴一张或多张图片，发送后自动转发给 Host 识别。
- **GLM-4V 识别** —— Host 调用智谱 GLM-4V，把识别结果作为隐藏上下文用户消息追加，让主模型基于图片真实内容作答。
- **缩略图可见** —— 识别过的图片存为持久附件，在历史消息中渲染缩略图。
- **模型 / API Key 设置** —— 输入框上方出现"视觉识别"Dock，齿轮图标内可添加模型（默认 `glm-4v-flash`）与 API Key；持久化到 `$DSH_HOME/vision-config.json`。
- **自愈式 dsh 补丁** —— 加载时 Host 侧检查 dsh checkout 的附件授权补丁，缺失则自动应用（幂等的一行改动 + apiproxy 重建）。

## 如何使用

1. 打开会话——输入框上方出现**视觉识别** Dock。
2. 点齿轮图标，添加模型（默认 `glm-4v-flash`）与智谱 API Key（端点 `https://open.bigmodel.cn/api/paas/v4/chat/completions`）。
3. 粘贴图片并发送；纯图片会自动填入"请描述这张图片的内容"。

> 模型与 API Key 持久化到本地纯文本 JSON `$DSH_HOME/vision-config.json`（默认 `~/.dsh/vision-config.json`）：首次加载自动创建空文件，每次配置修改重写，重启后重新读取。文件仅本地保存、不加密、不入 git；通过管理面板卸载插件时会自动删除。

## 安装与卸载

> 需要可用的 `dsh` CLI（pnpm）与一个 profile，例如 `web`。

### 从 npm 安装（推荐）

```sh
pnpm dsh plugin --profile web add @uachar/dsh-vision-plugin
```

### 从 GitHub Release tarball 安装

```sh
pnpm dsh plugin --profile web add https://github.com/uAcharGG/dsh-vision/releases/download/v0.1.0/uachar-dsh-vision-plugin-0.1.0.tgz
```

### 从源码构建并安装

```sh
git clone https://github.com/uAcharGG/dsh-vision.git
cd dsh-vision
pnpm install
# Host 侧：
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/tsdown/dist/run.mjs --config tsdown.config.ts
pnpm dsh plugin --profile web add link:<本目录的绝对路径>
```

> 客户端产物（`lib/client.js`）与 typert 生成的双面（`lib/typert.host.js` / `lib/typert.remote-client.js`）是 dsh workspace 构建的产物；仓库内的 `tsconfig.client.json` 仍引用 dsh checkout。若要在 workspace 外重建客户端，需先迁移该配置与 typert 生成步骤。

安装后**重启 dsh** 生效；浏览器侧通过包的 `dsh.client` 声明自动发现。

### 卸载

```sh
pnpm dsh plugin --profile web remove @uachar/dsh-vision-plugin
```

随后重启 dsh。（经管理面板卸载会同时删除 `$DSH_HOME/vision-config.json`。）

## 项目文件结构

| 文件 | 职责 |
|---|---|
| `src/index.ts` | Host 侧：`VisionService extends TypertRemoteService` —— `@Remote` `queue`/`config`/`status` + `agent/pre-step` 与 `llm/stream` 监听 + GLM 调用 |
| `src/client/index.ts` | 浏览器侧：`conversation.input.dock` 插槽 —— 粘贴捕获、提交拦截、模型/API Key 设置菜单 |
| `src/patch.ts` + `scripts/apply-dsh-patch.mjs` | 自愈式 dsh 附件授权补丁 |
| `src/types.ts` | 双面跨进程线协议类型（无损 JSON） |
| `cordis.patch.yml` | bundle 组合层 |
| `lib/` | 构建产物（随包发布） |

## 使用限制

- 配置为 `$DSH_HOME` 下的明文 JSON 文件；API Key 属于敏感本地数据。
- GLM-4V 识别需要 Dock 中配置有效的智谱 API Key。
- dsh 附件补丁针对本地 checkout 的 `api-proxy.ts` 应用；若 checkout 结构不同，脚本会拒绝自动打补丁并报告所需改动。

## 许可

MIT
