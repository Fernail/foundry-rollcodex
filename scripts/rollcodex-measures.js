/* global Hooks, game */
/**
 * RollCodex Measures Extension - Phase 1b (v0.1.20)
 *
 * Extension du module Foundry pour supporter les mesures workspace du profil v2.
 * Ce module etend les fonctionnalites live de rollcodex.js sans le modifier directement.
 *
 * Copie inline de src/lib/vtt/measureMatcher.js (source de verite pour les tests).
 * Les signatures doivent rester synchronisees.
 *
 * @version 0.1.20 - Phase 1b (2026-05-17)
 */

(() => {
  'use strict';

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

  // ==========================================================================
  // Extension RollCodex - state mesures + hooks
  // ==========================================================================

  const measuresState = {
    selectedMeasureId: null,
    participantContributions: new Map(),
    messageMatches: new Map(),
  };

  function resetMeasuresState() {
    measuresState.selectedMeasureId = null;
    measuresState.participantContributions.clear();
    measuresState.messageMatches.clear();
  }

  function getActiveMeasures() {
    const profile = globalThis.getCachedMappingProfile?.();
    if (!profile || profile.schema_version < 2) return [];
    return Array.isArray(profile.measures) ? profile.measures : [];
  }

  function recordMeasureContribution(messageId, participant_id, participant_label, measureId, contribution) {
    measuresState.messageMatches.set(messageId, measuresState.messageMatches.get(messageId) || new Set());
    measuresState.messageMatches.get(messageId).add(measureId);

    const key = `${measureId}:${participant_id || 'unresolved'}`;
    if (!measuresState.participantContributions.has(key)) {
      measuresState.participantContributions.set(key, {
        measureId,
        participant_id,
        participant_label,
        contributions: [],
      });
    }

    measuresState.participantContributions.get(key).contributions.push(contribution);
  }

  function buildMeasureRanking(measureId, measure) {
    const ranking = [];
    const aggregation = normalizeString(measure.aggregation);

    for (const [key, data] of measuresState.participantContributions.entries()) {
      if (!key.startsWith(`${measureId}:`)) continue;

      const aggregatedValue = aggregateContributions(data.contributions, aggregation);
      ranking.push({
        participant_id: data.participant_id || null,
        participant_label: data.participant_label || 'Non resolu',
        value: aggregatedValue,
        valueLabel: formatMeasureValue(aggregatedValue, measure),
        resolved: Boolean(data.participant_id),
      });
    }

    ranking.sort((a, b) => {
      if (aggregation === 'avg' && a.value !== b.value) return b.value - a.value;
      if (aggregation !== 'avg' && a.value !== b.value) return b.value - a.value;
      return a.participant_label.localeCompare(b.participant_label);
    });

    return ranking.slice(0, 10);
  }

  let throttleRefreshTimer = null;

  function throttledRefreshLivePanels() {
    if (throttleRefreshTimer) return;
    throttleRefreshTimer = setTimeout(() => {
      if (globalThis.refreshLivePanels) globalThis.refreshLivePanels();
      throttleRefreshTimer = null;
    }, 250);
  }

  function processMessageForMeasures(message) {
    const measures = getActiveMeasures();
    if (measures.length === 0) return;

    const profile = globalThis.getCachedMappingProfile?.();
    if (!profile) return;

    const messageId = String(message.id || '');
    if (!messageId) return;

    const actor = globalThis.resolveMessageActor?.(message);
    const rollFigures = globalThis.extractRollFigures?.(message);
    if (!rollFigures) return;

    const sourceKey = actor?.uuid || actor?.id || message.speaker?.alias || '';
    const mapping = sourceKey ? globalThis.resolveMappingFromProfile?.('actor', sourceKey) : null;

    const participantId = mapping?.target_id || null;
    const participantLabel = mapping?.target_label || message.speaker?.alias || 'Inconnu';

    const event_type = 'generic';
    const action_name = message.flavor || 'Action';
    const roll_total = rollFigures.total || null;
    const roll_natural = rollFigures.nat20 > 0 ? 20 : null;
    const damage_total = rollFigures.damageHint || null;
    const heal_total = null;
    const speaker = message.speaker?.alias || '';
    const sub_type = '';
    const skill_name = '';

    const vttEvent = {
      event_type,
      action_name,
      roll_total,
      roll_natural,
      damage_total,
      heal_total,
      speaker,
      participant_id: participantId,
      participant_label: participantLabel,
      sub_type,
      skill_name,
    };

    const gmUser = game.users?.find?.((u) => u.isGM && u.active);
    const gmUserId = gmUser?.id || null;

    const npcActorIds = new Set(
      Array.from(game.actors || [])
        .filter((a) => a.type === 'npc' && !a.hasPlayerOwner)
        .map((a) => a.id),
    );

    const matches = matchEventToMeasures(vttEvent, measures, { gmUserId, npcActorIds });

    for (const [measureId, contribution] of matches.entries()) {
      recordMeasureContribution(messageId, participantId, participantLabel, measureId, contribution);
    }
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

  function getSelectedMeasureData() {
    const measures = getActiveMeasures();
    const selected = measures.find((m) => m.id === measuresState.selectedMeasureId) || measures[0] || null;

    if (!selected) {
      return {
        measure: null,
        ranking: [],
      };
    }

    const ranking = buildMeasureRanking(selected.id, selected);

    return {
      measure: selected,
      ranking,
    };
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

    globalThis.RollCodexMeasures = {
      resetState: resetMeasuresState,
      getActiveMeasures,
      getSelectedMeasureData,
      getMeasureMatchesForSnapshot,
      selectMeasure: async (measureId) => {
        measuresState.selectedMeasureId = measureId || '';
        await game.settings.set('rollcodex', 'selectedMeasureId', measuresState.selectedMeasureId);
        if (globalThis.refreshLivePanels) globalThis.refreshLivePanels();
      },
    };

    console.log('[RollCodex] Measures extension (v0.1.14) ready');
  });
})();
