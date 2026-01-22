# AGENTS.md

This file provides guidance to AI Coding Agents such as Claude Code (claude.ai/code), Google Gemini, and/or OpenAI Codex when working with code in this repository.

## Project Overview

Chronome is a GNOME Shell extension that displays upcoming calendar meetings in the top panel. It integrates with Evolution Data Server (EDS) to read calendar data and shows meeting countdowns with clickable video conference links.

## Project Structure

```
Chronome/
├── extension.js           # Main extension code (ChronomeIndicator class)
├── prefs.js               # Preferences window (Adw/libadwaita)
├── metadata.json          # Extension metadata (UUID, versions, etc.)
├── stylesheet.css         # Custom CSS styles
├── release.sh             # Creates zip for extensions.gnome.org
├── run-tests.sh           # Test runner script
├── lib/                   # Utility modules (testable without GNOME Shell)
│   ├── calendarUtils.js   # EDS source handling, deduplication, colors
│   ├── constants.js       # Time constants (ONE_HOUR_MS, etc.)
│   ├── eventUtils.js      # Event filtering, deduplication, getNextMeeting
│   ├── formatting.js      # Time/duration formatting, text truncation
│   ├── icalParser.js      # iCal date/time parsing from raw strings
│   └── meetingServices.js # Video conference URL detection (40+ patterns)
├── schemas/
│   └── org.gnome.shell.extensions.chronome.gschema.xml
├── tests/
│   ├── runAll.js          # Test suite entry point
│   ├── runner.js          # BDD-style test framework (describe/it/expect)
│   ├── mocks.js           # Mock factories for events, settings, sources
│   ├── eventUtils.test.js
│   ├── formatting.test.js
│   ├── icalParser.test.js
│   └── meetingServices.test.js
└── .github/workflows/
    └── release.yml        # GitHub Actions release workflow
```

## Dependencies and Version Requirements

### GNOME Shell Versions

Supported versions (from `metadata.json`): **45, 46, 47, 48, 49**

### GI Module Versions

The extension explicitly requires these versions:
- `ECal?version=2.0` - Evolution Calendar
- `EDataServer?version=1.2` - Evolution Data Server
- `ICalGLib?version=3.0` - iCalendar library

### Runtime Requirements

- GNOME Shell 45+
- Evolution Data Server (for calendar access)
- GNOME Online Accounts (optional, for cloud calendars)

## Development Commands

```bash
# Compile GSettings schema (required after schema changes)
glib-compile-schemas schemas/

# Install extension locally for testing
cp -r . ~/.local/share/gnome-shell/extensions/chronome@herzog.tech/

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

- `createMockEvent(options)` - Creates mock event objects with iCal strings
- `createMockSettings(overrides)` - Creates mock GSettings object
- `createMockSource(options)` - Creates mock EDataServer source

### Testing Philosophy

Only `lib/` modules are tested - they are pure functions with no GNOME Shell dependencies. The main `extension.js` cannot be tested outside GNOME Shell.

## Release and Packaging

### Creating a Release

```bash
./release.sh
```

This creates `chronome@herzog.tech.zip` containing:
- `metadata.json`
- `extension.js`
- `prefs.js`
- `stylesheet.css`
- `lib/` (all utility modules)
- `schemas/org.gnome.shell.extensions.chronome.gschema.xml`

**Note:** Compiled schema (`gschemas.compiled`) is NOT included - extensions.gnome.org compiles it during review.

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

## Architecture

### Core Files

- **extension.js**: Main extension code with `ChronomeIndicator` class (PanelMenu.Button subclass) that handles:
  - Calendar data fetching via ECal/EDataServer async APIs
  - Panel label updates with countdown timers
  - Dropdown menu with today's events
  - Video conferencing link detection and launching

- **prefs.js**: Preferences window using Adw (libadwaita) with pages for General, Appearance, and Calendars settings

- **schemas/org.gnome.shell.extensions.chronome.gschema.xml**: GSettings schema defining all configurable options

### Internal Constants (extension.js)

- `DEBOUNCE_MS: 500` - Debounce delay for calendar change signals
- `CLIENT_CONNECT_TIMEOUT_SEC: 10` - Timeout for EDS client connections
- `SYNC_DELAY_MS: 50` - Delay between calendar sync requests
- `OPACITY_DIMMED: 178` (~70%) - Opacity for past/declined events
- `OPACITY_TENTATIVE: 204` (~80%) - Opacity for tentative events
- `MENU_ICON_SIZE: 16` - Icon size in dropdown menu

### Key Technical Details

- Uses GJS (GNOME JavaScript) with ES modules
- Imports from `gi://` for GObject introspection bindings (ECal, EDataServer, St, Clutter, etc.)
- Async calendar operations use Promise wrappers around EDS callback-based APIs
- Blocking operations wrapped in `GLib.idle_add()` to avoid freezing GNOME Shell on login
- Real-time countdown uses `GLib.timeout_add_seconds` timers
- Calendar change notifications via `ECalClientView` signals with debounced refresh
- Rescheduled instance detection uses per-source caching with automatic invalidation
- Video link detection uses regex patterns from MeetingBar project

### Stylesheet (`stylesheet.css`)

Custom CSS classes:
- `.chronome-current-event` - Highlights ongoing events in the menu with subtle blue background

## Utility Modules (`lib/`)

All `lib/` modules are pure functions that can be tested with `gjs -m` outside GNOME Shell.

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
- `getNextMeeting(events, options)` - Select next/current meeting with filtering

### `icalParser.js`
- `extractIcalProperty(icalStr, propName)` - Extract raw property from iCal
- `parseIcalDateTime(icalStr, propName)` - Parse to timestamp with timezone handling
- `extractIcalDateString(icalStr, propName)` - Extract YYYYMMDD date portion

### `calendarUtils.js`
- `getCalendarColor(source)` - Get hex color from EDS source
- `getAccountEmailForSource(source, registry)` - Get authenticated user's email
- `getCalendarIdForSource(source)` - Extract canonical calendar ID from WebDAV path
- `getCalendarPrivilegeScore(calendarId, accountEmail, isReadonly)` - Calculate owner/editor/readonly score
- `deduplicateSources(sources, registry, readonlyMap)` - Remove duplicate calendars across accounts

### `meetingServices.js`
- `findMeetingUrl(text)` - Find video conference URL in text
- Supports 40+ services: Zoom, Teams, Meet, Webex, Jitsi, etc.
- Patterns from MeetingBar project

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

- **Full refresh triggers:** `enabled-calendars`, `show-current-meeting`, `event-types`, `show-past-events`, `show-event-end-time`, `time-format`, `use-calendar-colors`
- **Label update only:** `real-time-countdown`, `event-title-length`
- **Icon update only:** `status-bar-icon-type`

## Code Conventions

### Import Patterns

**GNOME Shell Resources (extension.js only):**
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
```

### Naming Conventions

- Private methods/properties: prefix with underscore (`_refreshEvents`, `_clients`)
- Constants: UPPER_SNAKE_CASE in objects (`CONSTANTS.ONE_HOUR_MS`)
- Exported constants: UPPER_SNAKE_CASE (`export const ONE_MINUTE_MS`)
- GObject class registration: requires unique `GTypeName`

### Error Handling

- Wrap EDS operations in try/catch
- Use `console.debug()` for non-critical warnings
- Use `console.error()` for actual errors
- Silent failures for operations that commonly fail (calendar sync not supported)

## Common Pitfalls for AI Agents

### Async Safety

1. **Check `_destroyed` flag**: Always check `if (this._destroyed) return;` at the start of async callbacks to prevent post-destruction updates

2. **Callback wrapping**: EDS async operations use callbacks, not Promises. The extension wraps them:
   ```javascript
   client.refresh(null, (obj, res) => {
       if (this._destroyed) return;  // CRITICAL
       try { obj.refresh_finish(res); } catch (e) { ... }
   });
   ```

### GLib Timer Management

- Use `GLib.timeout_add_seconds()` not `setTimeout()`
- Always store timer ID and remove in `destroy()`:
  ```javascript
  if (this._fetchTimeout) {
      GLib.Source.remove(this._fetchTimeout);
      this._fetchTimeout = null;
  }
  ```

### Blocking Operations

- Never call synchronous EDS methods directly during extension load
- Wrap with `GLib.idle_add()` to defer execution:
  ```javascript
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      // Potentially blocking operation here
      return GLib.SOURCE_REMOVE;
  });
  ```

### Component Type Confusion

Different EDS APIs return different component types:
- `generate_instances_sync` callback: `ICalGLib.Component`
- `get_object_list_as_comps`: `ECal.Component`

Methods differ:

| Operation | ICalGLib.Component | ECal.Component |
|-----------|-------------------|----------------|
| Get iCal string | `as_ical_string()` | `get_as_string()` |
| Get recurrence ID | `get_recurrenceid()` | `get_recurid_as_string()` |

### Settings Signal Cleanup

Always disconnect settings signals in `destroy()`:
```javascript
for (const id of this._settingsSignals) {
    this._settings.disconnect(id);
}
```

### Cancellable for Async Operations

Use `Gio.Cancellable` for EDS async operations and cancel in `destroy()`:
```javascript
this._cancellable = new Gio.Cancellable();
// In destroy:
this._cancellable.cancel();
```

## Event Handling

Events are fetched using async wrappers around `ECal.Client.generate_instances_sync()` which properly expands recurring events. Key implementation details:

- **Non-blocking async**: All EDS operations use async patterns (callbacks wrapped in Promises, idle callbacks) to avoid blocking GNOME Shell startup
- **Recurring event expansion**: Uses `generate_instances_sync()` wrapped in `GLib.idle_add()` to get actual occurrence times without blocking
- **Deduplication**: Events are deduplicated by UID + start time, preferring exceptions over master occurrences
- **ICalGLib.Component wrapping**: The callback returns `ICalGLib.Component` objects (not `ECal.Component`), which are wrapped with instance times and proxy methods

The extension also tracks:
- Current user's participation status (accepted/declined/tentative) via attendee parsing
- All-day events via `dtStart.is_date()` check
- Video conference URLs in location and description fields

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
2. **Build a rescheduled instances map**: Find detached instances where:
   - `RECURRENCE-ID` date (from iCal string regex) matches today
   - `DTSTART` date (from iCal string regex) is DIFFERENT from RECURRENCE-ID
   - Store as `Map<"UID:RECURRENCE-ID-DATE", "DTSTART-DATE">`
3. **Phase 2**: Use `generate_instances_sync()` wrapped in `GLib.idle_add()` to expand recurring events without blocking
4. **Filter**: Skip detached instances that appear in the rescheduled map

### Caching Strategy

- **Per-source cache**: `_rescheduledCache` is a `Map<sourceUid, Map<key, value>>`
- **Date invalidation**: Entire cache is cleared when the date changes
- **Signal-based invalidation**: `ECalClientView` signals (`objects-added/modified/removed`) invalidate only the affected source's cache
- **Source changes**: Registry signals (`source-added/changed/removed`) clear the entire cache

### iCal String Parsing

Since `generate_instances_sync` modifies the component, extract dates from raw iCal strings:

```javascript
// Extract RECURRENCE-ID date (YYYYMMDD)
const recurIdMatch = icalStr.match(/RECURRENCE-ID[^:]*:(\d{8})/);

// Extract DTSTART date (YYYYMMDD)
const dtstartMatch = icalStr.match(/DTSTART[^:]*:(\d{8})/);
```

### Component Types

- `generate_instances_sync` callback receives `ICalGLib.Component` (from libical)
- `get_object_list_as_comps` returns `ECal.Component` (Evolution wrapper)
- Method names differ:
  - `ICalGLib.Component`: `as_ical_string()`, `get_recurrenceid()`
  - `ECal.Component`: `get_as_string()`, `get_recurid_as_string()`

### Callback Parameter Types

The `generate_instances_sync` callback signature is:
```javascript
(comp, instanceStart, instanceEnd) => { ... }
```

- `comp`: `ICalGLib.Component` - the event component (may be modified!)
- `instanceStart`: `ICalGLib.Time` object (NOT a number!) - must convert with `_icalTimeToTimestamp()`
- `instanceEnd`: `ICalGLib.Time` object (NOT a number!)

### When to Show vs Skip Detached Instances

| Scenario | RECURRENCE-ID | DTSTART | Action |
|----------|---------------|---------|--------|
| Modified (same date) | Dec 10 | Dec 10 | SHOW (location/attendee changes) |
| Rescheduled (different date) | Dec 10 | Dec 17 | SKIP (will appear on Dec 17) |

### Reference: GNOME Calendar Approach

GNOME Calendar handles this similarly - see merge requests:
- [MR !262 - Fix for recurring events shift bug](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/262)
- [MR !266 - Various fixes to recurrent events handling](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/266)
