/* global Dialog, FormApplication, Hooks, foundry, game, ui */

const MODULE_ID = 'rollcodex';
const MODULE_VERSION = '0.1.26';
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
const LIVE_METRICS_RECENT_EVENTS_LIMIT = 12;
const LIVE_METRICS_REFRESH_MS = 250;
const ROLLCODEX_MAPPING_VERSION = 1;
const FLOATING_PANEL_ID = 'rollcodex-floating-panel';

const ACTOR_KIND_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'pc', label: 'PJ' },
  { value: 'npc', label: 'PNJ' },
  { value: 'monster', label: 'Monstre' },
  { value: 'summon', label: 'Invocation' },
  { value: 'environment', label: 'Environnement' },
  { value: 'ignored', label: 'Ignore' },
];

const ITEM_ACTION_TYPE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'attack', label: 'Attaque' },
  { value: 'damage', label: 'Degats' },
  { value: 'healing', label: 'Soin' },
  { value: 'save', label: 'Jet de sauvegarde' },
  { value: 'check', label: 'Test' },
  { value: 'spell', label: 'Sort' },
  { value: 'resource', label: 'Ressource' },
  { value: 'utility', label: 'Utilitaire' },
  { value: 'other', label: 'Autre' },
  { value: 'ignored', label: 'Ignore' },
];

const FLAGS = {
  actorKind: 'actorKind',
  actorSpeakerAlias: 'actorSpeakerAlias',
  actorClass: 'actorClass',
  actorSubclass: 'actorSubclass',
  actorSpecies: 'actorSpecies',
  actorLevel: 'actorLevel',
  itemActionType: 'itemActionType',
  itemActionName: 'itemActionName',
  itemTags: 'itemTags',
};

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
  campaignId: 'campaignId',
  campaignLabel: 'campaignLabel',
  tableId: 'tableId',
  tableLabel: 'tableLabel',
  connectedAt: 'connectedAt',
  pendingConnectionId: 'pendingConnectionId',
  pendingConnectionSecret: 'pendingConnectionSecret',
  pendingState: 'pendingState',
  pendingPairingStatusEndpoint: 'pendingPairingStatusEndpoint',
  pendingPairingCode: 'pendingPairingCode',
  pendingPairingUrl: 'pendingPairingUrl',
  autoSnapshotEnabled: 'autoSnapshotEnabled',
  autoSnapshotMinIntervalMs: 'autoSnapshotMinIntervalMs',
  autoSnapshotIdleMinutes: 'autoSnapshotIdleMinutes',
  autoSnapshotLastSentAt: 'autoSnapshotLastSentAt',
  autoSnapshotLastMessageId: 'autoSnapshotLastMessageId',
  autoSnapshotLastError: 'autoSnapshotLastError',
  mappingProfileCache: 'mappingProfileCache',
  mappingProfileFetchedAt: 'mappingProfileFetchedAt',
  liveMetricsEnabled: 'liveMetricsEnabled',
  floatingPanelCollapsed: 'floatingPanelCollapsed',
  floatingPanelLeft: 'floatingPanelLeft',
  floatingPanelTop: 'floatingPanelTop',
};

const CLIENT_SCOPED_SETTINGS = new Set([
  SETTINGS.localConnectionSecret,
  SETTINGS.pendingConnectionId,
  SETTINGS.pendingConnectionSecret,
  SETTINGS.pendingState,
  SETTINGS.pendingPairingStatusEndpoint,
  SETTINGS.pendingPairingCode,
  SETTINGS.pendingPairingUrl,
  SETTINGS.liveMetricsEnabled,
  SETTINGS.floatingPanelCollapsed,
  SETTINGS.floatingPanelLeft,
  SETTINGS.floatingPanelTop,
]);

const activeConnectionApps = new Set();
const activeLivePanels = new Set();
const activeLiveMetricsApps = new Set();

const autoSnapshotState = {
  hookRegistered: false,
  lastErrorMessage: '',
  idleTimer: null,
  inMemoryLastMessageId: '',
  inFlight: false,
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

const liveMetricsState = {
  hookRegistered: false,
  refreshTimer: null,
  startedAt: null,
  messageIds: new Set(),
  participants: new Map(),
  recentEvents: [],
  totals: createEmptyLiveMetricTotals(),
};

const floatingPanelState = {
  status: '',
};

function createEmptyLiveMetricTotals() {
  return {
    messages: 0,
    rolls: 0,
    criticals: 0,
    fumbles: 0,
    damage: 0,
    healing: 0,
  };
}

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeString(value) {
  const normalized = String(value ?? '').trim();
  return normalized || '';
}

function normalizeSearchText(value) {
  return normalizeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readPath(object, path) {
  if (!object || !path) return undefined;
  if (foundry?.utils?.getProperty) return foundry.utils.getProperty(object, path);
  return String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function getCollectionEntries(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  if (typeof collection === 'object') return Object.values(collection);
  return [];
}

function getCollectionDocument(collection, id) {
  if (!collection || !id) return null;
  if (typeof collection.get === 'function') return collection.get(id) || null;
  return getCollectionEntries(collection).find((entry) => String(entry?.id || entry?._id || '') === String(id)) || null;
}

function getDocumentFromUuid(uuid) {
  const normalized = normalizeString(uuid);
  if (!normalized) return null;
  try {
    if (typeof globalThis.fromUuidSync === 'function') return globalThis.fromUuidSync(normalized) || null;
  } catch (_error) {
    return null;
  }
  return null;
}

function getItemUuidFromActivityUuid(uuid) {
  const normalized = normalizeString(uuid);
  if (!normalized) return '';
  const match = normalized.match(/^(.*\.Item\.[^.]+)(?:\.Activity\.[^.]+)?$/);
  return match?.[1] || '';
}

function getDocumentId(documentLike) {
  return normalizeString(documentLike?.id || documentLike?._id);
}

function getDocumentName(documentLike, fallback = '') {
  return normalizeString(documentLike?.name || documentLike?.label || fallback);
}

function readDocumentFlag(documentLike, key) {
  if (!documentLike || !key) return '';
  if (typeof documentLike.getFlag === 'function') return normalizeString(documentLike.getFlag(MODULE_ID, key));
  return normalizeString(readPath(documentLike, `flags.${MODULE_ID}.${key}`));
}

function isRollLike(value) {
  if (!value || typeof value !== 'object') return false;
  return Boolean(
    value.formula
    || value._formula
    || value.dice
    || value.terms
    || value.total !== undefined
    || value._total !== undefined
    || value.result !== undefined,
  );
}

function normalizeActorKind(value) {
  const normalized = normalizeString(value).toLowerCase();
  return ACTOR_KIND_OPTIONS.some((option) => option.value === normalized) ? normalized : 'auto';
}

function normalizeItemActionType(value) {
  const normalized = normalizeString(value).toLowerCase();
  return ITEM_ACTION_TYPE_OPTIONS.some((option) => option.value === normalized) ? normalized : 'auto';
}

function inferActorKind(actor) {
  const configured = normalizeActorKind(readDocumentFlag(actor, FLAGS.actorKind));
  if (configured && configured !== 'auto') return configured;

  const actorType = normalizeString(actor?.type).toLowerCase();
  if (actorType === 'character') return 'pc';
  if (actorType === 'npc') return actor?.hasPlayerOwner ? 'npc' : 'monster';
  if (actorType === 'loot' || actorType === 'vehicle' || actorType === 'hazard') return 'environment';
  if (actor?.hasPlayerOwner) return 'pc';
  return 'npc';
}

function getActorSpeakerAlias(actor, fallback = '') {
  return readDocumentFlag(actor, FLAGS.actorSpeakerAlias) || getDocumentName(actor, fallback);
}

function resolveMessageUser(message) {
  const rawUser = message?.user || message?.userId || message?.author;
  if (!rawUser) return null;
  if (typeof rawUser === 'object') return rawUser;
  return getCollectionDocument(game.users, rawUser);
}

function resolveMessageActor(message) {
  if (message?.actor) return message.actor;
  if (message?.speakerActor) return message.speakerActor;
  if (typeof message?.getAssociatedActor === 'function') {
    const actor = message.getAssociatedActor();
    if (actor) return actor;
  }

  const actorUuid = normalizeString(
    readPath(message, 'flags.dnd5e.actor.uuid')
    || readPath(message, 'flags.midi-qol.actorUuid')
    || readPath(message, 'flags.betterrolls5e.actorUuid'),
  );
  const uuidActor = getDocumentFromUuid(actorUuid);
  if (uuidActor) return uuidActor;

  const speaker = message?.speaker || {};
  if (speaker.scene && speaker.token) {
    const scene = getCollectionDocument(game.scenes, speaker.scene);
    const token = getCollectionDocument(scene?.tokens, speaker.token);
    if (token?.actor) return token.actor;
  }

  const actorId = normalizeString(
    speaker.actor
    || readPath(message, 'flags.core.actorId')
    || readPath(message, 'flags.dnd5e.actor.id')
    || readPath(message, 'flags.midi-qol.actorId')
    || readPath(message, 'flags.betterrolls5e.actorId'),
  );
  return getCollectionDocument(game.actors, actorId);
}

function resolveMessageItem(message, actor) {
  if (message?.item) return message.item;

  const itemUuid = normalizeString(
    readPath(message, 'flags.dnd5e.item.uuid')
    || readPath(message, 'flags.dnd5e.itemUuid')
    || readPath(message, 'flags.dnd5e.roll.itemUuid')
    || readPath(message, 'flags.dnd5e.use.itemUuid')
    || readPath(message, 'flags.midi-qol.itemUuid')
    || readPath(message, 'flags.betterrolls5e.itemUuid')
    || readPath(message, 'flags.pf2e.origin.itemUuid')
    || getItemUuidFromActivityUuid(readPath(message, 'flags.dnd5e.activity.uuid')),
  );
  const uuidItem = getDocumentFromUuid(itemUuid);
  if (uuidItem) return uuidItem;

  const directItem = readPath(message, 'flags.dnd5e.item')
    || readPath(message, 'flags.dnd5e.item.data')
    || readPath(message, 'flags.dnd5e.itemData')
    || readPath(message, 'flags.pf2e.origin.item');
  if (directItem?.id || directItem?._id || directItem?.name) {
    const itemId = normalizeString(directItem.id || directItem._id);
    if (actor && itemId) return getCollectionDocument(actor.items, itemId) || directItem;
    return directItem;
  }

  const itemId = normalizeString(
    readPath(message, 'flags.dnd5e.item.id')
    || readPath(message, 'flags.dnd5e.itemId')
    || readPath(message, 'flags.dnd5e.use.itemId')
    || readPath(message, 'flags.dnd5e.roll.itemId')
    || readPath(message, 'flags.midi-qol.itemId')
    || readPath(message, 'flags.betterrolls5e.itemId')
    || readPath(message, 'flags.pf2e.origin.itemId'),
  );
  if (actor && itemId) return getCollectionDocument(actor.items, itemId);

  const originMessage = typeof message?.getOriginatingMessage === 'function' ? message.getOriginatingMessage() : null;
  if (originMessage && originMessage !== message) return resolveMessageItem(originMessage, actor);
  return null;
}

function getMessageRolls(message) {
  const rolls = getCollectionEntries(message?.rolls)
    .concat(getCollectionEntries(readPath(message, 'data.rolls')))
    .concat(getCollectionEntries(readPath(message, 'system.rolls')))
    .filter(isRollLike);
  if (rolls.length) return rolls;
  if (isRollLike(message?.roll)) return [message.roll];
  return [
    readPath(message, 'flags.dnd5e.rolls'),
    readPath(message, 'flags.midi-qol.roll'),
    readPath(message, 'flags.pf2e.context.rolls'),
  ].flatMap((candidate) => getCollectionEntries(candidate)).filter(isRollLike);
}

function getRollTotal(roll) {
  return normalizeNumber(roll?.total ?? roll?._total ?? roll?.result);
}

function getRollFormula(roll) {
  return normalizeString(roll?.formula || roll?._formula);
}

function getD20Results(roll) {
  function collectDiceTerms(term) {
    if (!term || typeof term !== 'object') return [];
    const nested = getCollectionEntries(term.terms)
      .concat(getCollectionEntries(term.rolls))
      .flatMap((entry) => collectDiceTerms(entry));
    return [term, ...nested];
  }

  const dice = getCollectionEntries(roll?.dice).length
    ? getCollectionEntries(roll.dice)
    : getCollectionEntries(roll?.terms).flatMap((term) => collectDiceTerms(term));
  const results = [];
  dice.forEach((die) => {
    const faces = Number(die?.faces);
    if (faces !== 20) return;
    const beforeCount = results.length;
    getCollectionEntries(die?.results).forEach((result) => {
      if (result?.discarded || result?.rerolled || result?.active === false) return;
      const value = normalizeNumber(result?.result ?? result?.value);
      if (value !== null) results.push(value);
    });
    if (results.length !== beforeCount) return;
    getCollectionEntries(die?.values).forEach((result) => {
      const value = normalizeNumber(result?.result ?? result?.value ?? result);
      if (value !== null) results.push(value);
    });
  });
  return results;
}

function normalizeDndRollType(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return '';
  if (normalized === 'heal') return 'healing';
  if (normalized === 'skill' || normalized === 'tool' || normalized === 'ability') return 'check';
  if (normalized === 'death') return 'save';
  if (normalized === 'other') return 'damage';
  if (['attack', 'damage', 'healing', 'save', 'check', 'spell', 'resource', 'utility', 'ignored'].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function getMessageRollType(message) {
  return normalizeDndRollType(
    readPath(message, 'flags.dnd5e.roll.type')
    || readPath(message, 'flags.pf2e.context.type')
    || readPath(message, 'flags.sw5e.roll.type'),
  );
}

function getMessageActivityType(message) {
  return normalizeDndRollType(
    readPath(message, 'flags.dnd5e.activity.type')
    || readPath(message, 'flags.dnd5e.use.type')
    || readPath(message, 'flags.pf2e.origin.type'),
  );
}

function getRollOptionType(roll) {
  return normalizeDndRollType(roll?.options?.rollType || roll?.options?.type || roll?.options?.flavor);
}

function getRollDamageTypes(roll) {
  const options = roll?.options || {};
  return getCollectionEntries(options.types)
    .concat(getCollectionEntries(options.damageTypes))
    .concat(options.type ? [options.type] : [])
    .map((type) => normalizeSearchText(type))
    .filter(Boolean);
}

function isDamageRoll(roll) {
  const constructorName = normalizeSearchText(roll?.constructor?.name);
  if (constructorName.includes('damageroll')) return true;
  const formula = getRollFormula(roll);
  if (!formula) return false;
  if (/\b\d+\s*d\s*(4|6|8|10|12)\b/i.test(formula) && !/\b1?\s*d20\b/i.test(formula)) return true;
  return getRollDamageTypes(roll).length > 0;
}

function isD20Roll(roll) {
  if (getD20Results(roll).length) return true;
  const constructorName = normalizeSearchText(roll?.constructor?.name);
  if (constructorName.includes('d20roll')) return true;
  return /\b1?\s*d20\b/i.test(getRollFormula(roll));
}

function getRollRole(roll, message) {
  const rollType = getRollOptionType(roll);
  if (rollType === 'healing') return 'healing';
  if (rollType === 'damage') return 'damage';
  if (['attack', 'save', 'check'].includes(rollType)) return rollType;

  const damageTypes = getRollDamageTypes(roll);
  if (damageTypes.includes('healing') || damageTypes.includes('temphp')) return 'healing';
  if (damageTypes.length || isDamageRoll(roll)) {
    const messageType = getMessageRollType(message);
    return messageType === 'healing' ? 'healing' : 'damage';
  }

  const messageType = getMessageRollType(message);
  if (isD20Roll(roll)) {
    if (['attack', 'save', 'check'].includes(messageType)) return messageType;
    return 'attack';
  }

  return messageType || getMessageActivityType(message) || 'other';
}

function getRollCriticalCount(roll) {
  if (roll?.isCritical === true) return 1;
  const threshold = normalizeNumber(roll?.options?.criticalSuccess || roll?.options?.critical);
  return getD20Results(roll).filter((value) => value >= (threshold || 20)).length;
}

function getRollFumbleCount(roll) {
  if (roll?.isFumble === true) return 1;
  const threshold = normalizeNumber(roll?.options?.criticalFailure || roll?.options?.fumble);
  return getD20Results(roll).filter((value) => value <= (threshold || 1)).length;
}

function readMidiQolTotals(message) {
  const midi = readPath(message, 'flags.midi-qol');
  if (!midi) return { damage: 0, healing: 0 };

  const detailSources = [
    { total: midi.damageTotal, detail: midi.damageDetail },
    { total: midi.otherDamageTotal, detail: midi.otherDamageDetail },
    { total: midi.bonusDamageTotal, detail: midi.bonusDamageDetail },
  ];
  let damage = 0;
  let healing = 0;

  detailSources.forEach((source) => {
    const detail = getCollectionEntries(source.detail);
    const total = normalizeNumber(source.total);
    if (detail.length) {
      detail.forEach((entry) => {
        const amount = normalizeNumber(entry?.damage ?? entry?.value ?? entry?.total);
        if (amount === null) return;
        const type = normalizeSearchText(entry?.type || entry?.damageType);
        if (type === 'healing' || type === 'temphp') healing += amount;
        else damage += amount;
      });
    } else if (total !== null) {
      damage += total;
    }
  });

  return { damage, healing };
}

function readBetterRollsFigures(message) {
  const flags = readPath(message, 'flags.betterrolls5e');
  const entries = getCollectionEntries(flags?.entries);
  if (!entries.length) return null;

  let rollTotal = 0;
  let rollCount = 0;
  const d20Results = [];
  let criticalCount = 0;
  let fumbleCount = 0;
  let damage = 0;
  let healing = 0;

  entries.forEach((entry) => {
    if (entry?.type === 'multiroll' && ['attack', 'save', 'check'].includes(normalizeDndRollType(entry.rollType))) {
      const selected = getCollectionEntries(entry.entries).find((candidate) => !candidate?.ignored)
        || getCollectionEntries(entry.entries)[0];
      const total = normalizeNumber(selected?.total ?? selected?.roll?.total);
      const die = normalizeNumber(selected?.roll?.terms?.[0]?.total ?? selected?.roll?.dice?.[0]?.total);
      if (total !== null) {
        rollTotal += total;
        rollCount += 1;
      }
      if (die !== null) d20Results.push(die);
      if (selected?.isCrit) criticalCount += 1;
      if (die === 1) fumbleCount += 1;
    }

    if (entry?.type === 'damage-group') {
      getCollectionEntries(entry.entries).forEach((subEntry) => {
        let amount = normalizeNumber(subEntry?.baseRoll?.total ?? subEntry?.total);
        const critAmount = normalizeNumber(subEntry?.critRoll?.total);
        if (amount === null) return;
        if (critAmount !== null) amount += critAmount;
        const damageType = normalizeSearchText(subEntry?.damageType || subEntry?.type);
        if (damageType === 'healing' || damageType === 'temphp') healing += amount;
        else damage += amount;
      });
    }
  });

  return { rollTotal, rollCount, d20Results, criticalCount, fumbleCount, damage, healing };
}

function inferActionType({ message, item, rawText, rolls }) {
  const configured = normalizeItemActionType(readDocumentFlag(item, FLAGS.itemActionType));
  if (configured && configured !== 'auto') return configured;

  const rollType = getMessageRollType(message);
  const activityType = getMessageActivityType(message);
  if (['attack', 'damage', 'healing', 'save', 'check', 'utility', 'resource', 'ignored'].includes(rollType)) return rollType;
  if (['attack', 'damage', 'healing', 'save', 'check', 'utility', 'resource', 'ignored'].includes(activityType)) return activityType;

  const itemType = normalizeString(item?.type).toLowerCase();
  const text = normalizeSearchText(rawText);
  const hasDamageLabel = /\b(damage|dmg|degat|degats|blessure)\b/.test(text);
  const hasHealingLabel = /\b(heal|healing|soin|soins|soigne|restaure|regain)\b/.test(text);
  if (inferAmountFromText(rawText, 'healing') !== null || (rolls.length && hasHealingLabel)) return 'healing';
  if (inferAmountFromText(rawText, 'damage') !== null || (rolls.length && hasDamageLabel)) return 'damage';
  if (/saving throw|jet de sauvegarde|sauvegarde/.test(text)) return 'save';
  if (/ability check|skill check|test de competence|test /.test(text)) return 'check';
  if (itemType === 'spell') return 'spell';
  if (itemType === 'weapon') return 'attack';
  if (itemType === 'feat') return 'utility';
  return rolls.length ? 'attack' : 'other';
}

function getActionName(item, rawText, fallback = 'Action') {
  return readDocumentFlag(item, FLAGS.itemActionName) || getDocumentName(item) || normalizeString(rawText).slice(0, 64) || fallback;
}

function sumRollTotals(rolls) {
  return rolls.reduce((total, roll) => {
    const value = getRollTotal(roll);
    return value === null ? total : total + value;
  }, 0);
}

function looksLikeStaticAttackDescription(rawText) {
  const text = normalizeSearchText(rawText);
  return /\b(hit|touche)\s*:/.test(text)
    && /\b(weapon attack|attaque d arme|to hit|toucher|range|portee|allonge)\b/.test(text);
}

function readSafeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function collectStandaloneNumbers(text) {
  const withoutDiceFormula = String(text || '').replace(/\b\d+\s*d\s*\d+(?:\s*[+-]\s*\d+)?/gi, ' ');
  const matches = withoutDiceFormula.match(/\b\d{1,4}\b/g) || [];
  return matches
    .map((match) => readSafeNumber(match))
    .filter((number) => number !== null);
}

function inferAmountFromText(rawText, kind = 'damage') {
  if (looksLikeStaticAttackDescription(rawText)) return null;

  const text = normalizeSearchText(rawText);
  if (!text) return null;

  const keywords = kind === 'healing'
    ? ['heal', 'healing', 'soin', 'soins', 'soigne', 'restaure', 'regain']
    : ['damage', 'dmg', 'degat', 'degats', 'blessure'];
  const keywordPattern = keywords.join('|');
  const keywordMatch = text.match(new RegExp(`\\b(${keywordPattern})\\b`));

  if (keywordMatch?.index !== undefined) {
    const segment = text.slice(keywordMatch.index, keywordMatch.index + 96);
    const numbers = collectStandaloneNumbers(segment);
    if (numbers.length) return numbers[numbers.length - 1];
  }

  const beforeKeywordMatch = text.match(new RegExp(`\\b(\\d{1,4})\\s*(?:${keywordPattern})\\b`));
  const beforeKeywordAmount = readSafeNumber(beforeKeywordMatch?.[1]);
  return beforeKeywordAmount;
}

function inferRollNaturalFromText(rawText) {
  const text = normalizeSearchText(rawText);
  const naturalMatch = text.match(/\b(?:nat|natural|naturel|critique|critical)\s*(20|1)\b/);
  if (naturalMatch) return Number(naturalMatch[1]);
  const d20Match = text.match(/\bd20\D{0,24}(20|1)\b/);
  return d20Match ? Number(d20Match[1]) : null;
}

function inferRollTotalFromText(rawText) {
  if (looksLikeStaticAttackDescription(rawText)) return null;

  const text = normalizeSearchText(rawText);
  const totalMatch = text.match(/\b(?:total|result|resultat|jet|roll)\D{0,24}(\d{1,3})\b/);
  const total = readSafeNumber(totalMatch?.[1]);
  if (total !== null) return total;

  const d20Index = text.search(/\b1?\s*d20\b/);
  if (d20Index < 0) return null;
  const segment = text.slice(d20Index, d20Index + 96);
  const numbers = collectStandaloneNumbers(segment).filter((number) => number >= 0 && number <= 100);
  return numbers.length ? numbers[numbers.length - 1] : null;
}

function getMessageFigures({ message, rawText, item, rolls }) {
  const betterRollsFigures = readBetterRollsFigures(message);
  const rollGroups = rolls.reduce((groups, roll) => {
    const role = getRollRole(roll, message);
    if (['attack', 'save', 'check'].includes(role)) groups.d20.push(roll);
    else if (role === 'healing') groups.healing.push(roll);
    else if (role === 'damage') groups.damage.push(roll);
    else groups.other.push(roll);
    return groups;
  }, { d20: [], damage: [], healing: [], other: [] });

  const d20Results = rollGroups.d20.flatMap((roll) => getD20Results(roll));
  const textNatural = d20Results.length || betterRollsFigures?.d20Results?.length ? null : inferRollNaturalFromText(rawText);
  if (textNatural !== null) d20Results.push(textNatural);

  const textRollTotal = rollGroups.d20.length || betterRollsFigures?.rollCount ? null : inferRollTotalFromText(rawText);
  const rollCount = rollGroups.d20.length || betterRollsFigures?.rollCount || (textRollTotal !== null ? 1 : 0);
  const rollTotal = rollGroups.d20.length
    ? sumRollTotals(rollGroups.d20)
    : (betterRollsFigures?.rollTotal || textRollTotal || 0);
  const actionType = inferActionType({ message, item, rawText, rolls });
  const textDamage = inferAmountFromText(rawText, 'damage');
  const textHealing = inferAmountFromText(rawText, 'healing');
  const midiTotals = readMidiQolTotals(message);
  const rollDamage = sumRollTotals(rollGroups.damage);
  const rollHealing = sumRollTotals(rollGroups.healing);
  const damage = rollDamage
    || betterRollsFigures?.damage
    || midiTotals.damage
    || (actionType === 'damage' ? textDamage || 0 : 0);
  const healing = rollHealing
    || betterRollsFigures?.healing
    || midiTotals.healing
    || (actionType === 'healing' ? textHealing || 0 : 0);
  const criticalCount = rollGroups.d20.reduce((total, roll) => total + getRollCriticalCount(roll), 0)
    || betterRollsFigures?.criticalCount
    || d20Results.filter((value) => value === 20).length;
  const fumbleCount = rollGroups.d20.reduce((total, roll) => total + getRollFumbleCount(roll), 0)
    || betterRollsFigures?.fumbleCount
    || d20Results.filter((value) => value === 1).length;

  return {
    actionType,
    rollCount,
    rollTotal,
    d20Results: d20Results.concat(betterRollsFigures?.d20Results || []),
    criticalCount,
    fumbleCount,
    damage,
    healing,
  };
}

function createParticipant({ key, speaker, actor, actorKind, user }) {
  return {
    key,
    speaker,
    actorId: getDocumentId(actor),
    actorName: getDocumentName(actor),
    actorKind,
    userId: getDocumentId(user),
    userName: getDocumentName(user),
    messages: 0,
    rolls: 0,
    criticals: 0,
    fumbles: 0,
    damage: 0,
    healing: 0,
    actions: new Map(),
  };
}

function getParticipantKey({ actor, user, speaker }) {
  const actorId = getDocumentId(actor);
  if (actorId) return `actor:${actorId}`;
  const userId = getDocumentId(user);
  if (userId) return `user:${userId}`;
  return `speaker:${speaker || 'unknown'}`;
}

function formatMetricNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
}

function getActorKindLabel(kind) {
  return ACTOR_KIND_OPTIONS.find((option) => option.value === kind)?.label || 'Auto';
}

function getActionTypeLabel(type) {
  return ITEM_ACTION_TYPE_OPTIONS.find((option) => option.value === type)?.label || 'Autre';
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

function readActorClass(actor) {
  return readDocumentFlag(actor, FLAGS.actorClass)
    || normalizeString(readPath(actor, 'system.details.class'))
    || normalizeString(readPath(actor, 'system.details.classes'));
}

function readActorSubclass(actor) {
  return readDocumentFlag(actor, FLAGS.actorSubclass)
    || normalizeString(readPath(actor, 'system.details.subclass'));
}

function readActorSpecies(actor) {
  return readDocumentFlag(actor, FLAGS.actorSpecies)
    || normalizeString(readPath(actor, 'system.details.race'))
    || normalizeString(readPath(actor, 'system.details.species'))
    || normalizeString(readPath(actor, 'system.details.ancestry.name'));
}

function readActorLevel(actor) {
  const configured = normalizeNumber(readDocumentFlag(actor, FLAGS.actorLevel));
  if (configured !== null) return configured;
  return normalizeNumber(readPath(actor, 'system.details.level') || readPath(actor, 'system.attributes.level'));
}

function getActorPlayerUserIds(actor) {
  if (!actor) return [];
  return getCollectionEntries(game.users)
    .filter((user) => !user?.isGM)
    .filter((user) => {
      if (typeof actor.testUserPermission === 'function') return actor.testUserPermission(user, 'OWNER');
      const ownership = actor.ownership || actor.data?.permission || {};
      return Number(ownership[user.id] || 0) >= 3;
    })
    .map((user) => getDocumentId(user))
    .filter(Boolean);
}

function actorHasRollCodexFlags(actor) {
  return Boolean(
    readDocumentFlag(actor, FLAGS.actorKind)
    || readDocumentFlag(actor, FLAGS.actorSpeakerAlias)
    || readDocumentFlag(actor, FLAGS.actorClass)
    || readDocumentFlag(actor, FLAGS.actorSubclass)
    || readDocumentFlag(actor, FLAGS.actorSpecies)
    || readDocumentFlag(actor, FLAGS.actorLevel),
  );
}

function itemHasRollCodexFlags(item) {
  return Boolean(
    readDocumentFlag(item, FLAGS.itemActionType)
    || readDocumentFlag(item, FLAGS.itemActionName)
    || readDocumentFlag(item, FLAGS.itemTags),
  );
}

function buildActorMappingRecord(actor) {
  if (!actor) return null;
  const actorId = getDocumentId(actor);
  if (!actorId) return null;
  const kind = inferActorKind(actor);
  const speakerAlias = getActorSpeakerAlias(actor, getDocumentName(actor));
  return {
    id: actorId,
    name: getDocumentName(actor),
    kind,
    foundry_type: normalizeString(actor.type),
    speaker_alias: speakerAlias,
    class: readActorClass(actor) || null,
    subclass: readActorSubclass(actor) || null,
    species: readActorSpecies(actor) || null,
    level: readActorLevel(actor),
    player_user_ids: getActorPlayerUserIds(actor),
  };
}

function buildItemMappingRecord(item, actor = null) {
  if (!item) return null;
  const itemId = getDocumentId(item);
  if (!itemId) return null;
  return {
    id: itemId,
    actor_id: getDocumentId(actor) || null,
    name: getDocumentName(item),
    foundry_type: normalizeString(item.type),
    action_type: normalizeItemActionType(readDocumentFlag(item, FLAGS.itemActionType)),
    canonical_action_name: readDocumentFlag(item, FLAGS.itemActionName) || getDocumentName(item),
    tags: readDocumentFlag(item, FLAGS.itemTags)
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

function shouldIncludeActorInRoster(actor) {
  if (!actor) return false;
  if (actorHasRollCodexFlags(actor)) return true;
  if (actor.hasPlayerOwner) return true;
  return inferActorKind(actor) === 'pc';
}

function buildRollCodexRosterSnapshot() {
  const actors = {};
  getCollectionEntries(game.actors).forEach((actor) => {
    if (!shouldIncludeActorInRoster(actor)) return;
    const record = buildActorMappingRecord(actor);
    if (record) actors[record.id] = record;
  });

  const users = {};
  getCollectionEntries(game.users).forEach((user) => {
    const userId = getDocumentId(user);
    if (!userId) return;
    users[userId] = {
      id: userId,
      name: getDocumentName(user),
      role: user?.isGM ? 'gm' : 'player',
      active: Boolean(user?.active),
    };
  });

  return { actors, users };
}

function buildRollCodexMappingSnapshot() {
  const actors = {};
  const items = {};
  const speakers = {};

  getCollectionEntries(game.actors).forEach((actor) => {
    const actorRecord = buildActorMappingRecord(actor);
    if (actorRecord && actorHasRollCodexFlags(actor)) {
      actors[actorRecord.id] = actorRecord;
      if (actorRecord.speaker_alias) {
        speakers[actorRecord.speaker_alias] = {
          actor_id: actorRecord.id,
          kind: actorRecord.kind,
        };
      }
    }

    getCollectionEntries(actor?.items).forEach((item) => {
      if (!itemHasRollCodexFlags(item)) return;
      const itemRecord = buildItemMappingRecord(item, actor);
      if (itemRecord) items[`${actorRecord?.id || 'world'}:${itemRecord.id}`] = itemRecord;
    });
  });

  return {
    version: ROLLCODEX_MAPPING_VERSION,
    actors,
    items,
    speakers,
  };
}

function serializeRollForSnapshot(roll, message) {
  if (!roll) return null;
  return {
    formula: getRollFormula(roll),
    total: getRollTotal(roll),
    d20: getD20Results(roll),
    role: getRollRole(roll, message),
    damage_types: getRollDamageTypes(roll),
  };
}

function buildMessageRollSnapshot(message, { actor, item, rawText }) {
  const rawRolls = getMessageRolls(message);
  const rolls = rawRolls.map((roll) => serializeRollForSnapshot(roll, message)).filter(Boolean);
  const figures = getMessageFigures({ message, rawText, item, rolls: rawRolls });
  if (!rolls.length && !actor && !item && !figures.rollCount && !figures.damage && !figures.healing) return null;
  return {
    actor_id: getDocumentId(actor) || null,
    actor_name: getDocumentName(actor) || null,
    actor_kind: actor ? inferActorKind(actor) : null,
    item_id: getDocumentId(item) || null,
    item_name: getDocumentName(item) || null,
    action_type: figures.actionType,
    action_name: getActionName(item, rawText, ''),
    rolls,
    roll_total_hint: figures.rollCount ? figures.rollTotal : null,
    roll_natural_hint: figures.d20Results.length ? figures.d20Results[0] : null,
    damage_total_hint: figures.damage || null,
    heal_total_hint: figures.healing || null,
  };
}

function buildPairingCode({ state, secretHash }) {
  return `${String(secretHash || '').slice(0, 4)}-${String(state || '').slice(-4)}`.toUpperCase();
}

function isLocalRollCodexAppUrl(appUrl) {
  try {
    const url = new URL(appUrl);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase());
  } catch (_error) {
    return false;
  }
}

function buildPairingUrl({ appUrl, state, connectionId, secretHash = '', secretPrefix = '', pairingCode = '' }) {
  const metadata = getWorldMetadata();
  const url = new URL('/vtt/connect/foundry', appUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('connection_id', connectionId);
  url.searchParams.set('source_origin', window.location.origin);

  // Fallback local: la page RollCodex peut lire la preuve directement dans l URL
  // quand le popup est detache du contexte Foundry et perd window.opener.
  if (isLocalRollCodexAppUrl(appUrl) && secretHash) {
    url.searchParams.set('local_secret_hash', secretHash);
    if (secretPrefix) url.searchParams.set('local_secret_prefix', secretPrefix);
    if (pairingCode) url.searchParams.set('local_pairing_code', pairingCode);
  }

  Object.entries(metadata).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });

  return url.toString();
}

function buildConnectionConfigUrl(appUrl) {
  return new URL('/api/vtt-connection-config', appUrl).toString();
}

function buildPairingStatusEndpoint(appUrl) {
  return new URL('/api/vtt-pairing-status', appUrl).toString();
}

function buildPairingStatusEndpointCandidates(appUrl, preferredEndpoint = '') {
  const candidates = [];
  const addCandidate = (value) => {
    const normalized = normalizeString(value);
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  addCandidate(preferredEndpoint);
  addCandidate(buildPairingStatusEndpoint(appUrl));

  try {
    const url = new URL(appUrl);
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
    if (localHosts.has(url.hostname.toLowerCase()) && (url.port === '5173' || url.port === '4173')) {
      url.port = '3000';
      url.pathname = '/api/vtt-pairing-status';
      url.search = '';
      url.hash = '';
      addCandidate(url.toString());
    }
  } catch (_error) {
    // ignore invalid fallback URL, on garde les endpoints deja resolus
  }

  return candidates;
}

async function copyTextToClipboard(value) {
  const text = normalizeString(value);
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand('copy');
  } finally {
    textarea.remove();
  }
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
    campaignId: game.settings.get(MODULE_ID, SETTINGS.campaignId),
    campaignLabel: game.settings.get(MODULE_ID, SETTINGS.campaignLabel),
    tableId: game.settings.get(MODULE_ID, SETTINGS.tableId),
    tableLabel: game.settings.get(MODULE_ID, SETTINGS.tableLabel),
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
    idleMinutes: Number.isFinite(idleMinutes) && idleMinutes >= 0 ? idleMinutes : DEFAULT_IDLE_MINUTES,
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
  renderFloatingPanel();
}

function refreshLiveMetricsApps() {
  activeLiveMetricsApps.forEach((app) => app.render(false));
  refreshConnectionApps();
}

function scheduleLiveMetricsRefresh() {
  if (liveMetricsState.refreshTimer) return;
  liveMetricsState.refreshTimer = window.setTimeout(() => {
    liveMetricsState.refreshTimer = null;
    refreshLiveMetricsApps();
  }, LIVE_METRICS_REFRESH_MS);
}

function resetLiveMetricsState({ startedAt = new Date().toISOString(), scheduleRefresh = true } = {}) {
  liveMetricsState.startedAt = startedAt;
  liveMetricsState.messageIds = new Set();
  liveMetricsState.participants = new Map();
  liveMetricsState.recentEvents = [];
  liveMetricsState.totals = createEmptyLiveMetricTotals();
  if (scheduleRefresh) scheduleLiveMetricsRefresh();
}

function recordLiveMetricsFromMessage(message) {
  if (!game.settings.get(MODULE_ID, SETTINGS.liveMetricsEnabled)) return;
  if (!message) return;

  const messageId = normalizeString(message.id || message._id || `${message.timestamp || Date.now()}:${Math.random()}`);
  if (liveMetricsState.messageIds.has(messageId)) return;
  liveMetricsState.messageIds.add(messageId);
  if (!liveMetricsState.startedAt) liveMetricsState.startedAt = new Date().toISOString();

  const rawText = stripHtml(message.content || '');
  const actor = resolveMessageActor(message);
  const item = resolveMessageItem(message, actor);
  const user = resolveMessageUser(message);
  const rolls = getMessageRolls(message);
  const actorKind = inferActorKind(actor);
  const figures = getMessageFigures({ message, rawText, item, rolls });
  const actionType = figures.actionType;
  if (actorKind === 'ignored' || actionType === 'ignored') return;

  const speaker = getActorSpeakerAlias(actor, message.speaker?.alias || message.alias || getDocumentName(user, 'Foundry'));
  const actionName = getActionName(item, rawText, figures.rollCount ? 'Jet' : 'Message');
  const key = getParticipantKey({ actor, user, speaker });
  const participant = liveMetricsState.participants.get(key)
    || createParticipant({ key, speaker, actor, actorKind, user });

  const criticals = figures.criticalCount;
  const fumbles = figures.fumbleCount;
  const damage = figures.damage;
  const healing = figures.healing;

  participant.speaker = speaker;
  participant.actorKind = actorKind;
  participant.messages += 1;
  participant.rolls += figures.rollCount;
  participant.criticals += criticals;
  participant.fumbles += fumbles;
  participant.damage += damage;
  participant.healing += healing;
  participant.actions.set(actionName, (participant.actions.get(actionName) || 0) + 1);
  liveMetricsState.participants.set(key, participant);

  liveMetricsState.totals.messages += 1;
  liveMetricsState.totals.rolls += figures.rollCount;
  liveMetricsState.totals.criticals += criticals;
  liveMetricsState.totals.fumbles += fumbles;
  liveMetricsState.totals.damage += damage;
  liveMetricsState.totals.healing += healing;

  liveMetricsState.recentEvents.unshift({
    id: messageId,
    speaker,
    actorId: getDocumentId(actor),
    itemId: getDocumentId(item),
    actionName,
    actionType,
    actionTypeLabel: getActionTypeLabel(actionType),
    roll_total: figures.rollCount ? figures.rollTotal : null,
    damage_total: damage || null,
    heal_total: healing || null,
    rollTotal: figures.rollCount ? formatMetricNumber(figures.rollTotal) : '',
    damage: damage ? formatMetricNumber(damage) : '',
    healing: healing ? formatMetricNumber(healing) : '',
  });
  liveMetricsState.recentEvents = liveMetricsState.recentEvents.slice(0, LIVE_METRICS_RECENT_EVENTS_LIMIT);
  scheduleLiveMetricsRefresh();
}

function summarizeLiveMetricsForTemplate() {
  const participants = Array.from(liveMetricsState.participants.values())
    .sort((left, right) => (right.damage + right.healing + right.rolls) - (left.damage + left.healing + left.rolls))
    .map((participant) => {
      const topAction = Array.from(participant.actions.entries())
        .sort((left, right) => right[1] - left[1])[0];
      return {
        ...participant,
        actorKindLabel: getActorKindLabel(participant.actorKind),
        messagesLabel: formatMetricNumber(participant.messages),
        rollsLabel: formatMetricNumber(participant.rolls),
        criticalsLabel: formatMetricNumber(participant.criticals),
        fumblesLabel: formatMetricNumber(participant.fumbles),
        damageLabel: formatMetricNumber(participant.damage),
        healingLabel: formatMetricNumber(participant.healing),
        topActionLabel: topAction ? `${topAction[0]} (${topAction[1]})` : '-',
      };
    });

  return {
    enabled: Boolean(game.settings.get(MODULE_ID, SETTINGS.liveMetricsEnabled)),
    startedAtLabel: formatDateTime(liveMetricsState.startedAt),
    hasParticipants: participants.length > 0,
    participants,
    recentEvents: liveMetricsState.recentEvents,
    hasRecentEvents: liveMetricsState.recentEvents.length > 0,
    totals: {
      messages: formatMetricNumber(liveMetricsState.totals.messages),
      rolls: formatMetricNumber(liveMetricsState.totals.rolls),
      criticals: formatMetricNumber(liveMetricsState.totals.criticals),
      fumbles: formatMetricNumber(liveMetricsState.totals.fumbles),
      damage: formatMetricNumber(liveMetricsState.totals.damage),
      healing: formatMetricNumber(liveMetricsState.totals.healing),
    },
  };
}

function summarizeLiveMetricsForPayload() {
  const participants = Array.from(liveMetricsState.participants.values())
    .sort((left, right) => (right.damage + right.healing + right.rolls) - (left.damage + left.healing + left.rolls))
    .slice(0, 20)
    .map((participant) => {
      const topAction = Array.from(participant.actions.entries())
        .sort((left, right) => right[1] - left[1])[0];
      return {
        key: participant.key,
        speaker: participant.speaker,
        actor_id: participant.actorId || null,
        actor_name: participant.actorName || null,
        actor_kind: participant.actorKind || null,
        user_id: participant.userId || null,
        user_name: participant.userName || null,
        messages: participant.messages,
        rolls: participant.rolls,
        criticals: participant.criticals,
        fumbles: participant.fumbles,
        damage: participant.damage,
        healing: participant.healing,
        top_action: topAction ? { name: topAction[0], count: topAction[1] } : null,
      };
    });
  const selectedMeasureData = globalThis.RollCodexMeasures?.getSelectedMeasureData?.() || { measure: null, ranking: [] };
  const selectedMeasure = selectedMeasureData.measure;

  return {
    source: 'foundry-module-live',
    started_at: liveMetricsState.startedAt || null,
    totals: { ...liveMetricsState.totals },
    top_participants: participants,
    recent_events: liveMetricsState.recentEvents.slice(0, LIVE_METRICS_RECENT_EVENTS_LIMIT).map((event) => ({
      speaker: event.speaker,
      actor_id: event.actorId || null,
      item_id: event.itemId || null,
      action_name: event.actionName,
      action_type: event.actionType,
      roll_total: event.roll_total,
      damage_total: event.damage_total,
      heal_total: event.heal_total,
    })),
    selected_measure: selectedMeasure ? {
      id: selectedMeasure.id,
      name: selectedMeasure.name,
      aggregation: selectedMeasure.aggregation,
      field: selectedMeasure.field,
    } : null,
    selected_measure_ranking: (selectedMeasureData.ranking || []).slice(0, 10).map((entry) => ({
      participant_id: entry.participant_id || null,
      participant_label: entry.participant_label || 'Non resolu',
      value: entry.value,
      resolved: Boolean(entry.resolved),
    })),
  };
}

function getFloatingPanelSettings() {
  return {
    collapsed: Boolean(game.settings.get(MODULE_ID, SETTINGS.floatingPanelCollapsed)),
    left: Number(game.settings.get(MODULE_ID, SETTINGS.floatingPanelLeft)) || 96,
    top: Number(game.settings.get(MODULE_ID, SETTINGS.floatingPanelTop)) || 92,
  };
}

async function patchFloatingPanelSettings(patch) {
  const writes = [];
  if (Object.prototype.hasOwnProperty.call(patch, 'collapsed')) {
    writes.push(game.settings.set(MODULE_ID, SETTINGS.floatingPanelCollapsed, Boolean(patch.collapsed)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'left')) {
    writes.push(game.settings.set(MODULE_ID, SETTINGS.floatingPanelLeft, Math.max(8, Math.round(Number(patch.left) || 96))));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'top')) {
    writes.push(game.settings.set(MODULE_ID, SETTINGS.floatingPanelTop, Math.max(8, Math.round(Number(patch.top) || 92))));
  }
  await Promise.all(writes);
}

function setFloatingPanelStatus(status) {
  floatingPanelState.status = normalizeString(status);
  renderFloatingPanel();
}

function beginFloatingPanelDrag(event) {
  const panel = document.getElementById(FLOATING_PANEL_ID);
  if (!panel) return;
  event.preventDefault();

  const rect = panel.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = rect.left;
  const startTop = rect.top;

  const onMove = (moveEvent) => {
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    const nextLeft = Math.min(maxLeft, Math.max(8, Math.round(startLeft + moveEvent.clientX - startX)));
    const nextTop = Math.min(maxTop, Math.max(8, Math.round(startTop + moveEvent.clientY - startY)));
    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
  };

  const onUp = async () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const nextRect = panel.getBoundingClientRect();
    await patchFloatingPanelSettings({ left: nextRect.left, top: nextRect.top });
  };

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

async function toggleFloatingPanelCollapsed() {
  const settings = getFloatingPanelSettings();
  await patchFloatingPanelSettings({ collapsed: !settings.collapsed });
  setFloatingPanelStatus(settings.collapsed ? 'Panneau ouvert.' : 'Panneau reduit.');
}

async function toggleFloatingAutoSnapshot() {
  const settings = getAutoSnapshotSettings();
  await game.settings.set(MODULE_ID, SETTINGS.autoSnapshotEnabled, !settings.enabled);
  setFloatingPanelStatus(!settings.enabled ? 'Auto-capture active.' : 'Auto-capture suspendue.');
  scheduleIdleSnapshot(!settings.enabled ? 'foundry_auto_enabled' : 'foundry_auto_disabled');
}

async function setAutoIdleMinutes(minutes) {
  const safeMinutes = Math.max(5, Math.min(180, Math.round(Number(minutes) || DEFAULT_IDLE_MINUTES)));
  await game.settings.set(MODULE_ID, SETTINGS.autoSnapshotIdleMinutes, safeMinutes);
  scheduleIdleSnapshot('foundry_auto_idle_changed');
  setFloatingPanelStatus(`Auto ${safeMinutes} min.`);
}

async function adjustFloatingAutoIdle(deltaMinutes) {
  const settings = getAutoSnapshotSettings();
  await setAutoIdleMinutes(settings.idleMinutes + deltaMinutes);
}

async function sendFloatingSnapshot() {
  if (!canCurrentUserSendSnapshots()) {
    ui.notifications.warn('Seul le MJ primaire peut envoyer une capture RollCodex.');
    return;
  }
  setFloatingPanelStatus('Envoi de la capture...');
  try {
    const result = await sendSnapshotPayload({ mode: 'manual', reason: 'floating_panel_button' });
    const message = result.blockedResponse
      ? 'Capture transmise. Verifiez RollCodex.'
      : `Capture envoyee (${result.messageCount} messages).`;
    ui.notifications.info(message);
    setFloatingPanelStatus(message);
  } catch (error) {
    const message = error?.message || 'Capture RollCodex refusee.';
    ui.notifications.error(message);
    setFloatingPanelStatus(message);
  }
}

async function endFloatingSession() {
  if (!canCurrentUserSendSnapshots()) {
    ui.notifications.warn('Seul le MJ primaire peut terminer la session RollCodex.');
    return;
  }
  setFloatingPanelStatus('Fin de session...');
  try {
    const result = await sendSnapshotPayload({
      mode: 'manual',
      reason: 'manual_session_end',
      skipIfEmpty: true,
    });
    const message = result.skipped
      ? 'Aucun nouveau message a capturer.'
      : result.blockedResponse
        ? 'Fin de session transmise. Verifiez RollCodex.'
        : `Fin de session envoyee (${result.messageCount} messages).`;
    ui.notifications.info(message);
    setFloatingPanelStatus(message);
  } catch (error) {
    const message = error?.message || 'Fin de session RollCodex refusee.';
    ui.notifications.error(message);
    setFloatingPanelStatus(message);
  }
}

async function forgetFloatingConnection() {
  const confirmed = await Dialog.confirm({
    title: 'Oublier RollCodex',
    content: '<p>La connexion locale sera retiree de ce monde Foundry.</p>',
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
    game.settings.set(MODULE_ID, SETTINGS.campaignId, ''),
    game.settings.set(MODULE_ID, SETTINGS.campaignLabel, ''),
    game.settings.set(MODULE_ID, SETTINGS.tableId, ''),
    game.settings.set(MODULE_ID, SETTINGS.tableLabel, ''),
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
  clearIdleTimer();
  setFloatingPanelStatus('Connexion oubliee.');
  ui.notifications.info('Connexion RollCodex retiree de ce monde.');
}

function compactFloatingStatus(status, connected) {
  const text = normalizeString(status).toLowerCase();
  if (!connected) return 'Non connecte';
  if (!text || text.includes('connecte')) return 'Connecte';
  if (text.includes('profil') || text.includes('mapping') || text.includes('synchro')) return 'Synchro';
  if (text.includes('auto')) return 'Auto';
  if (text.includes('capture') || text.includes('envoi')) return 'Envoi';
  if (text.includes('fin de session')) return 'Session';
  return 'Connecte';
}

function bindFloatingPanelEvents(panel) {
  panel.querySelector('[data-rollcodex-floating-drag]')?.addEventListener('pointerdown', beginFloatingPanelDrag);
  panel.querySelector('[data-rollcodex-floating-collapse]')?.addEventListener('click', toggleFloatingPanelCollapsed);
  panel.querySelector('[data-rollcodex-floating-config]')?.addEventListener('click', () => new RollCodexConnectionApp().render(true));
  panel.querySelector('[data-rollcodex-floating-live]')?.addEventListener('click', () => new RollCodexLiveMetricsApp().render(true));
  panel.querySelector('[data-rollcodex-floating-send]')?.addEventListener('click', sendFloatingSnapshot);
  panel.querySelector('[data-rollcodex-floating-end]')?.addEventListener('click', endFloatingSession);
  panel.querySelector('[data-rollcodex-floating-forget]')?.addEventListener('click', forgetFloatingConnection);
  panel.querySelector('[data-rollcodex-floating-auto]')?.addEventListener('click', toggleFloatingAutoSnapshot);
  panel.querySelector('[data-rollcodex-floating-auto-minus]')?.addEventListener('click', () => adjustFloatingAutoIdle(-5));
  panel.querySelector('[data-rollcodex-floating-auto-plus]')?.addEventListener('click', () => adjustFloatingAutoIdle(5));
  panel.querySelector('[data-rollcodex-floating-measure]')?.addEventListener('change', async (event) => {
    if (globalThis.RollCodexMeasures?.selectMeasure) {
      await globalThis.RollCodexMeasures.selectMeasure(event.currentTarget.value || '');
      renderFloatingPanel();
    }
  });
}

function getFloatingRankingSummary(liveMetrics) {
  const selectedMeasureData = globalThis.RollCodexMeasures?.getSelectedMeasureData?.() || { measure: null, ranking: [] };
  const selectedMeasure = selectedMeasureData.measure || null;
  const selectedRanking = Array.isArray(selectedMeasureData.ranking) ? selectedMeasureData.ranking : [];
  const availableMeasures = globalThis.RollCodexMeasures?.getActiveMeasures?.() || [];
  const selectedMeasureId = globalThis.RollCodexMeasures?.selectedMeasureId || '';

  if (selectedMeasure && selectedRanking.length > 0) {
    return {
      title: selectedMeasure.icon
        ? `${selectedMeasure.icon} ${selectedMeasure.name}`
        : selectedMeasure.name,
      selectedMeasureId,
      availableMeasures,
      rows: selectedRanking.slice(0, 6).map((entry, index) => ({
        rank: index + 1,
        label: entry.participant_label || 'Non resolu',
        value: entry.valueLabel || formatMetricNumber(entry.value),
        unresolved: !entry.resolved,
      })),
      topLabel: selectedRanking[0]?.participant_label || 'Table Foundry',
    };
  }

  const participants = Array.isArray(liveMetrics?.participants) ? liveMetrics.participants : [];
  const rows = participants.slice(0, 6).map((participant, index) => ({
    rank: index + 1,
    label: participant.speaker || 'Inconnu',
    value: `${participant.rollsLabel} jets`,
    unresolved: false,
  }));

  return {
    title: 'Top participants',
    selectedMeasureId,
    availableMeasures,
    rows,
    topLabel: rows[0]?.label || 'Table Foundry',
  };
}

function renderFloatingRankingHtml(rankingSummary) {
  const hasMeasures = Array.isArray(rankingSummary.availableMeasures) && rankingSummary.availableMeasures.length > 0;
  const options = hasMeasures
    ? rankingSummary.availableMeasures.map((measure) => {
      const selected = measure.id === rankingSummary.selectedMeasureId ? 'selected' : '';
      return `<option value="${escapeHtml(measure.id)}" ${selected}>${escapeHtml(measure.name || measure.id)}</option>`;
    }).join('')
    : '';
  const selectHtml = hasMeasures
    ? `
      <label class="rollcodex-floating-panel__ranking-select-wrap">
        <span>Mesure</span>
        <select data-rollcodex-floating-measure class="rollcodex-floating-panel__ranking-select">${options}</select>
      </label>
    `
    : '';

  if (!rankingSummary.rows.length) {
    return `
      ${selectHtml}
      <div class="rollcodex-floating-panel__ranking-empty">Aucun classement live pour le moment.</div>
    `;
  }

  const rows = rankingSummary.rows.map((entry) => {
    return `
      <li class="${entry.unresolved ? 'is-unresolved' : ''}">
        <span class="rollcodex-floating-panel__ranking-rank">${entry.rank}</span>
        <span class="rollcodex-floating-panel__ranking-label" title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span>
        <span class="rollcodex-floating-panel__ranking-value">${escapeHtml(entry.value)}</span>
      </li>
    `;
  }).join('');

  return `
    ${selectHtml}
    <div class="rollcodex-floating-panel__ranking-head">${escapeHtml(rankingSummary.title)}</div>
    <ol class="rollcodex-floating-panel__ranking-list">${rows}</ol>
  `;
}

function renderFloatingPanel() {
  if (typeof game === 'undefined' || !game.ready) return;

  let panel = document.getElementById(FLOATING_PANEL_ID);
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = FLOATING_PANEL_ID;
    document.body.appendChild(panel);
  }

  const settings = getFloatingPanelSettings();
  const connection = getStoredConnection();
  const connected = hasStoredConnection(connection);
  const canSend = canCurrentUserSendSnapshots();
  const liveMetrics = summarizeLiveMetricsForTemplate();
  const rankingSummary = getFloatingRankingSummary(liveMetrics);
  const rankingHtml = renderFloatingRankingHtml(rankingSummary);
  const autoSettings = getAutoSnapshotSettings();
  const topParticipant = rankingSummary.topLabel || 'Table Foundry';
  const connectedScopeLabel = connection.tableLabel || connection.campaignLabel || connection.systemLabel || 'Systeme';
  const target = connected
    ? `${connection.workspaceLabel || 'Registre'} / ${connectedScopeLabel}`
    : 'Monde non connecte';
  const status = floatingPanelState.status || (connected ? 'Connecte a RollCodex.' : 'Pret pour connexion.');
  const statusLabel = compactFloatingStatus(status, connected);

  panel.className = `rollcodex-floating-panel ${settings.collapsed ? 'is-collapsed' : ''} ${connected ? 'is-connected' : 'is-idle'}`;
  panel.style.left = `${Math.max(8, settings.left)}px`;
  panel.style.top = `${Math.max(8, settings.top)}px`;

  if (settings.collapsed) {
    panel.innerHTML = `
      <div class="rollcodex-floating-panel__compact">
        <button type="button" class="rollcodex-floating-panel__drag" data-rollcodex-floating-drag title="Deplacer"><i class="fas fa-grip-lines"></i></button>
        <div class="rollcodex-floating-panel__compact-body">
          <strong>Classement live</strong>
          <span>${escapeHtml(target)}</span>
        </div>
        <button type="button" class="rollcodex-floating-panel__action" data-rollcodex-floating-collapse title="Ouvrir">Ouvrir</button>
      </div>
      <section class="rollcodex-floating-panel__compact-ranking">
        ${rankingHtml}
      </section>
    `;
    bindFloatingPanelEvents(panel);
    return;
  }

  panel.innerHTML = `
    <header class="rollcodex-floating-panel__header">
      <button type="button" class="rollcodex-floating-panel__drag" data-rollcodex-floating-drag title="Deplacer"><i class="fas fa-grip-lines"></i></button>
      <div class="rollcodex-floating-panel__title">
        <strong>RollCodex Live</strong>
        <span>${escapeHtml(target)}</span>
      </div>
      <span class="rollcodex-floating-panel__status-badge" title="${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
      <button type="button" class="rollcodex-floating-panel__action" data-rollcodex-floating-collapse title="Reduire">-</button>
    </header>
    <div class="rollcodex-floating-panel__metrics">
      <span><strong>${escapeHtml(liveMetrics.totals.messages)}</strong> msg</span>
      <span><strong>${escapeHtml(liveMetrics.totals.rolls)}</strong> jets</span>
      <span><strong>${escapeHtml(liveMetrics.totals.damage)}</strong> degats</span>
      <span><strong>${escapeHtml(liveMetrics.totals.healing)}</strong> soins</span>
    </div>
    <section class="rollcodex-floating-panel__ranking">
      ${rankingHtml}
    </section>
    <p class="rollcodex-floating-panel__status" title="${escapeHtml(status)}">${escapeHtml(statusLabel)}</p>
    <p class="rollcodex-floating-panel__meta">Actif : ${escapeHtml(topParticipant)} · Auto ${autoSettings.enabled ? 'ON' : 'OFF'} · ${autoSettings.idleMinutes} min</p>
    <div class="rollcodex-floating-panel__buttons">
      <button type="button" data-rollcodex-floating-config>${connected ? 'Cfg' : 'Lier'}</button>
      <button type="button" data-rollcodex-floating-live>Live</button>
      <button type="button" data-rollcodex-floating-send ${canSend && connected ? '' : 'disabled'}>Env.</button>
      <button type="button" data-rollcodex-floating-end ${canSend && connected ? '' : 'disabled'}>Fin</button>
      <button type="button" data-rollcodex-floating-forget ${connected ? '' : 'disabled'}>Oub.</button>
      <button type="button" data-rollcodex-floating-auto ${canSend && connected ? '' : 'disabled'}>Auto ${autoSettings.enabled ? 'ON' : 'OFF'}</button>
    </div>
    <div class="rollcodex-floating-panel__auto">
      <button type="button" data-rollcodex-floating-auto-minus ${canSend && connected ? '' : 'disabled'} title="Reduire l intervalle auto">-</button>
      <span>Auto ${autoSettings.idleMinutes} min</span>
      <button type="button" data-rollcodex-floating-auto-plus ${canSend && connected ? '' : 'disabled'} title="Augmenter l intervalle auto">+</button>
    </div>
  `;
  bindFloatingPanelEvents(panel);
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

function getChatMessagesSince(sinceMessageId = '') {
  const all = Array.from(game.messages?.contents || []);
  let startIndex = 0;
  if (sinceMessageId) {
    const idx = all.findIndex((message) => String(message.id || '') === String(sinceMessageId));
    if (idx >= 0) startIndex = idx + 1;
  }
  return all.slice(startIndex);
}

function collectChatMessagesSince(sinceMessageId) {
  const slice = getChatMessagesSince(sinceMessageId);
  const messages = slice
    .map((message) => {
      const rawText = stripHtml(message.content || '');
      const actor = resolveMessageActor(message);
      const item = resolveMessageItem(message, actor);
      const speaker = getActorSpeakerAlias(actor, message.speaker?.alias || message.alias || message.user?.name || 'Foundry');
      return {
        id: String(message.id || ''),
        timestamp: new Date(message.timestamp || Date.now()).toISOString(),
        speaker,
        raw_text: rawText,
        roll: buildMessageRollSnapshot(message, { actor, item, rawText }),
      };
    })
    .filter((message) => message.raw_text);

  const lastInBatch = slice.length > 0 ? String(slice[slice.length - 1].id || '') : '';
  const lastMessageId = lastInBatch || sinceMessageId || '';
  return { messages, lastMessageId, lastInBatch };
}

function getLiveBackfillMessages() {
  return getChatMessagesSince(getStoredLastMessageId());
}

function getFirstMessageTimestamp(messages) {
  const firstMessage = Array.isArray(messages) ? messages[0] : null;
  const parsed = firstMessage?.timestamp ? new Date(firstMessage.timestamp) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function rebuildLiveMetricsFromChatHistory({ reset = true } = {}) {
  if (!game.settings.get(MODULE_ID, SETTINGS.liveMetricsEnabled)) return 0;
  const messages = getLiveBackfillMessages();
  if (reset) {
    resetLiveMetricsState({ startedAt: getFirstMessageTimestamp(messages), scheduleRefresh: false });
  }
  messages.forEach((message) => recordLiveMetricsFromMessage(message));
  scheduleLiveMetricsRefresh();
  return messages.length;
}

function rebuildLiveSessionFromChatHistory({ reset = true } = {}) {
  const messages = getLiveBackfillMessages();
  if (reset) resetLiveSessionState();
  messages.forEach((message) => recordLiveObservation(message, { refresh: false }));
  globalThis.RollCodexMeasures?.rebuildFromMessages?.(messages);
  refreshLivePanels();
  return messages.length;
}

function buildSnapshotPayload(connection, { mode = 'manual', reason = 'manual', sinceMessageId = '' } = {}) {
  const { messages, lastMessageId, lastInBatch } = collectChatMessagesSince(sinceMessageId);
  const idempotencyToken = lastInBatch || sinceMessageId || 'empty';
  const stableSessionCapture = mode === 'auto' || reason === 'manual_session_end';
  const clientRequestId = stableSessionCapture
    ? `${connection.connectionId}:auto:${idempotencyToken}`
    : `${connection.connectionId}:${mode}:${idempotencyToken}:${generateState()}`;

  const mappingHints = getCurrentMappingHints();
  const measureMatches = globalThis.RollCodexMeasures?.getMeasureMatchesForSnapshot?.() || [];
  const mappingSnapshot = buildRollCodexMappingSnapshot();
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
      rollcodex_mapping_version: ROLLCODEX_MAPPING_VERSION,
      rollcodex_live_metrics: summarizeLiveMetricsForPayload(),
      rollcodex_mapping_snapshot: mappingSnapshot,
      rollcodex_mapping: mappingSnapshot,
      rollcodex_roster_snapshot: buildRollCodexRosterSnapshot(),
    },
    messages: messages.map(({ id: _id, ...rest }) => rest),
    mapping_hints: mappingHints,
  };

  if (measureMatches.length > 0) {
    payload.measure_matches = measureMatches;
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

  return payload?.message || payload?.error || fallbackMessage || 'Capture RollCodex refusee.';
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

function getAutoLastSentAtMs(settings = getAutoSnapshotSettings()) {
  const lastSentAt = Date.parse(String(settings.lastSentAt || ''));
  return Number.isFinite(lastSentAt) ? lastSentAt : 0;
}

function shouldThrottleAutoSnapshot(settings = getAutoSnapshotSettings()) {
  const lastSentAt = getAutoLastSentAtMs(settings);
  return lastSentAt > 0 && Date.now() - lastSentAt < settings.minIntervalMs;
}

async function sendSnapshotPayload({ mode = 'manual', reason = 'manual', skipIfEmpty = false } = {}) {
  const connection = getStoredConnection();
  if (!hasStoredConnection(connection)) {
    throw new Error('Connectez ce monde a RollCodex avant d envoyer une capture.');
  }

  const isAuto = mode === 'auto';
  if (isAuto) {
    const settings = getAutoSnapshotSettings();
    if (!settings.enabled || shouldThrottleAutoSnapshot(settings)) {
      return { skipped: true, blockedResponse: false, messageCount: 0 };
    }
    if (autoSnapshotState.inFlight) {
      return { skipped: true, blockedResponse: false, messageCount: 0 };
    }
    autoSnapshotState.inFlight = true;
  }

  try {
    const sinceMessageId = getStoredLastMessageId();
    const { payload, lastMessageId, messageCount } = buildSnapshotPayload(connection, {
      mode,
      reason,
      sinceMessageId,
    });

    if (messageCount === 0 && skipIfEmpty) {
      return { skipped: true, blockedResponse: false, messageCount: 0 };
    }

    const result = await postSnapshotPayload(connection.endpoint, payload);
    await rememberSnapshotSuccess(lastMessageId);
    return { ...result, messageCount };
  } catch (error) {
    await rememberSnapshotFailure(error);
    throw error;
  } finally {
    if (isAuto) autoSnapshotState.inFlight = false;
  }
}

function hasPendingSnapshotMessages() {
  const sinceMessageId = getStoredLastMessageId();
  return collectChatMessagesSince(sinceMessageId).messages.length > 0;
}

function shouldSendSessionEndSnapshot() {
  if (!canCurrentUserSendSnapshots()) return false;
  if (!hasStoredConnection()) return false;
  if (autoSnapshotState.inFlight) return false;

  const settings = getAutoSnapshotSettings();
  if (!settings.enabled) return false;
  if (shouldThrottleAutoSnapshot(settings)) return false;
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
  autoSnapshotState.inFlight = true;

  try {
    const connection = getStoredConnection();
    const sinceMessageId = getStoredLastMessageId();
    const { payload, lastMessageId, messageCount } = buildSnapshotPayload(connection, {
      mode: 'auto',
      reason,
      sinceMessageId,
    });

    if (messageCount === 0) {
      autoSnapshotState.inFlight = false;
      return;
    }

    const accepted = postSnapshotPayloadDuringUnload(connection.endpoint, payload);

    if (!accepted) {
      const message = 'Capture automatique de fin de session impossible.';
      autoSnapshotState.lastErrorMessage = message;
      game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, message).catch(() => {});
      autoSnapshotState.inFlight = false;
      return;
    }

    const nowIso = new Date().toISOString();
    autoSnapshotState.inMemoryLastMessageId = lastMessageId || autoSnapshotState.inMemoryLastMessageId;
    game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastSentAt, nowIso).catch(() => {});
    game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, '').catch(() => {});
    if (lastMessageId) {
      game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastMessageId, lastMessageId).catch(() => {});
    }
    refreshConnectionApps();
  } catch (error) {
    const message = error?.message || 'Capture automatique de fin de session impossible.';
    autoSnapshotState.lastErrorMessage = message;
    game.settings.set(MODULE_ID, SETTINGS.autoSnapshotLastError, message).catch(() => {});
    console.warn('[RollCodex] Session end snapshot failed', error);
  } finally {
    autoSnapshotState.inFlight = false;
  }
}

function clearIdleTimer() {
  if (autoSnapshotState.idleTimer) {
    window.clearTimeout(autoSnapshotState.idleTimer);
    autoSnapshotState.idleTimer = null;
  }
}

function scheduleIdleSnapshot(reason = 'foundry_auto_idle') {
  clearIdleTimer();
  if (!canCurrentUserSendSnapshots()) return;
  if (!hasStoredConnection()) return;

  const settings = getAutoSnapshotSettings();
  if (!settings.enabled) return;

  const idleMs = settings.idleMinutes * 60 * 1000;
  if (!Number.isFinite(idleMs) || idleMs <= 0) return;

  autoSnapshotState.idleTimer = window.setTimeout(() => {
    autoSnapshotState.idleTimer = null;
    sendSnapshotPayload({ mode: 'auto', reason, skipIfEmpty: true })
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
    if (document.visibilityState === 'visible') {
      refreshConnectionApps();
      scheduleIdleSnapshot('foundry_visibility_visible');
    }
  }, { capture: true });
  Hooks.on('createChatMessage', () => {
    scheduleIdleSnapshot('foundry_auto_chat_idle');
  });

  scheduleIdleSnapshot('foundry_auto_ready');
}

function registerLiveMetricsHooks() {
  if (liveMetricsState.hookRegistered) return;
  liveMetricsState.hookRegistered = true;

  Hooks.on('createChatMessage', (message) => {
    recordLiveMetricsFromMessage(message);
  });
}

function canConfigureRollCodexDocument(documentLike) {
  if (!documentLike) return false;
  return Boolean(game.user?.isGM || documentLike.isOwner);
}

function registerMappingSheetButtons() {
  Hooks.on('getActorSheetHeaderButtons', (app, buttons) => {
    if (!canConfigureRollCodexDocument(app?.object)) return;
    buttons.unshift({
      label: 'RollCodex',
      class: 'rollcodex-configure-actor',
      icon: 'fas fa-chart-line',
      onclick: () => new RollCodexMappingApp(app.object, 'actor').render(true),
    });
  });

  Hooks.on('getItemSheetHeaderButtons', (app, buttons) => {
    if (!canConfigureRollCodexDocument(app?.object)) return;
    buttons.unshift({
      label: 'RollCodex',
      class: 'rollcodex-configure-item',
      icon: 'fas fa-tags',
      onclick: () => new RollCodexMappingApp(app.object, 'item').render(true),
    });
  });
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
  const endpoint = normalizeString(data.endpoint || data.snapshotEndpoint || data.snapshot_endpoint);
  const mappingProfileEndpoint = normalizeString(data.mappingProfileEndpoint || data.mapping_profile_endpoint);
  const workspaceLabel = normalizeString(data.workspaceLabel || data.workspace_label);
  const systemId = normalizeString(data.systemId || data.system_id);
  const systemLabel = normalizeString(data.systemLabel || data.system_label);
  const campaignId = normalizeString(data.campaignId || data.campaign_id);
  const campaignLabel = normalizeString(data.campaignLabel || data.campaign_label);
  const tableId = normalizeString(data.tableId || data.table_id);
  const tableLabel = normalizeString(data.tableLabel || data.table_label);

  await game.settings.set(MODULE_ID, SETTINGS.connectionId, data.connectionId || '');
  await game.settings.set(MODULE_ID, SETTINGS.localConnectionSecret, connectionSecret || '');
  await game.settings.set(MODULE_ID, SETTINGS.connectionSecret, '');
  await game.settings.set(MODULE_ID, SETTINGS.endpoint, endpoint);
  await game.settings.set(MODULE_ID, SETTINGS.mappingProfileEndpoint, mappingProfileEndpoint);
  await game.settings.set(MODULE_ID, SETTINGS.workspaceLabel, workspaceLabel);
  await game.settings.set(MODULE_ID, SETTINGS.systemId, systemId);
  await game.settings.set(MODULE_ID, SETTINGS.systemLabel, systemLabel);
  await game.settings.set(MODULE_ID, SETTINGS.campaignId, campaignId);
  await game.settings.set(MODULE_ID, SETTINGS.campaignLabel, campaignLabel);
  await game.settings.set(MODULE_ID, SETTINGS.tableId, tableId);
  await game.settings.set(MODULE_ID, SETTINGS.tableLabel, tableLabel);
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
    pairingUrl: game.settings.get(MODULE_ID, SETTINGS.pendingPairingUrl),
  };
}

function hasPendingPairingData(pairing = getPendingPairing()) {
  return Boolean(pairing.connectionId && pairing.connectionSecret && pairing.state);
}

async function savePendingPairing({ connectionId, connectionSecret, state, pairingStatusEndpoint, pairingCode, pairingUrl }) {
  await game.settings.set(MODULE_ID, SETTINGS.pendingConnectionId, connectionId || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingConnectionSecret, connectionSecret || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingState, state || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingStatusEndpoint, pairingStatusEndpoint || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingCode, pairingCode || '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingUrl, pairingUrl || '');
}

async function clearPendingPairing() {
  await game.settings.set(MODULE_ID, SETTINGS.pendingConnectionId, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingConnectionSecret, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingState, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingStatusEndpoint, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingCode, '');
  await game.settings.set(MODULE_ID, SETTINGS.pendingPairingUrl, '');
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
    const indexKey = `${sourceKind}${String(sourceKey).toLowerCase()}`;
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

  const indexKey = `${sourceKind}${String(sourceKey).toLowerCase()}`;
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

      rebuildLiveSessionFromChatHistory({ reset: true });
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
  const actor = resolveMessageActor(message);
  const item = resolveMessageItem(message, actor);
  const rawText = stripHtml(message?.content || '');
  const rolls = getMessageRolls(message);
  const figures = getMessageFigures({ message, rawText, item, rolls });

  return {
    total: figures.rollTotal,
    count: figures.rollCount,
    nat20: figures.criticalCount,
    damageHint: figures.damage,
    healHint: figures.healing,
  };
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

function recordLiveObservation(message, { refresh = true } = {}) {
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
  if (rollFigures.healHint) {
    liveSessionState.totals.healTotal += rollFigures.healHint;
  }

  observations.forEach((observation) => {
    const sourceMapKey = `${observation.source_kind}\u001f${observation.source_key}`;
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

  if (refresh) refreshLivePanels();
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

class RollCodexLiveMetricsApp extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'rollcodex-live-metrics',
      title: 'RollCodex - Classement live',
      template: `modules/${MODULE_ID}/templates/live-metrics.hbs`,
      width: 620,
      closeOnSubmit: false,
      submitOnChange: false,
      resizable: true,
    });
  }

  getData() {
    return summarizeLiveMetricsForTemplate();
  }

  render(force, options) {
    activeLiveMetricsApps.add(this);
    return super.render(force, options);
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('[name="liveMetricsEnabled"]').on('change', (event) => this.toggleLiveMetrics(event.currentTarget.checked).catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="reset-live-metrics"]').on('click', () => this.resetLiveMetrics());
    html.find('[data-action="configure-actor"]').on('click', (event) => {
      const actor = getCollectionDocument(game.actors, event.currentTarget.dataset.actorId);
      if (actor) new RollCodexMappingApp(actor, 'actor').render(true);
    });
  }

  async _updateObject() {}

  async toggleLiveMetrics(enabled) {
    await game.settings.set(MODULE_ID, SETTINGS.liveMetricsEnabled, Boolean(enabled));
    if (enabled && !liveMetricsState.startedAt) resetLiveMetricsState();
    ui.notifications.info(enabled ? 'Classement live RollCodex active.' : 'Classement live RollCodex desactive.');
    refreshLiveMetricsApps();
  }

  resetLiveMetrics() {
    resetLiveMetricsState();
    ui.notifications.info('Classement live RollCodex remis a zero.');
  }

  close(options) {
    activeLiveMetricsApps.delete(this);
    return super.close(options);
  }
}

class RollCodexMappingApp extends FormApplication {
  constructor(documentLike, documentType, options = {}) {
    super(documentLike, options);
    this.documentType = documentType;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'rollcodex-mapping',
      title: 'RollCodex',
      template: `modules/${MODULE_ID}/templates/mapping.hbs`,
      width: 460,
      closeOnSubmit: true,
      submitOnChange: false,
      resizable: false,
    });
  }

  get title() {
    return this.documentType === 'item'
      ? `RollCodex - ${getDocumentName(this.object, 'Action')}`
      : `RollCodex - ${getDocumentName(this.object, 'Acteur')}`;
  }

  getData() {
    const documentLike = this.object;
    const isActor = this.documentType === 'actor';
    const selectedActorKind = normalizeActorKind(readDocumentFlag(documentLike, FLAGS.actorKind));
    const selectedActionType = normalizeItemActionType(readDocumentFlag(documentLike, FLAGS.itemActionType));
    return {
      isActor,
      isItem: !isActor,
      name: getDocumentName(documentLike),
      actorKind: selectedActorKind,
      actorKindOptions: ACTOR_KIND_OPTIONS.map((option) => ({ ...option, selected: option.value === selectedActorKind })),
      speakerAlias: readDocumentFlag(documentLike, FLAGS.actorSpeakerAlias),
      actorClass: readDocumentFlag(documentLike, FLAGS.actorClass),
      actorSubclass: readDocumentFlag(documentLike, FLAGS.actorSubclass),
      actorSpecies: readDocumentFlag(documentLike, FLAGS.actorSpecies),
      actorLevel: readDocumentFlag(documentLike, FLAGS.actorLevel),
      actionType: selectedActionType,
      actionTypeOptions: ITEM_ACTION_TYPE_OPTIONS.map((option) => ({ ...option, selected: option.value === selectedActionType })),
      actionName: readDocumentFlag(documentLike, FLAGS.itemActionName),
      actionTags: readDocumentFlag(documentLike, FLAGS.itemTags),
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    html.find('[data-action="clear-mapping"]').on('click', () => this.clearMapping().catch((error) => ui.notifications.error(error.message)));
  }

  async _updateObject(_event, formData) {
    if (this.documentType === 'actor') {
      await this.object.setFlag(MODULE_ID, FLAGS.actorKind, normalizeActorKind(formData.actorKind));
      await this.object.setFlag(MODULE_ID, FLAGS.actorSpeakerAlias, normalizeString(formData.speakerAlias));
      await this.object.setFlag(MODULE_ID, FLAGS.actorClass, normalizeString(formData.actorClass));
      await this.object.setFlag(MODULE_ID, FLAGS.actorSubclass, normalizeString(formData.actorSubclass));
      await this.object.setFlag(MODULE_ID, FLAGS.actorSpecies, normalizeString(formData.actorSpecies));
      await this.object.setFlag(MODULE_ID, FLAGS.actorLevel, normalizeString(formData.actorLevel));
    } else {
      await this.object.setFlag(MODULE_ID, FLAGS.itemActionType, normalizeItemActionType(formData.actionType));
      await this.object.setFlag(MODULE_ID, FLAGS.itemActionName, normalizeString(formData.actionName));
      await this.object.setFlag(MODULE_ID, FLAGS.itemTags, normalizeString(formData.actionTags));
    }
    ui.notifications.info('Configuration RollCodex enregistree.');
    refreshLiveMetricsApps();
  }

  async clearMapping() {
    const keys = this.documentType === 'actor'
      ? [FLAGS.actorKind, FLAGS.actorSpeakerAlias, FLAGS.actorClass, FLAGS.actorSubclass, FLAGS.actorSpecies, FLAGS.actorLevel]
      : [FLAGS.itemActionType, FLAGS.itemActionName, FLAGS.itemTags];
    await Promise.all(keys.map((key) => this.object.unsetFlag(MODULE_ID, key)));
    ui.notifications.info('Configuration RollCodex effacee.');
    refreshLiveMetricsApps();
    this.render(true);
  }
}

class RollCodexConnectionApp extends FormApplication {
  constructor(...args) {
    super(...args);
    this.autoRecoveryTimer = null;
    this.autoRecoveryUntil = 0;
    this.autoRecoveryRunning = false;
    this.currentMessageHandler = null;
    this.pairingPreparation = null;
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
    const hasPendingPairing = hasPendingPairingData(pendingPairing);
    const liveMetrics = summarizeLiveMetricsForTemplate();

    return {
      appUrl,
      connected: Boolean(connection.connectionId && connection.connectionSecret && connection.endpoint),
      canPreparePairing: Boolean(game.user?.isGM),
      hasPendingPairing,
      pendingConnectionId: pendingPairing.connectionId,
      pendingPairingCode: pendingPairing.pairingCode,
      pendingPairingUrl: pendingPairing.pairingUrl,
      autoSnapshotEnabled: autoSnapshot.enabled,
      autoSnapshotLastSentAtLabel: formatDateTime(autoSnapshot.lastSentAt),
      autoSnapshotLastError: autoSnapshot.lastError,
      liveMetricsEnabled: liveMetrics.enabled,
      liveMetrics,
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
    html.find('[data-action="prepare-pairing"]').on('click', () => this.preparePairing(html, { force: true, notify: true }).catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="recover-confirmation"]').on('click', () => this.recoverConfirmation().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="send-snapshot"]').on('click', () => this.sendSnapshot().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="end-session"]').on('click', () => this.sendEndOfSessionSnapshot().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="disconnect"]').on('click', () => this.disconnect().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="open-live-metrics"]').on('click', () => new RollCodexLiveMetricsApp().render(true));
    html.find('[data-action="reset-live-metrics"]').on('click', () => this.resetLiveMetrics());
    html.find('[data-action="open-pairing-url"]').on('click', (event) => this.openPreparedPairing(event, html).catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="copy-pairing-url"]').on('click', () => this.copyPendingPairingUrl().catch((error) => ui.notifications.error(error.message)));
    html.find('[name="appUrl"]').on('change', () => this.saveAppUrl(html, { notify: false }).catch((error) => ui.notifications.error(error.message)));
    html.find('[name="autoSnapshotEnabled"]').on('change', (event) => this.toggleAutoSnapshot(event.currentTarget.checked).catch((error) => ui.notifications.error(error.message)));
    html.find('[name="liveMetricsEnabled"]').on('change', (event) => this.toggleLiveMetrics(event.currentTarget.checked).catch((error) => ui.notifications.error(error.message)));

    const connection = getStoredConnection();
    const pendingPairing = getPendingPairing();
    if (!hasStoredConnection(connection) && game.user?.isGM && !hasPendingPairingData(pendingPairing)) {
      this.preparePairing(html).catch((error) => ui.notifications.warn(error.message));
    } else if (hasPendingPairingData(pendingPairing)) {
      this.installPendingPairingMessageHandler().catch(() => {});
      this.startAutoRecovery();
    }
  }

  async _updateObject() {}

  readAppUrl(html) {
    const form = html?.[0]?.closest('form') || this.form;
    if (!form) return normalizeAppUrl(game.settings.get(MODULE_ID, SETTINGS.appUrl));
    return normalizeAppUrl(new FormData(form).get('appUrl'));
  }

  async saveAppUrl(html, { notify = true } = {}) {
    const appUrl = this.readAppUrl(html);
    const previousAppUrl = normalizeAppUrl(game.settings.get(MODULE_ID, SETTINGS.appUrl));
    await game.settings.set(MODULE_ID, SETTINGS.appUrl, appUrl);
    if (appUrl !== previousAppUrl) await clearPendingPairing();
    if (notify) ui.notifications.info('Adresse RollCodex enregistree.');

    if (!hasStoredConnection() && game.user?.isGM) {
      await this.preparePairing(html, { force: appUrl !== previousAppUrl });
      return;
    }

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

  async toggleLiveMetrics(enabled) {
    await game.settings.set(MODULE_ID, SETTINGS.liveMetricsEnabled, Boolean(enabled));
    if (enabled && !liveMetricsState.startedAt) resetLiveMetricsState();
    ui.notifications.info(enabled ? 'Metriques live RollCodex activees.' : 'Metriques live RollCodex desactivees.');
    refreshLiveMetricsApps();
    this.render(true);
  }

  resetLiveMetrics() {
    resetLiveMetricsState();
    ui.notifications.info('Metriques live RollCodex remises a zero.');
    this.render(true);
  }

  installPairingMessageHandler({ appUrl, state, connectionId, secretHash, secretPrefix, pairingCode }) {
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
  }

  async installPendingPairingMessageHandler() {
    const pendingPairing = getPendingPairing();
    if (!hasPendingPairingData(pendingPairing)) return;

    const appUrl = normalizeAppUrl(game.settings.get(MODULE_ID, SETTINGS.appUrl));
    const secretHash = await sha256Hex(pendingPairing.connectionSecret);
    const secretPrefix = pendingPairing.connectionSecret.slice(0, 18);
    this.installPairingMessageHandler({
      appUrl,
      state: pendingPairing.state,
      connectionId: pendingPairing.connectionId,
      secretHash,
      secretPrefix,
      pairingCode: pendingPairing.pairingCode,
    });
  }

  async preparePairing(html, { force = false, notify = false } = {}) {
    if (!game.user?.isGM) {
      throw new Error('Seul un MJ peut connecter ce monde a RollCodex.');
    }

    const appUrl = this.readAppUrl(html);
    const storedAppUrl = normalizeAppUrl(game.settings.get(MODULE_ID, SETTINGS.appUrl));
    const pendingPairing = getPendingPairing();

    if (!force && appUrl === storedAppUrl && hasPendingPairingData(pendingPairing) && pendingPairing.pairingUrl) {
      await this.installPendingPairingMessageHandler();
      return pendingPairing;
    }

    if (this.pairingPreparation) return this.pairingPreparation;

    this.pairingPreparation = (async () => {
      try {
        await game.settings.set(MODULE_ID, SETTINGS.appUrl, appUrl);
        if (force || appUrl !== storedAppUrl) await clearPendingPairing();

        const connectionSecret = generateConnectionSecret();
        const connectionId = generateUuid();
        const state = generateState();
        const secretHash = await sha256Hex(connectionSecret);
        const secretPrefix = connectionSecret.slice(0, 18);
        const pairingCode = buildPairingCode({ state, secretHash });
        const pairingUrl = buildPairingUrl({
          appUrl,
          state,
          connectionId,
          secretHash,
          secretPrefix,
          pairingCode,
        });

        let connectionConfig = null;
        try {
          connectionConfig = await fetchConnectionConfig(appUrl);
        } catch (error) {
          console.warn('[RollCodex] Pairing status config unavailable', error);
        }

        const fallbackPairingStatusEndpoint = buildPairingStatusEndpoint(appUrl);

        await savePendingPairing({
          connectionId,
          connectionSecret,
          state,
          pairingStatusEndpoint: connectionConfig?.pairingStatusEndpoint || fallbackPairingStatusEndpoint,
          pairingCode,
          pairingUrl,
        });
        this.installPairingMessageHandler({
          appUrl,
          state,
          connectionId,
          secretHash,
          secretPrefix,
          pairingCode,
        });

        const nextPairing = getPendingPairing();
        if (notify) ui.notifications.info('Lien RollCodex pret.');
        return nextPairing;
      } catch (error) {
        await clearPendingPairing();
        this.stopAutoRecovery();
        if (this.currentMessageHandler) {
          window.removeEventListener('message', this.currentMessageHandler);
          this.currentMessageHandler = null;
        }
        throw error;
      } finally {
        this.pairingPreparation = null;
        this.render(true);
      }
    })();

    return this.pairingPreparation;
  }

  async openPreparedPairing(event, html) {
    const currentAppUrl = this.readAppUrl(html);
    const storedAppUrl = normalizeAppUrl(game.settings.get(MODULE_ID, SETTINGS.appUrl));
    const pendingPairing = getPendingPairing();

    if (currentAppUrl !== storedAppUrl || !hasPendingPairingData(pendingPairing) || !pendingPairing.pairingUrl) {
      event.preventDefault();
      await this.preparePairing(html, { force: true, notify: true });
      ui.notifications.info('Lien mis a jour. Cliquez a nouveau sur Connecter avec RollCodex.');
      return;
    }

    this.installPendingPairingMessageHandler().catch(() => {});
    this.startAutoRecovery();
    ui.notifications.info('RollCodex ouvert. Foundry terminera la liaison automatiquement.');
  }

  async startPairing(html) {
    return this.preparePairing(html, { force: true, notify: true });
  }

  async copyPendingPairingUrl() {
    const pendingPairing = getPendingPairing();
    if (!pendingPairing.pairingUrl) {
      ui.notifications.warn('Aucun lien RollCodex en attente.');
      return;
    }

    const copied = await copyTextToClipboard(pendingPairing.pairingUrl);
    if (copied) {
      ui.notifications.info('Lien RollCodex copie.');
    } else {
      ui.notifications.warn('Copie impossible. Utilisez le bouton Connecter avec RollCodex.');
    }
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

    const appUrl = normalizeAppUrl(game.settings.get(MODULE_ID, SETTINGS.appUrl));
    const endpointCandidates = buildPairingStatusEndpointCandidates(appUrl, pendingPairing.pairingStatusEndpoint);

    if (!endpointCandidates.length) {
      if (silent) return false;
      throw new Error('API de statut RollCodex indisponible pour cette demande. Relancez la connexion depuis Foundry.');
    }

    let lastError = null;

    for (const endpoint of endpointCandidates) {
      try {
        const response = await fetch(endpoint, {
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
          const error = new Error(payload?.message || payload?.error || 'Statut RollCodex indisponible.');
          error.code = payload?.code || payload?.error || '';
          lastError = error;
          continue;
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
        lastError = error;
      }
    }

    if (silent) return false;
    throw lastError || new Error('Statut RollCodex indisponible.');
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
    rebuildLiveMetricsFromChatHistory({ reset: true });
    rebuildLiveSessionFromChatHistory({ reset: true });
    if (this.currentMessageHandler) {
      window.removeEventListener('message', this.currentMessageHandler);
      this.currentMessageHandler = null;
    }
    this.stopAutoRecovery();
    fetchMappingProfile({ force: true }).catch((error) => {
      console.warn('[RollCodex] Mapping profile fetch after pairing failed', error);
    });
    ui.notifications.info('Monde Foundry connecte a RollCodex.');
    this.render(true);
  }

  async recoverConfirmation() {
    const form = this.form;
    const pastedValue = String(new FormData(form).get('confirmationPayload') || '').trim();

    if (!pastedValue) {
      const recovered = await this.tryCompletePendingPairing({ silent: false });
      if (recovered) return;
      throw new Error('Aucune confirmation automatique disponible. Relancez la liaison ou collez la confirmation RollCodex.');
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
      game.settings.set(MODULE_ID, SETTINGS.campaignId, ''),
      game.settings.set(MODULE_ID, SETTINGS.campaignLabel, ''),
      game.settings.set(MODULE_ID, SETTINGS.tableId, ''),
      game.settings.set(MODULE_ID, SETTINGS.tableLabel, ''),
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
      title: 'RollCodex - Tableau live',
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

    const measuresData = globalThis.RollCodexMeasures?.getSelectedMeasureData?.() || { measure: null, ranking: [] };
    const availableMeasures = globalThis.RollCodexMeasures?.getActiveMeasures?.() || [];
    const selectedMeasureId = globalThis.RollCodexMeasures?.selectedMeasureId || '';
    const hasMeasures = availableMeasures.length > 0;
    const showLegacyTotals = !selectedMeasureId;
    const showMeasureRanking = Boolean(selectedMeasureId && measuresData.measure);

    const ranking = measuresData.ranking.slice(0, 10).map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
    const totalRankingCount = measuresData.ranking.length;
    const unresolvedRankingCount = measuresData.ranking.filter((entry) => !entry.resolved).length;

    return {
      connected,
      isGmPrimary,
      workspaceLabel: connection.workspaceLabel || '',
      campaignLabel: connection.campaignLabel || '',
      tableLabel: connection.tableLabel || '',
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
      hasMeasures,
      availableMeasures: availableMeasures.map((m) => ({ ...m, selected: m.id === selectedMeasureId })),
      selectedMeasure: measuresData.measure,
      showLegacyTotals,
      showMeasureRanking,
      ranking,
      hasRanking: ranking.length > 0,
      totalRankingCount,
      unresolvedRankingCount,
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
    html.find('[data-action="end-session"]').on('click', () =>
      endFloatingSession().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="reset-session"]').on('click', () =>
      this.resetSession().catch((error) => ui.notifications.error(error.message)));
    html.find('[data-action="select-measure"]').on('change', (event) =>
      this.selectMeasure(event.currentTarget.value).catch((error) => ui.notifications.error(error.message)));
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

  async selectMeasure(measureId) {
    if (globalThis.RollCodexMeasures?.selectMeasure) {
      await globalThis.RollCodexMeasures.selectMeasure(measureId);
    }
    this.render(true);
  }

  async resetSession() {
    const confirmed = await Dialog.confirm({
      title: 'Reinitialiser la session live',
      content: '<p>Les compteurs de session courante seront remis a zero. Le profil et les captures envoyees ne sont pas affectes.</p>',
    });
    if (!confirmed) return;
    resetLiveSessionState();
    globalThis.RollCodexMeasures?.resetContributions?.();
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

  registerSetting(SETTINGS.liveMetricsEnabled, {
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    name: 'Classement live local RollCodex',
    hint: 'Affiche un tableau live local dans Foundry. Ces metriques ne sont pas envoyees a RollCodex.',
  });

  registerSetting(SETTINGS.floatingPanelCollapsed, {
    scope: 'client',
    config: false,
    type: Boolean,
    default: false,
  });

  registerSetting(SETTINGS.floatingPanelLeft, {
    scope: 'client',
    config: false,
    type: Number,
    default: 96,
  });

  registerSetting(SETTINGS.floatingPanelTop, {
    scope: 'client',
    config: false,
    type: Number,
    default: 92,
  });

  Object.values(SETTINGS)
    .filter((key) => ![
      SETTINGS.appUrl,
      SETTINGS.autoSnapshotEnabled,
      SETTINGS.autoSnapshotMinIntervalMs,
      SETTINGS.autoSnapshotIdleMinutes,
      SETTINGS.liveMetricsEnabled,
      SETTINGS.floatingPanelCollapsed,
      SETTINGS.floatingPanelLeft,
      SETTINGS.floatingPanelTop,
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
    name: 'Tableau live RollCodex',
    label: 'Ouvrir le panneau live',
    hint: 'Pilotage live de session, profil de mapping et envoi de capture avec hints.',
    icon: 'fas fa-gauge-high',
    type: RollCodexLivePanel,
    restricted: true,
  });

  game.settings.registerMenu(MODULE_ID, 'liveMetricsMenu', {
    name: 'Classement live local RollCodex',
    label: 'Ouvrir le classement live',
    hint: 'Afficher les metriques locales calculees depuis les messages Foundry de cette session.',
    icon: 'fas fa-chart-bar',
    type: RollCodexLiveMetricsApp,
    restricted: false,
  });

  registerMappingSheetButtons();
});

Hooks.once('ready', async () => {
  registerLiveMetricsHooks();
  if (game.settings.get(MODULE_ID, SETTINGS.liveMetricsEnabled) && !liveMetricsState.startedAt) {
    rebuildLiveMetricsFromChatHistory({ reset: true });
  }
  renderFloatingPanel();

  globalThis.refreshLivePanels = refreshLivePanels;
  globalThis.getCachedMappingProfile = getCachedMappingProfile;
  globalThis.resolveMessageActor = resolveMessageActor;
  globalThis.extractRollFigures = extractRollFigures;
  globalThis.resolveMappingFromProfile = resolveMappingFromProfile;
  globalThis.getRollCodexLiveBackfillMessages = getLiveBackfillMessages;

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
  rebuildLiveSessionFromChatHistory({ reset: true });
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
