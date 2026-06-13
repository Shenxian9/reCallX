// ==UserScript==
// @name         RECALLX
// @namespace    local.recallx
// @version      0.2.1
// @description  Locally back up visible X URLs and user-triggered interactions.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'recallx-data';
  const SYSTEM_PATHS = new Set([
    'home',
    'explore',
    'notifications',
    'messages',
    'settings',
    'i',
    'compose',
    'search',
    'jobs',
    'premium',
    'verified-orgs',
    'grok',
  ]);
  const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
  const TWEET_ID_PATTERN = /^\d+$/;
  let statusElement = null;

  function now() {
    const offsetMilliseconds = 8 * 60 * 60 * 1000;
    return `${new Date(Date.now() + offsetMilliseconds)
      .toISOString()
      .slice(0, -1)}+08:00`;
  }

  function emptyData() {
    return {
      version: 1,
      profiles: {},
      tweets: {},
      likes: {},
      bookmarks: {},
      follows: {},
      updatedAt: '',
    };
  }

  function ensureDataShape(data) {
    const shaped = data && typeof data === 'object' ? data : {};
    const collectionNames = [
      'profiles',
      'tweets',
      'likes',
      'bookmarks',
      'follows',
    ];

    shaped.version = 1;
    for (const name of collectionNames) {
      if (
        !shaped[name] ||
        typeof shaped[name] !== 'object' ||
        Array.isArray(shaped[name])
      ) {
        shaped[name] = {};
      }
    }
    shaped.updatedAt =
      typeof shaped.updatedAt === 'string' ? shaped.updatedAt : '';

    // Remove interaction-created duplicates from data written by version 0.2.0.
    // Explicitly saved/scanned profile and tweet records remain untouched.
    for (const url of new Set([
      ...Object.keys(shaped.likes),
      ...Object.keys(shaped.bookmarks),
    ])) {
      if (shaped.tweets[url]?.source === 'user-click') {
        delete shaped.tweets[url];
      }
    }
    for (const url of Object.keys(shaped.follows)) {
      if (shaped.profiles[url]?.source === 'user-click') {
        delete shaped.profiles[url];
      }
    }

    return shaped;
  }

  function loadData() {
    return ensureDataShape(GM_getValue(STORAGE_KEY, null));
  }

  function saveData(data) {
    GM_setValue(STORAGE_KEY, data);
  }

  function normalizeUrl(url) {
    let parsed;

    if (typeof url !== 'string' || !url.trim()) {
      return null;
    }

    try {
      parsed = new URL(url, window.location.href);
    } catch {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== 'https:' ||
      (hostname !== 'x.com' && hostname !== 'twitter.com')
    ) {
      return null;
    }

    parsed.hostname = 'x.com';
    parsed.port = '';
    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';

    return parsed.toString();
  }

  function parseXUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return null;
    }

    const parsed = new URL(normalizedUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (
      parts.length === 3 &&
      HANDLE_PATTERN.test(parts[0]) &&
      !SYSTEM_PATHS.has(parts[0].toLowerCase()) &&
      parts[1].toLowerCase() === 'status' &&
      TWEET_ID_PATTERN.test(parts[2])
    ) {
      return {
        url: normalizedUrl,
        type: 'tweet',
        handle: parts[0],
        tweetId: parts[2],
      };
    }

    if (
      parts.length === 1 &&
      HANDLE_PATTERN.test(parts[0]) &&
      !SYSTEM_PATHS.has(parts[0].toLowerCase())
    ) {
      return {
        url: normalizedUrl,
        type: 'profile',
        handle: parts[0],
      };
    }

    return null;
  }

  function saveRecord(record, source) {
    if (!record || (record.type !== 'profile' && record.type !== 'tweet')) {
      return false;
    }

    const data = loadData();
    const collection = record.type === 'tweet' ? data.tweets : data.profiles;

    if (collection[record.url]) {
      return false;
    }

    const savedAt = now();
    collection[record.url] = {
      ...record,
      savedAt,
      source,
    };
    data.updatedAt = savedAt;
    saveData(data);
    return true;
  }

  function saveTweetInteraction(tweetRecord, interactionType, source) {
    if (
      !tweetRecord ||
      tweetRecord.type !== 'tweet' ||
      !['like', 'bookmark'].includes(interactionType)
    ) {
      return false;
    }

    const data = loadData();
    const collection =
      interactionType === 'like' ? data.likes : data.bookmarks;

    if (collection[tweetRecord.url]) {
      return false;
    }

    const savedAt = now();
    collection[tweetRecord.url] = {
      ...tweetRecord,
      savedAt,
      source,
    };
    data.updatedAt = savedAt;
    saveData(data);
    return true;
  }

  function saveProfileInteraction(profileRecord, interactionType, source) {
    if (
      !profileRecord ||
      profileRecord.type !== 'profile' ||
      interactionType !== 'follow'
    ) {
      return false;
    }

    const data = loadData();

    if (data.follows[profileRecord.url]) {
      return false;
    }

    const savedAt = now();
    data.follows[profileRecord.url] = {
      ...profileRecord,
      savedAt,
      source,
    };
    data.updatedAt = savedAt;
    saveData(data);
    return true;
  }

  function removeTweetInteraction(tweetRecord, interactionType) {
    if (
      !tweetRecord ||
      tweetRecord.type !== 'tweet' ||
      !['unlike', 'remove-bookmark'].includes(interactionType)
    ) {
      return false;
    }

    const data = loadData();
    const collection =
      interactionType === 'unlike' ? data.likes : data.bookmarks;

    if (!collection[tweetRecord.url]) {
      return false;
    }

    delete collection[tweetRecord.url];
    data.updatedAt = now();
    saveData(data);
    return true;
  }

  function removeProfileInteraction(profileRecord, interactionType) {
    if (
      !profileRecord ||
      profileRecord.type !== 'profile' ||
      interactionType !== 'unfollow'
    ) {
      return false;
    }

    const data = loadData();
    if (!data.follows[profileRecord.url]) {
      return false;
    }

    delete data.follows[profileRecord.url];
    data.updatedAt = now();
    saveData(data);
    return true;
  }

  function setStatus(message) {
    if (statusElement) {
      statusElement.textContent = message;
    }
  }

  function saveCurrentPage() {
    const record = parseXUrl(window.location.href);

    if (!record) {
      setStatus('当前页面不是可识别的用户主页或推文页');
      return;
    }

    const added = saveRecord(record, 'current-page');
    setStatus(added ? `已保存 ${record.type}` : '该 URL 已保存');
  }

  function isVisibleLink(link) {
    if (!link.isConnected || link.getClientRects().length === 0) {
      return false;
    }

    const style = window.getComputedStyle(link);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      Number.parseFloat(style.opacity) === 0
    ) {
      return false;
    }

    const rect = link.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth
    );
  }

  function scanVisibleLinks() {
    const uniqueRecords = new Map();

    for (const link of document.querySelectorAll('a[href]')) {
      if (!isVisibleLink(link)) {
        continue;
      }

      const record = parseXUrl(link.href);
      if (record) {
        uniqueRecords.set(record.url, record);
      }
    }

    let addedCount = 0;
    for (const record of uniqueRecords.values()) {
      if (saveRecord(record, 'visible-link')) {
        addedCount += 1;
      }
    }

    setStatus(`识别 ${uniqueRecords.size} 条，新增 ${addedCount} 条`);
  }

  function detectActionFromButton(button) {
    const testId = (button.getAttribute('data-testid') || '').toLowerCase();
    const ariaLabel = (button.getAttribute('aria-label') || '').trim();
    const buttonText = (button.innerText || '').trim();
    const followText = `${ariaLabel} ${buttonText}`;

    if (testId.includes('unlike')) {
      return 'unlike';
    }
    if (testId.includes('like')) {
      return 'like';
    }

    if (
      testId.includes('removebookmark') ||
      testId.includes('remove-bookmark')
    ) {
      return 'remove-bookmark';
    }
    if (testId.includes('bookmark')) {
      return 'bookmark';
    }

    if (testId.includes('unfollow')) {
      return 'unfollow';
    }
    if (testId.includes('follow')) {
      return 'follow';
    }

    if (
      /\b(?:unfollow|following)\b/i.test(followText) ||
      /取消关注|正在关注|フォロー中|フォロー解除/.test(followText)
    ) {
      return 'unfollow';
    }
    if (/\bfollow\b/i.test(followText) || /关注|フォロー/.test(followText)) {
      return 'follow';
    }

    return null;
  }

  function findTweetRecordNearElement(element) {
    const article = element.closest('article');
    if (article) {
      for (const link of article.querySelectorAll('a[href*="/status/"]')) {
        const record = parseXUrl(normalizeUrl(link.href));
        if (record && record.type === 'tweet') {
          return record;
        }
      }
    }

    const currentRecord = parseXUrl(window.location.href);
    return currentRecord && currentRecord.type === 'tweet'
      ? currentRecord
      : null;
  }

  function findProfileRecordInContainer(container) {
    if (!container) {
      return null;
    }

    for (const link of container.querySelectorAll('a[href]')) {
      const record = parseXUrl(link.href);
      if (record && record.type === 'profile') {
        return record;
      }
    }

    return null;
  }

  function findProfileRecordNearElement(element) {
    const userCell = element.closest('[data-testid="UserCell"]');
    const article = element.closest('article');
    const nearbyContainers = [userCell, article, element.parentElement];

    for (const container of nearbyContainers) {
      const record = findProfileRecordInContainer(container);
      if (record) {
        return record;
      }
    }

    const currentRecord = parseXUrl(window.location.href);
    return currentRecord && currentRecord.type === 'profile'
      ? currentRecord
      : null;
  }

  function handleDocumentClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest('button, div[role="button"]');
    if (!button) {
      return;
    }

    const action = detectActionFromButton(button);
    if (!action) {
      return;
    }

    if (
      action === 'like' ||
      action === 'bookmark' ||
      action === 'unlike' ||
      action === 'remove-bookmark'
    ) {
      const tweetRecord = findTweetRecordNearElement(button);
      if (!tweetRecord) {
        return;
      }

      const changed =
        action === 'like' || action === 'bookmark'
          ? saveTweetInteraction(tweetRecord, action, 'user-click')
          : removeTweetInteraction(tweetRecord, action);
      if (changed) {
        console.info(`[RECALLX] updated ${action}: ${tweetRecord.url}`);
      }
      return;
    }

    const profileRecord = findProfileRecordNearElement(button);
    if (!profileRecord) {
      return;
    }

    const changed =
      action === 'follow'
        ? saveProfileInteraction(profileRecord, action, 'user-click')
        : removeProfileInteraction(profileRecord, action);
    if (changed) {
      console.info(`[RECALLX] updated ${action}: ${profileRecord.url}`);
    }
  }

  function initInteractionCapture() {
    document.addEventListener('click', handleDocumentClick, true);
  }

  function exportJson() {
    const data = loadData();
    const json = JSON.stringify(data, null, 2);
    const blobUrl = URL.createObjectURL(
      new Blob([json], { type: 'application/json;charset=utf-8' }),
    );
    const filename = `recallx-backup-${now().slice(0, 10)}.json`;
    let revoked = false;

    const revokeBlobUrl = () => {
      if (!revoked) {
        revoked = true;
        URL.revokeObjectURL(blobUrl);
      }
    };

    GM_download({
      url: blobUrl,
      name: filename,
      saveAs: true,
      onload: () => {
        revokeBlobUrl();
        setStatus(`已导出 ${filename}`);
      },
      onerror: () => {
        revokeBlobUrl();
        setStatus('导出失败，请检查 Tampermonkey 下载权限');
      },
    });

    window.setTimeout(revokeBlobUrl, 60_000);
  }

  function showStats() {
    const data = loadData();
    const profileCount = Object.keys(data.profiles).length;
    const tweetCount = Object.keys(data.tweets).length;
    const likeCount = Object.keys(data.likes).length;
    const bookmarkCount = Object.keys(data.bookmarks).length;
    const followCount = Object.keys(data.follows).length;
    const updatedAt = data.updatedAt || '尚无记录';

    setStatus(
      [
        `profiles: ${profileCount}`,
        `tweets: ${tweetCount}`,
        `likes: ${likeCount}`,
        `bookmarks: ${bookmarkCount}`,
        `follows: ${followCount}`,
        `updatedAt: ${updatedAt}`,
      ].join(' · '),
    );
  }

  function createPanel() {
    if (document.getElementById('recallx-panel-host')) {
      return;
    }

    const host = document.createElement('div');
    host.id = 'recallx-panel-host';
    host.style.position = 'fixed';
    host.style.right = '16px';
    host.style.bottom = '16px';
    host.style.zIndex = '2147483647';

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .panel {
        box-sizing: border-box;
        width: 244px;
        padding: 14px;
        border: 1px solid #334155;
        border-radius: 12px;
        color: #e2e8f0;
        background: #0f172a;
        box-shadow: 0 10px 30px rgb(0 0 0 / 35%);
        font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      h2 {
        margin: 0 0 10px;
        color: #f8fafc;
        font-size: 16px;
        letter-spacing: 0.08em;
      }
      .buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      button {
        min-height: 34px;
        padding: 6px 8px;
        border: 1px solid #475569;
        border-radius: 8px;
        color: #f8fafc;
        background: #1e293b;
        cursor: pointer;
        font: inherit;
      }
      button:hover {
        background: #334155;
      }
      button:focus-visible {
        outline: 2px solid #38bdf8;
        outline-offset: 2px;
      }
      .status {
        min-height: 36px;
        margin: 10px 0 0;
        color: #cbd5e1;
        overflow-wrap: anywhere;
      }
    `;

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('aria-label', 'RECALLX URL backup');

    const title = document.createElement('h2');
    title.textContent = 'RECALLX';

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const actions = [
      ['保存当前页', saveCurrentPage],
      ['扫描可见链接', scanVisibleLinks],
      ['导出 JSON', exportJson],
      ['统计', showStats],
    ];

    for (const [label, handler] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', handler);
      buttons.append(button);
    }

    statusElement = document.createElement('p');
    statusElement.className = 'status';
    statusElement.setAttribute('aria-live', 'polite');
    statusElement.textContent = '数据仅保存在本地';

    panel.append(title, buttons, statusElement);
    shadow.append(style, panel);
    document.body.append(host);
  }

  createPanel();
  initInteractionCapture();
})();
