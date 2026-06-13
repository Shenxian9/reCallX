# RECALLX

RECALLX 是一个仅在本地工作的 Tampermonkey userscript，用于记录用户在
X（`x.com` / `twitter.com`）页面上真实点击产生的点赞、书签和关注信息。

脚本不调用 X 内部 API，不会自动关注、点赞、收藏或滚动页面，也不提供普通用户主页或
推文 URL 的批量备份功能。

## 当前功能

- 在 X 页面右下角显示固定的 **RECALLX** 浮动面板。
- 监听用户真实点击产生的点赞、书签和关注操作。
- 取消点赞、取消收藏或取消关注时，删除对应的本地交互记录。
- 按规范化 URL 去重，所有数据只保存在 Tampermonkey 本地存储。
- 将 likes、bookmarks、follows 和元数据导出为 JSON。
- 在可视化统计窗口中展示三个交互分类；点击分类可查看详细表格。
- 通过“一键更新”依次从书签、喜欢和关注页面批量重建三个本地集合。

## 安装方式

1. 在浏览器中安装 Tampermonkey。
2. 打开 Tampermonkey 管理面板，选择“添加新脚本”。
3. 将 [`x-url-backup.user.js`](./x-url-backup.user.js) 的完整内容粘贴到编辑器。
4. 保存并启用脚本。
5. 打开或刷新任意 `https://x.com/*` 或 `https://twitter.com/*` 页面。

项目不使用外部依赖和构建工具，userscript 文件可直接运行。

## 使用方式

页面右下角的 RECALLX 面板提供：

- **同步账号**：填写 X 用户名（不含 `@`）；脚本也会尝试从页面自动识别。
- **一键更新**：依次访问：
  - `https://x.com/i/bookmarks`
  - `https://x.com/{用户名}/likes`
  - `https://x.com/{用户名}/following`
- **导出 JSON**：下载名为 `recallx-backup-YYYY-MM-DD.json` 的完整交互备份。
- **统计**：打开统计窗口，分别显示点赞、书签和关注数量。

一键更新只读取页面渲染出的链接，不调用 X 内部 API：

- 书签、喜欢和关注都先尝试定位列表底部，底部连续稳定后再按约四分之三个视口高度
  从下往上采集。
- 不再设置固定 80 轮限制；到达顶部且连续 8 轮没有新增记录时停止。
- 为防止 X 页面异常导致永久运行，每个阶段保留 30 分钟时间型安全终止。

一键更新默认使用**合并模式**：本次扫描结果会并入旧集合，不会因为某次漏扫而删除旧记录。
已存在 URL 保留最早的 `savedAt` 和原始 `source`，并更新 `lastSeenAt` 与
`sourceLastSeen: "bulk-sync"`。

统计窗口中的三个分类卡片均可点击。详情表格展示：

- 账号 handle；
- 相关 X 链接，可在新标签页打开；
- 记录类型；
- 东八区保存时间；
- 记录来源。

统计窗口不显示无实际用途的“本地记录总计”，也不再展示 profiles 或 tweets 普通备份。

## 数据与取消操作

- 点赞只保存在 `likes`。
- 书签只保存在 `bookmarks`。
- 关注只保存在 `follows`。
- unlike、remove bookmark 和 unfollow 会删除对应本地记录。
- 批量采集记录的 `source` 为 `bulk-sync`。
- 合并后旧记录不会因本次未扫描到而删除。
- 所有 `savedAt` 和 `updatedAt` 使用带 `+08:00` 偏移的东八区 ISO 8601 时间。
- 从旧版数据升级时，只迁移 likes、bookmarks 和 follows；旧 profiles/tweets 不再保留。

## 安全边界

- 不自动关注、点赞、收藏或执行其他账号操作。
- 只监听用户真实点击，不自动点击、恢复或重放操作。
- Follow/unfollow 只绑定被点击按钮所在的单一 UserCell，或用户主页主内容区；
  右侧栏和推荐关注侧边区域默认忽略。
- 不调用 X / Twitter 内部 API，不发送额外数据收集请求。
- 不执行无限滚动；扫描没有固定轮数上限，但有内容停止条件和 30 分钟阶段超时保护。
- 不依赖 X 的 CSS class 名。
- 所有数据默认仅通过 `GM_getValue` / `GM_setValue` 保存在本地。
- 不包含 GitHub 同步、云同步或自动上传。
- 不包含或硬编码 token、账号、密码、Cookie 等凭据。

## 后续计划

- 本地交互备份导入与合并。
- 详情表格的筛选、排序和搜索。
- 经用户明确配置后再考虑可选同步能力。
