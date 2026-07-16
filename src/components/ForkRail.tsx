import { forkLabel } from '../lib/format';
import { forkStatus, type ForkStatus } from '../lib/presets';
import type { ConsensusSpec } from '../lib/schema';

const STATUS_STYLE: Record<ForkStatus, { dot: string; label: string }> = {
  live: { dot: 'bg-status-good', label: 'live' },
  scheduled: { dot: 'bg-series-1', label: 'scheduled' },
  development: { dot: 'bg-ink-muted', label: 'in development' },
  feature: { dot: 'bg-series-7', label: 'feature' },
};

export function ForkRail({
  spec,
  selected,
  onSelect,
}: {
  spec: ConsensusSpec;
  selected: string;
  onSelect: (fork: string) => void;
}) {
  return (
    <nav aria-label="Fork" className="flex flex-wrap items-center gap-2">
      {spec.forkOrder.map((fork) => {
        const status = forkStatus(spec, fork);
        const active = fork === selected;
        return (
          <button
            key={fork}
            type="button"
            onClick={() => onSelect(fork)}
            title={`${forkLabel(fork)} — ${STATUS_STYLE[status].label}`}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm/6 transition-colors ${
              active
                ? 'border-ink bg-ink text-page'
                : 'border-hairline bg-surface text-ink-2 hover:border-ink-muted hover:text-ink'
            }`}
          >
            <span className={`size-1.5 rounded-full ${STATUS_STYLE[status].dot}`} />
            {forkLabel(fork)}
          </button>
        );
      })}
    </nav>
  );
}
