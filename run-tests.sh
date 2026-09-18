#!/bin/bash
# Chronome Test Runner
# Runs the unit suite under gjs, then the live suite against a throwaway Evolution Data Server session.
# Usage: ./run-tests.sh [--unit | --live]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Zones on both sides of Greenwich, so the local day and the UTC day disagree in each direction.
LIVE_TIMEZONES=(America/Los_Angeles Pacific/Auckland)

MODE="${1:-all}"
LIVE_DIR=""

cleanup() {
    [ -n "$LIVE_DIR" ] && rm -rf "$LIVE_DIR"
    return 0
}
trap cleanup EXIT

run_unit() {
    echo "Running Chronome unit tests..."
    echo ""
    TZ=UTC gjs -m tests/runAll.js
}

live_missing() {
    command -v dbus-run-session >/dev/null || { echo "dbus-run-session"; return; }
    gjs -c "imports.gi.versions.ECal = '2.0'; imports.gi.ECal;" 2>/dev/null || echo "the ECal typelib (evolution-data-server)"
}

# Each zone gets its own bus and its own XDG directories. The EDS factories are activated by that bus and inherit
# its environment, so they keep their calendars under LIVE_DIR and exit with the bus. The keyfile GSettings backend
# keeps the suite and the service on one settings store without touching dconf.
run_live() {
    glib-compile-schemas schemas/

    for zone in "${LIVE_TIMEZONES[@]}"; do
        LIVE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chronome-live.XXXXXX")"
        echo ""
        env TZ="$zone" \
            CHRONOME_LIVE_TEST_DIR="$LIVE_DIR" \
            XDG_DATA_HOME="$LIVE_DIR/data" \
            XDG_CONFIG_HOME="$LIVE_DIR/config" \
            XDG_CACHE_HOME="$LIVE_DIR/cache" \
            GSETTINGS_BACKEND=keyfile \
            dbus-run-session -- gjs -m tests/live/runLive.js 2> "$LIVE_DIR/stderr.log" || {
                echo ""
                echo "Live suite failed in $zone. Session log:"
                grep -v '^dbus-daemon' "$LIVE_DIR/stderr.log" || true
                return 1
            }
        rm -rf "$LIVE_DIR"
        LIVE_DIR=""
    done
}

status=0

if [ "$MODE" != "--live" ]; then
    run_unit || status=1
fi

if [ "$MODE" != "--unit" ]; then
    missing="$(live_missing)"
    if [ -z "$missing" ]; then
        run_live || status=1
    elif [ "$MODE" = "--live" ]; then
        echo "Live suite needs $missing."
        status=1
    else
        echo ""
        echo "Skipping the live suite: $missing is not installed."
    fi
fi

echo ""
if [ "$status" -eq 0 ]; then
    echo "All tests passed!"
else
    echo "Some tests failed."
fi
exit "$status"
