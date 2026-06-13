# RECALLX Implementation Guardrails

## 当前能力

- 通过真实点击捕获 likes、bookmarks、follows。
- 取消交互时删除对应本地记录。
- 导出 version 2 JSON。
- 在统计弹窗中点击分类并查看账号、链接、时间和来源详情。
- 通过有上限的页面滚动依次批量更新书签、喜欢和关注集合。

## 必须遵守的提示词

```text
RECALLX 是本地优先的 X 账号交互记录工具。

只保存 likes、bookmarks、follows，不要恢复 profiles/tweets 普通备份、
“保存当前页”或“扫描可见链接”功能。
不得显示无意义的本地记录总计。
点赞、书签、关注统计必须可点击，并展示可访问的详情表格。

不得自动点击任何 X / Twitter 按钮。
不得自动关注、自动点赞、自动收藏或自动恢复历史行为。
follow 点击捕获必须限制在被点击按钮所属的单一 UserCell；侧边栏推荐关注必须忽略，
不得从 article、parentElement 或全页 UserCell 推断点击对象。
不得调用 X / Twitter 内部 API。
不得无限滚动、无上限加载内容或依赖 X CSS class 名。
一键更新允许最多 20 次有界滚动，并必须在开始前提醒用户会整体替换集合、
可能覆盖或删除旧记录。
批量更新只能读取页面 DOM，不得调用 X 内部 API。
所有数据默认只使用 GM_getValue / GM_setValue 保存在本地。
不得实现未经用户明确要求的远程同步。
不得硬编码 token、账号、密码、Cookie 或其他凭据。
```

## 数据兼容要求

- 根数据使用 `version: 2`。
- 旧数据只迁移 likes、bookmarks、follows。
- 旧 profiles 和 tweets 不再保留。
- 保存时间使用带 `+08:00` 偏移的东八区 ISO 8601 字符串。
