#!/bin/bash
set -e

echo "🔗 Starting Ethereum Block Size Calculator..."

# Check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "❌ uv not found. Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # Add uv to PATH for current session
    export PATH="$HOME/.cargo/bin:$PATH"
fi

# Install dependencies
echo "📦 Installing dependencies..."
uv sync

# Run the app
echo "🚀 Starting Streamlit app..."
echo "📱 Open http://localhost:8501 in your browser"
uv run streamlit run app.py