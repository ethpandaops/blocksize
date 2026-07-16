"""Extract SSZ schemas, presets, and configs from an eth_consensus_specs build.

Runs inside an ethereum/consensus-specs checkout after the pyspec has been
generated (`uv run python -m pysetup.generate_specs --all-forks`). Introspects
every executable fork's remerkleable types and emits a single JSON document
consumed by the frontend's size engine.

Usage:
    uv run python extract.py --tag v1.7.0-alpha.12 --out consensus.json
"""

import argparse
import importlib
import json
import re
import sys
from pathlib import Path

from remerkleable.basic import boolean, uint
from remerkleable.bitfields import Bitlist, Bitvector
from remerkleable.byte_arrays import ByteList, ByteVector
from remerkleable.complex import Container, List, Vector
from remerkleable.core import View
from remerkleable.progressive import (
    CompatibleUnion,
    ProgressiveBitlist,
    ProgressiveByteList,
    ProgressiveContainer,
    ProgressiveList,
)
from remerkleable.union import Union

# JS numbers lose integer precision above 2^53; larger values ship as strings
# and are parsed to bigint on the frontend.
MAX_SAFE_INT = 2**53 - 1


def json_int(value: int):
    return value if abs(value) <= MAX_SAFE_INT else str(value)


def serialize_type(t, registry, module_name):
    """Serialize a remerkleable view type to a JSON schema node.

    Containers are emitted into `registry` by class name and referenced,
    so shared containers appear once per fork.
    """
    if issubclass(t, (Container, ProgressiveContainer)):
        name = t.__name__
        if name not in registry:
            registry[name] = None  # reserve to break recursion cycles
            registry[name] = {
                "kind": "container",
                "progressive": issubclass(t, ProgressiveContainer),
                "fields": [
                    [fname, serialize_type(ftype, registry, module_name)]
                    for fname, ftype in t.fields().items()
                ],
                "minSize": json_int(t.min_byte_length()),
                "maxSize": json_int(t.max_byte_length()),
            }
        return {"kind": "ref", "name": name}
    if issubclass(t, ProgressiveBitlist):
        return {"kind": "bitlist", "limit": None}
    if issubclass(t, ProgressiveByteList):
        return {"kind": "byteList", "limit": None, "alias": t.__name__}
    if issubclass(t, ProgressiveList):
        return {
            "kind": "list",
            "limit": None,
            "elem": serialize_type(t.element_cls(), registry, module_name),
        }
    if issubclass(t, (Union, CompatibleUnion)):
        return {
            "kind": "union",
            "options": [
                serialize_type(o, registry, module_name) if o is not None else None
                for o in t.options()
            ],
        }
    if issubclass(t, ByteVector):
        return {"kind": "byteVector", "length": t.type_byte_length(), "alias": t.__name__}
    if issubclass(t, ByteList):
        return {"kind": "byteList", "limit": json_int(t.limit()), "alias": t.__name__}
    if issubclass(t, Bitvector):
        return {"kind": "bitvector", "length": t.vector_length()}
    if issubclass(t, Bitlist):
        return {"kind": "bitlist", "limit": json_int(t.limit())}
    if issubclass(t, Vector):
        return {
            "kind": "vector",
            "length": t.vector_length(),
            "elem": serialize_type(t.element_cls(), registry, module_name),
        }
    if issubclass(t, List):
        return {
            "kind": "list",
            "limit": json_int(t.limit()),
            "elem": serialize_type(t.element_cls(), registry, module_name),
        }
    if issubclass(t, boolean):
        return {"kind": "bool"}
    if issubclass(t, uint):
        return {"kind": "uint", "size": t.type_byte_length()}
    raise TypeError(f"unhandled SSZ type in {module_name}: {t}")


def extract_constants(module):
    """Collect UPPER_CASE scalar constants from a fork module."""
    out = {}
    for name in dir(module):
        if not name.isupper():
            continue
        value = getattr(module, name)
        if isinstance(value, bool):
            out[name] = value
        elif isinstance(value, int):
            out[name] = json_int(int(value))
        elif isinstance(value, bytes):
            out[name] = "0x" + value.hex()
    return out


def extract_config(module):
    """Dump the runtime configuration (fork epochs, blob schedule, ...)."""
    config = module.config
    if hasattr(config, "_asdict"):
        raw = config._asdict()
    else:
        raw = {k: getattr(config, k) for k in dir(config) if k.isupper()}
    return jsonify_config(raw)


def jsonify_config(value):
    if isinstance(value, dict):
        return {str(k): jsonify_config(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonify_config(v) for v in value]
    if isinstance(value, bool):
        return value
    if isinstance(value, bytes):
        return "0x" + value.hex()
    if isinstance(value, int):
        return json_int(int(value))
    return str(value)


def extract_eips(fork_name, specs_root=Path("specs")):
    """EIP numbers referenced by a fork's spec markdown."""
    for candidate in (specs_root / fork_name, specs_root / "_features" / fork_name):
        if candidate.is_dir():
            text = "".join(p.read_text() for p in candidate.rglob("*.md"))
            return sorted({int(n) for n in re.findall(r"EIP-(\d+)", text)})
    return []


def extract_fork(fork_name, preset):
    module = importlib.import_module(f"eth_consensus_specs.{fork_name}.{preset}")
    registry = {}
    roots = []
    for name in dir(module):
        t = getattr(module, name)
        if not (isinstance(t, type) and issubclass(t, View)):
            continue
        if not issubclass(t, (Container, ProgressiveContainer)):
            continue
        # Only containers defined with this name in the fork's namespace,
        # not remerkleable base classes re-exported by the generated module.
        if t.__name__ != name or t.__module__.startswith("remerkleable"):
            continue
        serialize_type(t, registry, module.__name__)
        roots.append(name)
    return {
        "containers": registry,
        "constants": extract_constants(module),
    }, module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True, help="consensus-specs release tag")
    parser.add_argument("--preset", default="mainnet")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    from eth_consensus_specs.test.helpers.constants import ALL_PHASES, PREVIOUS_FORK_OF

    forks = {}
    config = {}
    for fork_name in ALL_PHASES:
        try:
            fork_data, module = extract_fork(fork_name, args.preset)
        except ModuleNotFoundError:
            print(f"skipping {fork_name}: no {args.preset} module", file=sys.stderr)
            continue
        fork_data["previous"] = PREVIOUS_FORK_OF.get(fork_name)
        fork_data["eips"] = extract_eips(fork_name)
        forks[fork_name] = fork_data
        # Each fork's Configuration only carries the keys it knows about;
        # merging in fork order yields the complete picture.
        config.update(extract_config(module))

    document = {
        "source": "ethereum/consensus-specs",
        "tag": args.tag,
        "preset": args.preset,
        "forkOrder": [f for f in ALL_PHASES if f in forks],
        "config": config,
        "forks": forks,
    }
    with open(args.out, "w") as f:
        json.dump(document, f, indent=1, sort_keys=True)
    total = sum(len(f["containers"]) for f in forks.values())
    print(f"wrote {args.out}: {len(forks)} forks, {total} containers")


if __name__ == "__main__":
    main()
