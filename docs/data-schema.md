# RECALLX Local Data Schema (Version 1)

RECALLX 使用 Tampermonkey 本地存储保存一个版本化根对象。`profiles` 和 `tweets`
均以规范化后的 URL 作为 key，因此 URL 本身就是去重标识。

## Root object

```json
{
  "version": 1,
  "profiles": {},
  "tweets": {},
  "updatedAt": ""
}
```

字段说明：

- `version`：数据结构版本，第一版固定为 `1`。
- `profiles`：profile record map，key 为规范化 profile URL。
- `tweets`：tweet record map，key 为规范化 tweet URL。
- `updatedAt`：最后一次新增记录的 ISO 8601 UTC 时间；无记录时为空字符串。

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
- `savedAt`：首次保存时间，ISO 8601 UTC 字符串。
- `source`：记录来源；MVP 使用 `current-page` 或 `visible-link`。

存储示例：

```json
{
  "profiles": {
    "https://x.com/example": {
      "url": "https://x.com/example",
      "type": "profile",
      "handle": "example",
      "savedAt": "2026-06-13T12:00:00.000Z",
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
- `savedAt`：首次保存时间，ISO 8601 UTC 字符串。
- `source`：记录来源；MVP 使用 `current-page` 或 `visible-link`。

## 写入与兼容规则

1. 以 record 的 `url` 作为对应 map 的 key。
2. 已存在相同 key 时不覆盖首次保存的 `savedAt` 和 `source`。
3. 新增任意 record 时，将 root `updatedAt` 更新为同一次写入的时间。
4. 缺失、损坏或非 version 1 的存储值回退到空的 version 1 root object。
5. version 1 不包含 likes、bookmarks、凭据或任何远程同步配置。
