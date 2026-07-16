import { useMemo, useState } from 'react';
import consensusJson from '../spec-data/consensus.json';
import elJson from '../spec-data/el.json';
import { BreakdownTable } from './components/BreakdownTable';
import { CompositionBar } from './components/CompositionBar';
import { Controls } from './components/Controls';
import { ForkRail } from './components/ForkRail';
import { InfoCards } from './components/InfoCards';
import { StatTiles } from './components/StatTiles';
import { discoverKnobs } from './lib/knobs';
import { balWorstCaseBytes, computeBlockSize, type UserState } from './lib/model';
import { useDebouncedValue } from './lib/useDebouncedValue';
import {
  currentMainnetFork,
  DEFAULTS,
  typicalKnobValues,
  worstCaseKnobValues,
} from './lib/presets';
import type { CalldataScenario } from './lib/el';
import type { ConsensusSpec, ElSpec } from './lib/schema';

const spec = consensusJson as unknown as ConsensusSpec;
const elSpec = elJson as unknown as ElSpec;

export default function App() {
  const landingFork = useMemo(() => currentMainnetFork(spec), []);
  const [fork, setFork] = useState(landingFork);
  const [activeValidators, setActiveValidators] = useState(DEFAULTS.activeValidators);
  const [gasLimit, setGasLimit] = useState(DEFAULTS.gasLimit);
  const [scenario, setScenario] = useState<CalldataScenario>('mixed');
  const [balBytes, setBalBytes] = useState(0);
  const knobs = useMemo(() => discoverKnobs(spec, fork), [fork]);
  const [knobValues, setKnobValues] = useState<Record<string, number>>(() =>
    typicalKnobValues(spec, landingFork, discoverKnobs(spec, landingFork)),
  );

  const selectFork = (next: string) => {
    setFork(next);
    setKnobValues(typicalKnobValues(spec, next, discoverKnobs(spec, next)));
  };

  // Controls update instantly; the expensive part (byte construction +
  // Snappy over megabytes) trails the sliders by a beat.
  const state: UserState = useMemo(
    () => ({ fork, activeValidators, gasLimit, scenario, knobValues, balBytes }),
    [fork, activeValidators, gasLimit, scenario, knobValues, balBytes],
  );
  const computeState = useDebouncedValue(state, 150);
  const result = useMemo(() => computeBlockSize(spec, elSpec, computeState), [computeState]);
  const stale = computeState !== state;

  const hasPayload = useMemo(() => {
    const containers = spec.forks[fork].containers;
    return (
      containers['BeaconBlockBody'].fields.some(([name]) => name === 'execution_payload') ||
      containers['SignedExecutionPayloadEnvelope'] !== undefined ||
      containers['ExecutionPayloadEnvelope'] !== undefined
    );
  }, [fork]);

  const applyPreset = (preset: 'typical' | 'max') => {
    if (preset === 'typical') {
      setKnobValues(typicalKnobValues(spec, fork, knobs));
      setBalBytes(0);
    } else {
      setKnobValues(worstCaseKnobValues(spec, fork, knobs));
      setBalBytes(result.elModel !== null ? balWorstCaseBytes(result.elModel, gasLimit) : 0);
    }
  };

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
            <span className="font-mono text-xs">v{elSpec.version}</span>
          </p>
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
            balMax={result.balWorstCase}
            onValidators={setActiveValidators}
            onGasLimit={setGasLimit}
            onScenario={setScenario}
            onKnobs={setKnobValues}
            onBal={setBalBytes}
            onPreset={applyPreset}
          />
          <main
            className={`flex min-w-0 flex-col gap-6 transition-opacity duration-150 ${
              stale ? 'opacity-60' : ''
            }`}
          >
            <StatTiles result={result} />
            <CompositionBar result={result} />
            <BreakdownTable result={result} knobValues={computeState.knobValues} />
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
