"""Extract execution-layer gas constants from EELS (ethereum-execution).

Unlike the consensus extractor, this runs against the plain PyPI package:

    pip install ethereum-execution
    python extract_el.py --version 2.20.0 --out el.json

For each hardfork it dumps the integer constants from the `transactions`
and `vm.gas` modules, which is everything the frontend's gas-to-bytes
model needs (intrinsic costs, EIP-7623 calldata floor, blob schedule,
per-tx gas cap).
"""

import argparse
import importlib
import json
import re

MAX_SAFE_INT = 2**53 - 1


def json_int(value: int):
    return value if abs(value) <= MAX_SAFE_INT else str(value)


def module_constants(module):
    out = {}
    for name in dir(module):
        value = getattr(module, name)
        if name.isupper():
            try:
                out[name] = json_int(int(value))
            except (TypeError, ValueError):
                continue
        elif isinstance(value, type) and value.__module__ == module.__name__:
            # Newer forks group costs in classes (e.g. amsterdam's
            # GasCosts, EIP-7778 gas schedule restructuring).
            for member in dir(value):
                if not member.isupper():
                    continue
                try:
                    out[member] = json_int(int(getattr(value, member)))
                except (TypeError, ValueError):
                    continue
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="ethereum-execution package version")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    from ethereum_spec_tools.forks import Hardfork

    forks = []
    for hardfork in Hardfork.discover():
        fork_name = hardfork.name.split(".")[-1]
        fork_module = importlib.import_module(hardfork.name)
        eips = sorted({int(n) for n in re.findall(r"EIP-?(\d+)", fork_module.__doc__ or "")})
        constants = {}
        for submodule in ("transactions", "vm.gas", "fork"):
            try:
                module = importlib.import_module(f"{hardfork.name}.{submodule}")
            except ModuleNotFoundError:
                continue
            constants.update(module_constants(module))
        criteria = hardfork.criteria
        if hasattr(criteria, "block_number"):
            criteria_value = int(criteria.block_number)
        elif hasattr(criteria, "timestamp"):
            criteria_value = int(criteria.timestamp)
        else:
            criteria_value = None
        forks.append(
            {
                "name": fork_name,
                "criteria": {"kind": type(criteria).__name__, "value": criteria_value},
                "eips": eips,
                "constants": constants,
            }
        )

    document = {
        "source": "ethereum/execution-specs",
        "version": args.version,
        "forks": forks,
    }
    with open(args.out, "w") as f:
        json.dump(document, f, indent=1, sort_keys=True)
    print(f"wrote {args.out}: {len(forks)} forks")


if __name__ == "__main__":
    main()
