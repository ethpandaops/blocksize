# Ethereum Block Size Calculator

A comprehensive tool for calculating and visualizing Ethereum block sizes across different network configurations, including support for the Electra upgrade features.

## 🌐 Live Demo

**Try it online**: https://ethpandaops.github.io/blocksize/

The app runs entirely in your browser using [stlite](https://github.com/whitphx/stlite) - no server required!

## Features

- **Consensus Layer Calculations**: BeaconBlock, attestations, slashings, exits, BLS changes
- **Post-Electra Support**: Deposit requests, withdrawal requests, consolidation requests  
- **Execution Layer Modeling**: EIP-7623 effects, compression scenarios, gas limit variations
- **Interactive Visualizations**: Component breakdowns, size comparisons, parameter exploration
- **Preset Configurations**: Common network scenarios (mainnet, testnet configurations)
- **Theoretical Worst-Case Analysis**: Maximum possible block sizes under extreme conditions

## Installation

```bash
# Clone the repository
git clone https://github.com/ethpandaops/blocksizes.git
cd blocksizes

# Install dependencies using uv (recommended)
uv sync

# Or using pip
pip install -r requirements.txt
```

## Usage

### Local Development
```bash
# Run the Streamlit app locally
streamlit run app.py

# Or using the run script
./run.sh
```

The app will be available at `http://localhost:8501`

### Deployment

The app is automatically deployed to GitHub Pages using stlite. To update the deployment:

```bash
# Rebuild and deploy after making changes to app.py
./deploy.sh
```

Or manually:
```bash
# Just rebuild index.html from app.py
./build.sh

# Then commit and push
git add index.html
git commit -m "Update deployment"
git push
```

## Configuration

The calculator includes several preset network configurations and supports custom parameter adjustment for:

- Active validator counts (100k - 5M)
- Gas limits (15M - 1000M = 1 gigagas)
- All consensus layer operations with realistic limits
- EIP-7623 effects and compression scenarios

## Technical Details

### Consensus Layer Components
- **BeaconBlock/Body**: Fixed SSZ overhead (500 bytes)
- **Attestations**: EIP-7549 cross-committee aggregation support
- **Slashings**: Theoretical worst-case with maximum validator sets
- **Post-Electra**: New deposit system, withdrawal & consolidation requests

### Execution Layer Modeling
- **EIP-7623**: Calldata cost increases and size reductions
- **Transaction Types**: all_zeros, all_nonzeros, mixed, access_list scenarios
- **Compression**: Snappy compression effects on different data patterns
- **Gas Conversion**: Empirical gas-to-size conversion rates

### Deployment Architecture
- **Runtime**: [stlite](https://github.com/whitphx/stlite) (Streamlit in browser via Pyodide)
- **Hosting**: GitHub Pages (static hosting)
- **Build Process**: Dynamic `index.html` generation from `app.py`
- **Dependencies**: Bundled client-side (numpy, pandas, plotly)

## Development Scripts

- `./build.sh` - Rebuild `index.html` from `app.py`
- `./deploy.sh` - Build and deploy to GitHub Pages
- `./run.sh` - Run local Streamlit development server

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes to `app.py`
4. Test locally with `streamlit run app.py`
5. Run `./deploy.sh` to update the live demo
6. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.