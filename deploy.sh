#!/bin/bash

# Deploy script for stlite GitHub Pages
# Builds and deploys the app to GitHub Pages

set -e

echo "🚀 Deploying Ethereum Block Size Calculator to GitHub Pages..."

# Build the index.html
echo "1️⃣ Building stlite deployment..."
./build.sh

# Check if there are changes to commit
if git diff --quiet index.html; then
    echo "ℹ️  No changes to index.html, skipping deployment"
    exit 0
fi

# Stage and commit changes
echo "2️⃣ Committing changes..."
git add index.html

git commit -m "Update stlite deployment

- Rebuild index.html from app.py
- Deploy latest changes to GitHub Pages

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push to GitHub
echo "3️⃣ Pushing to GitHub..."
git push origin master

echo "✅ Deployment complete!"
echo "🌐 Your app will be available at: https://ethpandaops.github.io/blocksize/"
echo "⏱️  GitHub Pages may take a few minutes to update"