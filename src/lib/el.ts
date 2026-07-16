/**
 * Execution-layer gas→bytes model, driven by constants extracted from
 * execution-specs (EELS). No hardcoded MiB-per-gas ratios: byte capacity
 * follows from intrinsic calldata pricing, and EIP-7623 participation is
 * detected by the presence of FLOOR_CALLDATA_COST in the fork's constants.
 */

import type { ElFork, ElSpec } from './schema';
import { toNumber } from './schema';

export type CalldataScenario = 'zeros' | 'random' | 'mixed';

/** Fraction of zero bytes in "mixed" calldata (historical mainnet average). */
export const MIXED_ZERO_FRACTION = 0.29;

/**
 * Approximate serialized overhead of a transaction envelope besides its
 * calldata: signature (~67 bytes), nonce, gas fields, to, value, chain id.
 */
export const TX_ENVELOPE_BYTES = 150;

export interface ElModel {
  fork: ElFork;
  txBaseCost: number;
  /** gas per calldata token under standard pricing (EIP-2028: 4). */
  standardTokenCost: number;
  /** gas per token under the EIP-7623 floor, or null pre-7623. */
  floorTokenCost: number | null;
  /** per-transaction gas cap (EIP-7825), or null when uncapped. */
  txMaxGasLimit: number | null;
}

export function latestElFork(spec: ElSpec): ElFork {
  return spec.forks[spec.forks.length - 1];
}

/**
 * First matching constant across naming generations: EELS module-level
 * names through prague/osaka, and amsterdam's GasCosts members
 * (EIP-7778 gas schedule restructuring).
 */
export function firstConstant(
  fork: ElFork,
  names: string[],
  fallback: number | null,
): number | null {
  for (const name of names) {
    if (fork.constants[name] !== undefined) return toNumber(fork.constants[name]);
  }
  return fallback;
}

export function elModelFor(fork: ElFork): ElModel {
  return {
    fork,
    txBaseCost: firstConstant(fork, ['TX_BASE_COST', 'TX_BASE'], 21000)!,
    standardTokenCost: firstConstant(
      fork,
      ['STANDARD_CALLDATA_TOKEN_COST', 'TX_DATA_TOKEN_STANDARD', 'TX_DATA_COST_PER_ZERO'],
      4,
    )!,
    floorTokenCost: firstConstant(fork, ['FLOOR_CALLDATA_COST', 'TX_DATA_TOKEN_FLOOR'], null),
    txMaxGasLimit: firstConstant(fork, ['TX_MAX_GAS_LIMIT'], null),
  };
}

/** Not yet scheduled on mainnet (in-development fork, e.g. amsterdam). */
export function isUpcoming(fork: ElFork): boolean {
  return fork.criteria.value === null;
}

/** Calldata tokens per byte for a scenario (zero byte = 1, non-zero = 4). */
export function tokensPerByte(scenario: CalldataScenario): number {
  switch (scenario) {
    case 'zeros':
      return 1;
    case 'random':
      return 4;
    case 'mixed':
      return MIXED_ZERO_FRACTION * 1 + (1 - MIXED_ZERO_FRACTION) * 4;
  }
}

/** Gas consumed per calldata byte when stuffing data (no execution). */
export function gasPerByte(model: ElModel, scenario: CalldataScenario): number {
  const tokens = tokensPerByte(scenario);
  // With no execution gas, EIP-7623 charges max(standard, floor) = floor.
  const perToken = model.floorTokenCost ?? model.standardTokenCost;
  return tokens * perToken;
}

export interface PayloadPlan {
  txCount: number;
  /** Calldata bytes for each transaction (remainder spread over the first txs). */
  calldataPerTx: number[];
  totalCalldataBytes: number;
  totalTxBytes: number;
}

/**
 * Plan a data-stuffing payload: as many calldata bytes as the gas limit
 * allows, split into transactions honoring the per-tx gas cap.
 */
export function planPayload(
  model: ElModel,
  gasLimit: number,
  scenario: CalldataScenario,
  maxTxCount: number,
): PayloadPlan {
  const perByte = gasPerByte(model, scenario);
  const txGas = Math.min(model.txMaxGasLimit ?? gasLimit, gasLimit);
  if (txGas <= model.txBaseCost) {
    return { txCount: 0, calldataPerTx: [], totalCalldataBytes: 0, totalTxBytes: 0 };
  }
  let txCount = Math.max(1, Math.floor(gasLimit / txGas));
  txCount = Math.min(txCount, maxTxCount);

  const bytesPerFullTx = Math.floor((txGas - model.txBaseCost) / perByte);
  const remainderGas = gasLimit - txCount * txGas;
  const calldataPerTx = new Array<number>(txCount).fill(bytesPerFullTx);
  if (remainderGas > model.txBaseCost && txCount < maxTxCount) {
    calldataPerTx.push(Math.floor((remainderGas - model.txBaseCost) / perByte));
    txCount += 1;
  }
  const totalCalldataBytes = calldataPerTx.reduce((a, b) => a + b, 0);
  return {
    txCount,
    calldataPerTx,
    totalCalldataBytes,
    totalTxBytes: totalCalldataBytes + txCount * TX_ENVELOPE_BYTES,
  };
}
