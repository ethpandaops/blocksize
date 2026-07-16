import type { CalldataScenario } from '../lib/el';
import { gasPerByte } from '../lib/el';
import { formatBytes, formatCount, forkLabel } from '../lib/format';
import type { BlockSizeResult } from '../lib/model';
import type { ConsensusSpec } from '../lib/schema';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <h3 className="text-sm/6 font-semibold">{title}</h3>
      <div className="mt-2 flex flex-col gap-1 text-sm/6 text-ink-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="text-right font-mono text-xs/6 text-ink">{value}</span>
    </p>
  );
}

export function InfoCards({
  spec,
  fork,
  result,
  scenario,
}: {
  spec: ConsensusSpec;
  fork: string;
  result: BlockSizeResult;
  scenario: CalldataScenario;
}) {
  const eips = spec.forks[fork].eips ?? [];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {result.elModel !== null && result.payloadPlan !== null ? (
        <Card title={`Execution payload — EL fork: ${forkLabel(result.elModel.fork.name)}`}>
          <Row label="Transactions" value={formatCount(result.payloadPlan.txCount)} />
          <Row label="Calldata" value={formatBytes(result.payloadPlan.totalCalldataBytes)} />
          <Row
            label={`Gas per calldata byte (${scenario})`}
            value={gasPerByte(result.elModel, scenario).toFixed(1)}
          />
          <Row
            label="Calldata pricing"
            value={
              result.elModel.floorTokenCost !== null
                ? `floor ${result.elModel.floorTokenCost}/token (EIP-7623)`
                : `standard ${result.elModel.standardTokenCost}/token`
            }
          />
          {result.elModel.txMaxGasLimit !== null && (
            <Row
              label="Per-tx gas cap (EIP-7825)"
              value={formatCount(result.elModel.txMaxGasLimit)}
            />
          )}
        </Card>
      ) : (
        <Card title="Execution payload">
          <p>
            Not part of the beacon block at this fork
            {result.elModel === null && spec.forks[fork].containers['SignedExecutionPayloadBid']
              ? ' — ePBS ships the payload separately; the block carries only the builder bid.'
              : '.'}
          </p>
        </Card>
      )}

      <Card title="Wire sizes">
        <Row label="Raw SSZ" value={formatBytes(result.sszBytes)} />
        <Row label="Gossip (Snappy, measured)" value={formatBytes(result.gossipBytes)} />
        <Row label="Req/resp (framed, measured)" value={formatBytes(result.framedBytes)} />
        <Row label="Snappy analytic ceiling" value={formatBytes(result.snappyCeiling)} />
        {result.gossipLimit !== null && (
          <Row label="Gossip message limit" value={formatBytes(result.gossipLimit)} />
        )}
        <Row label="Spec max (unconstrained SSZ)" value={formatBytes(result.specMaxBytes)} />
      </Card>

      {result.sidecars.length > 0 && (
        <Card title="Blob data — gossiped separately, not in the block">
          {result.sidecars.map((s) => (
            <div key={s.container} className="flex flex-col gap-1">
              <Row label={`${s.container} size`} value={formatBytes(s.bytesEach)} />
              <Row
                label={s.perBlock ? 'Columns per block' : 'Sidecars per block'}
                value={formatCount(s.count)}
              />
              <Row label="Total DA footprint" value={formatBytes(s.totalBytes)} />
            </div>
          ))}
        </Card>
      )}

      {eips.length > 0 && (
        <Card title={`${forkLabel(fork)} EIPs (from spec markdown)`}>
          <p className="flex flex-wrap gap-1.5">
            {eips.map((eip) => (
              <a
                key={eip}
                href={`https://eips.ethereum.org/EIPS/eip-${eip}`}
                className="rounded-sm border border-hairline px-1.5 py-0.5 font-mono text-xs/5 hover:border-ink-muted hover:text-ink"
              >
                {eip}
              </a>
            ))}
          </p>
        </Card>
      )}
    </div>
  );
}
