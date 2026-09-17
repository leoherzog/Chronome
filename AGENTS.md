# AGENTS.md

This file provides guidance to AI Coding Agents such as Claude Code (claude.ai/code), Google Gemini, and/or OpenAI Codex when working with code in this repository.

## Project Overview

Chronome is a GNOME Shell extension that displays upcoming calendar meetings in the top panel. It integrates with Evolution Data Server (EDS) to read calendar data and shows meeting countdowns with clickable video conference links.

## Project Structure

```
Chronome/
├── extension.js           # Entry point (subprocess lifecycle, D-Bus proxy)
├── service.js             # D-Bus service entry point (EDS connections, event processing)
├── prefs.js               # Preferences window (Adw/libadwaita)
├── metadata.json          # Extension metadata (UUID, versions, etc.)
├── stylesheet.css         # Custom CSS styles
├── LICENSE                # MIT, shipped in the zip
├── release.sh             # Creates zip for extensions.gnome.org
├── run-tests.sh           # Test runner script
├── lib/                   # Process-neutral modules
│   ├── calendarUtils.js   # EDS source handling, deduplication, colors
│   ├── constants.js       # Time constants (ONE_HOUR_MS, etc.)
│   ├── dbusInterface.js   # D-Bus name, object path, interface XML
│   ├── eventUtils.js      # Event filtering, deduplication, getNextMeeting
│   ├── formatting.js      # Time/duration formatting, text truncation
│   ├── icalParser.js      # iCal date/time parsing from raw strings
│   └── meetingServices.js # Video conference URL detection (40+ patterns)
├── ui/                    # Shell-process-only modules (St/Clutter/PanelMenu)
│   └── indicator.js       # ChronomeIndicator panel button, menu, countdown timer
├── service/               # Service-process-only modules (ECal/EDataServer)
│   ├── eventProperties.js # Component property readers, PARTSTAT, all-day, video links
│   └── eventQuery.js      # Instance generation, rescheduled map, per-source query
├── schemas/
│   └── org.gnome.shell.extensions.chronome.gschema.xml
├── tests/
│   ├── runAll.js          # Test suite entry point
│   ├── runner.js          # BDD-style test framework (describe/it/expect)
│   ├── mocks.js           # Mock factory for events
│   ├── eventUtils.test.js
│   ├── formatting.test.js
│   ├── icalParser.test.js
│   ├── meetingServices.test.js
│   └── diagnose-rescheduled.js  # Manual live-EDS diagnostic (not in runAll.js)
└── .github/workflows/
    ├── release.yml        # Attaches the release zip to a published GitHub Release
    └── tests.yml          # Runs ./run-tests.sh on push and pull request
```

## Dependencies and Version Requirements

### GNOME Shell Versions

Supported versions (from `metadata.json`): **45, 46, 47, 48, 49, 50**

### GI Module Versions

The extension explicitly requires these versions:
- `ECal?version=2.0` - Evolution Calendar
- `EDataServer?version=1.2` - Evolution Data Server
- `ICalGLib` - iCalendar library; imported **unversioned** on purpose, because libical-4.x distros ship only `ICalGLib-4.0`. Every module that imports it imports `ECal?version=2.0` directly above, so the matching version is already loaded. Never replace this with a top-level `await import()` fallback: top-level await turns module evaluation into a promise job, and `GLib.MainLoop.run()` in `start()` then starves all promise resolution, silently deadlocking the refresh pipeline.

### Runtime Requirements

- GNOME Shell 45+
- Evolution Data Server (for calendar access)
- GNOME Online Accounts (optional, for cloud calendars)

## Development Commands

```bash
# Install extension locally for testing (packs only the files that ship)
./release.sh && gnome-extensions install --force chronome@herzog.tech.zip

# Enable extension
gnome-extensions enable chronome@herzog.tech

# Disable extension
gnome-extensions disable chronome@herzog.tech

# View extension logs
journalctl -f -o cat /usr/bin/gnome-shell

# Restart GNOME Shell (X11 only - on Wayland, log out and back in)
# Alt+F2 then type 'r' and press Enter
```

## Testing

### Running Tests

```bash
./run-tests.sh
# Or directly:
gjs -m tests/runAll.js
```

### Test Framework

Uses a custom minimal BDD-style test runner (`tests/runner.js`) that runs under gjs:
- `describe(name, fn)` - Define a test suite
- `it(description, fn)` - Define a test case
- `skip(description, fn)` - Skip a test
- `expect(actual)` - Jest-like assertions: `.toBe()`, `.toEqual()`, `.toBeNull()`, `.toBeTruthy()`, `.toContain()`, `.toMatch()`, `.toThrow()`, `.not.*`

### What's Tested

- `formatting.test.js` - Duration formatting, time formatting, time ranges, text truncation
- `eventUtils.test.js` - Event deduplication, recurrence-id handling, getNextMeeting logic, all-day detection
- `icalParser.test.js` - iCal property extraction, date/time parsing with timezones
- `meetingServices.test.js` - Video conference URL detection for all supported services

### Mock Factories (`tests/mocks.js`)

- `createMockEvent(options)` - Creates a plain event wrapper with `get_uid()`, `get_recurid_as_string()`, and `_instanceStart`/`_instanceEnd` fields

### Testing Philosophy

The tested modules are `eventUtils.js`, `formatting.js`, `icalParser.js` and `meetingServices.js`, which need nothing beyond `GLib`. `lib/calendarUtils.js` imports `EDataServer` and is untested. `ui/` (needs St/Clutter) and `service/` (needs ECal/EDataServer) cannot be tested outside their respective processes.

### Manual Diagnostics

`tests/diagnose-rescheduled.js` is a manual diagnostic (not part of `runAll.js`) that connects to the live Evolution Data Server. Run it with `gjs -m tests/diagnose-rescheduled.js` to see which detached instances are rescheduled off of today and which of today's expanded occurrences the skip map catches. It is read-only. Note: `gjs` may print a harmless `Segmentation fault` during interpreter teardown, after all output is complete — a known libical/GJS shutdown crash.

## Release and Packaging

### Creating a Release

```bash
./release.sh
```

This creates `chronome@herzog.tech.zip` containing:
- `metadata.json`
- `extension.js`
- `service.js`
- `prefs.js`
- `stylesheet.css`
- `LICENSE`
- `lib/`
- `service/` (service-process modules)
- `ui/` (shell-process modules)
- `schemas/org.gnome.shell.extensions.chronome.gschema.xml`

**Note:** Compiled schema (`gschemas.compiled`) is NOT included - the Shell runs `glib-compile-schemas` when the extension is installed.

### Upload Location

https://extensions.gnome.org/upload/

## GitHub Actions

### Release Workflow (`.github/workflows/release.yml`)

Automatically attaches a release zip when a GitHub Release is published:

1. Triggers on: `release: [published]`
2. Runs `./release.sh` to build the zip
3. Uploads `chronome@herzog.tech.zip` to the release using `gh release upload`

**To create a release:**
1. Create and push a git tag: `git tag v1.0 && git push --tags`
2. Create a GitHub Release from the tag
3. The workflow automatically attaches the extension zip

### Test Workflow (`.github/workflows/tests.yml`)

Installs `gjs` from apt and runs `./run-tests.sh` on every push to `main` and every pull request. `tests/runner.js` exits non-zero on failure, so a red suite fails the job.

## Architecture

### Split Architecture: Extension + D-Bus Service

The extension uses a split architecture to keep heavy computation out of the GNOME Shell process:

```
extension.js  (entry point, runs inside GNOME Shell)
    │  Spawns on enable(), kills on disable()
    │  D-Bus proxy ← EventsChanged signal
    │  └── ui/indicator.js  (panel button, menu, countdown — St/Clutter live here only)
    ▼
service.js  (computation layer, runs as subprocess)
    │  Owns EDS connections, processes events
    │  Emits EventsChanged with JSON payload
    │  └── service/  (EDS querying and component property helpers)
    ▼
lib/  (process-neutral modules)
```

**D-Bus Interface** (`tech.herzog.Chronome1` on session bus):
- **Methods**: `GetEvents() → s` (JSON), `Refresh()`, `Ping() → b`
- **Signals**: `EventsChanged(s)` (JSON payload)
- **Object path**: `/tech/herzog/Chronome`

**Data format** (JSON over D-Bus):
- `nextMeeting`: `{ startMs, endMs, title, hasVideoLink }` or `null`
- `events[]`: `{ startMs, endMs, title, videoLink, calendarColor, isAllDay, isDeclined, isTentative, isNeedsResponse }`

The extension computes locally (needs fresh `Date.now()`): `isPast`, `isCurrent`, time range formatting, countdown text, title truncation, menu filtering.

### Settings Split

| Setting | Who reads it |
|---|---|
| `enabled-calendars`, `show-current-meeting` | Service (data selection) |
| `event-types` | Both (Service: next-meeting selection, Extension: menu filtering) |
| `refresh-interval` | Service (fetch timer period) |
| `show-past-events`, `show-event-end-time`, `time-format` | Extension (display) |
| `use-calendar-colors`, `event-title-length` | Extension (display) |
| `real-time-countdown`, `status-bar-icon-type` | Extension (display) |

### Core Files

- **extension.js**: Entry point (`ChronomeExtension`), kept deliberately small so the cleanup is easy to review:
  - Subprocess lifecycle (spawn on enable, SIGTERM on disable, auto-restart with backoff)
  - D-Bus proxy for communicating with the service
  - Creates/destroys the `ChronomeIndicator` from `ui/indicator.js`

- **ui/indicator.js**: `ChronomeIndicator` class (PanelMenu.Button subclass), loaded only by the Shell process:
  - Panel label updates with countdown timers
  - Dropdown menu with today's events (from pre-computed JSON), rebuilt on each update while closed and again on open, never while open, so an open menu is not destroyed under the pointer. An empty `PopupMenu` refuses to open, so the closed menu must stay built
  - Settings signal connections for display-only settings

- **service.js**: D-Bus service entry point that handles:
  - Calendar data fetching via ECal/EDataServer async APIs
  - Event deduplication and next meeting selection
  - JSON serialization and D-Bus signal emission
  - GSettings monitoring for data-affecting settings
  - Per-source teardown through `_dropSource(uid)`, which stops the client view via `_stopView(view)` and drops the client, its metadata and its rescheduled cache

- **service/**: Modules loaded only by the service process:
  - `eventProperties.js` - Component property readers, PARTSTAT participation, all-day detection, video link detection, wrapping `ICalGLib.Component` into plain event wrappers
  - `eventQuery.js` - `generate_instances_sync` wrapping, the rescheduled-instance map, per-source event querying

- **prefs.js**: Preferences window using Adw (libadwaita) with pages for General, Appearance, and Calendars settings

- **schemas/org.gnome.shell.extensions.chronome.gschema.xml**: GSettings schema defining all configurable options

### Service Lifecycle

1. `enable()`: spawns `gjs -m service.js` via `Gio.Subprocess` with `STDIN_PIPE`. The write end closes when the Shell process dies, and `_watchParent()` in service.js treats that EOF as parent death.
2. Service registers on D-Bus, starts EDS connections, emits `EventsChanged`
3. Extension receives signal, parses JSON, updates UI
4. `disable()`: destroys the indicator, then sends SIGTERM so the service runs `_shutdown()`. Do not use `force_exit()`; SIGKILL skips that cleanup.
5. Auto-restart: `wait_async()` callback detects service death and restarts after 2s, doubling to a 60s cap. The backoff resets once a child has lived 60s.

### Internal Constants

**service.js:**
- `DEBOUNCE_MS: 500` - Debounce delay for calendar change signals
- `CLIENT_CONNECT_TIMEOUT_SEC: 10` - Timeout for EDS client connections
- `SYNC_DELAY_MS: 50` - Delay between calendar sync requests

**extension.js:**
- `SERVICE_RESTART_DELAY_SEC: 2` - Initial delay before auto-restarting a dead service
- `SERVICE_RESTART_MAX_DELAY_SEC: 60` - Upper bound on the restart backoff
- `SERVICE_HEALTHY_UPTIME_MS: 60000` - Uptime after which a child counts as healthy and the backoff resets

**ui/indicator.js:**
- `OPACITY_DIMMED: 178` (~70%) - Opacity for past/declined events
- `OPACITY_TENTATIVE: 204` (~80%) - Opacity for tentative events
- `MENU_ICON_SIZE: 16` - Icon size in dropdown menu
- `DBUS_CALL_TIMEOUT_MS: 5000` - Timeout for the `GetEvents` and `Refresh` calls

### Key Technical Details

- Uses GJS (GNOME JavaScript) with ES modules
- Imports from `gi://` for GObject introspection bindings (ECal, EDataServer, St, Clutter, etc.)
- EDS async calls are promisified with `Gio._promisify` and awaited; `generate_instances_sync` is the exception and runs inside an idle source
- Blocking operations wrapped in `GLib.idle_add()` to avoid freezing the service main loop
- Real-time countdown uses `GLib.timeout_add_seconds` timers in ui/indicator.js
- Calendar change notifications via `ECalClientView` signals with debounced refresh in service
- Rescheduled instance detection uses per-source caching with automatic invalidation
- Video link detection uses regex patterns from MeetingBar project

### Stylesheet (`stylesheet.css`)

Custom CSS classes:
- `.chronome-current-event` - Highlights ongoing events in the menu with subtle blue background
- `.chronome-color-bar` - Colored left border showing the source calendar's color
- `.chronome-time-label` / `.chronome-time-label-wide` - Fixed-width time column in the menu (wide variant when end times are shown)
- `.chronome-video-icon` - Spacing for the video conference link icon

## Utility Modules (`lib/`)

`lib/` holds modules that import neither St/Clutter nor ECal/EDataServer; each file's header names the process that loads it. Most of it is pure and testable with `gjs -m` outside GNOME Shell, but `calendarUtils.js` imports `EDataServer` and `icalParser.js` imports `GLib`.

### `dbusInterface.js`
- `DBUS_NAME`, `DBUS_PATH`, `DBUS_IFACE_XML` - The bus name, object path and interface XML, imported by both `extension.js` and `service.js`. Imports nothing, so either process can load it.

### `constants.js`
Time constants in milliseconds:
- `ONE_SECOND_MS` (1000)
- `ONE_MINUTE_MS` (60000)
- `FIVE_MINUTES_MS` (300000)
- `ONE_HOUR_MS` (3600000)

### `formatting.js`
- `formatDuration(ms, _)` - Human-readable duration ("5 minutes", "1 hour 30 min")
- `formatTime(date, use24Hour)` - Format time ("1:30 PM" or "13:30")
- `formatTimeRange(startTs, endTs, showEndTime, use24Hour)` - Format range ("9:30 AM - 10:30 AM")
- `truncateText(text, maxLength)` - Truncate with ellipsis

### `eventUtils.js`
- `hasRecurrenceId(event)` - Check if event is a detached instance
- `getEventDedupeKey(event, getEventStart)` - Generate UID:timestamp key
- `deduplicateEvents(events, getEventStart)` - Remove duplicates, prefer exceptions
- `isAllDayEventHeuristic(startTime, endTime)` - Detect all-day events
- `getCurrentMeetings(events, options)` - Ongoing meetings with at least `minRemainingMs` left, sorted by end time
- `getNextMeeting(events, options)` - Select next/current meeting with filtering
- `sortEventsByStartTime(events, getEventStart)` - Sort in place by start time

### `icalParser.js`
- `extractIcalProperty(icalStr, propName)` - Extract raw property from iCal
- `parseIcalDateTime(icalStr, propName)` - Parse to timestamp with timezone handling
- `resolveTimezone(tzid)` - Resolve a TZID to a `GLib.TimeZone`, working around `GLib.TimeZone.new()`'s silent UTC fallback for globally-unique TZIDs (e.g. `/freeassociation.sourceforge.net/Europe/London`, seen on GNOME Calendar's local calendars) by stripping the domain prefix and retrying with the plain Olson name

### `calendarUtils.js`
- `getCalendarColor(source)` - Get hex color from EDS source
- `getAccountEmailForSource(source, registry)` - Get authenticated user's email
- `getCalendarIdForSource(source)` - Extract canonical calendar ID from WebDAV path
- `getCalendarPrivilegeScore(calendarId, accountEmail, isReadonly)` - Calculate owner/editor/readonly score; `isReadonly` defaults to `true`, so a caller with no read-only map scores every non-owner calendar as read-only.
- `deduplicateSources(sources, registry, readonlyMap)` - Remove duplicate calendars across accounts

### `meetingServices.js`
- `findMeetingUrl(text)` - Find video conference URL in text
- Supports 40+ services: Zoom, Teams, Meet, Webex, Jitsi, etc.
- Patterns from MeetingBar project

## Shell UI Modules (`ui/`)

Loaded only by the GNOME Shell process. These may import `St`, `Clutter`, `PanelMenu` and `PopupMenu`; nothing here may ever be imported by `prefs.js` or `service.js`.

### `indicator.js`
- `ChronomeIndicator` - `PanelMenu.Button` subclass owning the panel label, icon, dropdown menu, the one-second countdown timer, and its own settings signal connections. All of it is torn down in `destroy()`.

## Service Modules (`service/`)

Loaded only by the service subprocess. These may import `ECal`/`EDataServer`/`ICalGLib`; nothing here may ever be imported by the Shell process.

### `eventProperties.js`
- `icalTimeToTimestamp(icalTime)` - `ICalGLib.Time` → epoch milliseconds
- `getEventStart(event)` / `getEventEnd(event)` - Instance times, falling back to DTSTART + 1h
- `getPropertyString(event, methodName)` / `getEventTitle(event)` - Safe component property reads
- `isAllDayEvent(event)` - `dtStart.is_date()` check
- `hasCurrentUserPartstat(event, targetPartstat)` - Attendee PARTSTAT lookup for the account's own address
- `isDeclinedEvent(event)` / `isTentativeEvent(event)` / `isNeedsResponseEvent(event)`. `isDeclinedEvent` falls back to a `declined:`/`rejected:` prefix on the title, anchored to the start, for backends that drop PARTSTAT.
- `findVideoLink(event)` - Video conference URL from location, then description, then a scan of the whole serialized component
- `wrapICalComponent(comp, instanceStartMs, instanceEndMs, accountEmail, calendarColor, recurrenceIdStartMs)` - Wrap a component with its instance times and metadata

### `eventQuery.js`
- `generateInstancesAsync(service, client, startTimet, endTimet, cancellable)` - `generate_instances_sync()` deferred through `GLib.idle_add()`
- `buildRescheduledMapAsync(service, client, sourceUid, todayDateStr, todayStartMs, todayEndMs)` - Phase 1 of the two-phase query (see "Two-Phase Query Architecture")
- `queryEventsAsync(service, client, sourceUid)` - Full per-source event query

## GSettings Keys Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `refresh-interval` | int | 60 | Calendar data refresh interval (30-300 seconds) |
| `real-time-countdown` | bool | true | Update countdown every second |
| `time-format` | string | '12h' | Time display format ('12h' or '24h') |
| `event-title-length` | int | 30 | Max characters for event titles in panel |
| `event-types` | string[] | ['all-day', 'regular', 'declined', 'tentative'] | Which event types to display |
| `show-past-events` | bool | false | Show events that have ended in menu |
| `show-event-end-time` | bool | true | Show end time in menu items |
| `status-bar-icon-type` | string | 'calendar' | Panel icon: 'calendar', 'meeting-type', or 'none' |
| `show-current-meeting` | bool | true | Show ongoing meeting instead of next one |
| `enabled-calendars` | string[] | [] | Calendar UIDs to show (empty = all) |
| `use-calendar-colors` | bool | false | Show colored left border from calendar color |

### Settings Change Behavior

**Service side (triggers re-fetch and EventsChanged signal):**
- `enabled-calendars`, `event-types`, `show-current-meeting`
- `refresh-interval` (restarts fetch timer)

**Extension side (local UI update from cached data):**
- `show-past-events`, `show-event-end-time`, `time-format`, `use-calendar-colors`, `event-types` (menu re-render)
- `real-time-countdown`, `event-title-length` (label update only)
- `status-bar-icon-type` (icon update only)

Opening the Calendars page in prefs prunes `enabled-calendars` of UIDs that no longer resolve in the registry, which can write the key once and trigger one service re-fetch.

## Code Conventions

### Import Patterns

**GNOME Shell Resources (Shell process only — `extension.js` and `ui/`):**
```javascript
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
```

**Preferences (prefs.js only):**
```javascript
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
```

**GObject Introspection:**
```javascript
import GObject from 'gi://GObject';
import ECal from 'gi://ECal?version=2.0';
```

**Local modules:**
```javascript
import {functionName} from './lib/moduleName.js';
import {functionName} from '../lib/moduleName.js';  // from ui/ or service/
```

### Naming Conventions

- Private methods/properties: prefix with underscore (`_refreshEvents`, `_clients`)
- Constants: UPPER_SNAKE_CASE in objects (`CONSTANTS.ONE_HOUR_MS`)
- Exported constants: UPPER_SNAKE_CASE (`export const ONE_MINUTE_MS`)
- GObject class registration: requires unique `GTypeName`

### Error Handling

- Only use try/catch around awaited EDS calls, which reject with GError
- Do NOT use try-catch around property getters, signal connections, `destroy()`, `disconnect()` or `GLib.Source.remove()`
- Use `console.debug()` for non-critical warnings
- Use `console.error()` for actual errors
- Silent failures for operations that commonly fail (calendar sync not supported)

### Review Guidelines

Chronome is submitted to extensions.gnome.org, so edits must stay inside the [review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) and [best practices](https://gjs.guide/extensions/review-guidelines/best-practices.html). The rules this file does not cover elsewhere:

- No `?.()` or `typeof x === 'function'` on a guaranteed API
- Lines of 200 columns at most
- A custom `destroy()` runs in this order: sources, signals, references, then `super.destroy()`

## Common Pitfalls for AI Agents

### Async Safety (service.js)

1. **Check the cancellable**: a continuation that resumes after an `await` re-checks `this._cancellable.is_cancelled()` before touching state. `_shutdown()` cancels it and never nulls it, so it stays readable for the life of the process. Do not add a separate shutdown boolean.

2. **Awaited EDS calls**: the service promisifies its EDS calls and awaits them, filtering `CANCELLED` out of the catch:
   ```javascript
   if (this._cancellable.is_cancelled()) return;
   try {
       await client.refresh(this._cancellable);
   } catch (e) {
       if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
       if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED))
           console.debug(`Chronome service: Calendar sync failed: ${e.message}`);
   }
   ```

`ChronomeIndicator` uses no lifecycle flag and tears down in `destroy()`. Do not copy the service's cancellable pattern into `ui/` or `extension.js`.

### Promisified EDS Results (service.js)

`Gio._promisify` shifts off a leading `true`, so a promisified `gboolean fn(…, out X)` resolves to `[X]`, not the `[ok, X]` its `*_sync` variant returns. Read index 0, never `[, value]`:

```javascript
[storedComps] = await client.get_object_list_as_comps(query, cancellable);
```

Calls whose `*_finish` returns the value directly (`ECal.Client.connect`, `SourceRegistry.new`, `read_bytes_async`) are unaffected; so is `refresh` (no out-arg, return value unused).

### GLib Timer Management

- Use `GLib.timeout_add_seconds()` not `setTimeout()`
- **ui/indicator.js**: Display timer removed by `_stopTimer()`, called from `startTimer()` and `destroy()`; **extension.js**: restart timeout removed in `disable()`
- **service.js**: ALL GLib sources must be removed in `_shutdown()`. Named timers (fetch, debounce) tracked individually. Fire-and-forget sources use `this._sourceIds` Set:
  ```javascript
  const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      this._sourceIds.delete(id);
      // ... callback logic ...
      return GLib.SOURCE_REMOVE;
  });
  this._sourceIds.add(id);
  ```

### Blocking Operations (service.js)

- Never call synchronous EDS methods directly at startup
- Wrap with `GLib.idle_add()` to defer execution:
  ```javascript
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      // Potentially blocking operation here
      return GLib.SOURCE_REMOVE;
  });
  ```

### Settings Signal Cleanup

Always disconnect signals during cleanup, collecting their ids in an array:
- **ui/indicator.js**: In `destroy()` of `ChronomeIndicator`
- **service.js**: In `_shutdown()`, for both `_settingsSignals` and `_registrySignals`

```javascript
for (const id of this._settingsSignals) {
    this._settings.disconnect(id);
}
```

### Cancellable for Async Operations (service.js)

One `Gio.Cancellable` is passed to every EDS call and cancelled in `_shutdown()`, where it also serves as the reentrancy guard:
```javascript
this._cancellable = new Gio.Cancellable();
// In _shutdown:
this._cancellable.cancel();
```

## Event Handling

Events are fetched in `service.js` using async wrappers around `ECal.Client.generate_instances_sync()` which properly expands recurring events. Key implementation details:

- **Non-blocking async**: All EDS operations are promisified or deferred through idle callbacks to avoid blocking the service main loop
- **Deduplication**: Events are deduplicated by UID + start time, preferring exceptions over master occurrences
- **ICalGLib.Component wrapping**: The callback returns `ICalGLib.Component` objects (not `ECal.Component`), which are wrapped with instance times and proxy methods
- **JSON serialization**: Service converts event wrappers to plain JSON objects and emits via D-Bus `EventsChanged` signal

The service also computes:
- Current user's participation status (accepted/declined/tentative) via attendee parsing
- All-day events via `dtStart.is_date()` check
- Video conference URLs in location and description fields
- Next meeting selection (exported in `nextMeeting` field)

## Recurring Event and Detached Instance Handling

EDS uses iCalendar concepts for recurring events. Understanding these is critical for correct display:

### Key Concepts

- **Master recurring event**: Has `RRULE` (e.g., `FREQ=WEEKLY;BYDAY=WE`) defining the recurrence pattern
- **Detached instance**: A modified occurrence of a recurring event, identified by `RECURRENCE-ID` property
- **RECURRENCE-ID**: Points to the original occurrence date that was modified
- **DTSTART**: The actual start time of the event (may differ from RECURRENCE-ID if rescheduled)

### Rescheduled Instance Behavior

When a recurring event instance is rescheduled (e.g., moved from Dec 10 to Dec 17), EDS stores a detached instance with:
- `RECURRENCE-ID`: Original date (Dec 10) - the original occurrence being modified
- `DTSTART`: New date (Dec 17) - the actual scheduled time

`generate_instances_sync()` behavior:
- Returns detached instances when the query range matches their `RECURRENCE-ID`
- Sets the callback's `instanceStart`/`instanceEnd` parameters to the `RECURRENCE-ID` time, not `DTSTART`
- Modifies the component's `get_dtstart()` to return the `RECURRENCE-ID` time

The `occur-in-time-range?` query filters by stored `DTSTART`, not `RECURRENCE-ID`, so it won't find rescheduled events by their original date.

### Two-Phase Query Architecture

To correctly handle rescheduled instances efficiently:

1. **Phase 1**: Query recurring events and detached instances with `get_object_list_as_comps('(or (has-recurrences? #t) (contains? "recurrence-id" ""))')` (async)
   - Much smaller dataset than querying all events with `'#t'`
   - Results are cached per calendar source (`_rescheduledCache`)
2. **Build a rescheduled instances map**: parse `RECURRENCE-ID` and `DTSTART` to instants with `parseIcalDateTime()` and compare them against today's local bounds. A detached instance whose `RECURRENCE-ID` falls inside today and whose `DTSTART` does not is recorded in `rescheduledFromToday`, a `Set` of UIDs, so every same-day occurrence of that UID is skipped.
3. **Phase 2**: Use `generate_instances_sync()` wrapped in `GLib.idle_add()` to expand recurring events without blocking
4. **Filter**: Skip detached instances that appear in the rescheduled map

### Caching Strategy

- **Per-source cache**: `_rescheduledCache` is a `Map<sourceUid, {rescheduledFromToday, movedToToday}>`
- **Date invalidation**: Entire cache is cleared when the date changes
- **Signal-based invalidation**: `ECalClientView` signals (`objects-added/modified/removed`) invalidate only the affected source's cache
- **Source changes**: Registry signals (`source-added/changed/removed`) invalidate only the affected source; the whole cache is cleared only when the signal carries no source

### iCal String Parsing

Since `generate_instances_sync` modifies the component, read the dates from the raw iCal string instead of the component:

```javascript
const parsedRecurId = parseIcalDateTime(icalStr, 'RECURRENCE-ID');
const parsedStart = parseIcalDateTime(icalStr, 'DTSTART');
```

Compare the parsed instants, never the wire `YYYYMMDD` text: a property stored in UTC or under a foreign TZID has a different calendar date from the viewer's.

### Component Types

- `generate_instances_sync` callback receives `ICalGLib.Component` (from libical)
- `get_object_list_as_comps` returns `ECal.Component` (Evolution wrapper)
- Method names differ:
  - `ICalGLib.Component`: `as_ical_string()`, `get_recurrenceid()`
  - `ECal.Component`: `get_as_string()`, `get_recurid_as_string()`
- **`get_recurrenceid()` never returns null**: libical returns a truthy all-zero "null time" object for components without a RECURRENCE-ID (stringified: `00000000T000000`). Always guard with `is_null_time()` before treating the result as a real recurrence id.

### Callback Parameter Types

The `generate_instances_sync` callback signature is:
```javascript
(comp, instanceStart, instanceEnd) => { ... }
```

- `comp`: `ICalGLib.Component` - the event component (may be modified!)
- `instanceStart`: `ICalGLib.Time` object (NOT a number!) - must convert with `icalTimeToTimestamp()` (service/eventProperties.js)
- `instanceEnd`: `ICalGLib.Time` object (NOT a number!)

### When to Show vs Skip Detached Instances

Both instants are tested against today's local bounds.

| Scenario | RECURRENCE-ID | DTSTART | Action |
|----------|---------------|---------|--------|
| Modified in place | today | today | SHOW (location/attendee changes) |
| Rescheduled off today | today | another day | SKIP (appears on its new day) |
| Rescheduled onto today | another day | today | SHOW (added from `movedToToday`) |

### Reference: GNOME Calendar Approach

GNOME Calendar handles this similarly - see merge requests:
- [MR !262 - Fix for recurring events shift bug](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/262)
- [MR !266 - Various fixes to recurrent events handling](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/266)
