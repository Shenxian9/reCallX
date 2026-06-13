// ==UserScript==
// @name         RECALLX
// @namespace    local.recallx
// @version      0.3.0
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
  let statsModalElement = null;
  let statsContentElement = null;
  let statsCloseButton = null;
  let statsTriggerButton = null;

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

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
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
    const counts = {
      profiles: Object.keys(data.profiles).length,
      tweets: Object.keys(data.tweets).length,
      likes: Object.keys(data.likes).length,
      bookmarks: Object.keys(data.bookmarks).length,
      follows: Object.keys(data.follows).length,
    };
    const urlBackupTotal = counts.profiles + counts.tweets;
    const interactionTotal = counts.likes + counts.bookmarks + counts.follows;
    const total = urlBackupTotal + interactionTotal;

    if (!statsModalElement || !statsContentElement) {
      setStatus(`共 ${total} 条本地记录`);
      return;
    }

    const statCard = (label, count, tone) => `
      <div class="stat-card stat-card--${tone}">
        <span class="stat-card__label">${label}</span>
        <strong class="stat-card__value">${count}</strong>
      </div>
    `;

    statsContentElement.innerHTML = `
      <div class="stats-summary">
        <span class="stats-summary__label">本地记录总计</span>
        <strong class="stats-summary__value">${total}</strong>
        <span class="stats-summary__hint">全部数据仅保存在 Tampermonkey 本地存储</span>
      </div>
      <section class="stats-section" aria-labelledby="recallx-url-stats-title">
        <div class="stats-section__heading">
          <div>
            <h3 id="recallx-url-stats-title">URL 备份</h3>
            <p>手动保存或扫描得到的独立链接</p>
          </div>
          <span class="stats-section__total">${urlBackupTotal} 条</span>
        </div>
        <div class="stats-grid">
          ${statCard('用户主页', counts.profiles, 'profile')}
          ${statCard('推文', counts.tweets, 'tweet')}
        </div>
      </section>
      <section class="stats-section" aria-labelledby="recallx-action-stats-title">
        <div class="stats-section__heading">
          <div>
            <h3 id="recallx-action-stats-title">交互记录</h3>
            <p>由用户真实点击捕获，可随取消操作移除</p>
          </div>
          <span class="stats-section__total">${interactionTotal} 条</span>
        </div>
        <div class="stats-grid stats-grid--three">
          ${statCard('点赞', counts.likes, 'like')}
          ${statCard('书签', counts.bookmarks, 'bookmark')}
          ${statCard('关注', counts.follows, 'follow')}
        </div>
      </section>
      <dl class="stats-meta">
        <div>
          <dt>最后更新</dt>
          <dd>${escapeHtml(data.updatedAt || '尚无记录')}</dd>
        </div>
        <div>
          <dt>数据版本</dt>
          <dd>Version ${data.version}</dd>
        </div>
      </dl>
    `;

    statsModalElement.hidden = false;
    statsCloseButton?.focus();
  }

  function closeStats() {
    if (!statsModalElement || statsModalElement.hidden) {
      return;
    }

    statsModalElement.hidden = true;
    statsTriggerButton?.focus();
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
      .stats-modal[hidden] {
        display: none;
      }
      .stats-modal {
        position: fixed;
        inset: 0;
        z-index: 1;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        padding: 20px;
        background: rgb(2 6 23 / 72%);
        backdrop-filter: blur(4px);
      }
      .stats-dialog {
        box-sizing: border-box;
        width: min(560px, 100%);
        max-height: min(720px, calc(100vh - 40px));
        overflow-y: auto;
        border: 1px solid #334155;
        border-radius: 18px;
        color: #e2e8f0;
        background: #0f172a;
        box-shadow: 0 24px 80px rgb(0 0 0 / 55%);
      }
      .stats-dialog__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        padding: 20px 22px 14px;
        border-bottom: 1px solid #1e293b;
      }
      .stats-dialog__eyebrow {
        display: block;
        margin-bottom: 4px;
        color: #38bdf8;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .stats-dialog h2,
      .stats-dialog h3,
      .stats-dialog p {
        margin: 0;
      }
      .stats-dialog h2 {
        color: #f8fafc;
        font-size: 21px;
        letter-spacing: normal;
      }
      .stats-close {
        width: 34px;
        min-height: 34px;
        padding: 0;
        border-radius: 50%;
        font-size: 20px;
        line-height: 1;
      }
      .stats-dialog__body {
        display: grid;
        gap: 16px;
        padding: 18px 22px 22px;
      }
      .stats-summary {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 2px 16px;
        align-items: center;
        padding: 16px 18px;
        border: 1px solid #075985;
        border-radius: 14px;
        background: linear-gradient(135deg, rgb(14 116 144 / 25%), rgb(30 41 59 / 55%));
      }
      .stats-summary__label {
        color: #bae6fd;
        font-size: 13px;
        font-weight: 650;
      }
      .stats-summary__value {
        grid-row: 1 / 3;
        grid-column: 2;
        color: #f8fafc;
        font-size: 34px;
        line-height: 1;
      }
      .stats-summary__hint {
        color: #94a3b8;
        font-size: 11px;
      }
      .stats-section {
        padding: 15px;
        border: 1px solid #273449;
        border-radius: 14px;
        background: #111c2f;
      }
      .stats-section__heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .stats-section h3 {
        color: #f1f5f9;
        font-size: 14px;
      }
      .stats-section p {
        margin-top: 2px;
        color: #64748b;
        font-size: 11px;
      }
      .stats-section__total {
        flex: none;
        padding: 3px 8px;
        border-radius: 999px;
        color: #cbd5e1;
        background: #1e293b;
        font-size: 11px;
        font-weight: 650;
      }
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 9px;
      }
      .stats-grid--three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .stat-card {
        display: grid;
        gap: 7px;
        padding: 12px;
        border: 1px solid #334155;
        border-radius: 11px;
        background: #0b1324;
      }
      .stat-card__label {
        color: #94a3b8;
        font-size: 11px;
      }
      .stat-card__value {
        color: #f8fafc;
        font-size: 24px;
        line-height: 1;
      }
      .stat-card--profile { border-top-color: #22d3ee; }
      .stat-card--tweet { border-top-color: #60a5fa; }
      .stat-card--like { border-top-color: #fb7185; }
      .stat-card--bookmark { border-top-color: #c084fc; }
      .stat-card--follow { border-top-color: #4ade80; }
      .stats-meta {
        display: grid;
        gap: 8px;
        margin: 0;
      }
      .stats-meta > div {
        display: grid;
        grid-template-columns: 90px minmax(0, 1fr);
        gap: 12px;
        padding: 10px 12px;
        border-radius: 9px;
        background: #111827;
      }
      .stats-meta dt {
        color: #64748b;
      }
      .stats-meta dd {
        margin: 0;
        color: #cbd5e1;
        overflow-wrap: anywhere;
        text-align: right;
      }
      @media (max-width: 480px) {
        .stats-grid--three {
          grid-template-columns: 1fr;
        }
        .stats-dialog__body,
        .stats-dialog__header {
          padding-right: 16px;
          padding-left: 16px;
        }
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
      if (handler === showStats) {
        statsTriggerButton = button;
      }
      buttons.append(button);
    }

    statusElement = document.createElement('p');
    statusElement.className = 'status';
    statusElement.setAttribute('aria-live', 'polite');
    statusElement.textContent = '数据仅保存在本地';

    statsModalElement = document.createElement('div');
    statsModalElement.className = 'stats-modal';
    statsModalElement.hidden = true;
    statsModalElement.innerHTML = `
      <section
        class="stats-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recallx-stats-title"
      >
        <header class="stats-dialog__header">
          <div>
            <span class="stats-dialog__eyebrow">RECALLX LOCAL DATA</span>
            <h2 id="recallx-stats-title">备份统计</h2>
          </div>
          <button class="stats-close" type="button" aria-label="关闭统计窗口">×</button>
        </header>
        <div class="stats-dialog__body"></div>
      </section>
    `;
    statsContentElement = statsModalElement.querySelector(
      '.stats-dialog__body',
    );
    statsCloseButton = statsModalElement.querySelector('.stats-close');
    statsCloseButton.addEventListener('click', closeStats);
    statsModalElement.addEventListener('click', (event) => {
      if (event.target === statsModalElement) {
        closeStats();
      }
    });
    shadow.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeStats();
      }
    });

    panel.append(title, buttons, statusElement);
    shadow.append(style, panel, statsModalElement);
    document.body.append(host);
  }

  createPanel();
  initInteractionCapture();
})();
