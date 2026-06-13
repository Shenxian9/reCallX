// ==UserScript==
// @name         RECALLX
// @namespace    local.recallx
// @version      0.5.2
// @description  Locally back up user-triggered X likes, bookmarks, and follows.
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
  const SYNC_STATE_KEY = 'recallx-bulk-sync-state';
  const ACCOUNT_HANDLE_KEY = 'recallx-account-handle';
  const MAX_SYNC_SCROLLS = 20;
  const SYNC_SCROLL_DELAY = 800;
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
  let accountHandleInput = null;

  function now() {
    const offsetMilliseconds = 8 * 60 * 60 * 1000;
    return `${new Date(Date.now() + offsetMilliseconds)
      .toISOString()
      .slice(0, -1)}+08:00`;
  }

  function emptyData() {
    return {
      version: 2,
      likes: {},
      bookmarks: {},
      follows: {},
      updatedAt: '',
    };
  }

  function ensureDataShape(data) {
    const stored = data && typeof data === 'object' ? data : {};
    const shaped = emptyData();
    const collectionNames = ['likes', 'bookmarks', 'follows'];

    for (const name of collectionNames) {
      if (
        stored[name] &&
        typeof stored[name] === 'object' &&
        !Array.isArray(stored[name])
      ) {
        shaped[name] = stored[name];
      }
    }
    shaped.updatedAt =
      typeof stored.updatedAt === 'string' ? stored.updatedAt : '';

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

  function isInSidebar(element) {
    if (!element) {
      return false;
    }

    if (
      element.closest('aside') ||
      element.closest('[role="complementary"]') ||
      element.closest('[data-testid="sidebarColumn"]')
    ) {
      return true;
    }

    const recommendationPattern =
      /who to follow|you might like|recommended for you|people you may know|推荐关注|推荐用户|你可能喜欢|可能认识的人|おすすめユーザー|フォローおすすめ/i;
    let depth = 0;
    for (
      let node = element;
      node && node !== document.body && depth < 10;
      node = node.parentElement, depth += 1
    ) {
      const stableRegionInfo = [
        node.getAttribute('aria-label') || '',
        node.getAttribute('data-testid') || '',
        node.getAttribute('role') || '',
      ].join(' ');
      if (
        /sidebar|side.?bar|sidebarColumn|complementary/i.test(
          stableRegionInfo,
        )
      ) {
        return true;
      }

      const regionText = (node.innerText || node.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 800);
      if (recommendationPattern.test(`${stableRegionInfo} ${regionText}`)) {
        const rect = node.getBoundingClientRect();
        const viewportWidth =
          window.innerWidth || document.documentElement.clientWidth;
        const isRightColumn =
          rect.width > 0 &&
          viewportWidth > 0 &&
          rect.left >= Math.max(300, viewportWidth * 0.5);
        if (isRightColumn) {
          return true;
        }
      }
    }

    return false;
  }

  function findProfileRecordInSingleUserCell(userCell) {
    if (!userCell) {
      return null;
    }

    const ownHandle = detectAccountHandle();
    const candidates = new Map();
    for (const link of userCell.querySelectorAll('a[href]')) {
      const record = parseXUrl(link.href);
      if (
        record?.type === 'profile' &&
        record.handle.toLowerCase() !== ownHandle?.toLowerCase()
      ) {
        candidates.set(record.url, record);
      }
    }

    return candidates.size === 1 ? candidates.values().next().value : null;
  }

  function findProfileRecordNearElement(element) {
    if (isInSidebar(element)) {
      return null;
    }

    const userCell = element.closest('[data-testid="UserCell"]');
    if (userCell) {
      return findProfileRecordInSingleUserCell(userCell);
    }

    const currentRecord = parseXUrl(window.location.href);
    if (currentRecord?.type === 'profile' && element.closest('main')) {
      return currentRecord;
    }

    return null;
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

    if (isInSidebar(button)) {
      console.info('[RECALLX] ignored follow in sidebar');
      return;
    }

    const profileRecord = findProfileRecordNearElement(button);
    if (!profileRecord) {
      console.info('[RECALLX] ignored follow: no unique profile found');
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

  function sleep(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  function detectAccountHandle() {
    const candidates = [
      accountHandleInput?.value,
      GM_getValue(ACCOUNT_HANDLE_KEY, ''),
      document.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.href,
      window.location.href,
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate.trim()) {
        continue;
      }

      const directHandle = candidate.trim().replace(/^@/, '');
      if (
        HANDLE_PATTERN.test(directHandle) &&
        !SYSTEM_PATHS.has(directHandle.toLowerCase())
      ) {
        return directHandle;
      }

      const normalized = normalizeUrl(candidate);
      if (!normalized) {
        continue;
      }
      const parts = new URL(normalized).pathname.split('/').filter(Boolean);
      if (
        parts.length >= 1 &&
        HANDLE_PATTERN.test(parts[0]) &&
        !SYSTEM_PATHS.has(parts[0].toLowerCase())
      ) {
        return parts[0];
      }
    }

    return null;
  }

  function getBulkSyncSteps(handle) {
    return [
      {
        collection: 'bookmarks',
        label: '书签',
        path: '/i/bookmarks',
        recordType: 'tweet',
      },
      {
        collection: 'likes',
        label: '喜欢',
        path: `/${handle}/likes`,
        recordType: 'tweet',
      },
      {
        collection: 'follows',
        label: '关注',
        path: `/${handle}/following`,
        recordType: 'profile',
      },
    ];
  }

  function collectBulkRecords(recordType, records) {
    if (recordType === 'tweet') {
      for (const article of document.querySelectorAll('article')) {
        for (const link of article.querySelectorAll('a[href*="/status/"]')) {
          const record = parseXUrl(link.href);
          if (record?.type === 'tweet') {
            records.set(record.url, record);
            break;
          }
        }
      }
      return;
    }

    for (const userCell of document.querySelectorAll(
      '[data-testid="UserCell"]',
    )) {
      for (const link of userCell.querySelectorAll('a[href]')) {
        const record = parseXUrl(link.href);
        if (record?.type === 'profile') {
          records.set(record.url, record);
          break;
        }
      }
    }
  }

  async function scanBulkSyncPage(step) {
    const records = new Map();
    let stableRounds = 0;
    let previousHeight = 0;

    await sleep(1_500);
    for (let round = 0; round <= MAX_SYNC_SCROLLS; round += 1) {
      collectBulkRecords(step.recordType, records);

      const currentHeight = document.documentElement.scrollHeight;
      stableRounds =
        currentHeight === previousHeight ? stableRounds + 1 : 0;
      previousHeight = currentHeight;
      if (stableRounds >= 3 || round === MAX_SYNC_SCROLLS) {
        break;
      }

      window.scrollTo({
        top: currentHeight,
        behavior: 'auto',
      });
      setStatus(
        `正在更新${step.label}：已识别 ${records.size} 条（${round + 1}/${MAX_SYNC_SCROLLS}）`,
      );
      await sleep(SYNC_SCROLL_DELAY);
    }

    const savedAt = now();
    const collection = {};
    for (const record of records.values()) {
      collection[record.url] = {
        ...record,
        savedAt,
        source: 'bulk-sync',
      };
    }
    return collection;
  }

  async function resumeBulkSync() {
    const state = GM_getValue(SYNC_STATE_KEY, null);
    if (
      !state ||
      typeof state !== 'object' ||
      !HANDLE_PATTERN.test(state.handle || '')
    ) {
      return;
    }

    const steps = getBulkSyncSteps(state.handle);
    const step = steps[state.step];
    if (!step) {
      GM_setValue(SYNC_STATE_KEY, null);
      return;
    }

    if (window.location.pathname.replace(/\/+$/, '') !== step.path) {
      window.location.assign(`https://x.com${step.path}`);
      return;
    }

    setStatus(`正在批量更新${step.label}，请勿关闭页面…`);
    const collection = await scanBulkSyncPage(step);
    const data = loadData();
    data[step.collection] = collection;
    data.updatedAt = now();
    saveData(data);

    const nextStep = state.step + 1;
    if (nextStep >= steps.length) {
      GM_setValue(SYNC_STATE_KEY, null);
      setStatus(
        `批量更新完成：书签 ${data.bookmarks ? Object.keys(data.bookmarks).length : 0}，喜欢 ${data.likes ? Object.keys(data.likes).length : 0}，关注 ${Object.keys(data.follows).length}`,
      );
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }

    GM_setValue(SYNC_STATE_KEY, {
      ...state,
      step: nextStep,
    });
    window.location.assign(`https://x.com${steps[nextStep].path}`);
  }

  function startBulkSync() {
    const handle = detectAccountHandle();
    if (!handle) {
      setStatus('请先填写有效的 X 用户名（不含 @）');
      accountHandleInput?.focus();
      return;
    }

    const confirmed = window.confirm(
      [
        '一键更新会依次打开书签、喜欢和关注页面。',
        '每个分类会使用本次扫描结果替换本地旧记录，可能覆盖或删除以前保存的数据。',
        `当前账号：@${handle}`,
        '是否继续？',
      ].join('\n'),
    );
    if (!confirmed) {
      return;
    }

    GM_setValue(ACCOUNT_HANDLE_KEY, handle);
    GM_setValue(SYNC_STATE_KEY, {
      version: 1,
      handle,
      step: 0,
      startedAt: now(),
    });
    window.location.assign('https://x.com/i/bookmarks');
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
      likes: Object.keys(data.likes).length,
      bookmarks: Object.keys(data.bookmarks).length,
      follows: Object.keys(data.follows).length,
    };

    if (!statsModalElement || !statsContentElement) {
      setStatus('统计窗口暂不可用');
      return;
    }

    const statCard = (collection, label, description, count, tone) => `
      <button
        class="stat-card stat-card--${tone}"
        type="button"
        data-stats-collection="${collection}"
        aria-label="查看${label}记录，共 ${count} 条"
      >
        <span class="stat-card__label">${label}</span>
        <strong class="stat-card__value">${count}</strong>
        <span class="stat-card__description">${description}</span>
        <span class="stat-card__action">查看详情 →</span>
      </button>
    `;

    statsContentElement.innerHTML = `
      <section class="stats-section" aria-labelledby="recallx-action-stats-title">
        <div class="stats-section__heading">
          <div>
            <h3 id="recallx-action-stats-title">账号交互记录</h3>
            <p>点击任一分类，查看对应账号、链接和保存信息</p>
          </div>
        </div>
        <div class="stats-grid stats-grid--three">
          ${statCard('likes', '点赞', '已记录的推文点赞', counts.likes, 'like')}
          ${statCard('bookmarks', '书签', '已记录的推文书签', counts.bookmarks, 'bookmark')}
          ${statCard('follows', '关注', '已记录的关注账号', counts.follows, 'follow')}
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
        <div>
          <dt>存储位置</dt>
          <dd>Tampermonkey 本地存储</dd>
        </div>
      </dl>
    `;

    statsModalElement.hidden = false;
    statsCloseButton?.focus();
  }

  function showStatsDetails(collectionName) {
    const collectionMeta = {
      likes: { label: '点赞', recordLabel: '推文' },
      bookmarks: { label: '书签', recordLabel: '推文' },
      follows: { label: '关注', recordLabel: '账号' },
    };
    const meta = collectionMeta[collectionName];
    if (!meta || !statsContentElement) {
      return;
    }

    const data = loadData();
    const records = Object.values(data[collectionName]).sort((a, b) =>
      String(b.savedAt || '').localeCompare(String(a.savedAt || '')),
    );
    const rows = records
      .map((record, index) => {
        const handle = record.handle ? `@${record.handle}` : '未知账号';
        const safeUrl = normalizeUrl(record.url) || '';
        const linkMarkup = safeUrl
          ? `
              <a
                class="detail-link"
                href="${escapeHtml(safeUrl)}"
                target="_blank"
                rel="noopener noreferrer"
              >${escapeHtml(safeUrl)}</a>
            `
          : '<span class="detail-kind">无有效链接</span>';
        return `
          <tr>
            <td class="detail-index">${index + 1}</td>
            <td>
              <strong class="detail-handle">${escapeHtml(handle)}</strong>
              <span class="detail-kind">${meta.recordLabel}</span>
            </td>
            <td>
              ${linkMarkup}
            </td>
            <td>${escapeHtml(record.savedAt || '未知')}</td>
            <td>${escapeHtml(record.source || '未知')}</td>
          </tr>
        `;
      })
      .join('');

    statsContentElement.innerHTML = `
      <div class="detail-toolbar">
        <button class="detail-back" type="button" data-stats-back>
          ← 返回统计
        </button>
        <span>${meta.label} · ${records.length} 条</span>
      </div>
      ${
        records.length
          ? `
            <div class="detail-table-wrap">
              <table class="detail-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">账号</th>
                    <th scope="col">链接</th>
                    <th scope="col">保存时间</th>
                    <th scope="col">来源</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          `
          : `
            <div class="detail-empty">
              <strong>暂无${meta.label}记录</strong>
              <span>在 X 页面手动执行${meta.label}操作后，记录会显示在这里。</span>
            </div>
          `
      }
    `;
    statsContentElement.querySelector('[data-stats-back]')?.focus();
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
      .account-field {
        display: grid;
        gap: 5px;
        margin-bottom: 10px;
      }
      .account-field label {
        color: #94a3b8;
        font-size: 11px;
      }
      .account-field input {
        box-sizing: border-box;
        width: 100%;
        min-height: 34px;
        padding: 6px 9px;
        border: 1px solid #475569;
        border-radius: 8px;
        color: #f8fafc;
        background: #111827;
        font: inherit;
      }
      .account-field input:focus {
        border-color: #38bdf8;
        outline: 2px solid rgb(56 189 248 / 25%);
      }
      .bulk-sync-button {
        grid-column: 1 / -1;
        border-color: #0369a1;
        background: #075985;
        font-weight: 700;
      }
      .bulk-sync-button:hover {
        background: #0c4a6e;
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
      .stats-grid {
        display: grid;
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
        text-align: left;
        transition: border-color 120ms ease, transform 120ms ease, background 120ms ease;
      }
      .stat-card:hover {
        background: #162238;
        transform: translateY(-1px);
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
      .stat-card__description {
        color: #64748b;
        font-size: 10px;
      }
      .stat-card__action {
        color: #bae6fd;
        font-size: 10px;
        font-weight: 650;
      }
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
      .detail-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: #94a3b8;
        font-size: 12px;
      }
      .detail-back {
        min-height: 32px;
        padding: 5px 10px;
      }
      .detail-table-wrap {
        overflow-x: auto;
        border: 1px solid #273449;
        border-radius: 12px;
      }
      .detail-table {
        width: 100%;
        min-width: 760px;
        border-collapse: collapse;
        background: #0b1324;
        font-size: 11px;
      }
      .detail-table th,
      .detail-table td {
        padding: 11px 12px;
        border-bottom: 1px solid #1e293b;
        text-align: left;
        vertical-align: top;
      }
      .detail-table th {
        color: #94a3b8;
        background: #111c2f;
        font-size: 10px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .detail-table tbody tr:last-child td {
        border-bottom: 0;
      }
      .detail-table tbody tr:hover {
        background: #111c2f;
      }
      .detail-index,
      .detail-kind {
        color: #64748b;
      }
      .detail-handle,
      .detail-kind {
        display: block;
      }
      .detail-handle {
        margin-bottom: 3px;
        color: #f1f5f9;
      }
      .detail-link {
        display: block;
        max-width: 300px;
        color: #7dd3fc;
        overflow: hidden;
        text-decoration: none;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .detail-link:hover {
        text-decoration: underline;
      }
      .detail-empty {
        display: grid;
        gap: 6px;
        justify-items: center;
        padding: 42px 20px;
        border: 1px dashed #334155;
        border-radius: 12px;
        color: #64748b;
        text-align: center;
      }
      .detail-empty strong {
        color: #cbd5e1;
        font-size: 14px;
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
    panel.setAttribute('aria-label', 'RECALLX interaction backup');

    const title = document.createElement('h2');
    title.textContent = 'RECALLX';

    const accountField = document.createElement('div');
    accountField.className = 'account-field';
    const accountLabel = document.createElement('label');
    accountLabel.htmlFor = 'recallx-account-handle';
    accountLabel.textContent = '同步账号';
    accountHandleInput = document.createElement('input');
    accountHandleInput.id = 'recallx-account-handle';
    accountHandleInput.type = 'text';
    accountHandleInput.inputMode = 'text';
    accountHandleInput.autocomplete = 'off';
    accountHandleInput.maxLength = 15;
    accountHandleInput.placeholder = '用户名（不含 @）';
    accountHandleInput.value = detectAccountHandle() || '';
    accountHandleInput.addEventListener('change', () => {
      const handle = accountHandleInput.value.trim().replace(/^@/, '');
      if (HANDLE_PATTERN.test(handle)) {
        accountHandleInput.value = handle;
        GM_setValue(ACCOUNT_HANDLE_KEY, handle);
      }
    });
    accountField.append(accountLabel, accountHandleInput);

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const actions = [
      ['一键更新', startBulkSync],
      ['导出 JSON', exportJson],
      ['统计', showStats],
    ];

    for (const [label, handler] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', handler);
      if (handler === startBulkSync) {
        button.className = 'bulk-sync-button';
      }
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
            <h2 id="recallx-stats-title">账号交互统计</h2>
          </div>
          <button class="stats-close" type="button" aria-label="关闭统计窗口">×</button>
        </header>
        <div class="stats-dialog__body"></div>
      </section>
    `;
    statsContentElement = statsModalElement.querySelector(
      '.stats-dialog__body',
    );
    statsContentElement.addEventListener('click', (event) => {
      const collectionButton = event.target.closest('[data-stats-collection]');
      if (collectionButton) {
        showStatsDetails(collectionButton.dataset.statsCollection);
        return;
      }
      if (event.target.closest('[data-stats-back]')) {
        showStats();
      }
    });
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

    panel.append(title, accountField, buttons, statusElement);
    shadow.append(style, panel, statsModalElement);
    document.body.append(host);
  }

  createPanel();
  initInteractionCapture();
  resumeBulkSync();
})();
