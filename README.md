# dsh-vision-plugin

视觉识别插件（DeepSeek Harness 原生双面插件包）。

把图片粘贴到 Web 输入框，点击发送：图片字节经 `ctx.remote.vision.queue` 送到 Host 半，Host 在 `agent/pre-step` 里把图片存为 attachment 并立即显示到历史，然后调用 **GLM-4V** 识别，识别结果作为隐藏上下文消息注入主模型；`llm/stream` 同时剥离模型请求中的 image 块（deepseek 文本序列化器不支持图片）。

## 结构

| 半 | 文件 | 职责 |
|---|---|---|
| Host | `src/index.ts` | `VisionService extends TypertRemoteService`：`@Remote` 方法 `queue`/`config`/`status` + `agent/pre-step`、`llm/stream` 事件监听 + GLM 调用 |
| Client | `src/client/index.ts` | `conversation.input.dock` 插槽：粘贴拦截、发送拦截、模型/API Key 设置菜单 |
| 类型 | `src/types.ts` | 跨面 wire 类型（无损 JSON） |

构建产物（`pnpm run build:lib` 生成）：

- `lib/index.js` — Host 半
- `lib/client.js` — Client 半 bundle（经 `window.__ModuleLoader__` 加载）
- `lib/typert.host.js` / `lib/typert.remote-client.js` — 由 workspace typert 生成器从 `@Remote` 方法自动生成（client 通过 `ctx.remote.vision.*` 调用）

## 安装与启用

### 方式一：仓库内开发（本包所在）

在 profile 或 overlay 的 `cordis.yml` 中加一行（host 半）：

```yaml
- id: vision-plugin
  name: '@uachar/dsh-vision-plugin'
```

client 半由 `dsh.client` 声明自动被发现（需包在 profile 的依赖里）。

### 方式二：npm 发布后安装

```sh
dsh plugin --profile demo add @uachar/dsh-vision-plugin
```

包内 `dsh.bundle` 声明会把 `cordis.patch.yml` 作为组合层应用；未提供 patch 时在 profile 的 `cordis.patch.yml` 手动加 host 行（同上）。

### 使用

1. 打开 Web UI，新建会话；
2. 输入框上方出现「视觉识别」dock；
3. 点击齿轮图标，添加模型（默认 `glm-4v-flash`）与 API Key（智谱开放平台 `https://open.bigmodel.cn/api/paas/v4/chat/completions`）；
4. 粘贴图片（支持多张）→ 发送（纯图片会自动补"请描述这张图片的内容"）。

## 配置

模型与 API Key 目前保存在 Host 进程内存中（`VisionService.entries`），重启后丢失。需要持久化时可把存储换成 settings/credentials 后端。

## 开发

```sh
# 安装依赖（仓库根）
pnpm install --filter @uachar/dsh-vision-plugin...

# 类型检查
pnpm exec tsc -b packages/vision/vision/tsconfig.json
pnpm exec tsc -b packages/vision/vision/tsconfig.client.json

# 构建（host 面生成 typert 产物 → client 面生成 bundle）
pnpm run build:lib:host
pnpm run build:lib:client

# 或一次构建全部
pnpm run build:lib
```

### 构建顺序依赖

`lib/typert.remote-client.js` 由 host 面 tsdown 生成，client 半的 `import visionRemote from '@uachar/dsh-vision-plugin/remote'` 依赖它——所以**必须先跑 host 面构建**，client 面才能解析 `./remote`（tsconfig.client.json 已把 `@uachar/dsh-vision-plugin/remote` paths 指向生成物）。

## 发布到 npm

1. 构建产物：`pnpm run build:lib`
2. `package.json` 的 `files` 已列出发布物（lib/*.js、lib/types、typert 产物）；`dsh.client` 声明、`exports` 已就绪
3. 发布前注意：
   - 若保留在 dsh 仓库内开发，`pnpm run build:lib:host` 会触发仓库约束检查；正式发布建议从独立 git 仓库执行 `npm publish` 或 `pnpm publish`（把 `workspace:*` 依赖改成真实版本）
   - git 安装需要 `prepare` 脚本 + 用户 `allowBuilds` 授权；发布预构建产物（npm 包/tarball）则无需

## 许可

MIT
