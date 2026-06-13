# RECALLX Implementation Guardrails

本文档记录后续开发 RECALLX 时应持续提供给代码代理的核心约束。

## 当前能力

- 保存当前用户主页或推文详情页。
- 扫描当前视口内已经渲染且可见的 `a[href]`。
- 导出本地 JSON 并显示 profiles、tweets、likes、bookmarks、follows 统计。
- 通过事件委托记录用户真实点击产生的点赞、书签和关注备份。

## 必须遵守的提示词

```text
RECALLX 是本地优先的 Tampermonkey URL 与交互备份工具。

不得自动点击任何 X / Twitter 按钮。
不得自动关注、自动点赞、自动收藏或自动恢复历史行为。
不得调用 X / Twitter 内部 API。
不得无限滚动、主动加载更多内容或依赖 X CSS class 名。
只允许读取当前 URL、DOM 中的 a[href]，以及用户真实 click 事件对应按钮的
data-testid、aria-label 和 innerText。
所有数据默认只使用 GM_getValue / GM_setValue 保存在本地。
不得实现未经用户明确要求的 GitHub 或其他远程同步。
不得硬编码 token、账号、密码、Cookie 或其他凭据。

交互 URL 只保存在对应的 likes、bookmarks 或 follows 集合，不要额外复制到
tweets 或 profiles。
捕获取消点赞、取消收藏、取消关注时，删除对应交互集合中的记录，但不得删除
current-page 或 visible-link 来源的 tweets/profiles 独立备份。
```

## 数据兼容要求

- 根数据继续使用 `version: 1`。
- 加载旧数据时必须保留已有 profiles 和 tweets。
- 缺少 likes、bookmarks、follows 时必须自动补空对象。
- 保存时间和 `updatedAt` 使用带 `+08:00` 偏移的东八区 ISO 8601 字符串。
