import { useEffect, useMemo, useState } from 'react';
import consensusJson from '../spec-data/consensus.json';
import elJson from '../spec-data/el.json';
import { BreakdownTable, type BreakdownRow } from './components/BreakdownTable';
import { CompositionBar } from './components/CompositionBar';
import { Controls } from './components/Controls';
import { ForkRail } from './components/ForkRail';
import { InfoCards } from './components/InfoCards';
import { StatTiles } from './components/StatTiles';
import type { CalldataScenario } from './lib/el';
import { stuffedPayloadShape } from './lib/el';
import { formatCount } from './lib/format';
import { discoverKnobs } from './lib/knobs';
import {
  balWorstCaseBytes,
  computeBlockSize,
  type BlockSizeResult,
  type UserState,
} from './lib/model';
import { landingFork, typicalKnobValues, worstCaseKnobValues } from './lib/presets';
import type { ConsensusSpec, ElSpec } from './lib/schema';
import { decodeState, encodeState } from './lib/urlState';
import { useDebouncedValue } from './lib/useDebouncedValue';

const spec = consensusJson as unknown as ConsensusSpec;
const elSpec = elJson as unknown as ElSpec;

function ShareButton() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = window.location.href;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Async clipboard denied (permissions, non-secure context): fall
      // back to a selection-based copy.
      const scratch = document.createElement('textarea');
      scratch.value = url;
      document.body.appendChild(scratch);
      scratch.select();
      ok = document.execCommand('copy');
      scratch.remove();
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="ml-auto rounded-sm border border-hairline px-2.5 py-1 text-xs/5 text-ink-2 transition-colors hover:border-ink-muted hover:text-ink"
    >
      {copied ? 'Copied!' : 'Share this config'}
    </button>
  );
}

function blockRows(result: BlockSizeResult, knobValues: Record<string, number>): BreakdownRow[] {
  return result.breakdown.map((f) => {
    const knobPath = Object.keys(knobValues).find((p) => p.endsWith(`.${f.name}`));
    const count =
      knobPath !== undefined
        ? formatCount(knobValues[knobPath])
        : f.name === 'execution_payload'
          ? formatCount(result.payloadPlan?.txCount ?? 0)
          : '—';
    return { name: f.name, count, bytes: f.bytes };
  });
}

function envelopeRows(result: BlockSizeResult): BreakdownRow[] {
  if (result.envelope === null) return [];
  return result.envelope.breakdown.map((f) => ({
    name: f.name,
    count: f.name === 'transactions' ? formatCount(result.payloadPlan?.txCount ?? 0) : '—',
    bytes: f.bytes,
  }));
}

export default function App() {
  const initial = useMemo(
    () => decodeState(spec, window.location.search, landingFork(spec)),
    [],
  );
  const [fork, setFork] = useState(initial.fork);
  const [activeValidators, setActiveValidators] = useState(initial.activeValidators);
  const [gasLimit, setGasLimit] = useState(initial.gasLimit);
  const [scenario, setScenario] = useState<CalldataScenario>(initial.scenario);
  const [balBytes, setBalBytes] = useState<number | null>(initial.balBytes ?? null);
  const [txCount, setTxCount] = useState<number | null>(initial.txCount ?? null);
  const [calldataBytes, setCalldataBytes] = useState<number | null>(initial.calldataBytes ?? null);
  const [preset, setPreset] = useState<'typical' | 'max' | 'custom'>('typical');
  const knobs = useMemo(() => discoverKnobs(spec, fork), [fork]);
  const [knobValues, setKnobValues] = useState<Record<string, number>>(initial.knobValues);

  const selectFork = (next: string) => {
    setFork(next);
    setKnobValues(typicalKnobValues(spec, next, discoverKnobs(spec, next)));
    setBalBytes(null);
    setTxCount(null);
    setCalldataBytes(null);
    setPreset('typical');
  };

  const custom = <T,>(setter: (v: T) => void) => {
    return (value: T) => {
      setter(value);
      setPreset('custom');
    };
  };

  // Controls update instantly; the expensive part (byte construction +
  // Snappy over megabytes) trails the inputs by a beat.
  const state: UserState = useMemo(
    () => ({ fork, activeValidators, gasLimit, scenario, knobValues, balBytes, txCount, calldataBytes }),
    [fork, activeValidators, gasLimit, scenario, knobValues, balBytes, txCount, calldataBytes],
  );
  const computeState = useDebouncedValue(state, 150);
  const result = useMemo(() => computeBlockSize(spec, elSpec, computeState), [computeState]);
  const stale = computeState !== state;

  // Keep the URL linkable: it always reflects the settled configuration.
  useEffect(() => {
    const query = encodeState(spec, computeState);
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
  }, [computeState]);

  const hasPayload = useMemo(() => {
    const containers = spec.forks[fork].containers;
    return (
      containers['BeaconBlockBody'].fields.some(([name]) => name === 'execution_payload') ||
      containers['SignedExecutionPayloadEnvelope'] !== undefined ||
      containers['ExecutionPayloadEnvelope'] !== undefined
    );
  }, [fork]);

  const applyPreset = (next: 'typical' | 'max') => {
    if (next === 'typical') {
      setKnobValues(typicalKnobValues(spec, fork, knobs));
      setBalBytes(null);
      setTxCount(null);
      setCalldataBytes(null);
    } else {
      setKnobValues(worstCaseKnobValues(spec, fork, knobs));
      if (result.elModel !== null) {
        const stuffed = stuffedPayloadShape(result.elModel, gasLimit, scenario);
        setTxCount(stuffed.txCount);
        setCalldataBytes(stuffed.calldataBytes);
        setBalBytes(balWorstCaseBytes(result.elModel, gasLimit));
      }
    }
    setPreset(next);
  };

  const envelopeResidual =
    result.envelope !== null
      ? result.envelope.sszBytes - result.envelope.breakdown.reduce((a, f) => a + f.bytes, 0n)
      : 0n;

  return (
    <div className="min-h-dvh bg-page font-sans text-ink">
      <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl/8 font-semibold tracking-tight">Ethereum block sizes</h1>
          <p className="text-sm/6 text-ink-2">
            derived from{' '}
            <a
              className="underline decoration-hairline underline-offset-2 hover:text-ink"
              href="https://github.com/ethereum/consensus-specs"
            >
              consensus-specs
            </a>{' '}
            <span className="font-mono text-xs">{spec.tag}</span> ·{' '}
            <a
              className="underline decoration-hairline underline-offset-2 hover:text-ink"
              href="https://github.com/ethereum/execution-specs"
            >
              execution-specs
            </a>{' '}
            <span className="font-mono text-xs">{elSpec.version}</span>
          </p>
          <ShareButton />
        </header>

        <div className="mt-6">
          <ForkRail spec={spec} selected={fork} onSelect={selectFork} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_1fr]">
          <Controls
            knobs={knobs}
            activeValidators={activeValidators}
            gasLimit={gasLimit}
            scenario={scenario}
            knobValues={knobValues}
            hasPayload={hasPayload}
            balBytes={balBytes}
            balUsed={result.balBytesUsed}
            balMax={result.balWorstCase}
            txCount={txCount}
            txUsed={result.payloadPlan?.txCount ?? 0}
            txMax={result.payloadPlan?.maxTxCount ?? 0}
            calldataBytes={calldataBytes}
            calldataUsed={result.payloadPlan?.totalCalldataBytes ?? 0}
            calldataMax={result.payloadPlan?.maxCalldataBytes ?? 0}
            preset={preset}
            onValidators={setActiveValidators}
            onGasLimit={setGasLimit}
            onScenario={setScenario}
            onKnobs={custom(setKnobValues)}
            onBal={custom(setBalBytes)}
            onTxCount={custom(setTxCount)}
            onCalldata={custom(setCalldataBytes)}
            onPreset={applyPreset}
          />
          <main
            className={`flex min-w-0 flex-col gap-6 transition-opacity duration-150 ${
              stale ? 'opacity-60' : ''
            }`}
          >
            <StatTiles result={result} />
            <CompositionBar
              title="Beacon block — where the bytes live"
              rows={result.breakdown}
              residualLabel="envelope"
              residualBytes={result.envelopeBytes}
            />
            <BreakdownTable
              rows={blockRows(result, computeState.knobValues)}
              residualLabel="block envelope (header, signature, offsets)"
              residualBytes={result.envelopeBytes}
            />
            {result.envelope !== null && (
              <>
                <CompositionBar
                  title="Payload envelope — where the bytes live"
                  rows={result.envelope.breakdown}
                  residualLabel="wrapper"
                  residualBytes={envelopeResidual}
                />
                <BreakdownTable
                  rows={envelopeRows(result)}
                  residualLabel="envelope wrapper (builder fields, signature, offsets)"
                  residualBytes={envelopeResidual}
                />
              </>
            )}
            <InfoCards spec={spec} fork={computeState.fork} result={result} scenario={scenario} />
          </main>
        </div>

        <footer className="mt-10 border-t border-hairline pt-4 text-xs/5 text-ink-muted">
          <p>
            Sizes are computed from SSZ schemas extracted from the spec repositories — nothing is
            transcribed by hand. Wire sizes come from running real Snappy compression over a fully
            constructed block. An{' '}
            <a className="underline underline-offset-2" href="https://github.com/ethpandaops/blocksize">
              ethPandaOps
            </a>{' '}
            tool.
          </p>
        </footer>
      </div>
    </div>
  );
}
