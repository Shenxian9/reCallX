# RECALLX Local Data Schema (Version 1)

RECALLX 使用 Tampermonkey 本地存储保存一个版本化根对象。`profiles` 和 `tweets`
均以规范化后的 URL 作为 key，因此 URL 本身就是去重标识。

## Root object

```json
{
  "version": 1,
  "profiles": {},
  "tweets": {},
  "likes": {},
  "bookmarks": {},
  "follows": {},
  "updatedAt": ""
}
```

字段说明：

- `version`：数据结构版本，第一版固定为 `1`。
- `profiles`：profile record map，key 为规范化 profile URL。
- `tweets`：tweet record map，key 为规范化 tweet URL。
- `likes`：用户真实点击点赞按钮时保存的 tweet record map。
- `bookmarks`：用户真实点击书签按钮时保存的 tweet record map。
- `follows`：用户真实点击关注按钮时保存的 profile record map。
- `updatedAt`：最后一次新增记录的 ISO 8601 东八区时间；无记录时为空字符串。

## Profile record

```json
{
  "url": "",
  "type": "profile",
  "handle": "",
  "savedAt": "",
  "source": ""
}
```

- `url`：规范化后的 `https://x.com/{handle}`。
- `handle`：URL 中原样保留的有效 handle。
- `savedAt`：首次保存时间，带 `+08:00` 偏移的 ISO 8601 东八区字符串。
- `source`：记录来源；使用 `current-page`、`visible-link` 或 `user-click`。

存储示例：

```json
{
  "profiles": {
    "https://x.com/example": {
      "url": "https://x.com/example",
      "type": "profile",
      "handle": "example",
      "savedAt": "2026-06-13T20:00:00.000+08:00",
      "source": "current-page"
    }
  }
}
```

## Tweet record

```json
{
  "url": "",
  "type": "tweet",
  "handle": "",
  "tweetId": "",
  "savedAt": "",
  "source": ""
}
```

- `url`：规范化后的 `https://x.com/{handle}/status/{tweetId}`。
- `handle`：推文作者 URL 路径中的有效 handle。
- `tweetId`：仅由数字组成的推文 ID，以字符串保存以避免数值精度问题。
- `savedAt`：首次保存时间，带 `+08:00` 偏移的 ISO 8601 东八区字符串。
- `source`：记录来源；使用 `current-page`、`visible-link` 或 `user-click`。

## 写入与兼容规则

1. 以 record 的 `url` 作为对应 map 的 key。
2. 已存在相同 key 时不覆盖首次保存的 `savedAt` 和 `source`。
3. 新增任意 record 时，将 root `updatedAt` 更新为同一次写入的时间。
4. 点赞只将 tweet record 写入 `likes`，不额外写入 `tweets`。
5. 添加书签只将 tweet record 写入 `bookmarks`，不额外写入 `tweets`。
6. 关注只将 profile record 写入 `follows`，不额外写入 `profiles`。
7. 旧 version 1 数据缺失 `likes`、`bookmarks` 或 `follows` 时自动补空对象，
   不清空已有 `profiles` 和 `tweets`。
8. 缺失或损坏的集合字段回退为空对象；根对象继续使用 version 1。
9. version 1 不包含凭据或任何远程同步配置。
10. 兼容旧版冗余数据：若 tweets/profiles 中的记录来源为 `user-click`，且同 URL
    已存在于相应交互集合，加载时删除该冗余副本；其他来源的普通备份保持不变。

## Interaction record semantics

`likes` 和 `bookmarks` 中的值使用 tweet record 结构，`follows` 中的值使用 profile
record 结构。交互记录的 `source` 为 `user-click`，`savedAt` 是首次捕获该行为的时间。

这些集合跟随用户捕获到的取消动作更新：

- 取消点赞删除 `likes` 中的对应记录；
- 取消收藏删除 `bookmarks` 中的对应记录；
- 取消关注删除 `follows` 中的对应记录；
- 取消动作不会删除 `tweets` 或 `profiles` 中由 `current-page` / `visible-link`
  创建的独立 URL 备份。
