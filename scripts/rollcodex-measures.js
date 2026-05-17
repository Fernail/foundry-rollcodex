/* global Hooks, game */
/**
 * RollCodex Measures Extension - Phase 1b (v0.1.41)
 *
 * Extension du module Foundry pour supporter les mesures workspace du profil v2.
 * Ce module etend les fonctionnalites live de rollcodex.js sans le modifier directement.
 *
 * Copie inline de src/lib/vtt/measureMatcher.js (source de verite pour les tests).
 * Les signatures doivent rester synchronisees.
 *
 * @version 0.1.41 - Phase 1b (2026-05-17)
 */

(() => {
  'use strict';

  const LIVE_ROLL_EVENT_TYPES = new Set(['roll', 'attack', 'spell_attack', 'saving_throw', 'save', 'initiative', 'skill_check', 'ability_check', 'check']);
  const LIVE_DAMAGE_EVENT_TYPES = new Set(['damage', 'spell_damage']);
  const LIVE_HEALING_EVENT_TYPES = new Set(['healing', 'heal']);

  // ==========================================================================
  // INLINE: src/lib/vtt/measureMatcher.js (source de verite des tests)
  // ==========================================================================

  function normalizeString(value) {
    return String(value ?? '').trim();
  }

  function normalizeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function matchEventToMeasure(event, measure, options = {}) {
    if (normalizeString(measure.formula_expression)) {
      return null;
    }

    if (measure.use_condition === true) {
      return null;
    }

    const targetRole = normalizeString(measure.target_role) || 'all';
    if (targetRole !== 'all') {
      const participantId = normalizeString(event.participant_id);
      const gmUserId = normalizeString(options.gmUserId);
      const npcActorIds = options.npcActorIds || new Set();

      if (targetRole === 'gm_only') {
        if (!participantId || participantId !== gmUserId) return null;
      } else if (targetRole === 'players_only') {
        if (!participantId || participantId === gmUserId) return null;
        if (npcActorIds.has(participantId)) return null;
      } else if (targetRole === 'npcs_only') {
        if (!npcActorIds.has(participantId)) return null;
      }
    }

    const filterEventTypes = Array.isArray(measure.filter_event_type) ? measure.filter_event_type : [];
    if (filterEventTypes.length > 0) {
      const eventType = normalizeString(event.event_type).toLowerCase();
      const matchesEventType = filterEventTypes.some((ft) => normalizeString(ft).toLowerCase() === eventType);
      if (!matchesEventType) return null;
    }

    const filterSubType = normalizeString(measure.filter_sub_type).toLowerCase();
    if (filterSubType) {
      const eventSubType = normalizeString(event.sub_type).toLowerCase();
      if (eventSubType !== filterSubType) return null;
    }

    const filterSkillName = normalizeString(measure.filter_skill_name).toLowerCase();
    if (filterSkillName) {
      const eventSkillName = normalizeString(event.skill_name).toLowerCase();
      if (eventSkillName !== filterSkillName) return null;
    }

    const filterActionName = normalizeString(measure.filter_action_name).toLowerCase();
    if (filterActionName) {
      const eventActionName = normalizeString(event.action_name).toLowerCase();
      if (eventActionName !== filterActionName) return null;
    }

    const aggregation = normalizeString(measure.aggregation);
    const field = normalizeString(measure.field);

    if (aggregation === 'percent_critical') {
      const percentField = normalizeString(measure.percent_field);
      const percentOperator = normalizeString(measure.percent_operator) || 'eq';
      const percentValue = normalizeNumber(measure.percent_value);

      if (!percentField || percentValue === null) return null;

      const eventValue = normalizeNumber(event[percentField]);
      if (eventValue === null) return null;

      let matches = false;
      if (percentOperator === 'eq') matches = eventValue === percentValue;
      else if (percentOperator === 'gte') matches = eventValue >= percentValue;
      else if (percentOperator === 'lte') matches = eventValue <= percentValue;

      if (!matches) return null;

      return { value: 1, field: percentField, kind: 'percent_critical' };
    }

    if (aggregation === 'count') {
      return { value: 1, field: 'count', kind: 'count' };
    }

    if (aggregation === 'sum' || aggregation === 'avg') {
      const fieldValue = normalizeNumber(event[field]);
      if (fieldValue === null) return null;

      return { value: fieldValue, field, kind: aggregation };
    }

    return null;
  }

  function aggregateContributions(contributions, aggregation) {
    if (!Array.isArray(contributions) || contributions.length === 0) return 0;

    const values = contributions.map((c) => c.value);

    if (aggregation === 'count' || aggregation === 'percent_critical') {
      return values.length;
    }

    if (aggregation === 'sum') {
      return values.reduce((acc, val) => acc + val, 0);
    }

    if (aggregation === 'avg') {
      const sum = values.reduce((acc, val) => acc + val, 0);
      return sum / values.length;
    }

    return 0;
  }

  function formatMeasureValue(value, measure) {
    const aggregation = normalizeString(measure.aggregation);

    if (aggregation === 'count' || aggregation === 'percent_critical') {
      return String(Math.round(value));
    }

    if (aggregation === 'sum') {
      return String(Math.round(value));
    }

    if (aggregation === 'avg') {
      return value.toFixed(1);
    }

    return String(value);
  }

  function matchEventToMeasures(event, measures, options = {}) {
    const matches = new Map();

    if (!Array.isArray(measures)) return matches;

    for (const measure of measures) {
      const contribution = matchEventToMeasure(event, measure, options);
      if (contribution) {
        matches.set(measure.id, contribution);
      }
    }

    return matches;
  }

  function normalizeMetricKey(value) {
    return normalizeString(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-');
  }

  function normalizeMetricArray(value) {
    return Array.isArray(value)
      ? value.map((item) => normalizeString(item).toLowerCase()).filter(Boolean)
      : [];
  }

  function normalizeProfileMetricResult(result) {
    if (!result || typeof result !== 'object') return null;
    const value = normalizeNumber(result.value);
    const label = normalizeString(result.label || result.value_label || result.valueLabel);
    const count = normalizeNumber(result.count);
    if (value === null && !label) return null;
    return {
      value: value ?? 0,
      label: label || String(value ?? 0),
      count,
    };
  }

  function buildMetricTargetKey(targetKind, targetId) {
    const normalizedId = normalizeString(targetId);
    if (!normalizedId) return '';
    const normalizedKind = normalizeString(targetKind || 'target').toLowerCase() || 'target';
    return `${normalizedKind}:${normalizedId}`;
  }

  function normalizeProfileMetricRankingEntry(entry, index) {
    if (!entry || typeof entry !== 'object') return null;
    const value = normalizeNumber(entry.value);
    const label = normalizeString(entry.label || entry.target_label || entry.name);
    if (value === null || !label) return null;
    const valueLabel = normalizeString(entry.value_label || entry.valueLabel || entry.label_value);
    const targetKind = normalizeString(entry.target_kind || entry.targetKind || entry.type || 'character').toLowerCase();
    const targetId = normalizeString(entry.target_id || entry.targetId || entry.id);
    return {
      key: targetId ? buildMetricTargetKey(targetKind, targetId) : normalizeString(entry.key || `ranking-${index}`),
      label,
      sourceLabel: normalizeString(entry.source_label || entry.sourceLabel || entry.detail || label),
      mapped: true,
      target_kind: targetKind,
      target_id: targetId,
      value,
      value_label: valueLabel || String(value),
      count: normalizeNumber(entry.count),
    };
  }

  function normalizeProfileMetric(metric) {
    const id = normalizeString(metric?.id || metric?.key || metric?.name);
    if (!id || metric?.live_supported === false) return null;
    const aggregation = normalizeString(metric?.aggregation || 'count').toLowerCase();
    const field = normalizeString(metric?.field || '').toLowerCase();
    const percentField = normalizeString(metric?.percent_field || metric?.percentField || metric?.field || '').toLowerCase();
    const ranking = Array.isArray(metric?.ranking)
      ? metric.ranking.map(normalizeProfileMetricRankingEntry).filter(Boolean)
      : [];

    return {
      ...metric,
      id,
      name: normalizeString(metric?.name || metric?.label || id),
      label: normalizeString(metric?.name || metric?.label || id),
      aggregation,
      field,
      percent_field: percentField,
      percentField,
      percent_operator: normalizeString(metric?.percent_operator || metric?.percentOperator || 'eq').toLowerCase(),
      percentOperator: normalizeString(metric?.percent_operator || metric?.percentOperator || 'eq').toLowerCase(),
      percent_value: metric?.percent_value ?? metric?.percentValue ?? null,
      percentValue: metric?.percent_value ?? metric?.percentValue ?? null,
      target_role: normalizeString(metric?.target_role || metric?.targetRole || 'all').toLowerCase() || 'all',
      targetRole: normalizeString(metric?.target_role || metric?.targetRole || 'all').toLowerCase() || 'all',
      filter_event_type: normalizeMetricArray(metric?.filter_event_type || metric?.filterEventType),
      filterEventType: normalizeMetricArray(metric?.filter_event_type || metric?.filterEventType),
      filter_sub_type: normalizeString(metric?.filter_sub_type || metric?.filterSubType).toLowerCase(),
      filterSubType: normalizeString(metric?.filter_sub_type || metric?.filterSubType).toLowerCase(),
      filter_skill_name: normalizeString(metric?.filter_skill_name || metric?.filterSkillName).toLowerCase(),
      filterSkillName: normalizeString(metric?.filter_skill_name || metric?.filterSkillName).toLowerCase(),
      filter_action_name: normalizeString(metric?.filter_action_name || metric?.filterActionName).toLowerCase(),
      filterActionName: normalizeString(metric?.filter_action_name || metric?.filterActionName).toLowerCase(),
      filter_player_id: normalizeString(metric?.filter_player_id || metric?.filterPlayerId),
      sortOrder: Number(metric?.sort_order ?? metric?.sortOrder) || 0,
      result: normalizeProfileMetricResult(metric?.result),
      ranking,
      rankingDimension: normalizeString(metric?.ranking_dimension || metric?.rankingDimension),
      scopeHint: normalizeString(metric?.scope_hint || metric?.scopeHint),
    };
  }

  function getProfileMetrics(profile) {
    const rawMetrics = Array.isArray(profile?.metrics)
      ? profile.metrics
      : Array.isArray(profile?.measures)
        ? profile.measures
        : [];
    return rawMetrics
      .map(normalizeProfileMetric)
      .filter(Boolean)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));
  }

  function getSelectedProfileMetric(metrics, selectedMetricId) {
    const normalizedId = normalizeString(selectedMetricId);
    return metrics.find((metric) => metric.id === normalizedId) || metrics[0] || null;
  }

  function getMetricProfileStatus(profile) {
    if (!profile?.schema_version) return 'Profil RollCodex indisponible';
    const metricCount = Array.isArray(profile.metrics)
      ? profile.metrics.length
      : Array.isArray(profile.measures)
        ? profile.measures.length
        : 0;
    if (!metricCount) return 'Aucune mesure dans le registre cible';
    if (!getProfileMetrics(profile).length) return 'Aucune mesure compatible live dans le registre';
    return '';
  }

  function isRollLikeEvent(event) {
    const actionType = normalizeString(event?.event_type || event?.action_type_hint).toLowerCase();
    return event?.roll_total != null
      || event?.roll_total_hint != null
      || event?.roll_natural != null
      || event?.roll_natural_hint != null
      || LIVE_ROLL_EVENT_TYPES.has(actionType);
  }

  function eventTypeMatchesMetricFilter(eventType, event, filter) {
    if (filter === eventType) return true;
    if (filter === 'roll') return isRollLikeEvent(event);
    if (filter === 'saving_throw' && eventType === 'save') return true;
    if (filter === 'save' && eventType === 'saving_throw') return true;
    if (filter === 'skill_check' && eventType === 'check') return true;
    if (filter === 'ability_check' && eventType === 'check') return true;
    if (filter === 'spell_attack' && eventType === 'spell') return isRollLikeEvent(event);
    if (LIVE_DAMAGE_EVENT_TYPES.has(filter)) {
      return LIVE_DAMAGE_EVENT_TYPES.has(eventType)
        || ((eventType === 'message' || eventType === 'roll' || eventType === 'attack' || eventType === 'spell_attack')
          && event?.damage_total != null);
    }
    if (LIVE_HEALING_EVENT_TYPES.has(filter)) {
      return LIVE_HEALING_EVENT_TYPES.has(eventType)
        || ((eventType === 'message' || eventType === 'roll') && event?.heal_total != null);
    }
    return false;
  }

  function eventMatchesMetricTargetRole(event, metric) {
    const targetRole = normalizeString(metric?.target_role || metric?.targetRole || 'all').toLowerCase() || 'all';
    if (targetRole === 'all') return true;
    if (targetRole === 'gm_only') return event.route_to_gm === true;
    if (targetRole === 'players_only') {
      // Inclut les jets de PJ ET les actions du GM via un PNJ/monstre (mappes
      // sur le bucket GM mais materialises par un acteur a la table). Exclut
      // uniquement les rolls "purs" GM (chat /roll sans acteur).
      const actorKind = normalizeString(event.actor_kind).toLowerCase();
      return actorKind !== '' && actorKind !== 'unknown';
    }
    if (targetRole === 'npcs_only') return event.actor_kind && event.actor_kind !== 'pc';
    return true;
  }

  function messageMatchesMetricFilter(event, metric) {
    if (!eventMatchesMetricTargetRole(event, metric)) return false;

    const filters = metric.filterEventType || metric.filter_event_type || [];
    const actionType = normalizeString(event?.event_type || event?.action_type_hint || 'message').toLowerCase();
    const matchesEventType = !filters.length || filters.some((filter) => eventTypeMatchesMetricFilter(actionType, event, filter));
    if (!matchesEventType) return false;

    const metricSubType = normalizeString(metric.filterSubType || metric.filter_sub_type).toLowerCase();
    if (metricSubType && normalizeString(event?.sub_type || event?.sub_type_hint).toLowerCase() !== metricSubType) return false;

    const metricSkillName = normalizeString(metric.filterSkillName || metric.filter_skill_name).toLowerCase();
    if (metricSkillName && normalizeString(event?.skill_name || event?.skill_name_hint).toLowerCase() !== metricSkillName) return false;

    const metricActionName = normalizeString(metric.filterActionName || metric.filter_action_name).toLowerCase();
    if (metricActionName) {
      const actionName = normalizeString(event?.action_name || event?.action_name_hint).toLowerCase();
      if (!actionName || !actionName.includes(metricActionName)) return false;
    }

    const filterPlayerId = normalizeString(metric.filter_player_id || metric.filterPlayerId);
    if (filterPlayerId && normalizeString(event?.player_id) !== filterPlayerId) return false;

    return true;
  }

  function getMetricFieldValue(event, field) {
    const normalizedField = normalizeString(field).toLowerCase();
    if (normalizedField === 'damage_total') return normalizeNumber(event?.damage_total ?? event?.damage_total_hint);
    if (normalizedField === 'heal_total') return normalizeNumber(event?.heal_total ?? event?.heal_total_hint);
    if (normalizedField === 'roll_natural') return normalizeNumber(event?.roll_natural ?? event?.roll_natural_hint);
    if (normalizedField === 'modifier') return normalizeNumber(event?.modifier);
    if (normalizedField && Object.prototype.hasOwnProperty.call(event || {}, normalizedField)) {
      return normalizeNumber(event[normalizedField]);
    }
    return normalizeNumber(event?.roll_total ?? event?.roll_total_hint);
  }

  function compareMetricPercent(value, metric) {
    const expected = normalizeNumber(metric.percentValue ?? metric.percent_value);
    if (value === null || expected === null) return false;
    const operator = normalizeString(metric.percentOperator || metric.percent_operator || 'eq').toLowerCase();
    if (operator === 'gt') return value > expected;
    if (operator === 'gte') return value >= expected;
    if (operator === 'lt') return value < expected;
    if (operator === 'lte') return value <= expected;
    if (operator === 'ne') return value !== expected;
    return value === expected;
  }

  function addMetricContribution(bucket, metric, event) {
    const aggregation = metric.aggregation || 'count';
    if (aggregation === 'percent_critical') {
      const hasCritFlag = event.is_critical === true || event.is_critical_hint === true;
      if (!isRollLikeEvent(event) && !hasCritFlag) return false;
      bucket.denominator += 1;
      if (event.roll_natural === 20 || event.roll_natural_hint === 20 || hasCritFlag) bucket.numerator += 1;
      return true;
    }
    if (aggregation === 'percent_fumble') {
      const hasFumbleFlag = event.is_fumble === true || event.is_fumble_hint === true;
      if (!isRollLikeEvent(event) && !hasFumbleFlag) return false;
      bucket.denominator += 1;
      if (event.roll_natural === 1 || event.roll_natural_hint === 1 || hasFumbleFlag) bucket.numerator += 1;
      return true;
    }
    if (aggregation === 'percent') {
      const value = getMetricFieldValue(event, metric.percentField || metric.percent_field || metric.field);
      if (value === null) return false;
      bucket.denominator += 1;
      if (compareMetricPercent(value, metric)) bucket.numerator += 1;
      return true;
    }
    if (aggregation === 'avg' || aggregation === 'average' || aggregation === 'mean') {
      const value = getMetricFieldValue(event, metric.field);
      if (value === null) return false;
      bucket.sum += value;
      bucket.count += 1;
      return true;
    }
    if (aggregation === 'sum') {
      const value = getMetricFieldValue(event, metric.field);
      if (value === null) return false;
      bucket.sum += value;
      bucket.count += 1;
      return true;
    }
    bucket.count += 1;
    return true;
  }

  function formatMetricValue(value, metric) {
    if (['percent', 'percent_critical', 'percent_fumble'].includes(metric?.aggregation)) {
      return `${Math.round(value * 10) / 10}%`;
    }
    if (['avg', 'average', 'mean'].includes(metric?.aggregation)) {
      return String(Math.round(value * 10) / 10);
    }
    return String(Math.round(value));
  }

  function metricAggregationFamily(metric) {
    const aggregation = metric?.aggregation || 'count';
    const isPercent = ['percent', 'percent_critical', 'percent_fumble'].includes(aggregation);
    const isAverage = ['avg', 'average', 'mean'].includes(aggregation);
    return {
      aggregation,
      isPercent,
      isAverage,
      isAdditive: !isPercent && !isAverage,
    };
  }

  function bucketValueForMetric(bucket, metric) {
    const family = metricAggregationFamily(metric);
    if (family.isPercent) return bucket.denominator ? (bucket.numerator / bucket.denominator) * 100 : 0;
    if (family.isAverage) return bucket.count ? bucket.sum / bucket.count : 0;
    if (family.aggregation === 'sum') return bucket.sum;
    return bucket.count;
  }

  function mergeBaselineAndLiveMetric(metric, family, baselineValue, baselineCount, liveStats) {
    const safeBaselineValue = Number(baselineValue) || 0;
    const safeBaselineCount = Number(baselineCount) || 0;
    if (family.isAdditive) {
      const liveValue = bucketValueForMetric(liveStats, metric);
      return {
        value: safeBaselineValue + liveValue,
        delta: liveValue,
        count: safeBaselineCount + (Number(liveStats?.messages) || Number(liveStats?.count) || 0),
      };
    }

    if (family.isAverage) {
      const liveCount = Number(liveStats?.count) || 0;
      if (liveCount <= 0) return { value: safeBaselineValue, delta: 0, count: safeBaselineCount };
      const totalCount = safeBaselineCount + liveCount;
      const value = totalCount > 0
        ? ((safeBaselineValue * safeBaselineCount) + (Number(liveStats?.sum) || 0)) / totalCount
        : bucketValueForMetric(liveStats, metric);
      return { value, delta: value - safeBaselineValue, count: totalCount };
    }

    if (family.isPercent) {
      const liveDenominator = Number(liveStats?.denominator) || 0;
      if (liveDenominator <= 0) return { value: safeBaselineValue, delta: 0, count: safeBaselineCount };
      const totalDenominator = safeBaselineCount + liveDenominator;
      const baselineNumerator = safeBaselineCount > 0 ? (safeBaselineValue / 100) * safeBaselineCount : 0;
      const value = totalDenominator > 0
        ? ((baselineNumerator + (Number(liveStats?.numerator) || 0)) / totalDenominator) * 100
        : bucketValueForMetric(liveStats, metric);
      return { value, delta: value - safeBaselineValue, count: totalDenominator };
    }

    const liveValue = bucketValueForMetric(liveStats, metric);
    return {
      value: safeBaselineValue + liveValue,
      delta: liveValue,
      count: safeBaselineCount + (Number(liveStats?.messages) || Number(liveStats?.count) || 0),
    };
  }

  // ==========================================================================
  // Extension RollCodex - state mesures + hooks
  // ==========================================================================

  const measuresState = {
    selectedMeasureId: null,
    liveEvents: [],
    liveEventIds: new Set(),
    messageMatches: new Map(),
  };

  function resetMeasuresState() {
    measuresState.selectedMeasureId = null;
    measuresState.liveEvents = [];
    measuresState.liveEventIds.clear();
    measuresState.messageMatches.clear();
  }

  function resetMeasureContributions() {
    measuresState.liveEvents = [];
    measuresState.liveEventIds.clear();
    measuresState.messageMatches.clear();
  }

  function getActiveMeasures() {
    const profile = globalThis.getCachedMappingProfile?.();
    if (!profile || profile.schema_version < 2) return [];
    return getProfileMetrics(profile);
  }

  function recordMeasureMatch(messageId, measureId) {
    const messageMatches = measuresState.messageMatches.get(messageId) || new Set();
    if (messageMatches.has(measureId)) return;
    messageMatches.add(measureId);
    measuresState.messageMatches.set(messageId, messageMatches);
  }

  function getGameUsers() {
    return Array.from(game.users?.contents || game.users || []);
  }

  function getCurrentGmUser() {
    const users = getGameUsers();
    return users.find((user) => user?.active && user?.isGM)
      || users.find((user) => user?.isGM)
      || (game.user?.isGM ? game.user : null);
  }

  function resolveMessageUser(message) {
    const rawUser = message?.user || message?.userId || message?.author;
    if (!rawUser) return null;
    if (typeof rawUser === 'object') return rawUser;
    return game.users?.get?.(rawUser) || getGameUsers().find((user) => String(user.id) === String(rawUser)) || null;
  }

  function findProfileMapping(profile, sourceKind, sourceKey) {
    const direct = globalThis.resolveMappingFromProfile?.(sourceKind, sourceKey);
    if (direct) return direct;
    const wantedKind = normalizeString(sourceKind).toLowerCase();
    const wantedKey = normalizeString(sourceKey).toLowerCase();
    if (!wantedKind || !wantedKey) return null;
    const mappings = Array.isArray(profile?.mappings) ? profile.mappings : [];
    return mappings.find((mapping) => {
      return normalizeString(mapping?.source_kind).toLowerCase() === wantedKind
        && normalizeString(mapping?.source_key).toLowerCase() === wantedKey;
    }) || null;
  }

  function getActorSourceKey(actor) {
    return actor?.uuid || actor?.id || '';
  }

  function getPcMetricBucket(profile, { actor, speaker, mapping }) {
    const targetId = normalizeString(mapping?.target_id);
    const targetKind = normalizeString(mapping?.target_kind || 'character').toLowerCase();
    const label = normalizeString(mapping?.target_label || actor?.name || speaker || 'Personnage');
    const actorId = normalizeString(actor?.id);
    return {
      key: targetId ? buildMetricTargetKey(targetKind || 'target', targetId) : `actor:${actorId || normalizeMetricKey(label || speaker || 'pj')}`,
      label,
      sourceLabel: normalizeString(speaker || actor?.name || label),
      mapped: Boolean(targetId),
      target_kind: targetKind || 'character',
      target_id: targetId || actorId || '',
      participant_id: targetId || actorId || '',
      participant_label: label,
      route_to_gm: false,
    };
  }

  function getGmMetricBucket(profile, { speaker, user }) {
    const gmUser = getCurrentGmUser() || user || null;
    const gmName = normalizeString(gmUser?.name || game.user?.name || 'GM');
    const gmMapping = findProfileMapping(profile, 'user', gmUser?.id)
      || findProfileMapping(profile, 'speaker', gmName);
    const targetId = normalizeString(gmMapping?.target_id || gmUser?.id || 'gm');
    const targetKind = normalizeString(gmMapping?.target_kind || 'gm').toLowerCase();
    const label = normalizeString(gmMapping?.target_label || gmName || 'GM');
    return {
      key: targetId ? buildMetricTargetKey(targetKind || 'gm', targetId) : `gm:${normalizeMetricKey(label || 'gm')}`,
      label,
      sourceLabel: normalizeString(speaker || label),
      mapped: Boolean(gmMapping?.target_id || gmUser?.id),
      target_kind: targetKind || 'gm',
      target_id: targetId,
      participant_id: targetId,
      participant_label: label,
      route_to_gm: true,
    };
  }

  function getMetricBucket(profile, event) {
    if (event.route_to_gm) {
      return getGmMetricBucket(profile, {
        speaker: event.original_speaker || event.speaker,
        user: event.user,
      });
    }
    return {
      key: event.bucket_key,
      label: event.participant_label,
      sourceLabel: event.source_label || event.original_speaker || event.speaker,
      mapped: event.mapped !== false,
      target_kind: event.target_kind,
      target_id: event.target_id,
      participant_id: event.participant_id,
      participant_label: event.participant_label,
      route_to_gm: false,
    };
  }

  function normalizeFoundryEventType(rollFigures) {
    const actionType = normalizeString(rollFigures?.actionType).toLowerCase();
    if (actionType && actionType !== 'auto' && actionType !== 'other') return actionType;
    if (rollFigures?.damageHint) return 'damage';
    if (rollFigures?.healHint) return 'healing';
    if (rollFigures?.count) return 'roll';
    return 'message';
  }

  function buildLiveEventFromMessage(message, profile) {
    const messageId = String(message.id || message._id || '');
    if (!messageId || measuresState.liveEventIds.has(messageId)) return null;

    const actor = globalThis.resolveMessageActor?.(message);
    const user = resolveMessageUser(message);
    const rollFigures = globalThis.extractRollFigures?.(message);
    if (!rollFigures) return null;

    const actorKind = normalizeString(
      actor ? globalThis.inferRollCodexActorKind?.(actor) : '',
    ).toLowerCase();
    const isPlayerCharacter = actorKind === 'pc';
    const speaker = normalizeString(message.speaker?.alias || actor?.name || user?.name || 'Foundry');
    const sourceKey = getActorSourceKey(actor) || speaker;
    const mapping = isPlayerCharacter && sourceKey ? findProfileMapping(profile, 'actor', sourceKey) : null;
    const bucket = isPlayerCharacter
      ? getPcMetricBucket(profile, { actor, speaker, mapping })
      : getGmMetricBucket(profile, { speaker, user });
    const eventType = normalizeFoundryEventType(rollFigures);
    const actionName = normalizeString(rollFigures.actionName || message.flavor || 'Action');
    const rollNatural = normalizeNumber(rollFigures.rollNatural) ?? (rollFigures.nat20 > 0 ? 20 : null);

    return {
      id: messageId,
      message_id: messageId,
      event_type: eventType,
      action_type_hint: eventType,
      action_name: actionName,
      action_name_hint: actionName,
      roll_total: normalizeNumber(rollFigures.rollTotal ?? rollFigures.total),
      roll_total_hint: normalizeNumber(rollFigures.rollTotal ?? rollFigures.total),
      roll_natural: rollNatural,
      roll_natural_hint: rollNatural,
      damage_total: normalizeNumber(rollFigures.damageHint),
      damage_total_hint: normalizeNumber(rollFigures.damageHint),
      heal_total: normalizeNumber(rollFigures.healHint),
      heal_total_hint: normalizeNumber(rollFigures.healHint),
      is_critical: rollFigures.isCritical === true || rollFigures.nat20 > 0,
      is_critical_hint: rollFigures.isCritical === true || rollFigures.nat20 > 0,
      is_fumble: rollFigures.isFumble === true,
      is_fumble_hint: rollFigures.isFumble === true,
      speaker: bucket.route_to_gm ? bucket.label : speaker,
      original_speaker: speaker,
      source_label: bucket.sourceLabel,
      participant_id: bucket.participant_id || null,
      participant_label: bucket.participant_label || 'Non resolu',
      target_kind: bucket.target_kind,
      target_id: bucket.target_id,
      target_label: bucket.participant_label,
      character_id: bucket.target_kind === 'character' ? bucket.target_id : null,
      player_id: bucket.target_kind === 'player' ? bucket.target_id : null,
      actor_id: actor?.id || null,
      actor_kind: actorKind || 'unknown',
      user_id: user?.id || null,
      sub_type: '',
      sub_type_hint: '',
      skill_name: '',
      skill_name_hint: '',
      mapped: bucket.mapped,
      bucket_key: bucket.key,
      route_to_gm: bucket.route_to_gm,
      user,
    };
  }

  let throttleRefreshTimer = null;
  let throttleRebuildTimer = null;

  function throttledRefreshLivePanels() {
    if (throttleRefreshTimer) return;
    throttleRefreshTimer = setTimeout(() => {
      if (globalThis.refreshLivePanels) globalThis.refreshLivePanels();
      throttleRefreshTimer = null;
    }, 250);
  }

  function throttledRebuildFromHistory() {
    if (throttleRebuildTimer) return;
    throttleRebuildTimer = setTimeout(() => {
      throttleRebuildTimer = null;
      const messages = globalThis.getRollCodexLiveBackfillMessages?.()
        || Array.from(game.messages?.contents || []);
      rebuildFromMessages(messages);
    }, 250);
  }

  function processMessageForMeasures(message) {
    const profile = globalThis.getCachedMappingProfile?.();
    if (!profile) return;
    const measures = getProfileMetrics(profile);
    if (measures.length === 0) return;

    const event = buildLiveEventFromMessage(message, profile);
    if (!event) return;

    measuresState.liveEventIds.add(event.message_id);
    measuresState.liveEvents.push(event);

    const debug = globalThis.RollCodexDebug === true;
    const matched = [];
    const rejected = [];

    for (const measure of measures) {
      const scratch = { count: 0, sum: 0, numerator: 0, denominator: 0, messages: 0 };
      const filterOk = messageMatchesMetricFilter(event, measure);
      if (!filterOk) {
        if (debug) rejected.push({ id: measure.id, name: measure.name, reason: 'filter' });
        continue;
      }
      const contributed = addMetricContribution(scratch, measure, event);
      if (!contributed) {
        if (debug) rejected.push({ id: measure.id, name: measure.name, reason: 'no_field_value' });
        continue;
      }
      recordMeasureMatch(event.message_id, measure.id);
      if (debug) matched.push({ id: measure.id, name: measure.name, scratch });
    }

    if (debug) {
      console.debug('[RollCodex Measures] processed', {
        message_id: event.message_id,
        event_type: event.event_type,
        actor_kind: event.actor_kind,
        participant: event.participant_label,
        roll_total: event.roll_total,
        damage_total: event.damage_total,
        heal_total: event.heal_total,
        route_to_gm: event.route_to_gm,
        matched,
        rejected,
      });
    }

    throttledRefreshLivePanels();
  }

  function getMeasureMatchesForSnapshot() {
    const result = [];

    for (const [messageId, measureIds] of measuresState.messageMatches.entries()) {
      result.push({
        message_id: messageId,
        measure_ids: Array.from(measureIds),
      });
    }

    return result;
  }

  function computeLiveDeltaForMetric(profile, metric) {
    const buckets = new Map();
    const totals = { count: 0, sum: 0, numerator: 0, denominator: 0, messages: 0 };
    if (!metric) return { buckets, totals };

    measuresState.liveEvents.forEach((event) => {
      if (!messageMatchesMetricFilter(event, metric)) return;
      const bucketInfo = getMetricBucket(profile, event);
      const bucket = buckets.get(bucketInfo.key) || {
        ...bucketInfo,
        count: 0,
        sum: 0,
        numerator: 0,
        denominator: 0,
        messages: 0,
      };
      const before = {
        count: bucket.count,
        sum: bucket.sum,
        numerator: bucket.numerator,
        denominator: bucket.denominator,
      };
      const contributed = addMetricContribution(bucket, metric, event);
      if (!contributed) return;
      bucket.messages += 1;
      totals.messages += 1;
      totals.count += bucket.count - before.count;
      totals.sum += bucket.sum - before.sum;
      totals.numerator += bucket.numerator - before.numerator;
      totals.denominator += bucket.denominator - before.denominator;
      buckets.set(bucketInfo.key, bucket);
    });

    return { buckets, totals };
  }

  function findBaselineEntryForBucket(baselineRanking, bucket) {
    const bucketSource = normalizeMetricKey(bucket.sourceLabel);
    const bucketLabel = normalizeMetricKey(bucket.label);
    return baselineRanking.find((entry) => {
      const entrySource = normalizeMetricKey(entry.sourceLabel);
      const entryLabel = normalizeMetricKey(entry.label);
      return (bucketSource && entrySource === bucketSource)
        || (bucketLabel && entryLabel === bucketLabel);
    }) || null;
  }

  function computeBaselinePlusLive(profile, metric) {
    if (!metric) return { metricResult: null, leaderboard: [] };

    const baselineResult = metric.result || null;
    const baselineRanking = Array.isArray(metric.ranking) ? metric.ranking : [];
    const { buckets, totals } = computeLiveDeltaForMetric(profile, metric);
    const family = metricAggregationFamily(metric);

    const baselineValue = Number(baselineResult?.value) || 0;
    const baselineCount = Number(baselineResult?.count) || 0;
    const mergedGlobal = mergeBaselineAndLiveMetric(metric, family, baselineValue, baselineCount, totals);
    const totalDelta = mergedGlobal.delta;
    const mergedValue = mergedGlobal.value;
    const hasDelta = Math.abs(totalDelta) > 0.01 || totals.messages > 0;
    const deltaLabel = Math.abs(totalDelta) > 0.01
      ? `${totalDelta > 0 ? '+' : '-'}${formatMetricValue(Math.abs(totalDelta), metric)}`
      : '';
    const metricResult = baselineResult || hasDelta ? {
      value: mergedValue,
      label: formatMetricValue(mergedValue, metric),
      count: mergedGlobal.count,
      delta_value: totalDelta,
      delta_label: deltaLabel,
      delta_count: totals.messages,
      has_delta: hasDelta,
    } : null;

    const merged = new Map();
    baselineRanking.forEach((entry) => {
      const key = entry.key || `baseline-${merged.size}`;
      merged.set(key, {
        key,
        label: entry.label,
        sourceLabel: entry.sourceLabel || entry.label,
        mapped: entry.mapped !== false,
        baseline_value: Number(entry.value) || 0,
        baseline_count: Number(entry.count) || 0,
        baseline_label: entry.value_label || formatMetricValue(Number(entry.value) || 0, metric),
        delta_value: 0,
        delta_messages: 0,
        merged_count: Number(entry.count) || 0,
      });
    });

    for (const [bucketKey, bucket] of buckets.entries()) {
      let entry = merged.get(bucketKey);
      if (!entry) {
        const matched = findBaselineEntryForBucket(Array.from(merged.values()), bucket);
        if (matched) entry = matched;
      }
      if (entry) {
        const mergedEntry = mergeBaselineAndLiveMetric(metric, family, entry.baseline_value, entry.baseline_count, bucket);
        entry.delta_value = mergedEntry.delta;
        entry.delta_messages = bucket.messages;
        entry.merged_count = mergedEntry.count;
      } else {
        const mergedBucket = mergeBaselineAndLiveMetric(metric, family, 0, 0, bucket);
        merged.set(bucketKey, {
          key: bucketKey,
          label: bucket.label,
          sourceLabel: bucket.sourceLabel,
          mapped: bucket.mapped,
          baseline_value: 0,
          baseline_count: 0,
          baseline_label: '',
          delta_value: mergedBucket.value,
          delta_messages: bucket.messages,
          merged_count: mergedBucket.count,
        });
      }
    }

    const leaderboard = Array.from(merged.values()).map((entry) => {
      const finalValue = entry.baseline_value + entry.delta_value;
      const entryHasDelta = Math.abs(entry.delta_value) > 0.01 || entry.delta_messages > 0;
      const entryDeltaLabel = Math.abs(entry.delta_value) > 0.01
        ? `${entry.delta_value > 0 ? '+' : '-'}${formatMetricValue(Math.abs(entry.delta_value), metric)}`
        : '';
      return {
        key: entry.key,
        label: entry.label,
        participant_label: entry.label,
        sourceLabel: entry.sourceLabel,
        mapped: entry.mapped,
        resolved: entry.mapped !== false,
        baseline_value: entry.baseline_value,
        baseline_label: entry.baseline_label,
        value: finalValue,
        value_label: formatMetricValue(finalValue, metric),
        valueLabel: formatMetricValue(finalValue, metric),
        delta_value: entry.delta_value,
        delta_label: entryDeltaLabel,
        deltaLabel: entryDeltaLabel,
        delta_messages: entry.delta_messages,
        has_delta: entryHasDelta,
        merged_count: entry.merged_count,
      };
    });

    return {
      metricResult,
      leaderboard: leaderboard
        .filter((entry) => Number(entry.value) > 0 || entry.has_delta)
        .sort((left, right) => (right.value - left.value)
          || (right.delta_value - left.delta_value)
          || left.label.localeCompare(right.label))
        .slice(0, 10),
    };
  }

  function getSelectedMeasureData() {
    const profile = globalThis.getCachedMappingProfile?.();
    const measures = profile ? getProfileMetrics(profile) : [];
    const selected = getSelectedProfileMetric(measures, measuresState.selectedMeasureId);

    if (!selected) {
      return {
        measure: null,
        ranking: [],
        leaderboard: [],
        metricResult: null,
        metric_result: null,
        profileMetrics: measures,
        metricStatus: getMetricProfileStatus(profile),
      };
    }

    const merged = computeBaselinePlusLive(profile, selected);

    return {
      measure: selected,
      metric: selected,
      ranking: merged.leaderboard,
      leaderboard: merged.leaderboard,
      metricResult: merged.metricResult,
      metric_result: merged.metricResult,
      profileMetrics: measures,
      metricStatus: getMetricProfileStatus(profile),
    };
  }

  function rebuildFromMessages(messages) {
    resetMeasureContributions();
    (messages || []).forEach((message) => {
      try {
        processMessageForMeasures(message);
      } catch (error) {
        console.warn('[RollCodex Measures] History processing failed', error);
      }
    });
    throttledRefreshLivePanels();
  }

  Hooks.once('init', () => {
    game.settings.register('rollcodex', 'selectedMeasureId', {
      scope: 'client',
      config: false,
      type: String,
      default: '',
    });
  });

  Hooks.once('ready', () => {
    measuresState.selectedMeasureId = String(game.settings.get('rollcodex', 'selectedMeasureId') || '');

    Hooks.on('createChatMessage', (message) => {
      try {
        processMessageForMeasures(message);
      } catch (error) {
        console.warn('[RollCodex Measures] Processing failed', error);
      }
    });

    Hooks.on('updateChatMessage', () => {
      try {
        throttledRebuildFromHistory();
      } catch (error) {
        console.warn('[RollCodex Measures] Rebuild on update failed', error);
      }
    });

    globalThis.RollCodexMeasures = {
      get selectedMeasureId() {
        return measuresState.selectedMeasureId || '';
      },
      resetState: resetMeasuresState,
      resetContributions: resetMeasureContributions,
      getActiveMeasures,
      getSelectedMeasureData,
      getMeasureMatchesForSnapshot,
      processMessage: processMessageForMeasures,
      rebuildFromMessages,
      selectMeasure: async (measureId) => {
        measuresState.selectedMeasureId = measureId || '';
        await game.settings.set('rollcodex', 'selectedMeasureId', measuresState.selectedMeasureId);
        if (globalThis.refreshLivePanels) globalThis.refreshLivePanels();
      },
    };

    const initialMessages = globalThis.getRollCodexLiveBackfillMessages?.()
      || Array.from(game.messages?.contents || []);
    rebuildFromMessages(initialMessages);

    console.log('[RollCodex] Measures extension ready');
  });
})();
