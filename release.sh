#!/bin/bash

# Release script for Chronome GNOME Shell Extension
# Creates a zip file ready for upload to extensions.gnome.org

set -e

EXTENSION_UUID="chronome@herzog.tech"
OUTPUT_FILE="${EXTENSION_UUID}.zip"

# Remove existing zip if present
rm -f "$OUTPUT_FILE"

# Create the zip file with required extension files
zip -r "$OUTPUT_FILE" \
    metadata.json \
    extension.js \
    prefs.js \
    stylesheet.css \
    lib/ \
    schemas/org.gnome.shell.extensions.chronome.gschema.xml

echo "Created $OUTPUT_FILE"
echo ""
echo "Contents:"
unzip -l "$OUTPUT_FILE"
echo ""
echo "Upload to: https://extensions.gnome.org/upload/"
