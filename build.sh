#!/bin/bash

# Build script for stlite GitHub Pages deployment
# Dynamically embeds app.py content into index.html template

set -e

APP_FILE="app.py"
INDEX_FILE="index.html"
TEMPLATE_FILE="index.template.html"

echo "🔧 Building stlite deployment from $APP_FILE..."

# Check if app.py exists
if [ ! -f "$APP_FILE" ]; then
    echo "❌ Error: $APP_FILE not found!"
    exit 1
fi

# Read app.py content and escape it for JavaScript string
echo "📖 Reading $APP_FILE content..."
APP_CONTENT=$(cat "$APP_FILE" | sed 's/\\/\\\\/g' | sed 's/`/\\`/g' | sed 's/\$/\\$/g')

# Create the index.html with embedded app content
echo "🚀 Generating $INDEX_FILE..."

# Create the HTML template with app content embedded
cat > "$INDEX_FILE" << EOF
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Ethereum Electra Block Size Calculator</title>
    <meta name="description" content="Calculate Ethereum block sizes for various configurations including Electra upgrade features" />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@stlite/browser@0.76.0/build/style.css"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module">
      import { mount } from "https://cdn.jsdelivr.net/npm/@stlite/browser@0.76.0/build/stlite.js";
      
      mount(
        {
          entrypoint: "app.py",
          files: {
            "app.py": \`$APP_CONTENT\`,
          },
          requirements: ["streamlit", "numpy", "pandas", "plotly"],
        },
        document.getElementById("root"),
      );
    </script>
  </body>
</html>
EOF

echo "✅ Successfully built $INDEX_FILE"
echo "📏 File size: $(wc -c < "$INDEX_FILE") bytes"
echo "📄 Lines: $(wc -l < "$INDEX_FILE") lines"

# Validate the generated file
if [ -s "$INDEX_FILE" ]; then
    echo "✅ Validation: $INDEX_FILE is not empty"
else
    echo "❌ Error: Generated $INDEX_FILE is empty!"
    exit 1
fi

echo "🎯 Ready for deployment! Run 'git add $INDEX_FILE && git commit -m \"Update stlite deployment\" && git push' to deploy"