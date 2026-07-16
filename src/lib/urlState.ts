/**
 * Bidirectional mapping between app state and URL query params, so any
 * configuration is linkable. Only values that differ from the fork's
 * typical defaults are encoded, keeping URLs short.
 *
 * Example: ?fork=gloas&gas=300000000&cd=zeros&k.attestations=2
 */

import type { CalldataScenario } from './el';
import { discoverKnobs } from './knobs';
import type { UserState } from './model';
import { DEFAULTS, typicalKnobValues } from './presets';
import type { ConsensusSpec } from './schema';

const SCENARIOS: CalldataScenario[] = ['zeros', 'mixed', 'random'];
const KNOB_PREFIX = 'k.';
const PATH_PREFIX = 'message.body.';

function shortPath(path: string): string {
  return path.startsWith(PATH_PREFIX) ? path.slice(PATH_PREFIX.length) : path;
}

export function encodeState(spec: ConsensusSpec, state: UserState): string {
  const params = new URLSearchParams();
  params.set('fork', state.fork);
  if (state.activeValidators !== DEFAULTS.activeValidators) {
    params.set('v', String(state.activeValidators));
  }
  if (state.gasLimit !== DEFAULTS.gasLimit) {
    params.set('gas', String(state.gasLimit));
  }
  if (state.scenario !== 'mixed') {
    params.set('cd', state.scenario);
  }
  if (state.balBytes !== null && state.balBytes !== undefined) {
    params.set('bal', String(state.balBytes));
  }
  if (state.txCount !== null && state.txCount !== undefined) {
    params.set('tx', String(state.txCount));
  }
  if (state.calldataBytes !== null && state.calldataBytes !== undefined) {
    params.set('cal', String(state.calldataBytes));
  }
  const knobs = discoverKnobs(spec, state.fork);
  const defaults = typicalKnobValues(spec, state.fork, knobs);
  for (const knob of knobs) {
    const value = state.knobValues[knob.path] ?? 0;
    if (value !== (defaults[knob.path] ?? 0)) {
      params.set(KNOB_PREFIX + shortPath(knob.path), String(value));
    }
  }
  return params.toString();
}

function intParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function decodeState(spec: ConsensusSpec, search: string, fallbackFork: string): UserState {
  const params = new URLSearchParams(search);
  const forkParam = params.get('fork');
  const fork = forkParam !== null && spec.forks[forkParam] !== undefined ? forkParam : fallbackFork;

  const knobs = discoverKnobs(spec, fork);
  const knobValues = typicalKnobValues(spec, fork, knobs);
  for (const knob of knobs) {
    const value = intParam(params, KNOB_PREFIX + shortPath(knob.path));
    if (value !== null) knobValues[knob.path] = Math.min(value, knob.max);
  }

  const scenarioParam = params.get('cd');
  return {
    fork,
    activeValidators: intParam(params, 'v') ?? DEFAULTS.activeValidators,
    gasLimit: intParam(params, 'gas') ?? DEFAULTS.gasLimit,
    scenario: SCENARIOS.includes(scenarioParam as CalldataScenario)
      ? (scenarioParam as CalldataScenario)
      : 'mixed',
    balBytes: intParam(params, 'bal'),
    txCount: intParam(params, 'tx'),
    calldataBytes: intParam(params, 'cal'),
    knobValues,
  };
}
