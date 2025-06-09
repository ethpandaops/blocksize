# Ethereum Block Size Calculator

A Streamlit application for parameterizing and visualizing Ethereum block sizes at different gas limits and validator counts.

## Features

- **Interactive Parameter Controls**: Adjust validators, gas limits, attestations, deposits, and slashings
- **Real-time Calculations**: Live updates of committee size and block sizes
- **Multiple Visualizations**: Charts showing relationships between parameters and block sizes
- **Scenario Comparison**: Compare predefined scaling scenarios
- **Block Composition Analysis**: Breakdown of what contributes to block size

## Quick Start with uv

### Option 1: One-Command Start
```bash
./run.sh
```

### Option 2: Manual Setup  
```bash
# Install dependencies
uv sync

# Run the app
uv run streamlit run app.py
```

### Option 3: Install uv first (if needed)
```bash
# Install uv if you don't have it
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install dependencies and run
uv sync
uv run streamlit run app.py
```

The app will open in your browser at `http://localhost:8501`

## Usage

1. **Adjust Parameters**: Use the sidebar sliders to modify:
   - Active validator count (100K - 2M)
   - Gas limit (15M - 300M)
   - Network activity (attestations, deposits, slashings)
   - Transaction density type

2. **View Results**: The main dashboard shows:
   - Current committee size and block sizes
   - Interactive charts showing parameter relationships
   - Scenario comparisons with predefined configurations

3. **Explore Visualizations**: Three tabs provide different views:
   - **Gas Limit Impact**: How gas limits affect block sizes
   - **Validator Count Impact**: How validator count scales block sizes
   - **Scenario Comparison**: Compare realistic network scenarios

## Block Size Model

The calculator models both consensus and execution layer block sizes:

- **Consensus Layer**: Based on validator count, attestations, deposits, and slashings
- **Execution Layer**: Based on gas limit and transaction density
- **Committee Size**: Calculated as `validators / 32 / 64`

## Scenarios

Predefined scenarios include:
- **Current Mainnet**: ~1M validators, 30M gas limit
- **High Activity**: 1.5M validators, 60M gas limit with high activity
- **Future Scale**: 2M validators, 150M gas limit
- **Extreme Scale**: 2M validators, 300M gas limit with maximum activity