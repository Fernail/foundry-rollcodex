/* global Dialog, FormApplication, Hooks, foundry, game, ui */

const MODULE_ID = 'rollcodex';
const MODULE_VERSION = '0.1.13';
const DEFAULT_ROLLCODEX_APP_URL = 'http://localhost:5173';
const MESSAGE_HANDSHAKE_TYPE = 'rollcodex:vtt-pairing-handshake';
const MESSAGE_HANDSHAKE_RESPONSE_TYPE = 'rollcodex:vtt-pairing-handshake-response';
const MESSAGE_COMPLETE_TYPE = 'rollcodex:vtt-connection-complete';
const SNAPSHOT_RESPONSE_BLOCKED = 'SNAPSHOT_RESPONSE_BLOCKED';
const AUTO_RECOVERY_DURATION_MS = 10 * 60 * 1000;
const AUTO_RECOVERY_INTERVAL_MS = 2000;
const AUTO_SESSION_CAPTURE_MIN_INTERVAL_MS = 120000;
const DEFAULT_IDLE_MINUTES = 45;
const MAPPING_PROFILE_TTL_MS = 30 * 60 * 1000;
const LIVE_MAX_HINTS = 512;
const LIVE_MAX_SOURCES = 256;

const SETTINGS = {
  appUrl: 'appUrl',
  connectionId: 'connectionId',
  connectionSecret: 'connectionSecret',
  localConnectionSecret: 'localConnectionSecret',
  endpoint: 'endpoint',
  mappingProfileEndpoint: 'mappingProfileEndpoint',
  workspaceLabel: 'workspaceLabel',
  systemId: 'systemId',
  systemLabel: 'systemLabel',
  connectedAt: 'connectedAt',
  pendingConnectionId: 'pendingConnectionId',
  pendingConnectionSecret: 'pendingConnectionSecret',
  pendingState: 'pendingState',
  pendingPairingStatusEndpoint: 'pendingPairingStatusEndpoint',
  pendingPairingCode: 'pendingPairingCode',
  autoSnapshotEnabled: 'autoSnapshotEnabled',
  autoSnapshotMinIntervalMs: 'autoSnapshotMinIntervalMs',
  autoSnapshotIdleMinutes: 'autoSnapshotIdleMinutes',
  autoSnapshotLastSentAt: 'autoSnapshotLastSentAt',
  autoSnapshotLastMessageId: 'autoSnapshotLastMessageId',
  autoSnapshotLastError: 'autoSnapshotLastError',
  mappingProfileCache: 'mappingProfileCache',
  mappingProfileFetchedAt: 'mappingProfileFetchedAt',
};

const CLIENT_SCOPED_SETTINGS = new Set([
  SETTINGS.localConnectionSecret,
  SETTINGS.pendingConnectionId,
  SETTINGS.pendingConnectionSecret,
  SETTINGS.pendingState,
  SETTINGS.pendingPairingStatusEndpoint,
  SETTINGS.pendingPairingCode,
]);

const activeConnectionApps = new Set();
const activeLivePanels = new Set();

const autoSnapshotState = {
  hookRegistered: false,
  lastErrorMessage: '',
  idleTimer: null,
  inMemoryLastMessageId: '',
};

const liveSessionState = {
  hookRegistered: false,
  startedAt: '',
  sources: new Map(),
  observedMessageIds: new Set(),
  totals: { actions: 0, rolls: 0, nat20: 0, damageTotal: 0, healTotal: 0 },
  resolvedCount: 0,
  unresolvedCount: 0,
};

const mappingProfileState = {
  profile: null,
  generatedAt: 0,
  index: null,
  lastFetchError: '',
  inFlight: null,
};

function registerSetting(key, options) {
  game.settings.register(MODULE_ID, key, {
    scope: options.scope || 'world',
    config: options.config ?? false,
    type: options.type || String,
    default: options.default ?? '',
    name: options.name || key,
    hint: options.hint || '',
  });
}

function normalizeAppUrl(value) {
  const trimmed = String(value || '').trim() || DEFAULT_ROLLCODEX_APP_URL;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;

  try {
    url = new URL(withProtocol);
  } catch (_error) {
    throw new Error('Adresse RollCodex invalide. Utilisez HTTPS en production ou http://localhost en test local.');
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error('Adresse RollCodex invalide. Utilisez HTTPS en production ou http://localhost en test local.');
  }

  if (url.username || url.password) {
    throw new Error('Adresse RollCodex invalide. Ne mettez pas d identifiant dans l URL.');
  }

  const localHttpHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (url.protocol === 'http:' && !localHttpHosts.has(url.hostname.toLowerCase())) {
    throw new Error('Adresse RollCodex non securisee. Utilisez HTTPS, sauf pour http://localhost en test local.');
  }

  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function getLoggableEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch (_error) {
    return 'endpoint RollCodex';
  }
}

function toBase64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generateConnectionSecret() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `rcx_foundry_${toBase64Url(bytes)}`;
}

function generateState() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function generateUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function sha256Hex(value) {
  const input = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stripHtml(value) {
  const html = document.createElement('div');
  html.innerHTML = String(value || '');
  return (html.textContent || html.innerText || '').trim();
}

function getWorldMetadata() {
  return {
    foundry_world_id: game.world?.id || '',
    foundry_world_title: game.world?.title || game.world?.id || 'Monde Foundry',
    foundry_system_id: game.system?.id || '',
    foundry_system_title: game.system?.title || game.system?.id || '',
    foundry_version: game.version || '',
    module_version: MODULE_VERSION,
  };
}

function buildPairingCode({ state, secretHash }) {
  return `${String(secretHash || '').slice(0, 4)}-${String(state || '').slice(-4)}`.toUpperCase();
}

function buildPairingUrl({ appUrl, state, connectionId }) {
  const metadata = getWorldMetadata();
  const url = new URL('/vtt/connect/foundry', appUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('connection_id', connectionId);
  url.searchParams.set('source_origin', window.location.origin);

  Object.entries(metadata).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  return url.toString();
}

function buildConnectionConfigUrl(appUrl) {
  return new URL('/api/vtt-connection-config', appUrl).toString();
}

async function fetchConnectionConfig(appUrl) {
  const response = await fetch(buildConnectionConfigUrl(appUrl), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Configuration RollCodex indisponible.');
  }

  const pairingStatusEndpoint = String(payload?.foundry?.pairingStatusEndpoint || '').trim();
  if (!pairingStatusEndpoint) {
    throw new Error('Endpoint de statut RollCodex indisponible.');
  }

  return {
    pairingStatusEndpoint,
    snapshotEndpoint: String(payload?.foundry?.snapshotEndpoint || '').trim(),
    mappingProfileEndpoint: String(payload?.foundry?.mappingProfileEndpoint || '').trim(),
  };
}

function getStoredConnection() {
  return {
    connectionId: game.settings.get(MODULE_ID, SETTINGS.connectionId),
    connectionSecret: game.settings.get(MODULE_ID, SETTINGS.localConnectionSecret),
    endpoint: game.settings.get(MODULE_ID, SETTINGS.endpoint),
    mappingProfileEndpoint: game.settings.get(MODULE_ID, SETTINGS.mappingProfileEndpoint),
    workspaceLabel: game.settings.get(MODULE_ID, SETTINGS.workspaceLabel),
    systemId: game.settings.get(MODULE_ID, SETTINGS.systemId),
    systemLabel: game.settings.get(MODULE_ID, SETTINGS.systemLabel),
    connectedAt: game.settings.get(MODULE_ID, SETTINGS.connectedAt),
  };
}

function hasStoredConnection(connection = getStoredConnection()) {
  return Boolean(connection.connectionId && connection.connectionSecret && connection.endpoint);
}

function getAutoSnapshotSettings() {
  const minInterval = Number(game.settings.get(MODULE_ID, SETTINGS.autoSnapshotMinIntervalMs));
  const idleMinutes = Number(game.settings.get(MODULE_ID, SETTINGS.autoSnapshotIdleMinutes));

  return {
    enabled: Boolean(game.settings.get(MODULE_ID, SETTINGS.autoSnapshotEnabled)),
    minIntervalMs: Number.isFinite(minInterval) && minInterval > 0 ? minInterval : AUTO_SESSION_CAPTURE_MIN_INTERVAL_MS,
    idleMinutes: Number.isFinite(idleMinutes) && idleMinutes > 0 ? idleMinutes : DEFAULT_IDLE_MINUTES,
    lastSentAt: game.settings.get(MODULE_ID, SETTINGS.autoSnapshotLastSentAt),
    lastError: game.settings.get(MODULE_ID, SETTINGS.autoSnapshotLastError),
    lastMessageId: game.settings.get(MODULE_ID, SETTINGS.autoSnapshotLastMessageId),
  };
}

function getStoredLastMessageId() {
  return autoSnapshotState.inMemoryLastMessageId
    || String(game.settings.get(MODULE_ID, SETTINGS.autoSnapshotLastMessageId) || '');
}

function formatDateTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function refreshConnectionApps() {
  activeConnectionApps.forEach((app) => app.render(false));
}

function getPrimaryActiveGmUserId() {
  const users = Array.from(game.users?.contents || game.users || []);
  const activeGms = users
    .filter((user) => user?.active && user?.isGM)
    .map((user) => String(user.id || ''))
    .filter(Boolean)
    .sort();

  return activeGms[0] || '';
}

function canCurrentUserSendSnapshots() {
  if (!game.user?.isGM) return false;
  const primaryGmId = getPrimaryActiveGmUserId();
  return !primaryGmId || primaryGmId === String(game.user.id || '');
}

function collectChatMessagesSince(sinceMessageId) {
  const all = Array.from(game.messages?.contents || []);
  let startIndex = 0;
  if (sinceMessageId) {
    const idx = all.findIndex((message) => String(message.id || '') === String(sinceMessageId));
    if (idx >= 0) startIndex = idx + 1;
  }

  const slice = all.slice(startIndex);
  const messages = slice
    .map((message) => ({
      id: String(message.id || ''),
      timestamp: new Date(message.timestamp || Date.now()).toISOString(),
      speaker: message.speaker?.alias || message.alias || message.user?.name || 'Foundry',
      raw_text: stripHtml(message.content || ''),
    }))
    .filter((message) => message.raw_text);

  const lastInBatch = slice.length > 0 ? String(slice[slice.length - 1].id || '') : '';
  const lastMessageId = lastInBatch || sinceMessageId || '';
  return { messages, lastMessageId, lastInBatch };
}

function buildSnapshotPayload(connection, { mode = 'manual', reason = 'manual', sinceMessageId = '' } = {}) {
  const { messages, lastMessageId, lastInBatch } = collectChatMessagesSince(sinceMessageId);
  const idempotencyToken = lastInBatch || sinceMessageId || 'empty';
  const stableSessionCapture = mode === 'auto' || reason === 'manual_session_end';
  const clientRequestId = stableSessionCapture
    ? `${connection.connectionId}:auto:${idempotencyToken}`
    : `${connection.connectionId}:${mode}:${idempotencyToken}:${generateState()}`;

  const mappingHints = getCurrentMappingHints();
  const payload = {
    provider: 'foundry',
    connection_id: connection.connectionId,
    connection_secret: connection.connectionSecret,
    client_request_id: clientRequestId,
    source_format: 'foundry_json',
    metadata: {
      ...getWorldMetadata(),
      exported_at: new Date().toISOString(),
      rollcodex_client: `foundry-module/${MODULE_VERSION}`,
      capture_mode: mode,
      capture_reason: reason,
      since_message_id: sinceMessageId || '',
      last_message_id: lastMessageId,
      message_count: messages.length,
      mapping_hint_count: mappingHints.length,
    },
    messages: messages.map(({ id: _id, ...rest }) => rest),
  };

  if (mappingHints.length > 0) {
    payload.mapping_hints = mappingHints;
  }

  return { payload, lastMessageId, messageCount: messages.length, mappingHintCount: mappingHints.length };
}

function describeSnapshotError(payload, fallbackMessage) {
  const code = payload?.code || payload?.error || '';

  if (code === 'INVALID_CONNECTION_SECRET') {
    return 'Le secret local ne correspond plus a RollCodex. Reconnectez ce monde depuis le module.';
  }

  if (code === 'CONNECTION_REVOKED') {
    return 'La connexion RollCodex a ete revoquee. Relancez une liaison depuis Foundry.';
  }

  if (code === 'PLAN_REQUIRED') {
    return 'Le registre RollCodex n a plus le droit aux captures connectees. Verifiez le plan du registre.';
  }

  if (code === 'QUOTA_EXCEEDED') {
    return 'Le quota d import RollCodex est atteint pour ce registre.';
  }

  if (code === 'RATE_LIMITED') {
    return 'RollCodex limite temporairement les captures de cette connexion. Reessayez dans quelques instants.';
  }

  return payload?.message || fallbackMessage || 'Capture RollCodex refusee.';
}

async function postSnapshotPayload(endpoint, snapshotPayload) {
  const body = JSON.stringify(snapshotPayload);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const snapshotError = new Error(describeSnapshotError(payload, 'Capture RollCodex refusee.'));
      snapshotError.code = payload?.code || payload?.error || '';
      throw snapshotError;
    }

    return { blockedResponse: false };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;

    try {
      await fetch(endpoint, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body,
      });
    } catch (fallbackError) {
      console.error('[RollCodex] Snapshot network failure', { endpoint: getLoggableEndpoint(endpoint), error: fallbackError });
      throw new Error('Capture impossible : RollCodex est injoignable depuis Foundry. Verifiez que le serveur RollCodex et la fonction VTT sont accessibles.');
    }

    console.warn('[RollCodex] Snapshot sent without readable CORS response', { endpoint: getLoggableEndpoint(endpoint) });
    return { blockedResponse: true, code: SNAPSHOT_RESPONSE_BLOCKED };
  }
}

async function rememberSnapshotSuccess(lastMessageId = '') {
  if (lastMessageId) {
    autoSnapshotState.inMemoryLastMessageId = lastMessageId;
  }

  await Promise.all([
    game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastSentAt, new Date().toISOString()),
    game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, ''),
    lastMessageId
      ? game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastMessageId, lastMessageId)
      : Promise.resolve(),
  ]);
  autoSnapshotState.lastErrorMessage = '';
  refreshConnectionApps();
}

async function rememberSnapshotFailure(error) {
  const message = error?.message || 'Capture RollCodex impossible.';
  await game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, message);

  if (error?.code === 'CONNECTION_REVOKED' || error?.code === 'INVALID_CONNECTION_SECRET') {
    await game.settings.set(MODULE_ID, SETTINGS.autoSnapshotEnabled, false);
  }

  refreshConnectionApps();
}

async function sendSnapshotPayload({ mode = 'manual', reason = 'manual', skipIfEmpty = false } = {}) {
  const connection = getStoredConnection();
  if (!hasStoredConnection(connection)) {
    throw new Error('Connectez ce monde a RollCodex avant d envoyer une capture.');
  }

  const sinceMessageId = getStoredLastMessageId();
  const { payload, lastMessageId, messageCount } = buildSnapshotPayload(connection, {
    mode,
    reason,
    sinceMessageId,
  });

  if (messageCount === 0 && skipIfEmpty) {
    return { skipped: true, blockedResponse: false, messageCount: 0 };
  }

  try {
    const result = await postSnapshotPayload(connection.endpoint, payload);
    await rememberSnapshotSuccess(lastMessageId);
    return { ...result, messageCount };
  } catch (error) {
    await rememberSnapshotFailure(error);
    throw error;
  }
}

function hasPendingSnapshotMessages() {
  const sinceMessageId = getStoredLastMessageId();
  return collectChatMessagesSince(sinceMessageId).messages.length > 0;
}

function isFoundryDesktopClient() {
  const userAgent = String(navigator.userAgent || '').toLowerCase();
  return userAgent.includes('electron') || Boolean(globalThis.process?.versions?.electron);
}

function shouldSendSessionEndSnapshot() {
  if (!canCurrentUserSendSnapshots()) return false;
  if (!hasStoredConnection()) return false;

  const settings = getAutoSnapshotSettings();
  if (!settings.enabled) return false;
  return hasPendingSnapshotMessages();
}

function postSnapshotPayloadDuringUnload(endpoint, snapshotPayload) {
  const body = JSON.stringify(snapshotPayload);
  const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });

  try {
    if (navigator.sendBeacon?.(endpoint, blob)) {
      return true;
    }
  } catch (error) {
    console.warn('[RollCodex] Snapshot sendBeacon failure', error);
  }

  try {
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
      },
      body,
      keepalive: true,
    }).catch((error) => {
      console.warn('[RollCodex] Snapshot keepalive failure', error);
    });
    return true;
  } catch (error) {
    console.warn('[RollCodex] Snapshot unload send failure', error);
    return false;
  }
}

function sendSessionEndSnapshot(reason = 'foundry_session_end') {
  if (!shouldSendSessionEndSnapshot()) return;

  const connection = getStoredConnection();
  const sinceMessageId = getStoredLastMessageId();
  const { payload, lastMessageId, messageCount } = buildSnapshotPayload(connection, {
    mode: 'auto',
    reason,
    sinceMessageId,
  });

  if (messageCount === 0) return;

  const accepted = postSnapshotPayloadDuringUnload(connection.endpoint, payload);

  if (!accepted) {
    const message = 'Capture automatique de fin de session impossible.';
    autoSnapshotState.lastErrorMessage = message;
    game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, message).catch(() => {});
    return;
  }

  const nowIso = new Date().toISOString();
  autoSnapshotState.inMemoryLastMessageId = lastMessageId || autoSnapshotState.inMemoryLastMessageId;
  game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastSentAt, nowIso).catch(() => {});
  game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, '').catch(() => {});
  if (lastMessageId) {
    game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastMessageId, lastMessageId).catch(() => {});
  }
}

function clearIdleTimer() {
  if (autoSnapshotState.idleTimer) {
    window.clearTimeout(autoSnapshotState.idleTimer);
    autoSnapshotState.idleTimer = null;
  }
}

function scheduleIdleSnapshot() {
  clearIdleTimer();
  if (!canCurrentUserSendSnapshots()) return;
  if (!hasStoredConnection()) return;

  const settings = getAutoSnapshotSettings();
  if (!settings.enabled) return;

  const idleMs = settings.idleMinutes * 60 * 1000;
  if (!Number.isFinite(idleMs) || idleMs <= 0) return;

  autoSnapshotState.idleTimer = window.setTimeout(() => {
    autoSnapshotState.idleTimer = null;
    sendSnapshotPayload({ mode: 'auto', reason: 'idle_timeout', skipIfEmpty: true })
      .catch((error) => console.warn('[RollCodex] Idle snapshot failed', error));
  }, idleMs);
}

function registerAutoSnapshotHooks() {
  if (autoSnapshotState.hookRegistered) return;
  autoSnapshotState.hookRegistered = true;

  window.addEventListener('pagehide', () => {
    sendSessionEndSnapshot('foundry_pagehide');
  }, { capture: true });
  window.addEventListener('beforeunload', () => {
    sendSessionEndSnapshot('foundry_beforeunload');
  }, { capture: true });
  window.addEventListener('unload', () => {
    sendSessionEndSnapshot('foundry_unload');
  }, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isFoundryDesktopClient()) {
      sendSessionEndSnapshot('foundry_desktop_visibility_hidden');
    }
  }, { capture: true });
  Hooks.on('createChatMessage', () => {
    scheduleIdleSnapshot();
  });

  scheduleIdleSnapshot();
}

function parseConfirmationPayload(rawValue) {
  const normalized = String(rawValue || '').trim();
  if (!normalized) return null;

  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

async function saveConnectionFromMessage(data, connectionSecret) {
  await game.settings.set(MODULE_ID, SETTINGS.connectionId, data.connectionId || '');
  await game.settings.set(MODULE_ID, SETTINGS.localConnectionSecret, connectionSecret || '');
  await game.settings.set(MODULE_ID, SETTINGS.connectionSecret, '');
  await game.settings.set(MODULE_ID, SETTINGS.endpoint, data.endpoint || '');
  await game.settings.set(MODULE_ID, SETTINGS.mappingProfileEndpoint, data.mappingProfileEndpoint || '');
  await game.settings.set(MODULE_ID, SETTINGS.workspaceLabel, data.workspaceLabel || '');
  await game.settings.set(MODULE_ID, SETTINGS.systemId, data.systemId || '');
  await game.settings.set(MODULE_ID, SETTINGS.systemLabel, data.systemLabel || '');
  await game.settings.set(MODULE_ID, SETTINGS.connectedAt, new Date().toISOString());
}

async function migrateLegacyConnectionSecret() {
  if (!game.user?.isGM) return;

  const legacySecret = String(game.settings.get(MODULE_ID, SETTINGS.connectionSecret) || '').trim();
  if (!legacySecret) return;

  const localSecret = String(game.settings.get(MODULE_ID, SETTINGS.localConnectionSecret) || '').trim();
  if (!localSecret) {
    await game.settings.set(MODULE_ID, SETTINGS.localConnectionSecret, legacySecret);
  }
  await game.settings.set(MODULE_ID, SETTINGS.connectionSecret, '');
}

function getPendingPairing() {
  return {
    connectionId: game.settings.get(MODULE_ID, SETTINGS.pendingConnectionId),
    connectionSecret: game.settings.get(MODULE_ID, SETTINGS.pendingConnectionSecret),
    state: game.settings.get(MODULE_ID, SETTINGS.pendingState),
    pairingStatusEndpoint: game.settings.get(MODULE_ID, SETTINGS.pendingPairingStatusEndpoint),
    pairingCode: game.settings.get(MODULE_ID, SETTINGS.pendingPairingCode),
  };
}

async function savePendingPairing({ connectionId, connectionSecret, state, pairingStatusEndpoint, pairingCode }) {
  await game.settings.set(MODULE_ID, SETTINGS.pendingConnectionId, connectionId || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingConnectionSecret, connectionSecret || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingState, state || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingStatusEndpoint, pairingStatusEndpoint || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingCode, pairingCode || '');
}

async function clearPendingPairing() {
  await game.settings.set(MODULE_ID, SETTINGS.pendingConnectionId, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingConnectionSecret, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingState, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingStatusEndpoint, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingCode, '');
}

function refreshLivePanels() {
  activeLivePanels.forEach((app) => app.render(false));
}

function getCachedMappingProfile() {
  if (mappingProfileState.profile && mappingProfileState.index) {
    return mappingProfileState.profile;
  }

  const cached = game.settings.get(MODULE_ID, SETTINGS.mappingProfileCache);
  if (!cached || typeof cached !== 'string') return null;

  try {
    const parsed = JSON.parse(cached);
    if (!parsed || typeof parsed !== 'object') return null;
    mappingProfileState.profile = parsed;
    mappingProfileState.generatedAt = Date.parse(String(parsed.generated_at || '')) || 0;
    mappingProfileState.index = buildMappingProfileIndex(parsed);
    return parsed;
  } catch (_error) {
    return null;
  }
}

function buildMappingProfileIndex(profile) {
  const index = new Map();
  const scopeKeys = Array.isArray(profile?.scope_keys) ? profile.scope_keys : ['workspace'];
  const scopeRank = new Map(scopeKeys.map((key, position) => [String(key), position]));

  const pushMapping = (sourceKind, sourceKey, mapping) => {
    if (!sourceKind || !sourceKey) return;
    const indexKey = `${sourceKind} ${String(sourceKey).toLowerCase()}`;
    const existing = index.get(indexKey);
    if (!existing) {
      index.set(indexKey, mapping);
      return;
    }

    const existingRank = scopeRank.get(String(existing.scope_key || '')) ?? 999;
    const candidateRank = scopeRank.get(String(mapping.scope_key || '')) ?? 999;
    if (candidateRank < existingRank) {
      index.set(indexKey, mapping);
      return;
    }
    if (candidateRank === existingRank) {
      const existingConfidence = Number(existing.confidence || 0);
      const candidateConfidence = Number(mapping.confidence || 0);
      if (candidateConfidence > existingConfidence) {
        index.set(indexKey, mapping);
      }
    }
  };

  const mappings = Array.isArray(profile?.mappings) ? profile.mappings : [];
  mappings.forEach((mapping) => {
    if (!mapping || typeof mapping !== 'object') return;
    pushMapping(mapping.source_kind, mapping.source_key, mapping);
  });

  return index;
}

function resolveMappingFromProfile(sourceKind, sourceKey) {
  const profile = getCachedMappingProfile();
  if (!profile || !mappingProfileState.index) return null;
  if (!sourceKind || !sourceKey) return null;

  const indexKey = `${sourceKind} ${String(sourceKey).toLowerCase()}`;
  return mappingProfileState.index.get(indexKey) || null;
}

async function fetchMappingProfile({ force = false } = {}) {
  if (!canCurrentUserSendSnapshots()) return null;
  const connection = getStoredConnection();
  if (!hasStoredConnection(connection) || !connection.mappingProfileEndpoint) return null;

  if (!force && mappingProfileState.profile
    && Date.now() - mappingProfileState.generatedAt < MAPPING_PROFILE_TTL_MS) {
    return mappingProfileState.profile;
  }

  if (mappingProfileState.inFlight) return mappingProfileState.inFlight;

  mappingProfileState.inFlight = (async () => {
    try {
      const response = await fetch(connection.mappingProfileEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({
          provider: 'foundry',
          connection_id: connection.connectionId,
          connection_secret: connection.connectionSecret,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = payload?.code || payload?.error || '';
        const message = payload?.message || payload?.error || 'Profil de mapping indisponible.';
        mappingProfileState.lastFetchError = String(message);
        if (code === 'INVALID_CONNECTION_SECRET' || code === 'CONNECTION_REVOKED') {
          console.warn('[RollCodex] Mapping profile auth failed', { code });
        }
        refreshLivePanels();
        return null;
      }

      const profile = payload?.profile && typeof payload.profile === 'object' ? payload.profile : null;
      if (!profile) {
        mappingProfileState.lastFetchError = 'Reponse de profil RollCodex inattendue.';
        refreshLivePanels();
        return null;
      }

      mappingProfileState.profile = profile;
      mappingProfileState.generatedAt = Date.parse(String(profile.generated_at || '')) || Date.now();
      mappingProfileState.index = buildMappingProfileIndex(profile);
      mappingProfileState.lastFetchError = '';

      try {
        await game.settings.set(MODULE_ID, SETTINGS.mappingProfileCache, JSON.stringify(profile));
        await game.settings.set(
          MODULE_ID,
          SETTINGS.mappingProfileFetchedAt,
          new Date(mappingProfileState.generatedAt).toISOString(),
        );
      } catch (storageError) {
        console.warn('[RollCodex] Mapping profile cache persistence failed', storageError);
      }

      refreshLivePanels();
      return profile;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Profil de mapping indisponible.';
      mappingProfileState.lastFetchError = message;
      console.warn('[RollCodex] Mapping profile fetch failed', error);
      refreshLivePanels();
      return null;
    } finally {
      mappingProfileState.inFlight = null;
    }
  })();

  return mappingProfileState.inFlight;
}

function getMessageActor(message) {
  if (!message || !message.speaker) return null;
  const actorId = message.speaker.actor;
  if (!actorId) return null;
  try {
    return game.actors?.get?.(actorId) || null;
  } catch (_error) {
    return null;
  }
}

function getMessageToken(message) {
  if (!message || !message.speaker) return null;
  const tokenName = message.speaker.token ? message.speaker.alias : '';
  return tokenName || message.speaker.alias || '';
}

function getMessageUser(message) {
  if (!message) return null;
  const userId = message.user?.id || message.user;
  if (!userId) return null;
  try {
    return game.users?.get?.(userId) || null;
  } catch (_error) {
    return null;
  }
}

function extractRollFigures(message) {
  const rolls = Array.isArray(message?.rolls) ? message.rolls : [];
  let total = 0;
  let count = 0;
  let nat20 = 0;
  let damageHint = 0;

  rolls.forEach((roll) => {
    if (!roll) return;
    const rollTotal = Number(roll?.total ?? roll?._total ?? 0);
    if (Number.isFinite(rollTotal)) {
      total += rollTotal;
      count += 1;
      if (rollTotal >= 18) damageHint += rollTotal;
    }
    const terms = Array.isArray(roll?.terms) ? roll.terms : [];
    terms.forEach((term) => {
      const faces = Number(term?.faces);
      if (faces !== 20) return;
      const results = Array.isArray(term?.results) ? term.results : [];
      results.forEach((result) => {
        if (Number(result?.result) === 20) nat20 += 1;
      });
    });
  });

  return { total, count, nat20, damageHint };
}

function extractMessageObservations(message) {
  const observations = [];
  if (!message) return observations;

  const actor = getMessageActor(message);
  if (actor) {
    const sourceKey = actor.uuid || `Actor.${actor.id}`;
    observations.push({
      source_kind: 'actor',
      source_key: String(sourceKey),
      source_label: actor.name || actor.token?.name || 'Acteur Foundry',
      target_kind: 'character',
    });
  }

  if (message.speaker?.alias && !actor) {
    observations.push({
      source_kind: 'speaker',
      source_key: String(message.speaker.alias),
      source_label: String(message.speaker.alias),
      target_kind: 'character',
    });
  }

  const tokenAlias = getMessageToken(message);
  if (tokenAlias && (!actor || tokenAlias !== actor.name)) {
    observations.push({
      source_kind: 'token',
      source_key: `token:${tokenAlias}`,
      source_label: String(tokenAlias),
      target_kind: 'character',
    });
  }

  const user = getMessageUser(message);
  if (user) {
    observations.push({
      source_kind: 'user',
      source_key: `User.${user.id}`,
      source_label: user.name || 'Foundry User',
      target_kind: 'player',
    });
  }

  const itemUuid = message?.flags?.dnd5e?.itemUuid
    || message?.flags?.pf2e?.itemUuid
    || message?.flags?.[message?.flags?.systemId]?.itemUuid
    || null;
  if (itemUuid) {
    observations.push({
      source_kind: 'item',
      source_key: String(itemUuid),
      source_label: message?.flavor || 'Item Foundry',
      target_kind: null,
    });
  }

  return observations;
}

function recordLiveObservation(message) {
  if (!message) return;
  const messageId = String(message.id || '');
  if (messageId && liveSessionState.observedMessageIds.has(messageId)) return;
  if (messageId) liveSessionState.observedMessageIds.add(messageId);

  const observations = extractMessageObservations(message);
  if (observations.length === 0) return;

  if (!liveSessionState.startedAt) {
    liveSessionState.startedAt = new Date().toISOString();
  }

  const rollFigures = extractRollFigures(message);
  liveSessionState.totals.actions += 1;
  liveSessionState.totals.rolls += rollFigures.count;
  liveSessionState.totals.nat20 += rollFigures.nat20;
  if (rollFigures.damageHint) {
    liveSessionState.totals.damageTotal += rollFigures.damageHint;
  }

  observations.forEach((observation) => {
    const sourceMapKey = `${observation.source_kind} ${observation.source_key}`;
    let entry = liveSessionState.sources.get(sourceMapKey);
    if (!entry) {
      if (liveSessionState.sources.size >= LIVE_MAX_SOURCES) return;
      const resolved = resolveMappingFromProfile(observation.source_kind, observation.source_key);
      entry = {
        source_kind: observation.source_kind,
        source_key: observation.source_key,
        source_label: observation.source_label,
        target_kind: resolved?.target_kind || observation.target_kind || null,
        target_id: resolved?.target_id || null,
        target_label: resolved?.target_label || null,
        confidence: Number(resolved?.confidence || 0),
        resolved: Boolean(resolved?.target_id),
        observation_count: 0,
        rolls: 0,
        nat20: 0,
        damage_total: 0,
      };
      liveSessionState.sources.set(sourceMapKey, entry);
      if (entry.resolved) {
        liveSessionState.resolvedCount += 1;
      } else {
        liveSessionState.unresolvedCount += 1;
      }
    }

    entry.observation_count += 1;
    entry.rolls += rollFigures.count;
    entry.nat20 += rollFigures.nat20;
    entry.damage_total += rollFigures.damageHint;
  });

  refreshLivePanels();
}

function resetLiveSessionState() {
  liveSessionState.startedAt = '';
  liveSessionState.sources.clear();
  liveSessionState.observedMessageIds.clear();
  liveSessionState.totals.actions = 0;
  liveSessionState.totals.rolls = 0;
  liveSessionState.totals.nat20 = 0;
  liveSessionState.totals.damageTotal = 0;
  liveSessionState.totals.healTotal = 0;
  liveSessionState.resolvedCount = 0;
  liveSessionState.unresolvedCount = 0;
}

function getCurrentMappingHints() {
  const hints = [];
  let processed = 0;
  for (const entry of liveSessionState.sources.values()) {
    if (processed >= LIVE_MAX_HINTS) break;
    processed += 1;
    const confidence = Number.isFinite(entry.confidence) ? Math.max(0, Math.min(1, entry.confidence)) : 0;
    hints.push({
      provider: 'foundry',
      source_kind: entry.source_kind,
      source_key: entry.source_key,
      source_label: entry.source_label || null,
      target_kind: entry.target_kind || null,
      target_id: entry.target_id || null,
      target_label: entry.target_label || null,
      confidence,
    });
  }
  return hints;
}

function registerLiveObservationHooks() {
  if (liveSessionState.hookRegistered) return;
  liveSessionState.hookRegistered = true;
  Hooks.on('createChatMessage', (message) => {
    try {
      recordLiveObservation(message);
    } catch (error) {
      console.warn('[RollCodex] Live observation failed', error);
    }
  });
}

class RollCodexConnectionApp extends FormApplication {
  constructor(...args) {
    super(...args);
    this.autoRecoveryTimer = null;
    this.autoRecoveryUntil = 0;
    this.autoRecoveryRunning = false;
    this.currentMessageHandler = null;
    this.handleAutoRecoveryFocus = () => {
      this.tryCompletePendingPairing({ silent: true }).catch(() => {});
    };
    this.handleAutoRecoveryVisibility = () => {
      if (!document.hidden) {
        this.tryCompletePendingPairing({ silent: true }).catch(() => {});
      }
    };
    this.handleAutoRecoveryInteraction = () => {
      this.tryCompletePendingPairing({ silent: true }).catch(() => {});
    };
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'rollcodex-connection',
      title: 'RollCodex',
      template: `modules/${MODULE_ID}/templates/connection.hbs`,
      width: 560,
      closeOnSubmit: false,
      submitOnChange: false,
      resizable: false,
    });
  }

  getData() {
    const appUrl = normalizeAppUrl(game.settings.get(MODULE_ID, SETTINGS.appUrl));
    const connection = getStoredConnection();
    const autoSnapshot = getAutoSnapshotSettings();
    const pendingPairing = getPendingPairing();
    const hasPendingPairing = Boolean(pendingPairing.connectionId && pendingPairing.connectionSecret && pendingPairing.state);

    return {
      appUrl,
      connected: Boolean(connection.connectionId && connection.connectionSecret && connection.endpoint),
      hasPendingPairing,
      pendingConnectionId: pendingPairing.connectionId,
      pendingPairingCode: pendingPairing.pairingCode,
      autoSnapshotEnabled: autoSnapshot.enabled,
      autoSnapshotLastSentAtLabel: formatDateTime(autoSnapshot.lastSentAt),
      autoSnapshotLastError: autoSnapshot.lastError,
      ...connection,
    };
  }

  render(force, options) {
    activeConnectionApps.add(this);
    return super.render(force, options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('[data-action="save-url"]').on('click', () => this.saveAppUrl(html).catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="connect"]').on('click', () => this.startPairing(html).catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="recover-confirmation"]').on('click', () => this.recoverConfirmation().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="send-snapshot"]').on('click', () => this.sendSnapshot().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="end-session"]').on('click', () => this.sendEndOfSessionSnapshot().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="disconnect"]').on('click', () => this.disconnect().catch((error) => ui.notifications.error(error.message)));
    html.find('[name="autoSnapshotEnabled"]').on('change', (event) => this.toggleAutoSnapshot(event.currentTarget.checked).catch((error) => ui.notifications.error(error.message)));

    const pendingPairing = getPendingPairing();
    if (pendingPairing.connectionId && pendingPairing.connectionSecret && pendingPairing.state) {
      this.startAutoRecovery();
    }
  }

  async _updateObject() {}

  async saveAppUrl(html) {
    const form = html[0]?.closest('form') || this.form;
    const appUrl = normalizeAppUrl(new FormData(form).get('appUrl'));
    await game.settings.set(MODULE_ID, SETTINGS.appUrl, appUrl);
    ui.notifications.info('Adresse RollCodex enregistree.');
    this.render(true);
  }

  async toggleAutoSnapshot(enabled) {
    await game.settings.set(MODULE_ID, SETTINGS.autoSnapshotEnabled, Boolean(enabled));
    if (enabled) {
      ui.notifications.info('Capture automatique de fin de session activee.');
    } else {
      ui.notifications.info('Capture automatique de fin de session desactivee.');
    }
    this.render(true);
  }

  async startPairing(html) {
    if (!game.user?.isGM) {
      ui.notifications.error('Seul un MJ peut connecter ce monde a RollCodex.');
      return;
    }

    const form = html[0]?.closest('form') || this.form;
    const appUrl = normalizeAppUrl(new FormData(form).get('appUrl'));
    await game.settings.set(MODULE_ID, SETTINGS.appUrl, appUrl);

    const connectionSecret = generateConnectionSecret();
    const connectionId = generateUuid();
    const state = generateState();
    const secretHash = await sha256Hex(connectionSecret);
    const secretPrefix = connectionSecret.slice(0, 18);
    const pairingCode = buildPairingCode({ state, secretHash });
    const pairingUrl = buildPairingUrl({ appUrl, state, connectionId });

    let connectionConfig = null;
    try {
      connectionConfig = await fetchConnectionConfig(appUrl);
    } catch (error) {
      console.warn('[RollCodex] Pairing status config unavailable', error);
      ui.notifications.warn('API de statut RollCodex indisponible. Le bouton Recuperer reste disponible en secours.');
    }

    await savePendingPairing({
      connectionId,
      connectionSecret,
      state,
      pairingStatusEndpoint: connectionConfig?.pairingStatusEndpoint || '',
      pairingCode,
    });
    this.render(true);

    const expectedOrigin = new URL(appUrl).origin;

    const handleMessage = async (event) => {
      const data = event?.data || {};
      if (event.origin !== expectedOrigin) return;
      if (data.type === MESSAGE_HANDSHAKE_TYPE && data.state === state && data.connectionId === connectionId) {
        event.source?.postMessage({
          type: MESSAGE_HANDSHAKE_RESPONSE_TYPE,
          state,
          connectionId,
          secretHash,
          secretPrefix,
          pairingCode,
        }, expectedOrigin);
        return;
      }

      if (data.type !== MESSAGE_COMPLETE_TYPE || data.state !== state) return;

      window.removeEventListener('message', handleMessage);
      await this.completePairing(data);
    };

    if (this.currentMessageHandler) {
      window.removeEventListener('message', this.currentMessageHandler);
    }
    this.currentMessageHandler = handleMessage;
    window.addEventListener('message', handleMessage);
    this.startAutoRecovery();

    const popup = window.open(pairingUrl, 'rollcodex-connect', 'popup,width=1040,height=820');
    if (!popup) {
      window.removeEventListener('message', handleMessage);
      this.currentMessageHandler = null;
      this.stopAutoRecovery();
      await clearPendingPairing();
      ui.notifications.warn('Ouverture bloquee. Autorisez les popups puis relancez la connexion RollCodex.');
      this.render(true);
      return;
    }

    ui.notifications.info('Connexion RollCodex ouverte. Foundry detectera la validation via l API RollCodex.');
  }

  startAutoRecovery() {
    this.stopAutoRecovery();
    this.autoRecoveryUntil = Date.now() + AUTO_RECOVERY_DURATION_MS;
    window.addEventListener('focus', this.handleAutoRecoveryFocus);
    document.addEventListener('visibilitychange', this.handleAutoRecoveryVisibility);
    window.addEventListener('pointerdown', this.handleAutoRecoveryInteraction, true);
    window.addEventListener('keydown', this.handleAutoRecoveryInteraction, true);

    this.autoRecoveryTimer = window.setInterval(() => {
      if (Date.now() > this.autoRecoveryUntil) {
        this.stopAutoRecovery();
        return;
      }

      this.tryCompletePendingPairing({ silent: true }).catch(() => {});
    }, AUTO_RECOVERY_INTERVAL_MS);

    window.setTimeout(() => {
      this.tryCompletePendingPairing({ silent: true }).catch(() => {});
    }, 1000);
  }

  stopAutoRecovery() {
    if (this.autoRecoveryTimer) {
      window.clearInterval(this.autoRecoveryTimer);
    }

    this.autoRecoveryTimer = null;
    this.autoRecoveryUntil = 0;
    window.removeEventListener('focus', this.handleAutoRecoveryFocus);
    document.removeEventListener('visibilitychange', this.handleAutoRecoveryVisibility);
    window.removeEventListener('pointerdown', this.handleAutoRecoveryInteraction, true);
    window.removeEventListener('keydown', this.handleAutoRecoveryInteraction, true);
  }

  async tryCompletePendingPairing({ silent = false } = {}) {
    if (this.autoRecoveryRunning) return false;
    this.autoRecoveryRunning = true;

    try {
      const pendingPairing = getPendingPairing();
      const recoveredFromApi = await this.tryRecoverConfirmationFromApi({ silent: true });
      if (recoveredFromApi) return true;
      if (pendingPairing.pairingStatusEndpoint && silent) return false;
      return await this.tryRecoverConfirmationFromClipboard({ silent });
    } finally {
      this.autoRecoveryRunning = false;
    }
  }

  async tryRecoverConfirmationFromApi({ silent = false } = {}) {
    const pendingPairing = getPendingPairing();
    if (!pendingPairing.connectionId || !pendingPairing.connectionSecret || !pendingPairing.state) {
      this.stopAutoRecovery();
      return false;
    }

    if (!pendingPairing.pairingStatusEndpoint) {
      if (silent) return false;
      throw new Error('API de statut RollCodex indisponible pour cette demande. Relancez la connexion depuis Foundry.');
    }

    try {
      const response = await fetch(pendingPairing.pairingStatusEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8',
        },
        body: JSON.stringify({
          provider: 'foundry',
          connection_id: pendingPairing.connectionId,
          connection_secret: pendingPairing.connectionSecret,
          state: pendingPairing.state,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || 'Statut RollCodex indisponible.');
      }

      if (payload?.status === 'pending') return false;
      if (payload?.status === 'revoked') {
        throw new Error('La connexion RollCodex a ete revoquee. Relancez une liaison depuis Foundry.');
      }
      if (payload?.status === 'connected' && payload?.type === MESSAGE_COMPLETE_TYPE) {
        await this.completePairing(payload);
        return true;
      }

      return false;
    } catch (error) {
      if (silent) return false;
      throw error;
    }
  }

  async tryRecoverConfirmationFromClipboard({ silent = false } = {}) {
    const pendingPairing = getPendingPairing();
    if (!pendingPairing.connectionId || !pendingPairing.connectionSecret || !pendingPairing.state) {
      this.stopAutoRecovery();
      return false;
    }

    if (!navigator.clipboard?.readText) {
      if (silent) return false;
      throw new Error('Collez la confirmation RollCodex dans le champ prevu, puis relancez la recuperation.');
    }

    try {
      const rawValue = await navigator.clipboard.readText();
      const payload = parseConfirmationPayload(rawValue);
      if (!payload) {
        if (silent) return false;
        throw new Error('Le presse-papiers ne contient pas une confirmation RollCodex valide.');
      }

      if (payload.type !== MESSAGE_COMPLETE_TYPE
        || payload.state !== pendingPairing.state
        || payload.connectionId !== pendingPairing.connectionId) {
        if (silent) return false;
        throw new Error('Cette confirmation ne correspond pas a la demande Foundry en cours.');
      }

      await this.completePairing(payload);
      return true;
    } catch (error) {
      if (silent) return false;
      throw error;
    }
  }

  async completePairing(data) {
    if (data?.type !== MESSAGE_COMPLETE_TYPE) {
      throw new Error('Confirmation RollCodex invalide.');
    }

    const pendingPairing = getPendingPairing();
    if (!pendingPairing.connectionSecret || !pendingPairing.state) {
      throw new Error('Aucune demande RollCodex en attente dans ce monde. Relancez la connexion depuis Foundry.');
    }
    if (data.state !== pendingPairing.state || data.connectionId !== pendingPairing.connectionId) {
      throw new Error('Cette confirmation ne correspond pas a la demande Foundry en cours.');
    }

    await saveConnectionFromMessage(data, pendingPairing.connectionSecret);
    await clearPendingPairing();
    await game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, '');
    if (this.currentMessageHandler) {
      window.removeEventListener('message', this.currentMessageHandler);
      this.currentMessageHandler = null;
    }
    this.stopAutoRecovery();
    ui.notifications.info('Monde Foundry connecte a RollCodex.');
    this.render(true);
  }

  async recoverConfirmation() {
    const form = this.form;
    const pastedValue = String(new FormData(form).get('confirmationPayload') || '').trim();

    if (!pastedValue) {
      const recovered = await this.tryCompletePendingPairing({ silent: false });
      if (recovered) return;
    }

    const payload = parseConfirmationPayload(pastedValue);
    if (!payload) {
      throw new Error('La confirmation collee n est pas un JSON RollCodex valide.');
    }
    await this.completePairing(payload);
  }

  async sendSnapshot() {
    const result = await sendSnapshotPayload({ mode: 'manual', reason: 'manual_button' });

    if (result.blockedResponse) {
      ui.notifications.warn('Capture transmise. Le navigateur a bloque le retour, verifiez l import dans RollCodex.');
      return;
    }

    ui.notifications.info('Capture envoyee a RollCodex. Relisez l import dans votre registre.');
  }

  async sendEndOfSessionSnapshot() {
    const confirmed = await Dialog.confirm({
      title: 'Marquer la fin de session',
      content: '<p>RollCodex va capturer tous les messages depuis la derniere capture reussie. A utiliser quand la session est terminee.</p>',
    });
    if (!confirmed) return;

    const result = await sendSnapshotPayload({
      mode: 'manual',
      reason: 'manual_session_end',
      skipIfEmpty: true,
    });

    if (result.skipped) {
      ui.notifications.info('Aucun nouveau message a capturer depuis la derniere capture.');
      return;
    }

    if (result.blockedResponse) {
      ui.notifications.warn('Fin de session transmise. Verifiez l import dans RollCodex.');
      return;
    }

    ui.notifications.info(`Fin de session envoyee a RollCodex (${result.messageCount} messages).`);
  }

  async disconnect() {
    const confirmed = await Dialog.confirm({
      title: 'Oublier RollCodex',
      content: '<p>La connexion locale sera retiree de ce monde Foundry. Vous pourrez la recreer depuis RollCodex.</p>',
    });

    if (!confirmed) return;

    await Promise.all([
      game.settings.set(MODULE_ID, SETTINGS.connectionId, ''),
      game.settings.set(MODULE_ID, SETTINGS.connectionSecret, ''),
      game.settings.set(MODULE_ID, SETTINGS.localConnectionSecret, ''),
      game.settings.set(MODULE_ID, SETTINGS.endpoint, ''),
      game.settings.set(MODULE_ID, SETTINGS.mappingProfileEndpoint, ''),
      game.settings.set(MODULE_ID, SETTINGS.mappingProfileCache, ''),
      game.settings.set(MODULE_ID, SETTINGS.mappingProfileFetchedAt, ''),
      game.settings.set(MODULE_ID, SETTINGS.workspaceLabel, ''),
      game.settings.set(MODULE_ID, SETTINGS.systemId, ''),
      game.settings.set(MODULE_ID, SETTINGS.systemLabel, ''),
      game.settings.set(MODULE_ID, SETTINGS.connectedAt, ''),
      game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastSentAt, ''),
      game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, ''),
      game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastMessageId, ''),
      clearPendingPairing(),
    ]);

    autoSnapshotState.inMemoryLastMessageId = '';
    mappingProfileState.profile = null;
    mappingProfileState.index = null;
    mappingProfileState.generatedAt = 0;
    mappingProfileState.lastFetchError = '';
    resetLiveSessionState();
    refreshLivePanels();
    clearIdleTimer();
    this.stopAutoRecovery();
    ui.notifications.info('Connexion RollCodex retiree de ce monde.');
    this.render(true);
  }

  close(options) {
    activeConnectionApps.delete(this);
    if (this.currentMessageHandler) {
      window.removeEventListener('message', this.currentMessageHandler);
      this.currentMessageHandler = null;
    }
    this.stopAutoRecovery();
    return super.close(options);
  }
}

class RollCodexLivePanel extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'rollcodex-live-panel',
      title: 'RollCodex Live (kikimeter)',
      template: `modules/${MODULE_ID}/templates/live-panel.hbs`,
      width: 520,
      height: 'auto',
      closeOnSubmit: false,
      submitOnChange: false,
      resizable: true,
    });
  }

  getData() {
    const connection = getStoredConnection();
    const connected = hasStoredConnection(connection);
    const profile = getCachedMappingProfile();
    const profileFetchedAtRaw = game.settings.get(MODULE_ID, SETTINGS.mappingProfileFetchedAt);
    const profileFetchedAtLabel = formatDateTime(profileFetchedAtRaw);
    const profileCount = Array.isArray(profile?.mappings) ? profile.mappings.length : 0;
    const isGmPrimary = canCurrentUserSendSnapshots();

    const sources = Array.from(liveSessionState.sources.values()).map((entry) => ({
      ...entry,
      confidenceLabel: entry.resolved ? `${Math.round(entry.confidence * 100)}%` : 'non resolu',
      damageLabel: entry.damage_total > 0 ? String(entry.damage_total) : '-',
    }));

    sources.sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? -1 : 1;
      return b.observation_count - a.observation_count;
    });

    return {
      connected,
      isGmPrimary,
      workspaceLabel: connection.workspaceLabel || '',
      systemLabel: connection.systemLabel || '',
      mappingProfileEndpoint: connection.mappingProfileEndpoint || '',
      profileAvailable: Boolean(profile),
      profileFetchedAtLabel,
      profileMappingCount: profileCount,
      profileFetchError: mappingProfileState.lastFetchError || '',
      sessionStartedAtLabel: liveSessionState.startedAt ? formatDateTime(liveSessionState.startedAt) : '',
      actions: liveSessionState.totals.actions,
      rolls: liveSessionState.totals.rolls,
      nat20: liveSessionState.totals.nat20,
      damageTotal: liveSessionState.totals.damageTotal,
      resolvedCount: liveSessionState.resolvedCount,
      unresolvedCount: liveSessionState.unresolvedCount,
      sources,
      hasSources: sources.length > 0,
    };
  }

  render(force, options) {
    activeLivePanels.add(this);
    return super.render(force, options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('[data-action="reload-profile"]').on('click', () =>
      this.reloadProfile().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="send-snapshot"]').on('click', () =>
      this.sendSnapshotNow().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="reset-session"]').on('click', () =>
      this.resetSession().catch((error) => ui.notifications.error(error.message)));
  }

  async _updateObject() {}

  async reloadProfile() {
    if (!canCurrentUserSendSnapshots()) {
      ui.notifications.warn('Seul le MJ primaire peut recharger le profil RollCodex.');
      return;
    }
    const profile = await fetchMappingProfile({ force: true });
    if (profile) {
      ui.notifications.info('Profil de mapping RollCodex rafraichi.');
    } else if (mappingProfileState.lastFetchError) {
      ui.notifications.warn(mappingProfileState.lastFetchError);
    } else {
      ui.notifications.info('Aucun profil retourne par RollCodex (memoire vide).');
    }
    this.render(true);
  }

  async sendSnapshotNow() {
    if (!canCurrentUserSendSnapshots()) {
      ui.notifications.warn('Seul le MJ primaire peut envoyer un snapshot RollCodex.');
      return;
    }
    const result = await sendSnapshotPayload({ mode: 'manual', reason: 'live_panel_button' });
    if (result.blockedResponse) {
      ui.notifications.warn('Capture transmise. Le navigateur a bloque le retour, verifiez l import dans RollCodex.');
      return;
    }
    const hintsCount = result.mappingHintCount ?? 0;
    ui.notifications.info(`Capture envoyee (${result.messageCount} messages, ${hintsCount} hints).`);
  }

  async resetSession() {
    const confirmed = await Dialog.confirm({
      title: 'Reinitialiser la session live',
      content: '<p>Les compteurs de session courante seront remis a zero. Le profil et les captures envoyees ne sont pas affectes.</p>',
    });
    if (!confirmed) return;
    resetLiveSessionState();
    this.render(true);
  }

  close(options) {
    activeLivePanels.delete(this);
    return super.close(options);
  }
}

Hooks.once('init', () => {
  registerSetting(SETTINGS.appUrl, {
    scope: 'client',
    config: true,
    default: DEFAULT_ROLLCODEX_APP_URL,
    name: 'Adresse RollCodex',
    hint: 'Adresse de l application RollCodex a ouvrir pour connecter ce monde.',
  });

  registerSetting(SETTINGS.autoSnapshotEnabled, {
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    name: 'Captures automatiques RollCodex',
    hint: 'Tente une capture de fin de session quand le monde ou l onglet Foundry se ferme.',
  });

  registerSetting(SETTINGS.autoSnapshotMinIntervalMs, {
    scope: 'world',
    config: false,
    type: Number,
    default: AUTO_SESSION_CAPTURE_MIN_INTERVAL_MS,
  });

  registerSetting(SETTINGS.autoSnapshotIdleMinutes, {
    scope: 'world',
    config: true,
    type: Number,
    default: DEFAULT_IDLE_MINUTES,
    name: 'Inactivite chat avant capture (minutes)',
    hint: 'Si aucun message n est envoye pendant cette duree, RollCodex declenche une capture de la session courante. Mettez 0 pour desactiver.',
  });

  Object.values(SETTINGS)
    .filter((key) => ![
      SETTINGS.appUrl,
      SETTINGS.autoSnapshotEnabled,
      SETTINGS.autoSnapshotMinIntervalMs,
      SETTINGS.autoSnapshotIdleMinutes,
    ].includes(key))
    .forEach((key) => registerSetting(key, {
      config: false,
      scope: CLIENT_SCOPED_SETTINGS.has(key) ? 'client' : 'world',
    }));

  game.settings.registerMenu(MODULE_ID, 'connectionMenu', {
    name: 'Connexion RollCodex',
    label: 'Connecter avec RollCodex',
    hint: 'Relier ce monde Foundry a un registre RollCodex.',
    icon: 'fas fa-link',
    type: RollCodexConnectionApp,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, 'livePanelMenu', {
    name: 'RollCodex Live (kikimeter)',
    label: 'Ouvrir le panneau live',
    hint: 'Compteurs de session pre-validation, profil de mapping et envoi de capture avec hints.',
    icon: 'fas fa-gauge-high',
    type: RollCodexLivePanel,
    restricted: true,
  });
});

Hooks.once('ready', async () => {
  if (!game.user?.isGM) return;
  try {
    await migrateLegacyConnectionSecret();
  } catch (error) {
    console.warn('[RollCodex] Legacy connection secret migration failed', error);
  }
  autoSnapshotState.inMemoryLastMessageId = String(
    game.settings.get(MODULE_ID, SETTINGS.autoSnapshotLastMessageId) || '',
  );
  registerAutoSnapshotHooks();
  registerLiveObservationHooks();
  getCachedMappingProfile();
  const connection = getStoredConnection();
  if (!connection.connectionId) {
    ui.notifications.info('RollCodex est pret. Configurez la connexion dans les parametres du module.');
    return;
  }
  if (canCurrentUserSendSnapshots() && connection.mappingProfileEndpoint) {
    fetchMappingProfile({ force: false }).catch((error) => {
      console.warn('[RollCodex] Initial mapping profile fetch failed', error);
    });
  }
});