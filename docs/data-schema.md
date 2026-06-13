# RECALLX Local Data Schema (Version 2)

## Root object

```json
{
  "version": 2,
  "likes": {},
  "bookmarks": {},
  "follows": {},
  "updatedAt": ""
}
```

- `likes`：用户真实点击点赞按钮时保存的 tweet record map。
- `bookmarks`：用户真实点击书签按钮时保存的 tweet record map。
- `follows`：用户真实点击关注按钮时保存的 profile record map。
- `updatedAt`：最后一次新增或删除记录的东八区 ISO 8601 时间。

version 2 不包含 `profiles` 和 `tweets` 普通备份集合。

## Tweet interaction record

用于 `likes` 和 `bookmarks`：

```json
{
  "url": "https://x.com/example/status/123",
  "type": "tweet",
  "handle": "example",
  "tweetId": "123",
  "savedAt": "2026-06-13T20:00:00.000+08:00",
  "source": "user-click"
}
```

## Profile interaction record

用于 `follows`：

```json
{
  "url": "https://x.com/example",
  "type": "profile",
  "handle": "example",
  "savedAt": "2026-06-13T20:00:00.000+08:00",
  "source": "user-click"
}
```

## 写入与删除

1. 以规范化 URL 为对应集合的 key。
2. 同一集合中的相同 URL 只保存一次。
3. like 只写 likes，bookmark 只写 bookmarks，follow 只写 follows。
4. unlike 删除 likes 记录。
5. remove bookmark 删除 bookmarks 记录。
6. unfollow 删除 follows 记录。
7. 新增或删除成功时更新 `updatedAt`。

## Version 1 迁移

加载 version 1 或其他旧结构时：

1. 保留有效的 `likes`、`bookmarks`、`follows` 对象。
2. 不迁移 `profiles` 和 `tweets`。
3. 缺失或损坏的交互集合补为空对象。
4. 根对象版本设置为 `2`。
5. 保留有效字符串 `updatedAt`。

迁移后的数据会在下一次写入或导出内容中体现为 version 2 结构。
