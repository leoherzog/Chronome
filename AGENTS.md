# AGENTS.md

This file provides guidance to AI Coding Agents such as Claude Code (claude.ai/code), Google Gemini, and/or OpenAI Codex when working with code in this repository.

## Project Overview

Chronome is a GNOME Shell extension that displays upcoming calendar meetings in the top panel. It integrates with Evolution Data Server (EDS) to read calendar data and shows meeting countdowns with clickable video conference links.

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

## Architecture

### Core Files

- **extension.js**: Main extension code with `ChronomeIndicator` class (PanelMenu.Button subclass) that handles:
  - Calendar data fetching via ECal/EDataServer async APIs
  - Panel label updates with countdown timers
  - Dropdown menu with today's events
  - Video conferencing link detection and launching

- **prefs.js**: Preferences window using Adw (libadwaita) with pages for General, Appearance, and Calendars settings

- **schemas/org.gnome.shell.extensions.chronome.gschema.xml**: GSettings schema defining all configurable options

### Key Technical Details

- Uses GJS (GNOME JavaScript) with ES modules
- Imports from `gi://` for GObject introspection bindings (ECal, EDataServer, St, Clutter, etc.)
- Async calendar operations use Promise wrappers around EDS callback-based APIs
- Blocking operations wrapped in `GLib.idle_add()` to avoid freezing GNOME Shell on login
- Real-time countdown uses `GLib.timeout_add_seconds` timers
- Calendar change notifications via `ECalClientView` signals with debounced refresh
- Rescheduled instance detection uses per-source caching with automatic invalidation
- Video link detection uses regex patterns from MeetingBar project

### Event Handling

Events are fetched using async wrappers around `ECal.Client.generate_instances_sync()` which properly expands recurring events. Key implementation details:

- **Non-blocking async**: All EDS operations use async patterns (callbacks wrapped in Promises, idle callbacks) to avoid blocking GNOME Shell startup
- **Recurring event expansion**: Uses `generate_instances_sync()` wrapped in `GLib.idle_add()` to get actual occurrence times without blocking
- **Deduplication**: Events are deduplicated by UID + start time, preferring exceptions over master occurrences
- **ICalGLib.Component wrapping**: The callback returns `ICalGLib.Component` objects (not `ECal.Component`), which are wrapped with instance times and proxy methods

The extension also tracks:
- Current user's participation status (accepted/declined/tentative) via attendee parsing
- All-day events via `dtStart.is_date()` check
- Video conference URLs in location and description fields

### Recurring Event and Detached Instance Handling

EDS uses iCalendar concepts for recurring events. Understanding these is critical for correct display:

#### Key Concepts

- **Master recurring event**: Has `RRULE` (e.g., `FREQ=WEEKLY;BYDAY=WE`) defining the recurrence pattern
- **Detached instance**: A modified occurrence of a recurring event, identified by `RECURRENCE-ID` property
- **RECURRENCE-ID**: Points to the original occurrence date that was modified
- **DTSTART**: The actual start time of the event (may differ from RECURRENCE-ID if rescheduled)

#### Rescheduled Instance Behavior

When a recurring event instance is rescheduled (e.g., moved from Dec 10 to Dec 17), EDS stores a detached instance with:
- `RECURRENCE-ID`: Original date (Dec 10) - the original occurrence being modified
- `DTSTART`: New date (Dec 17) - the actual scheduled time

`generate_instances_sync()` behavior:
- Returns detached instances when the query range matches their `RECURRENCE-ID`
- Sets the callback's `instanceStart`/`instanceEnd` parameters to the `RECURRENCE-ID` time, not `DTSTART`
- Modifies the component's `get_dtstart()` to return the `RECURRENCE-ID` time

The `occur-in-time-range?` query filters by stored `DTSTART`, not `RECURRENCE-ID`, so it won't find rescheduled events by their original date.

#### Two-Phase Query Architecture

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

#### Caching Strategy

- **Per-source cache**: `_rescheduledCache` is a `Map<sourceUid, Map<key, value>>`
- **Date invalidation**: Entire cache is cleared when the date changes
- **Signal-based invalidation**: `ECalClientView` signals (`objects-added/modified/removed`) invalidate only the affected source's cache
- **Source changes**: Registry signals (`source-added/changed/removed`) clear the entire cache

#### iCal String Parsing

Since `generate_instances_sync` modifies the component, extract dates from raw iCal strings:

```javascript
// Extract RECURRENCE-ID date (YYYYMMDD)
const recurIdMatch = icalStr.match(/RECURRENCE-ID[^:]*:(\d{8})/);

// Extract DTSTART date (YYYYMMDD)
const dtstartMatch = icalStr.match(/DTSTART[^:]*:(\d{8})/);
```

#### Component Types

- `generate_instances_sync` callback receives `ICalGLib.Component` (from libical)
- `get_object_list_as_comps` returns `ECal.Component` (Evolution wrapper)
- Method names differ:
  - `ICalGLib.Component`: `as_ical_string()`, `get_recurrenceid()`
  - `ECal.Component`: `get_as_string()`, `get_recurid_as_string()`

#### Callback Parameter Types

The `generate_instances_sync` callback signature is:
```javascript
(comp, instanceStart, instanceEnd) => { ... }
```

- `comp`: `ICalGLib.Component` - the event component (may be modified!)
- `instanceStart`: `ICalGLib.Time` object (NOT a number!) - must convert with `_icalTimeToTimestamp()`
- `instanceEnd`: `ICalGLib.Time` object (NOT a number!)

#### When to Show vs Skip Detached Instances

| Scenario | RECURRENCE-ID | DTSTART | Action |
|----------|---------------|---------|--------|
| Modified (same date) | Dec 10 | Dec 10 | SHOW (location/attendee changes) |
| Rescheduled (different date) | Dec 10 | Dec 17 | SKIP (will appear on Dec 17) |

#### Reference: GNOME Calendar Approach

GNOME Calendar handles this similarly - see merge requests:
- [MR !262 - Fix for recurring events shift bug](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/262)
- [MR !266 - Various fixes to recurrent events handling](https://gitlab.gnome.org/GNOME/gnome-calendar/-/merge_requests/266)
