import { useState } from 'react';
import type { CalldataScenario } from '../lib/el';
import { fieldLabel, formatCount } from '../lib/format';
import type { Knob } from '../lib/knobs';

const SCENARIOS: { id: CalldataScenario; label: string; hint: string }[] = [
  { id: 'zeros', label: 'All zeros', hint: 'cheapest per byte, biggest raw payload, compresses away' },
  { id: 'mixed', label: 'Mixed', hint: '~29% zero bytes, like historical mainnet calldata' },
  { id: 'random', label: 'Random', hint: 'worst case for the wire: incompressible' },
];

/** Slider paired with a text input, so exact values can be typed. */
function Field({
  label,
  value,
  min,
  max,
  step,
  unit,
  auto,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Value is currently model-derived rather than user-set. */
  auto?: boolean;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft.replace(/[,\s_]/g, ''));
    if (Number.isFinite(parsed)) {
      onChange(Math.min(max, Math.max(min, Math.round(parsed))));
    }
    setDraft(null);
  };
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-sm/6">
        <span className="text-ink-2">{label}</span>
        <span className="flex items-baseline gap-1.5">
          {auto === true && <span className="text-xs/5 text-ink-muted">auto</span>}
          <input
            type="text"
            inputMode="numeric"
            className="w-24 rounded-sm border border-hairline bg-transparent px-1.5 py-0.5 text-right font-mono text-xs/5 text-ink focus:border-ink-muted focus:outline-hidden"
            value={draft ?? formatCount(value)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          {unit !== undefined && <span className="text-xs/5 text-ink-muted">{unit}</span>}
        </span>
      </span>
      <input
        type="range"
        className="mt-1 w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Controls({
  knobs,
  activeValidators,
  gasLimit,
  scenario,
  knobValues,
  hasPayload,
  balBytes,
  balUsed,
  balMax,
  onValidators,
  onGasLimit,
  onScenario,
  onKnobs,
  onBal,
  onPreset,
}: {
  knobs: Knob[];
  activeValidators: number;
  gasLimit: number;
  scenario: CalldataScenario;
  knobValues: Record<string, number>;
  hasPayload: boolean;
  balBytes: number | null;
  balUsed: number;
  balMax: number;
  onValidators: (v: number) => void;
  onGasLimit: (v: number) => void;
  onScenario: (s: CalldataScenario) => void;
  onKnobs: (values: Record<string, number>) => void;
  onBal: (bytes: number | null) => void;
  onPreset: (preset: 'typical' | 'max') => void;
}) {
  const groups = new Map<string | null, Knob[]>();
  for (const knob of knobs) {
    const list = groups.get(knob.group) ?? [];
    list.push(knob);
    groups.set(knob.group, list);
  }

  const setKnob = (path: string, value: number) => onKnobs({ ...knobValues, [path]: value });

  return (
    <aside className="flex h-fit flex-col gap-6 rounded-lg border border-hairline bg-surface p-4 lg:sticky lg:top-4">
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm/6 font-semibold">Network</h2>
          <div className="flex gap-2 text-xs/5">
            <button
              type="button"
              className="rounded-sm border border-hairline px-2 py-0.5 text-ink-2 hover:text-ink"
              onClick={() => onPreset('typical')}
            >
              typical
            </button>
            <button
              type="button"
              className="rounded-sm border border-hairline px-2 py-0.5 text-ink-2 hover:text-ink"
              onClick={() => onPreset('max')}
            >
              max
            </button>
          </div>
        </div>
        <Field
          label="Active validators"
          value={activeValidators}
          min={100_000}
          max={5_000_000}
          step={50_000}
          onChange={onValidators}
        />
        {hasPayload && (
          <>
            <Field
              label="Gas limit"
              value={Math.round(gasLimit / 1_000_000)}
              min={15}
              max={1000}
              step={5}
              unit="M"
              onChange={(v) => onGasLimit(v * 1_000_000)}
            />
            <fieldset>
              <legend className="text-sm/6 text-ink-2">Calldata content</legend>
              <div className="mt-1 flex gap-1">
                {SCENARIOS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.hint}
                    onClick={() => onScenario(s.id)}
                    className={`flex-1 rounded-sm border px-2 py-1 text-xs/5 ${
                      scenario === s.id
                        ? 'border-ink bg-ink text-page'
                        : 'border-hairline text-ink-2 hover:text-ink'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>
            {balMax > 0 && (
              <Field
                label="Block access list (EIP-7928)"
                value={Math.round(Math.min(balUsed, balMax) / 1024)}
                min={0}
                max={Math.round(balMax / 1024)}
                step={16}
                unit="KiB"
                auto={balBytes === null}
                onChange={(kib) => onBal(kib * 1024)}
              />
            )}
          </>
        )}
      </section>

      {[...groups.entries()].map(([group, groupKnobs]) => (
        <section key={group ?? 'body'} className="flex flex-col gap-3">
          <h2 className="text-sm/6 font-semibold">
            {group === null ? 'Block body' : fieldLabel(group)}
          </h2>
          {groupKnobs.map((knob) => (
            <Field
              key={knob.path}
              label={fieldLabel(knob.name)}
              value={knobValues[knob.path] ?? 0}
              min={0}
              max={knob.max}
              step={1}
              unit={`/ ${formatCount(knob.max)}`}
              onChange={(v) => setKnob(knob.path, v)}
            />
          ))}
        </section>
      ))}

      <p className="text-xs/5 text-ink-muted">
        Fields are discovered from the fork's SSZ schema; caps come from list limits or the fork's
        processing constants. Values can be typed or dragged.
      </p>
    </aside>
  );
}
