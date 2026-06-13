# RECALLX Userscript Requirements

## 目标

构建一个可直接安装的 Tampermonkey userscript，在 `x.com` 和 `twitter.com`
页面中收集用户明确要求保存的用户主页及推文 URL。数据默认只保存在本地。

## MVP 功能

1. 在匹配页面右下角显示固定的 RECALLX 面板。
2. “保存当前页”识别并保存：
   - 用户主页；
   - 推文详情页。
3. “扫描可见链接”只检查当前视口内已经渲染且可见的 `a[href]`：
   - 识别用户主页 URL；
   - 识别推文 URL；
   - 按规范化 URL 去重。
4. 使用 `GM_getValue` 和 `GM_setValue` 读写本地数据。
5. 导出包含完整本地数据的 JSON 文件。
6. 显示 profiles 数量、tweets 数量和 `updatedAt`。
7. 监听用户真实点击红心、书签和关注按钮的事件：
   - 点赞记录写入 `tweets` 和 `likes`；
   - 书签记录写入 `tweets` 和 `bookmarks`；
   - 关注记录写入 `profiles` 和 `follows`。
8. 统计同时显示 profiles、tweets、likes、bookmarks 和 follows 数量。

## 非目标功能

以下功能不属于本 MVP：

- 自动关注、自动点赞或自动收藏；
- 自动点击、恢复、重放或撤销用户行为；
- 读取或修改点赞、收藏状态；
- 调用 X / Twitter 内部 API；
- 无限滚动、自动加载更多内容或高频抓取；
- GitHub、云端或其他远程同步；
- JSON 导入、Markdown 导出和复杂的数据管理界面。

## 安全限制

- 只允许使用当前页面 URL 和当前 DOM 中可见的 `a[href]` 进行识别。
- 不依赖 X 页面内部 CSS class 名。
- 不发起用于收集数据的网络请求，不向第三方发送本地记录。
- 不保存 token、账号、密码、Cookie 或其他凭据。
- 所有账号操作均由用户在 X 页面中自行完成；脚本不代替用户执行操作。
- 扫描动作必须由用户点击触发，且不得通过滚动扩大扫描范围。
- 行为捕获只能监听用户真实产生的 click 事件，不得主动触发 X 页面按钮。
- 不调用 X 内部 API 查询交互状态。
- likes、bookmarks 和 follows 是历史备份，不保证与 X 当前状态完全一致。
- 用户取消点赞、取消收藏或取消关注时，不删除已有备份，也不新增对应行为记录。

## 用户交互识别

- 使用捕获阶段事件委托：
  `document.addEventListener('click', handleDocumentClick, true)`。
- 只处理用户点击路径中最近的 `button` 或 `div[role="button"]`。
- 动作识别只参考按钮的 `data-testid`、`aria-label` 和 `innerText`。
- `unlike`、`removeBookmark`、`remove-bookmark` 和 `unfollow` 等取消动作不记录。
- 点赞和书签优先从最近的 `article` 中读取 `/status/` 链接；详情页可回退到当前 URL。
- 关注优先从最近的 `[data-testid="UserCell"]` 读取主页链接，再检查附近 article
  或父元素；用户主页可回退到当前 URL。
- 无法找到相应 tweet/profile record 时不写入任何行为数据。

## URL 识别规则

### 规范化

`normalizeUrl(url)` 应：

1. 只接受 `https://x.com` 或 `https://twitter.com` URL；
2. 将主机名 `twitter.com` 统一转换为 `x.com`；
3. 删除 query string；
4. 删除 hash；
5. 删除末尾多余斜杠，但保留根路径 `/`。

### 推文 URL

- 格式：`https://x.com/{handle}/status/{tweetId}`
- `tweetId` 必须仅包含数字。

### 用户主页 URL

- 格式：`https://x.com/{handle}`
- 必须只有一个路径段。

### Handle

- 长度为 1 到 15 位；
- 只允许字母、数字和下划线；
- 匹配时不区分系统路径的大小写。

以下系统路径不能被识别为用户主页：

- `home`
- `explore`
- `notifications`
- `messages`
- `settings`
- `i`
- `compose`
- `search`
- `jobs`
- `premium`
- `verified-orgs`
- `grok`

系统路径也不能作为推文 URL 中的 handle。

## 本地存储规则

- 使用一个固定 Tampermonkey 存储键保存版本化根对象。
- 根对象包含 `version`、`profiles`、`tweets`、`likes`、`bookmarks`、`follows`
  和 `updatedAt`。
- 所有记录集合都是以规范化 URL 为 key 的对象。
- 每条记录包含规范化 URL、类型、handle、保存时间及来源。
- 推文记录还包含 `tweetId`。
- 新记录的 `savedAt` 使用带 `+08:00` 偏移的 ISO 8601 东八区时间。
- 只有新增记录时才更新根对象的 `updatedAt`；重复 URL 不重复写入。
- 数据损坏或结构不兼容时，脚本应安全回退为空的 version 1 数据，不执行远程恢复。
- 旧 version 1 数据缺少 likes、bookmarks 或 follows 时，加载后自动补为空对象，
  并保留已有 profiles 和 tweets。
- JSON 导出文件名为 `recallx-backup-YYYY-MM-DD.json`。
