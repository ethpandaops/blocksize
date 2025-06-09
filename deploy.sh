#!/bin/bash

# Deploy script for stlite GitHub Pages
# Builds and deploys the app to deploy-pages branch

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

# Get current commit for reference
CURRENT_COMMIT=$(git rev-parse HEAD)

echo "2️⃣ Creating deployment branch..."

# Create or switch to deploy-pages branch
git checkout -B deploy-pages

# Add only the files needed for deployment
git add index.html
git add app.py  # Keep source for reference
git add build.sh  # Keep build script  
git add requirements.txt  # Keep dependencies list
git add README.md  # Keep documentation

# Commit the deployment
git commit -m "🚀 Deploy stlite to GitHub Pages

- Rebuilt index.html from app.py
- Source commit: $CURRENT_COMMIT
- Manual deployment via deploy.sh

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push to deploy-pages branch
echo "3️⃣ Pushing to deploy-pages branch..."
git push origin deploy-pages --force

# Switch back to master
git checkout master

echo "✅ Deployment complete!"
echo "🌐 Your app will be available at: https://ethpandaops.github.io/blocksize/"
echo "⏱️  GitHub Pages may take a few minutes to update"
echo "📝 Source commit: $CURRENT_COMMIT"