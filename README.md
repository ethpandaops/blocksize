# Ethereum Block Size Calculator

**Live**: https://ethpandaops.github.io/blocksize/

Interactive calculator for everything an Ethereum slot puts on the wire,
across every consensus fork: the beacon block, the ePBS payload envelope
(with its EIP-7928 block access list), and blob/DAS sidecars — each as raw
SSZ and measured gossip size. All of it is derived from the spec
repositories; nothing is transcribed by hand.

## How it stays correct

The design goal: **a new spec release requires zero code changes here.**

1. `extractor/extract.py` runs inside an [ethereum/consensus-specs] checkout
   (after its own pyspec build) and dumps every fork's SSZ container schemas,
   preset constants, config (fork epochs, blob schedule), and referenced EIPs
   to `spec-data/consensus.json`. Each container's min/max byte length as
   computed by the spec's own SSZ implementation (remerkleable) is included
   as ground truth.
2. `extractor/extract_el.py` dumps per-fork gas constants (intrinsic costs,
   EIP-7623 calldata floor, EIP-7825 tx gas cap, blob schedule) from
   [ethereum/execution-specs] (EELS, `ethereum-execution` on PyPI).
3. The frontend's size engine (`src/lib/ssz.ts`) interprets those schemas
   generically: SSZ min/max sizing, exact instance sizing, and byte-level
   construction. The test suite asserts the engine reproduces the spec's own
   min/max for **every container in every fork** — if a release introduces an
   SSZ construct the engine can't handle, tests fail loudly.
4. UI knobs (sliders) are **discovered from the schema**: every list in the
   block body becomes a control, capped by its SSZ limit or, for progressive
   (EIP-7495-style) lists, the fork's processing-limit constants. A new fork's
   new fields appear automatically — as gloas's `payload_attestations` and
   builder requests do today.
5. The `update-specs` workflow runs nightly (and on demand): it re-runs
   both extractors against the latest consensus-specs release and EELS
   HEAD, verifies the engine against the new data, and — when the specs
   substantively changed — commits the refresh to master and redeploys
   the site, no human in the loop. If verification fails on real
   changes, it opens a PR instead.
6. A constants-coverage ratchet (`src/lib/coverage.test.ts`) enumerates
   every size-relevant constant in the extracted data and fails when a
   spec update introduces one without an explicit disposition — a new
   size cap can't be silently ignored (this class of miss happened once,
   with EIP-7934's block size cap).

Validation against reality: at mainnet's average 30.3 Mgas, the model's
typical block is within ~5% of the measured average raw block size
(204KB, xatu, July 2026). Measured Snappy compression on real blocks
(2.3×) is stronger than the model's "mixed" calldata scenario, so wire
sizes err conservative.

Behavior is keyed to extracted *constants*, never to fork names or EIP tables:
EIP-7623 floor pricing applies because `FLOOR_CALLDATA_COST` exists in the
fork's constants, the tx cap because `TX_MAX_GAS_LIMIT` exists, and so on.

## Compression is measured, not estimated

The tool constructs the actual serialized bytes of the configured block —
correct SSZ layout, seeded-random bytes for cryptographic fields (signatures,
roots, pubkeys, KZG objects), realistic small integers for counters, and
calldata matching the selected scenario (all-zeros / mixed / random) — then
runs real Snappy over them:

- **gossip**: raw (block-format) Snappy, as libp2p gossip uses
- **req/resp**: framed Snappy with per-64KiB-chunk overhead
- plus the analytic worst-case ceiling (`32 + n + n/6`)

So "compressed size" is the measured wire size of the modeled content, and
the content is an explicit input rather than a hardcoded ratio.

The one modeling layer that is *not* spec-derived is a small set of
name-keyed physical constraints (`src/lib/constraints.ts`): how full an
aggregation bitfield gets for a validator count, how many bytes of calldata a
gas limit buys, deposit-contract gas per deposit request. Unmatched fields
fall back to their spec worst case.

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # engine vs spec ground truth + integration tests
npm run build      # production build (dist/)
```

To refresh spec data locally:

```bash
# consensus: needs a consensus-specs checkout with a built pyspec
git clone --depth 1 --branch <tag> https://github.com/ethereum/consensus-specs /tmp/consensus-specs
cd /tmp/consensus-specs && uv sync --all-extras && uv run python -m pysetup.generate_specs --all-forks
uv run python <this-repo>/extractor/extract.py --tag <tag> --out <this-repo>/spec-data/consensus.json

# execution: plain PyPI package
uv venv /tmp/elenv && uv pip install --python /tmp/elenv/bin/python ethereum-execution==<version>
/tmp/elenv/bin/python extractor/extract_el.py --version <version> --out spec-data/el.json
```

## Stack

Vite + React + TypeScript + Tailwind CSS v4, [snappyjs] for compression,
deployed to GitHub Pages. No backend; everything runs in the browser.

[ethereum/consensus-specs]: https://github.com/ethereum/consensus-specs
[ethereum/execution-specs]: https://github.com/ethereum/execution-specs
[snappyjs]: https://github.com/zhipeng-jia/snappyjs
