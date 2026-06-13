# RECALLX Userscript Requirements

## 目标

构建一个本地优先的 Tampermonkey userscript，记录用户在 `x.com` 和 `twitter.com`
页面上真实执行的点赞、书签和关注操作，并提供 JSON 导出及可交互的详情统计。

## MVP 功能

1. 在匹配页面右下角显示固定 RECALLX 面板。
2. 面板仅提供：
   - 导出 JSON；
   - 统计。
3. 使用 `GM_getValue` 和 `GM_setValue` 保存 likes、bookmarks、follows。
4. 捕获用户真实点击：
   - like 写入 `likes`；
   - bookmark 写入 `bookmarks`；
   - follow 写入 `follows`；
   - unlike、remove bookmark、unfollow 删除对应记录。
5. 统计窗口展示点赞、书签和关注三个可点击分类，不显示本地记录总计。
6. 点击分类后展示详情表格，包括账号、链接、记录类型、保存时间和来源。
7. 详情链接可在新标签页安全打开。
8. 统计窗口支持关闭按钮、点击遮罩关闭和 Escape 键关闭。
9. 浮窗提供账号输入和“一键更新”：
   - 自动识别当前账号 handle，失败时允许用户手动输入；
   - 依次访问 `/i/bookmarks`、`/{handle}/likes`、`/{handle}/following`；
   - 书签、喜欢和关注都先定位底部，再从下往上采集；
   - 不设置固定滚动轮数上限；
   - 每阶段使用 30 分钟时间型安全终止，避免页面异常时永久运行；
   - 将本次结果合并到对应本地集合，不删除旧记录。

## 已删除功能

- 保存当前用户主页；
- 保存当前推文详情页；
- 扫描可见链接；
- profiles 普通备份；
- tweets 普通备份；
- URL 备份统计和本地记录总计。

## 非目标功能

- 自动关注、自动点赞或自动收藏；
- 自动点击、恢复、重放或撤销用户行为；
- 调用 X / Twitter 内部 API；
- 无限滚动、高频抓取或无上限页面采集；
- GitHub、云端或其他远程同步；
- 账号凭据、Cookie 或 token 存储。

## 用户交互识别

- 使用 `document.addEventListener('click', handleDocumentClick, true)`。
- 只处理最近的 `button` 或 `div[role="button"]`。
- 动作识别只参考 `data-testid`、`aria-label` 和 `innerText`。
- like/bookmark 从最近 `article` 中寻找 `/status/` 链接，详情页可回退当前 URL。
- follow/unfollow 只允许从被点击按钮最近的单一 `[data-testid="UserCell"]`
  寻找唯一主页链接。
- 如果按钮不在 UserCell 中，仅当当前 URL 是用户主页且按钮位于 `main` 主内容区时，
  才使用当前主页 URL。
- `aside`、`[role="complementary"]` 及可稳定识别的 sidebar / Who to follow /
  推荐关注区域中的 follow/unfollow 一律忽略。
- 侧栏识别必须覆盖 `[data-testid="sidebarColumn"]`；对于没有明确语义 role 的布局，
  结合推荐模块稳定文本与元素位于视口右半区的几何位置判断。
- 禁止从 article、parentElement、大容器或页面其他 UserCell 宽泛查找点击对象。
- 无法识别对应记录时不写入数据。

## URL 识别规则

- 只接受 HTTPS `x.com` 和 `twitter.com`。
- `twitter.com` 统一为 `x.com`。
- 删除 query、hash 和非根路径末尾斜杠。
- 推文：`https://x.com/{handle}/status/{tweetId}`。
- 主页：`https://x.com/{handle}`。
- handle 为 1–15 位字母、数字或下划线，并过滤系统路径。
- tweetId 只允许数字。

URL 识别只用于确定交互所对应的账号或推文，不用于普通 URL 扫描和备份。

## 批量更新规则

- 不调用 X 内部 API，也不通过额外 HTTP 请求获取数据。
- 使用页面导航和当前 DOM 中已渲染的链接采集。
- bookmarks/likes 从 `article a[href*="/status/"]` 识别推文。
- following 只从非 sidebar 的单一 `[data-testid="UserCell"]` 识别唯一账号主页，
  必须复用点击捕获的侧边栏过滤，避免导入 Who to follow 推荐账号。
- 使用持久化同步状态跨页面依次完成三个步骤。
- bookmarks/likes/follows 先反复 `scrollTo` 当前底部并等待虚拟列表扩展；底部位置和高度连续
  3 轮稳定后开始记录。
- 三个分类记录阶段每轮向上滚动约视口高度的 75%，到达顶部且连续 8 轮
  没有新增记录时停止。
- 每次滚动后等待 2 秒，不设置固定轮数上限；每阶段最多运行 30 分钟。
- tweet bulk-sync 收集 article 内所有合法 status URL，由 Map 去重。
- 每个分类完成后与旧集合合并，记录来源为 `bulk-sync`，不得删除未扫描到的旧记录。
- 已存在 URL 保留原 `savedAt` 和 `source`，更新 `lastSeenAt` 和
  `sourceLastSeen: "bulk-sync"`。
- 底部定位输出 phase、轮次、滚动位置、页面高度和稳定轮数。
- 采集输出方向、数量、新增数、滚动位置、页面高度、顶部/底部状态和连续无新增轮数。
- 同步期间不得自动点击点赞、书签、关注或其他账号操作按钮。
- following bulk-sync 遇到 aside、complementary、sidebarColumn 或右侧推荐模块必须跳过。

## 本地存储规则

- 根对象使用 version 2，只包含 `likes`、`bookmarks`、`follows`、`updatedAt`。
- 每个集合以规范化 URL 为 key 去重。
- likes/bookmarks 保存 tweet record；follows 保存 profile record。
- `savedAt` 和 `updatedAt` 使用带 `+08:00` 偏移的东八区 ISO 8601 时间。
- 重复交互不覆盖首次保存信息。
- 取消操作删除对应集合中的记录并更新 `updatedAt`。
- 读取旧 version 1 数据时，只迁移 likes、bookmarks、follows；丢弃 profiles/tweets。
- 批量更新记录使用 `source: "bulk-sync"`。
- bulk-sync 合并模式不得降低集合数量。
- JSON 文件名为 `recallx-backup-YYYY-MM-DD.json`。

## 统计详情要求

- 三个分类卡片必须有明确标签、数量、说明和“查看详情”提示。
- 表格按 `savedAt` 从新到旧排列。
- 表格必须处理空状态和长 URL。
- 所有从存储读取并插入 HTML 的字段必须转义。
- 外部链接使用 `target="_blank"` 和 `rel="noopener noreferrer"`。
- 窄屏下允许表格横向滚动，不得撑破视口。
