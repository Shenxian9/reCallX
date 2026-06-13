# X URL Backup Userscript Requirements

## Goal

Build a Tampermonkey userscript for x.com and twitter.com.

The script should help the user locally back up URLs for:

- X user profiles
- X posts / tweets
- possibly liked posts
- possibly bookmarked posts

The script must not:

- auto-follow users
- auto-like posts
- auto-bookmark posts
- call X internal APIs
- scrape by infinite auto-scrolling
- perform high-frequency requests

## MVP Features

1. Show a small floating panel on X pages.
2. Save current page if it is:
   - a tweet detail page
   - a user profile page
3. Scan currently visible page links and collect:
   - tweet URLs
   - profile URLs
4. Store data locally with GM_setValue and GM_getValue.
5. Deduplicate by normalized URL.
6. Export all data as JSON.
7. Export all data as Markdown.
8. Provide simple statistics:
   - profile count
   - tweet count
   - bookmark count
   - like count

## Data Model

Use one root object:

{
"version": 1,
"profiles": {},
"tweets": {},
"likes": {},
"bookmarks": {},
"updatedAt": ""
}

Each record should include:

- url
- type
- handle if available
- savedAt
- source

## Safety

Only save links from the currently loaded DOM.
Do not send data anywhere unless the user explicitly configures GitHub sync later.
