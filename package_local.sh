#!/bin/bash

DEST_DIR="$HOME/Downloads"
ZIP_NAME="sp-grafana-local.zip"
OUTPUT_PATH="$DEST_DIR/$ZIP_NAME"

# Ensure Downloads directory exists
mkdir -p "$DEST_DIR"

echo "Packaging plugin to $OUTPUT_PATH..."

# Remove old zip if exists
rm -f "$OUTPUT_PATH"

# Zip specific files
zip "$OUTPUT_PATH" manifest.json index.html plugin.js

echo "Done! Plugin packaged at: $OUTPUT_PATH"
