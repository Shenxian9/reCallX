# RECALLX Implementation Guardrails

## 当前能力

- 通过真实点击捕获 likes、bookmarks、follows。
- 取消交互时删除对应本地记录。
- 导出 version 2 JSON。
- 在统计弹窗中点击分类并查看账号、链接、时间和来源详情。

## 必须遵守的提示词

```text
RECALLX 是本地优先的 X 账号交互记录工具。

只保存 likes、bookmarks、follows，不要恢复 profiles/tweets 普通备份、
“保存当前页”或“扫描可见链接”功能。
不得显示无意义的本地记录总计。
点赞、书签、关注统计必须可点击，并展示可访问的详情表格。

不得自动点击任何 X / Twitter 按钮。
不得自动关注、自动点赞、自动收藏或自动恢复历史行为。
不得调用 X / Twitter 内部 API。
不得无限滚动、主动加载更多内容或依赖 X CSS class 名。
所有数据默认只使用 GM_getValue / GM_setValue 保存在本地。
不得实现未经用户明确要求的远程同步。
不得硬编码 token、账号、密码、Cookie 或其他凭据。
```

## 数据兼容要求

- 根数据使用 `version: 2`。
- 旧数据只迁移 likes、bookmarks、follows。
- 旧 profiles 和 tweets 不再保留。
- 保存时间使用带 `+08:00` 偏移的东八区 ISO 8601 字符串。
