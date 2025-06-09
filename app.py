import streamlit as st
import numpy as np
import pandas as pd
import plotly.graph_objects as go

# Ethereum Entity Specifications
ETHEREUM_ENTITIES = {
    "BeaconBlock": {"max_per_block": 1, "ssz_size": 84},
    "BeaconBlockBody": {"max_per_block": 1, "ssz_size": 416},
    "ProposerSlashing": {"max_per_block": 16, "ssz_size": 416},
    "AttesterSlashing": {"max_per_block": 2, "base_size": 8, "per_index": 8, "attestation_overhead": 228},
    "Attestation": {"max_per_block": 8, "base_size": 236, "per_index_bit": 1/8},
    "Deposit": {"max_per_block": 16, "ssz_size": 1240},
    "VoluntaryExit": {"max_per_block": 16, "ssz_size": 112},
    "BLSToExecutionChange": {"max_per_block": 16, "ssz_size": 172},
    "BlobKZGCommitment": {"max_per_block": 9, "ssz_size": 48},
    "DepositRequest": {"max_per_block": 8192, "ssz_size": 192},
    "WithdrawalRequest": {"max_per_block": 16, "ssz_size": 76},
    "ConsolidationRequest": {"max_per_block": 2, "ssz_size": 116}
}

# Block size calculation functions
def calculate_committee_size(active_validators):
    """Calculate committee size based on active validators: validators / 32 / 64"""
    return active_validators // 32 // 64

def calculate_max_deposit_requests(gas_limit):
    """Calculate maximum possible deposit requests based on gas limit"""
    # Each individual deposit costs ~31,500 gas (3,150,000 gas per 100 deposits)
    gas_per_deposit = 31_500
    
    # Calculate maximum individual deposits that fit in gas limit
    max_deposits_by_gas = gas_limit // gas_per_deposit
    
    # Respect protocol limit
    max_deposits_by_protocol = ETHEREUM_ENTITIES["DepositRequest"]["max_per_block"]
    
    return min(max_deposits_by_gas, max_deposits_by_protocol)

def calculate_remaining_execution_gas(gas_limit, deposit_requests):
    """Calculate remaining gas for execution payload after accounting for deposit requests"""
    if deposit_requests == 0:
        return gas_limit
    
    # Each individual deposit costs ~31,500 gas
    gas_per_deposit = 31_500
    
    # Calculate actual gas consumed by deposits
    gas_consumed_by_deposits = deposit_requests * gas_per_deposit
    
    # Remaining gas for execution payload
    remaining_gas = gas_limit - gas_consumed_by_deposits
    
    return max(0, remaining_gas)  # Ensure non-negative

def calculate_attester_slashing_size(num_slashings, active_validators):
    """
    Calculate size of attester slashings based on slot-scoped validator count
    Each attestation in a slashing can only include validators from its slot
    """
    if num_slashings == 0:
        return 0
    
    base_size = ETHEREUM_ENTITIES["AttesterSlashing"]["base_size"]
    attestation_overhead = ETHEREUM_ENTITIES["AttesterSlashing"]["attestation_overhead"]
    per_index = ETHEREUM_ENTITIES["AttesterSlashing"]["per_index"]
    
    # Validators per slot: total validators / 32 slots per epoch
    validators_per_slot = active_validators // 32
    
    # Worst-case: both conflicting attestations include all validators from their respective slots
    # Each slashing has two conflicting attestations, each with max validators for that slot
    size_per_slashing = (base_size + 
                       2 * (attestation_overhead + validators_per_slot * per_index))
    
    return num_slashings * size_per_slashing

def calculate_attestation_size(num_attestations, active_validators):
    """
    Calculate size of Electra attestations with EIP-7549 cross-committee aggregation
    Post-Electra: attestations can aggregate across all committees in a slot
    Each slot has 1/32 of the total validator set
    """
    if num_attestations == 0:
        return 0
        
    base_size = ETHEREUM_ENTITIES["Attestation"]["base_size"]
    per_index_bit = ETHEREUM_ENTITIES["Attestation"]["per_index_bit"]
    
    # Validators per slot: total validators / 32 slots per epoch
    validators_per_slot = active_validators // 32
    
    # EIP-7549: Committee index moved outside, enabling cross-committee aggregation
    # Worst-case: each attestation aggregates all validators assigned to that slot
    
    # Size per attestation: base + bitfield for validators in the slot
    size_per_attestation = base_size + (validators_per_slot * per_index_bit)
    
    return num_attestations * size_per_attestation

def calculate_consensus_block_size(active_validators, gas_limit, 
                                 proposer_slashings=0, attester_slashings=0, 
                                 attestations=8, voluntary_exits=0,
                                 bls_to_execution_changes=0, blob_kzg_commitments=0,
                                 deposit_requests=0, withdrawal_requests=0, 
                                 consolidation_requests=0):
    """
    Calculate consensus layer block size in bytes using theoretical worst-case
    Based on detailed Ethereum consensus layer specifications
    """
    total_size = 0
    
    # Fixed components
    total_size += ETHEREUM_ENTITIES["BeaconBlock"]["ssz_size"]
    total_size += ETHEREUM_ENTITIES["BeaconBlockBody"]["ssz_size"]
    
    # Variable components
    total_size += min(proposer_slashings, ETHEREUM_ENTITIES["ProposerSlashing"]["max_per_block"]) * ETHEREUM_ENTITIES["ProposerSlashing"]["ssz_size"]
    
    total_size += calculate_attester_slashing_size(
        min(attester_slashings, ETHEREUM_ENTITIES["AttesterSlashing"]["max_per_block"]), 
        active_validators
    )
    
    total_size += calculate_attestation_size(
        min(attestations, ETHEREUM_ENTITIES["Attestation"]["max_per_block"]), 
        active_validators
    )
    
    total_size += min(voluntary_exits, ETHEREUM_ENTITIES["VoluntaryExit"]["max_per_block"]) * ETHEREUM_ENTITIES["VoluntaryExit"]["ssz_size"]
    total_size += min(bls_to_execution_changes, ETHEREUM_ENTITIES["BLSToExecutionChange"]["max_per_block"]) * ETHEREUM_ENTITIES["BLSToExecutionChange"]["ssz_size"]
    total_size += min(blob_kzg_commitments, ETHEREUM_ENTITIES["BlobKZGCommitment"]["max_per_block"]) * ETHEREUM_ENTITIES["BlobKZGCommitment"]["ssz_size"]
    
    # Post-Electra components
    total_size += min(deposit_requests, ETHEREUM_ENTITIES["DepositRequest"]["max_per_block"]) * ETHEREUM_ENTITIES["DepositRequest"]["ssz_size"]
    total_size += min(withdrawal_requests, ETHEREUM_ENTITIES["WithdrawalRequest"]["max_per_block"]) * ETHEREUM_ENTITIES["WithdrawalRequest"]["ssz_size"]
    total_size += min(consolidation_requests, ETHEREUM_ENTITIES["ConsolidationRequest"]["max_per_block"]) * ETHEREUM_ENTITIES["ConsolidationRequest"]["ssz_size"]
    
    return total_size

def calculate_execution_block_size(available_gas, transaction_type="mixed", compressed=False, eip_7623=True):
    """
    Calculate execution layer block size in bytes based on EIP-7623 and compression
    
    Args:
        available_gas: Available gas for execution payload (after deposits)
        transaction_type: "all_zeros", "all_nonzeros", "mixed", "al_mixed" (access list + mixed)
        compressed: Whether to apply Snappy compression
        eip_7623: Whether EIP-7623 is active (default True for post-Dencun)
    """
    # Convert gas to MiB based on transaction type and EIP-7623 status
    if not eip_7623:
        # Pre-EIP-7623 sizes (in parentheses from the table)
        conversion_rates = {
            "all_zeros": 7.15 / 30_000_000,      # 7.15 MiB per 30M gas
            "all_nonzeros": 1.79 / 30_000_000,   # 1.79 MiB per 30M gas  
            "mixed": 3.34 / 30_000_000,          # 3.34 MiB per 30M gas
            "al_mixed": 1.63 / 30_000_000        # 1.63 MiB per 30M gas (no change)
        }
    else:
        # Post-EIP-7623 sizes
        conversion_rates = {
            "all_zeros": 2.86 / 30_000_000,      # 2.86 MiB per 30M gas
            "all_nonzeros": 0.72 / 30_000_000,   # 0.72 MiB per 30M gas
            "mixed": 1.34 / 30_000_000,          # 1.34 MiB per 30M gas  
            "al_mixed": 1.63 / 30_000_000        # 1.63 MiB per 30M gas
        }
    
    # Calculate base size in MiB using available gas
    mib_size = available_gas * conversion_rates[transaction_type]
    
    if compressed:
        # Apply Snappy compression ratios from the table
        compression_ratios = {
            "all_zeros": 0.13 / 2.86,      # Extremely high compression for zeros
            "all_nonzeros": 1.0,           # No compression for random data
            "mixed": 1.07 / 1.34,          # Moderate compression
            "al_mixed": 1.36 / 1.63        # Slight compression
        }
        mib_size *= compression_ratios.get(transaction_type, 1.0)
    
    # Convert MiB to bytes
    return int(mib_size * 1024 * 1024)

def bytes_to_mib(bytes_val):
    """Convert bytes to MiB"""
    return bytes_val / (1024 * 1024)

def generate_calculation_notes(active_validators, gas_limit, remaining_execution_gas, proposer_slashings, attester_slashings, 
                             attestations, voluntary_exits, bls_to_execution_changes, blob_count,
                             deposit_requests, withdrawal_requests, consolidation_requests,
                             transaction_type, eip_7623_active, compressed):
    """Generate calculation assumption notes for all components"""
    notes = []
    
    # Fixed components
    notes.append({
        "Component": "BeaconBlock + BeaconBlockBody", 
        "Assumption": "Fixed SSZ overhead",
        "Details": f"84 + 416 = 500 bytes (constant)"
    })
    
    # Attestations (Electra EIP-7549)
    if attestations > 0:
        validators_per_slot = active_validators // 32
        notes.append({
            "Component": "Attestations", 
            "Assumption": "Maximum Electra aggregation per slot",
            "Details": f"{attestations} attestations × {validators_per_slot:,} validators ({active_validators:,}/32 per slot)"
        })
    
    # Deposit requests (when enabled)
    if deposit_requests > 0:
        gas_used_by_deposits = gas_limit - remaining_execution_gas
        notes.append({
            "Component": "Deposit Requests", 
            "Assumption": "Reduces execution gas allocation",
            "Details": f"{deposit_requests:,} deposits using {gas_used_by_deposits:,} gas"
        })
    
    # Proposer slashings
    if proposer_slashings > 0:
        notes.append({
            "Component": "Proposer Slashings", 
            "Assumption": "Fixed SSZ size",
            "Details": f"{proposer_slashings} slashings × 416 bytes each"
        })
    
    # Attester slashings
    if attester_slashings > 0:
        validators_per_slot = active_validators // 32
        notes.append({
            "Component": "Attester Slashings", 
            "Assumption": "Worst-case per slot",
            "Details": f"{attester_slashings} slashings with {validators_per_slot:,} validators each side ({active_validators:,}/32 per slot)"
        })
    
    # Other consensus operations
    if voluntary_exits > 0:
        notes.append({
            "Component": "Voluntary Exits", 
            "Assumption": "Fixed SSZ size",
            "Details": f"{voluntary_exits} exits × 112 bytes each"
        })
    
    if bls_to_execution_changes > 0:
        notes.append({
            "Component": "BLS Changes", 
            "Assumption": "Fixed SSZ size", 
            "Details": f"{bls_to_execution_changes} changes × 172 bytes each"
        })
    
    if blob_count > 0:
        notes.append({
            "Component": "Blob Commitments", 
            "Assumption": "KZG commitment per blob",
            "Details": f"{blob_count} blobs × 48 bytes per KZG commitment"
        })
    
    if withdrawal_requests > 0:
        notes.append({
            "Component": "Withdrawal Requests", 
            "Assumption": "Fixed SSZ size",
            "Details": f"{withdrawal_requests} requests × 76 bytes each"
        })
    
    if consolidation_requests > 0:
        notes.append({
            "Component": "Consolidation Requests", 
            "Assumption": "Fixed SSZ size",
            "Details": f"{consolidation_requests} requests × 116 bytes each"
        })
    
    # Execution layer
    transaction_type_names = {
        "all_zeros": "all zeros",
        "all_nonzeros": "all non-zeros", 
        "mixed": "mixed (29% zeros)",
        "al_mixed": "access list + mixed"
    }
    notes.append({
        "Component": "Execution Layer", 
        "Assumption": f"EIP-7623 {'active' if eip_7623_active else 'inactive'}, {transaction_type_names[transaction_type]} transactions",
        "Details": f"{remaining_execution_gas:,} gas available for execution{', Snappy compressed' if compressed else ''}"
    })
    
    return notes

# Preset configurations
NETWORK_PRESETS = {
    "mainnet electra (36M)": {
        "active_validators": 1_100_000,
        "gas_limit": 36_000_000,
        "proposer_slashings": 0,
        "attester_slashings": 0,
        "attestations": 8,
        "voluntary_exits": 2,
        "bls_to_execution_changes": 8,
        "blob_count": 9,
        "deposit_requests": 0,  # Realistic: no mass deposits
        "withdrawal_requests": 8,
        "consolidation_requests": 0,
        "transaction_type": "mixed",
        "eip_7623_active": True,
        "compressed": False
    },
    "worst case (36M)": {
        "active_validators": 1_100_000,
        "gas_limit": 36_000_000,
        "proposer_slashings": 16,
        "attester_slashings": 2,
        "attestations": 8,
        "voluntary_exits": 16,
        "bls_to_execution_changes": 16,
        "blob_count": 9,
        "deposit_requests": 0,  # Worst case might be no deposits, max execution
        "withdrawal_requests": 16,
        "consolidation_requests": 2,
        "transaction_type": "all_zeros",
        "eip_7623_active": True,
        "compressed": False
    }
}

# Streamlit App
st.set_page_config(page_title="Ethereum Block Size Calculator", layout="wide")

st.title("🔗 Ethereum Block Size Calculator")

# Sidebar for parameters
st.sidebar.header("⚙️ Network Parameters")

# Preset selector
preset_options = ["Custom"] + list(NETWORK_PRESETS.keys())
selected_preset = st.sidebar.selectbox(
    "Load Preset Configuration",
    options=preset_options,
    index=1,  # Default to mainnet electra (36M)
    help="Load predefined network configurations for common scenarios"
)

# Get preset values or defaults
if selected_preset != "Custom":
    preset = NETWORK_PRESETS[selected_preset]
    default_validators = preset["active_validators"]
    default_gas_limit = preset["gas_limit"] // 1_000_000  # Convert to millions
    default_proposer_slashings = preset["proposer_slashings"]
    default_attester_slashings = preset["attester_slashings"]
    default_attestations = preset["attestations"]
    default_voluntary_exits = preset["voluntary_exits"]
    default_bls_changes = preset["bls_to_execution_changes"]
    default_blob_count = preset["blob_count"]
    default_deposit_requests = preset["deposit_requests"]
    default_withdrawal_requests = preset["withdrawal_requests"]
    default_consolidation_requests = preset["consolidation_requests"]
    default_transaction_type = preset["transaction_type"]
    default_eip_7623 = preset["eip_7623_active"]
    default_compressed = preset["compressed"]
else:
    # Custom defaults
    default_validators = 1_100_000
    default_gas_limit = 30
    default_proposer_slashings = 0
    default_attester_slashings = 0
    default_attestations = 8
    default_voluntary_exits = 2
    default_bls_changes = 8
    default_blob_count = 9
    default_deposit_requests = 0
    default_withdrawal_requests = 8
    default_consolidation_requests = 0
    default_transaction_type = "all_zeros"
    default_eip_7623 = True
    default_compressed = False

# Always use theoretical worst-case mode
calculation_mode = "theoretical"
realistic_mode = False

# Validator count slider
active_validators = st.sidebar.slider(
    "Active Validators",
    min_value=100_000,
    max_value=5_000_000,
    value=default_validators,
    step=100_000,
    help="Number of active validators in the network"
)

# Gas limit slider (in millions, max 1 gigagas)
gas_limit_millions = st.sidebar.slider(
    "Gas Limit (Millions)",
    min_value=15,
    max_value=1000,
    value=default_gas_limit,
    step=5,
    help="Maximum gas per block in millions (1000M = 1 gigagas)"
)
gas_limit = gas_limit_millions * 1_000_000

# Network activity parameters
st.sidebar.subheader("Consensus Layer Operations")

# Core consensus operations
proposer_slashings = st.sidebar.slider(
    "Proposer Slashings",
    min_value=0,
    max_value=ETHEREUM_ENTITIES["ProposerSlashing"]["max_per_block"],
    value=default_proposer_slashings,
    help=f"Max {ETHEREUM_ENTITIES['ProposerSlashing']['max_per_block']} per block - conflicting block headers"
)

attester_slashings = st.sidebar.slider(
    "Attester Slashings",
    min_value=0,
    max_value=ETHEREUM_ENTITIES["AttesterSlashing"]["max_per_block"],
    value=default_attester_slashings,
    help=f"Max {ETHEREUM_ENTITIES['AttesterSlashing']['max_per_block']} per block - conflicting attestations"
)

attestations = st.sidebar.slider(
    "Attestations",
    min_value=0,
    max_value=ETHEREUM_ENTITIES["Attestation"]["max_per_block"],
    value=default_attestations,
    help=f"Max {ETHEREUM_ENTITIES['Attestation']['max_per_block']} per block - validator votes"
)

# Validator lifecycle operations
voluntary_exits = st.sidebar.slider(
    "Voluntary Exits",
    min_value=0,
    max_value=ETHEREUM_ENTITIES["VoluntaryExit"]["max_per_block"],
    value=default_voluntary_exits,
    help=f"Max {ETHEREUM_ENTITIES['VoluntaryExit']['max_per_block']} per block - validator exits"
)

bls_to_execution_changes = st.sidebar.slider(
    "BLS to Execution Changes",
    min_value=0,
    max_value=ETHEREUM_ENTITIES["BLSToExecutionChange"]["max_per_block"],
    value=default_bls_changes,
    help=f"Max {ETHEREUM_ENTITIES['BLSToExecutionChange']['max_per_block']} per block - credential changes"
)

# Blob-related operations
blob_count = st.sidebar.slider(
    "Blob Count",
    min_value=0,
    max_value=ETHEREUM_ENTITIES["BlobKZGCommitment"]["max_per_block"],
    value=default_blob_count,
    help=f"Number of blobs (max {ETHEREUM_ENTITIES['BlobKZGCommitment']['max_per_block']} per block in Electra)"
)
blob_kzg_commitments = blob_count  # Each blob has one KZG commitment

st.sidebar.subheader("Post-Electra Operations")

# Calculate dynamic max for deposit requests
max_possible_deposits = calculate_max_deposit_requests(gas_limit)

# Post-Electra operations
deposit_requests = st.sidebar.slider(
    "Deposit Requests",
    min_value=0,
    max_value=max_possible_deposits,
    value=min(default_deposit_requests, max_possible_deposits),  # Ensure default doesn't exceed max
    step=10,
    help=f"Max {max_possible_deposits:,} with {gas_limit_millions}M gas (protocol limit: {ETHEREUM_ENTITIES['DepositRequest']['max_per_block']:,})"
)

# Calculate remaining gas for execution payload
remaining_execution_gas = calculate_remaining_execution_gas(gas_limit, deposit_requests)

# Show constraint information
protocol_limit = ETHEREUM_ENTITIES["DepositRequest"]["max_per_block"]
if max_possible_deposits < protocol_limit:
    st.sidebar.warning(f"⚠️ Gas limit constrains deposits to {max_possible_deposits:,} (protocol allows {protocol_limit:,})")

# Show gas allocation
if deposit_requests > 0:
    gas_used_by_deposits = gas_limit - remaining_execution_gas
    st.sidebar.info(f"📊 {deposit_requests:,} deposits using {gas_used_by_deposits:,} gas")
    st.sidebar.info(f"⛽ {remaining_execution_gas:,} gas remaining for execution")
else:
    st.sidebar.info(f"⛽ {gas_limit:,} gas available for execution")

withdrawal_requests = st.sidebar.slider(
    "Withdrawal Requests",
    min_value=0,
    max_value=ETHEREUM_ENTITIES["WithdrawalRequest"]["max_per_block"],
    value=default_withdrawal_requests,
    help=f"Max {ETHEREUM_ENTITIES['WithdrawalRequest']['max_per_block']} per block - withdrawal requests"
)

consolidation_requests = st.sidebar.slider(
    "Consolidation Requests",
    min_value=0,
    max_value=ETHEREUM_ENTITIES["ConsolidationRequest"]["max_per_block"],
    value=default_consolidation_requests,
    help=f"Max {ETHEREUM_ENTITIES['ConsolidationRequest']['max_per_block']} per block - validator consolidation"
)

st.sidebar.subheader("Execution Layer Settings")

# Transaction type selection
transaction_types = {
    "all_zeros": "All Zeros (Worst Case)",
    "all_nonzeros": "All Non-zeros", 
    "mixed": "Mixed (29% zeros, 71% non-zeros)",
    "al_mixed": "Access List + Mixed"
}

transaction_type = st.sidebar.selectbox(
    "Transaction Type",
    options=list(transaction_types.keys()),
    format_func=lambda x: transaction_types[x],
    index=list(transaction_types.keys()).index(default_transaction_type),
    help="Type of transaction data filling the block - affects compression and size"
)

eip_7623_active = st.sidebar.checkbox(
    "EIP-7623 Active",
    value=default_eip_7623,
    help="Whether EIP-7623 (calldata cost increase) is active (post-Dencun)"
)

compressed = st.sidebar.checkbox(
    "Snappy Compression",
    value=default_compressed,
    help="Apply Snappy compression to execution layer block size"
)

# Show preset info if selected
if selected_preset != "Custom":
    st.sidebar.info(f"✅ Using preset: **{selected_preset}**")

# Calculate block sizes using theoretical worst-case

consensus_size = calculate_consensus_block_size(
    active_validators=active_validators,
    gas_limit=gas_limit,
    proposer_slashings=proposer_slashings,
    attester_slashings=attester_slashings,
    attestations=attestations,
    voluntary_exits=voluntary_exits,
    bls_to_execution_changes=bls_to_execution_changes,
    blob_kzg_commitments=blob_kzg_commitments,
    deposit_requests=deposit_requests,
    withdrawal_requests=withdrawal_requests,
    consolidation_requests=consolidation_requests
)

execution_size = calculate_execution_block_size(
    available_gas=remaining_execution_gas,
    transaction_type=transaction_type,
    compressed=compressed,
    eip_7623=eip_7623_active
)

total_size = consensus_size + execution_size

# Generate calculation notes
calculation_notes = generate_calculation_notes(
    active_validators, gas_limit, remaining_execution_gas, proposer_slashings, attester_slashings,
    attestations, voluntary_exits, bls_to_execution_changes, blob_count,
    deposit_requests, withdrawal_requests, consolidation_requests,
    transaction_type, eip_7623_active, compressed
)

# Display calculation assumptions
if calculation_notes:
    notes_df = pd.DataFrame(calculation_notes)
    st.dataframe(notes_df, use_container_width=True, hide_index=True)

# Display current calculations
col1, col2, col3 = st.columns(3)

with col1:
    consensus_mib = bytes_to_mib(consensus_size)
    if consensus_mib < 0.01:
        consensus_display = f"{consensus_size:,} bytes"
    else:
        consensus_display = f"{consensus_mib:.3f} MiB"
    st.metric(
        "Consensus Layer",
        consensus_display,
        help="Size of consensus layer block"
    )

with col2:
    st.metric(
        "Execution Layer", 
        f"{bytes_to_mib(execution_size):.2f} MiB",
        help="Size of execution layer block"
    )

with col3:
    total_mib = bytes_to_mib(total_size)
    st.metric(
        "Total Block Size",
        f"{total_mib:.2f} MiB",
        help="Combined consensus + execution layer block size"
    )

# Component breakdown

# Use calculated deposit requests
breakdown_deposit_requests = deposit_requests

# Calculate all component sizes and counts
component_data = {
    "Execution Layer": {"size": execution_size, "count": 1, "layer": "EL"},
    "Attestations": {"size": calculate_attestation_size(attestations, active_validators), "count": attestations, "layer": "CL"},
    "Deposit Requests": {"size": breakdown_deposit_requests * ETHEREUM_ENTITIES["DepositRequest"]["ssz_size"], "count": breakdown_deposit_requests, "layer": "CL"},
    "BeaconBlock": {"size": ETHEREUM_ENTITIES["BeaconBlock"]["ssz_size"], "count": 1, "layer": "CL"},
    "BeaconBlockBody": {"size": ETHEREUM_ENTITIES["BeaconBlockBody"]["ssz_size"], "count": 1, "layer": "CL"},
    "Withdrawal Requests": {"size": withdrawal_requests * ETHEREUM_ENTITIES["WithdrawalRequest"]["ssz_size"], "count": withdrawal_requests, "layer": "CL"},
    "BLS Changes": {"size": bls_to_execution_changes * ETHEREUM_ENTITIES["BLSToExecutionChange"]["ssz_size"], "count": bls_to_execution_changes, "layer": "CL"},
    "Voluntary Exits": {"size": voluntary_exits * ETHEREUM_ENTITIES["VoluntaryExit"]["ssz_size"], "count": voluntary_exits, "layer": "CL"},
    f"Blob Commitments": {"size": blob_kzg_commitments * ETHEREUM_ENTITIES["BlobKZGCommitment"]["ssz_size"], "count": blob_kzg_commitments, "layer": "CL"},
    "Proposer Slashings": {"size": proposer_slashings * ETHEREUM_ENTITIES["ProposerSlashing"]["ssz_size"], "count": proposer_slashings, "layer": "CL"},
    "Attester Slashings": {"size": calculate_attester_slashing_size(attester_slashings, active_validators), "count": attester_slashings, "layer": "CL"},
    "Consolidation Requests": {"size": consolidation_requests * ETHEREUM_ENTITIES["ConsolidationRequest"]["ssz_size"], "count": consolidation_requests, "layer": "CL"},
}

# Extract sizes for compatibility with existing code
component_sizes = {k: v["size"] for k, v in component_data.items()}

# Filter non-zero components and prepare data
filtered_components = {k: v for k, v in component_sizes.items() if v > 0}

if filtered_components:
    component_names = list(filtered_components.keys())
    component_values = list(filtered_components.values())
    total_bytes = sum(component_values)
    
    # Create pie chart
    fig_breakdown = go.Figure(data=[go.Pie(
        labels=component_names,
        values=component_values,
        textinfo='none',
        hovertemplate='<b>%{label}</b><br>' +
                     'Size: %{value:,.0f} bytes<br>' +
                     'Percentage: %{percent}<br>' +
                     '<extra></extra>'
    )])
    
    fig_breakdown.update_layout(
        title="Block Size by Component",
        height=500,
        showlegend=False
    )
    
    st.plotly_chart(fig_breakdown, use_container_width=True)
    
    # Add legend
    st.caption("🔵 Execution Layer (EL) • 🟠 Consensus Layer (CL)")
    
    # Create breakdown table
    breakdown_data = []
    total_bytes = sum(filtered_components.values())
    
    for name, size_bytes in sorted(filtered_components.items(), key=lambda x: x[1], reverse=True):
        percentage = (size_bytes / total_bytes) * 100
        size_mib = bytes_to_mib(size_bytes)
        count = component_data[name]["count"]
        layer = component_data[name]["layer"]
        
        # Calculate size per unit
        if count > 0:
            size_per_unit = size_bytes / count
            if size_per_unit < 1024:
                size_per_unit_display = f"{size_per_unit:.0f} B"
            elif size_per_unit < 1024 * 1024:
                size_per_unit_display = f"{size_per_unit/1024:.1f} KB"
            else:
                size_per_unit_display = f"{size_per_unit/(1024*1024):.2f} MB"
        else:
            size_per_unit_display = "—"
        
        # Add layer emoji for visual distinction
        layer_icon = "🔵" if layer == "EL" else "🟠"
        component_display = f"{layer_icon} {name}"
        
        breakdown_data.append({
            "Component": component_display,
            "Count": count,
            "Size/Unit": size_per_unit_display,
            "Total Bytes": f"{size_bytes:,}",
            "Total MiB": f"{size_mib:.3f}",
            "Percentage": f"{percentage:.1f}%"
        })
    
    # Add total row
    breakdown_data.append({
        "Component": "**TOTAL**",
        "Count": "—",
        "Size/Unit": "—",
        "Total Bytes": f"{total_bytes:,}",
        "Total MiB": f"{bytes_to_mib(total_bytes):.3f}",
        "Percentage": "100.0%"
    })
    
    df_breakdown = pd.DataFrame(breakdown_data)
    st.dataframe(df_breakdown, use_container_width=True, hide_index=True)
else:
    st.write("No components have non-zero sizes")