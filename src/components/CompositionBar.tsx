import { fieldLabel, formatBytes } from '../lib/format';

const SERIES = [
  'bg-series-1',
  'bg-series-2',
  'bg-series-3',
  'bg-series-4',
  'bg-series-5',
  'bg-series-6',
  'bg-series-7',
  'bg-series-8',
] as const;

const MAX_NAMED_SEGMENTS = 7;
const MIN_SHARE_PERCENT = 1;

export interface CompositionRow {
  name: string;
  bytes: bigint;
}

export function CompositionBar({
  title,
  rows,
  residualLabel,
  residualBytes,
}: {
  title: string;
  /** In schema field order — colors key to position, not size rank. */
  rows: CompositionRow[];
  residualLabel: string;
  residualBytes: bigint;
}) {
  const total = rows.reduce((a, f) => a + f.bytes, 0n) + residualBytes;
  if (total === 0n) return null;

  // Color is keyed to the field's schema position, so a segment keeps its
  // hue as knobs move it up or down the ranking. Membership in the named
  // set is by size; the residual is neutral gray (it is not an entity).
  const colorByField = new Map(rows.map((f, i) => [f.name, SERIES[i % SERIES.length]]));
  const share = (bytes: bigint) => Number((bytes * 10000n) / total) / 100;

  const bySize = [...rows].filter((f) => f.bytes > 0n).sort((a, b) => (a.bytes > b.bytes ? -1 : 1));
  const named = bySize
    .slice(0, MAX_NAMED_SEGMENTS)
    .filter((f) => share(f.bytes) >= MIN_SHARE_PERCENT);
  const restBytes = bySize.slice(named.length).reduce((a, f) => a + f.bytes, 0n) + residualBytes;

  const segments = [
    ...named.map((f) => ({
      name: fieldLabel(f.name),
      bytes: f.bytes,
      color: colorByField.get(f.name)!,
    })),
    {
      name: bySize.length > named.length ? `everything else + ${residualLabel}` : residualLabel,
      bytes: restBytes,
      color: 'bg-ink-muted',
    },
  ].filter((s) => s.bytes > 0n);

  return (
    <figure className="rounded-lg border border-hairline bg-surface p-4">
      <figcaption className="text-sm/6 font-semibold">{title}</figcaption>
      <div className="mt-3 flex h-9 w-full gap-0.5" role="img" aria-label={title}>
        {segments.map((s) => (
          <div
            key={s.name}
            className={`group relative min-w-1 first:rounded-l-sm last:rounded-r-sm ${s.color}`}
            style={{ width: `${share(s.bytes)}%` }}
          >
            <span className="pointer-events-none absolute -top-9 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-sm border border-hairline bg-surface px-2 py-1 text-xs/4 text-ink shadow-sm group-hover:block">
              {s.name} · {formatBytes(s.bytes)} · {share(s.bytes).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5 text-xs/5 text-ink-2">
            <span className={`size-2.5 rounded-xs ${s.color}`} />
            {s.name} · {formatBytes(s.bytes)}
          </span>
        ))}
      </div>
    </figure>
  );
}
