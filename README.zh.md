# dsh-vision-plugin

DeepSeek Harness 的视觉识别插件：把图片粘贴到 Web 输入框，Host 侧经 **GLM-4V** 识别，并把识别结果作为隐藏上下文消息注入对话。原生双面（Host + 浏览器）插件，经 dsh-launcher 安装与管理。

## 工作原理

1. 在 Web 输入框粘贴一张或多张图片并发送。
2. 浏览器半（`conversation.input.dock`）把图片字节经 `ctx.remote.vision.queue` 送到 Host 半。
3. Host 半在 `agent/pre-step` 中把每张图片存为持久 attachment，向历史写入 `vision-image` 块（UI 渲染缩略图；DeepSeek 文本序列化器忽略该块），并调用 **GLM-4V**。
4. 识别结果作为隐藏上下文用户消息追加，主模型据此回答图片内容。
5. `llm/stream` 同时剥离模型请求中残留的 `image` 块（DeepSeek 序列化器不支持图片）。

### dsh 附件授权自修复补丁

历史缩略图加载依赖 readAttachment 授权，而该授权历史上只放行核心 `image` 块，导致 `vision-image` 缩略图加载失败（`ATTACHMENT_NOT_REFERENCED`）。插件 Host 半在加载时检查 dsh 源码中的 `imageBlockIn`，若缺少补丁则自动执行 `scripts/apply-dsh-patch.mjs`——一行幂等改动 + apiproxy 重建。不依赖 launcher 或安装钩子；该补丁对所有携带 attachment 的插件块都有益。

## 安装

通过 dsh-launcher（本地路径 → `D:\Pro\dsh-vision`）安装，或手动执行：

```sh
pnpm dsh plugin --profile web add link:D:\Pro\dsh-vision
```

之后**重启 dsh**。浏览器半通过包的 `dsh.client` 声明自动被发现。

## 配置

新建会话后，输入框上方出现「视觉识别」dock：

1. 点击齿轮图标。
2. 添加模型（默认 `glm-4v-flash`）与 API Key（智谱开放平台，端点 `https://open.bigmodel.cn/api/paas/v4/chat/completions`）。
3. 粘贴图片发送；纯图片会自动补"请描述这张图片的内容"。

> 模型与 API Key 会持久化到本地纯 JSON 配置文件 `$DSH_HOME\vision-config.json`（默认 `~\.dsh\vision-config.json`）：插件首次加载时自动生成（空配置），每次配置变更即重写，重启 dsh 后自动重新读取——模型与 Key 重启不丢失。该文件仅存本地、未加密、不进 git，经 dsh-launcher 卸载插件时自动删除。

## 结构

| 半 | 文件 | 职责 |
|---|---|---|
| Host | `src/index.ts` | `VisionService extends TypertRemoteService`：`@Remote` `queue`/`config`/`status` + `agent/pre-step`、`llm/stream` 监听 + GLM 调用 |
| Client | `src/client/index.ts` | `conversation.input.dock` 插槽：粘贴拦截、发送拦截、模型/API Key 设置菜单 |
| 补丁 | `src/patch.ts` + `scripts/apply-dsh-patch.mjs` | dsh 附件授权自修复补丁 |
| 类型 | `src/types.ts` | 跨面 wire 类型（无损 JSON） |

## 构建

Host 半可独立构建：

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json
node node_modules/tsdown/dist/run.mjs --config tsdown.config.ts
```

浏览器 bundle（`lib/client.js`）与 typert 生成面（`lib/typert.host.js` / `lib/typert.remote-client.js`）是构建期产物，目前由 dsh workspace 构建生成；仓库内的 `tsconfig.client.json` 仍引用 dsh 源码目录。要在 workspace 之外完整重建 client 半，需先迁移该配置与 typert 生成步骤。

## 已知限制

- 配置持久化为 `$DSH_HOME` 下的明文 JSON 文件；API Key 属于敏感本地数据，请注意保管。
- GLM-4V 识别需要有效的智谱 API Key（在 dock 中配置）。
- dsh 附件补丁针对本地源码目录的 `api-proxy.ts`；若目录结构与预期不符，脚本拒绝自动打补丁并提示所需改动。

## 许可

MIT
