#!/bin/bash
# Chronome Test Runner
# Run the test suite using gjs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Running Chronome tests..."
echo ""

if TZ=UTC gjs -m tests/runAll.js; then
    echo ""
    echo "All tests passed!"
else
    echo ""
    echo "Some tests failed."
    exit 1
fi
