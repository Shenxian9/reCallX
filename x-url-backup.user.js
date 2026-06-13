// ==UserScript==
// @name         RECALLX
// @namespace    local.recallx
// @version      0.1.0
// @description  Locally back up visible X profile and post URLs.
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
    return new Date().toISOString();
  }

  function emptyData() {
    return {
      version: 1,
      profiles: {},
      tweets: {},
      updatedAt: '',
    };
  }

  function loadData() {
    const stored = GM_getValue(STORAGE_KEY, null);

    if (
      !stored ||
      typeof stored !== 'object' ||
      stored.version !== 1 ||
      !stored.profiles ||
      typeof stored.profiles !== 'object' ||
      Array.isArray(stored.profiles) ||
      !stored.tweets ||
      typeof stored.tweets !== 'object' ||
      Array.isArray(stored.tweets)
    ) {
      return emptyData();
    }

    return {
      version: 1,
      profiles: stored.profiles,
      tweets: stored.tweets,
      updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
    };
  }

  function saveData(data) {
    GM_setValue(STORAGE_KEY, data);
  }

  function normalizeUrl(url) {
    let parsed;

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
    const updatedAt = data.updatedAt || '尚无记录';

    setStatus(
      `profiles: ${profileCount} · tweets: ${tweetCount} · updatedAt: ${updatedAt}`,
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
})();
