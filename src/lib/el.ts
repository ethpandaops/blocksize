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
  /** RLP block size cap after safety margin (EIP-7934), or null pre-osaka. */
  maxBlockBytes: number | null;
}

/** Rough RLP header + withdrawals allowance inside the EIP-7934 budget. */
const EL_BLOCK_OVERHEAD_BYTES = 2048;

/**
 * Cheapest achievable gas cost of one EL-triggered deposit, from the
 * EIP-6110 security considerations: 15,650 gas of deposit-contract
 * execution + 6,900 for the value-bearing CALL + ~1,000 of amortized
 * batching overhead. A contract-execution cost rather than a protocol
 * constant — but it is the only per-payload bound on deposit requests:
 * the deposit contract has no dequeue cap (unlike EIP-7002/7251 system
 * contracts), and gloas drops the CL list limit too (EIP-7688
 * progressive lists).
 */
export const GAS_PER_DEPOSIT_REQUEST = 23_550;

/** Most deposit requests one payload's gas can pay for. */
export function maxDepositRequests(gasLimit: number): number {
  return Math.floor(gasLimit / GAS_PER_DEPOSIT_REQUEST);
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
    maxBlockBytes: firstConstant(fork, ['MAX_RLP_BLOCK_SIZE'], null),
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

/**
 * Typical-mainnet payload rates, measured from xatu canonical beacon
 * blocks (7 days to 2026-07-16, 50,139 blocks: avg 381 txs and 182,325
 * serialized tx bytes per 30.3M gas used). Empirical by nature — the
 * transaction mix is user behavior, not protocol — and expressed per
 * million gas so they scale with the gas limit.
 */
export const TYPICAL_TXS_PER_MGAS = 12.6;
export const TYPICAL_TX_BYTES_PER_MGAS = 6015;

export interface PayloadPlan {
  txCount: number;
  /** Calldata bytes for each transaction (remainder spread over the first txs). */
  calldataPerTx: number[];
  totalCalldataBytes: number;
  totalTxBytes: number;
  /** Gas-capacity ceilings for the current configuration, for UI ranges. */
  maxTxCount: number;
  maxCalldataBytes: number;
}

export interface PayloadShape {
  /** Explicit transaction count; null = typical-mainnet rate. */
  txCount: number | null;
  /** Explicit total calldata bytes; null = typical-mainnet rate. */
  calldataBytes: number | null;
  scenario: CalldataScenario;
}

/**
 * Plan the execution payload: how many transactions, carrying how much
 * calldata. Defaults follow measured mainnet rates; explicit values are
 * clamped to what the gas limit can actually pay for (intrinsic cost per
 * transaction, floor-priced calldata, per-tx gas cap).
 */
export function planPayload(
  model: ElModel,
  gasLimit: number,
  shape: PayloadShape,
  txListLimit: number,
  /** Non-transaction bytes inside the EL block (the EIP-7928 BAL), which
   * consume EIP-7934 budget alongside calldata. */
  reservedBlockBytes = 0,
): PayloadPlan {
  const perByte = gasPerByte(model, shape.scenario);
  const txCapacity = Math.floor(gasLimit / model.txBaseCost);
  const maxTxCount = Math.min(txCapacity, txListLimit);
  if (maxTxCount === 0) {
    return {
      txCount: 0,
      calldataPerTx: [],
      totalCalldataBytes: 0,
      totalTxBytes: 0,
      maxTxCount: 0,
      maxCalldataBytes: 0,
    };
  }

  const typicalTxs = Math.round((gasLimit / 1_000_000) * TYPICAL_TXS_PER_MGAS);
  const txCount = Math.min(maxTxCount, Math.max(1, shape.txCount ?? typicalTxs));

  // Gas left after intrinsic costs buys calldata at the floor price; the
  // per-tx gas cap bounds how much any one transaction can carry.
  const calldataGas = gasLimit - txCount * model.txBaseCost;
  let maxCalldataBytes = Math.max(0, Math.floor(calldataGas / perByte));
  if (model.txMaxGasLimit !== null) {
    const perTxBytes = Math.floor((model.txMaxGasLimit - model.txBaseCost) / perByte);
    maxCalldataBytes = Math.min(maxCalldataBytes, txCount * perTxBytes);
  }
  if (model.maxBlockBytes !== null) {
    // EIP-7934: the RLP block size cap binds before gas does once the
    // limit is large enough (e.g. 300M gas of zero-byte calldata).
    const byteBudget =
      model.maxBlockBytes -
      reservedBlockBytes -
      txCount * TX_ENVELOPE_BYTES -
      EL_BLOCK_OVERHEAD_BYTES;
    maxCalldataBytes = Math.min(maxCalldataBytes, Math.max(0, byteBudget));
  }

  const typicalCalldata = Math.max(
    0,
    Math.round((gasLimit / 1_000_000) * TYPICAL_TX_BYTES_PER_MGAS - txCount * TX_ENVELOPE_BYTES),
  );
  const totalCalldataBytes = Math.min(
    maxCalldataBytes,
    Math.max(0, shape.calldataBytes ?? typicalCalldata),
  );

  const base = Math.floor(totalCalldataBytes / txCount);
  const remainder = totalCalldataBytes - base * txCount;
  const calldataPerTx = new Array<number>(txCount).fill(base);
  for (let i = 0; i < remainder; i++) calldataPerTx[i] += 1;

  return {
    txCount,
    calldataPerTx,
    totalCalldataBytes,
    totalTxBytes: totalCalldataBytes + txCount * TX_ENVELOPE_BYTES,
    maxTxCount,
    maxCalldataBytes,
  };
}

/** The data-stuffing worst case: fewest envelopes, every byte the gas can buy. */
export function stuffedPayloadShape(
  model: ElModel,
  gasLimit: number,
  scenario: CalldataScenario,
): { txCount: number; calldataBytes: number } {
  const txGas = Math.min(model.txMaxGasLimit ?? gasLimit, gasLimit);
  const txCount = Math.max(1, Math.ceil(gasLimit / Math.max(txGas, 1)));
  const plan = planPayload(model, gasLimit, { txCount, calldataBytes: null, scenario }, 1 << 20);
  return { txCount, calldataBytes: plan.maxCalldataBytes };
}
