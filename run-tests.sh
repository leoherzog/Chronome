#!/bin/bash
# Chronome Test Runner
# Run the test suite using gjs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Running Chronome tests..."
echo ""

gjs -m tests/runAll.js

exit_code=$?

if [ $exit_code -eq 0 ]; then
    echo ""
    echo "All tests passed!"
else
    echo ""
    echo "Some tests failed."
fi

exit $exit_code
