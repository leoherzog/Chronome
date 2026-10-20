# TODO

Feature gaps against MeetingBar, Itsycal, Dato, Dot, nextmeeting and the other GNOME and KDE panel calendars, with the fixes the comparison surfaced. Evolution Data Server stays the only data source. Nothing here adds OAuth, iCal URL sync or a provider API.

## Fixes

- [x] Rank conference link sources in `findVideoLink()`: `CONFERENCE`, `URL`, `X-GOOGLE-CONFERENCE`, `X-MICROSOFT-SKYPETEAMSMEETINGURL`, LOCATION, then DESCRIPTION. Google Meet events usually have no LOCATION, and when they do it often holds an unrelated link.
  - Treat an empty X- value as absent, tolerate duplicates, and do not host-match the Teams property, which can be an `aka.ms` redirect.
  - Skip `X-MICROSOFT-ONLINEMEETINGCONFLINK`. It is a SIP address, not a URL.
  - `CONFERENCE` has a typed accessor only in ICalGLib 4.0. Iterate `ANY_PROPERTY` and match `get_property_name()` so it works on 3.0.
  - Skip the full-component scan for all-day events.
- [x] Read the user's RSVP from `STATUS` on Microsoft 365 sources. That backend writes the user's own response to `STATUS`, and a declined meeting arrives as `STATUS:CANCELLED`. Its ATTENDEE lines carry only the PARTSTAT the server reports for each invitee. Branch on the source's backend name.
- [x] Match attendee addresses with `ECal.util_get_property_email()`. Exchange and iCloud carry the address in an `EMAIL` parameter, which the `mailto:` strip misses.
- [x] Collect component properties in one pass inside `wrapICalComponent()`. A libical component has one shared property iterator, so any nested property read breaks the outer loop.
- [x] Widen the Zoom Gov pattern in `lib/meetingServices.js`. Its `[a-zA-Z0-9?&=]+` tail cuts passcodes at `-`, `_`, `.`, `+` and `/`.
- [x] Extend the Teams pattern to `teams.live.com`, `teams.cloud.microsoft` and the short `/meet/<digits>?p=<passcode>` links.
- [x] Call `client.set_default_timezone()` after connect, and pad the query range by a day on each side. EDS otherwise resolves all-day and floating events against UTC and filters the range in UTC.
- [x] Use `client.check_refresh_supported()` so the sync loop skips sources that only return `NOT_SUPPORTED`.

## GNOME 51

Shell 51.0 pairs with mutter 51, gjs 1.90, GLib 2.90, GTK 4.24, libadwaita 1.10 and EDS 3.62. Nothing in the porting guide or in those releases removes an API this extension calls. Every claim below is read from tagged source; nothing has run on a 51 session yet.

- [ ] Add `"51"` to `shell-version` in `metadata.json`, and to the version lists in `AGENTS.md` and `README.md`.
  - Without it the Shell marks the extension out of date and never enables it.
  - Rerun `release.sh` before uploading. The checked-in zip carries a stale description without the clipboard declaration.
  - Adding a shell version always sends the upload to a human reviewer, and any `.js` change does too. Ship the metadata bump and every pending code change in one upload, and never upload again before it is reviewed: a second upload with the same shell-version set auto-rejects the first.
- [ ] Replace the `GLib.unix_signal_add` and `Gio.UnixInputStream` aliases in `service.js` with `GLibUnix.signal_add` and `GioUnix.InputStream` behind `GLib.check_version(2, 80, 0) === null`, keeping the aliases for 45.
  - Load them with `imports.gi`, never `await import()`. A top-level await makes the service hang on stdin EOF and crash on SIGTERM.
  - The aliases print three stack-traced warnings on every service start on GNOME 46 and later, which touches the "must not print excessively" review rule.
- [ ] Add a row to the AGENTS.md "Review Guidelines" section naming the Shexli output the reviewer sees.
  - Shexli is advisory and runs on every manually reviewed upload. Expected on this package: EGO-M-004 "implausible future releases" for `51` (extensions-web hardcodes a ceiling of 50, upstream issues #399 and #402) and EGO-P-007 that `service.js`, `service/` and `lib/` are unreachable from `extension.js`.
  - Keep the `servicePath` identifier in the `Gio.Subprocess.new` argv. A template literal clears EGO-P-007 but adds four lifecycle and logging false positives, because a launched module is then judged as Shell-process code.
  - Preview from a clone of extensions-web: `uv run --no-project --python 3.13 --with tree-sitter==0.25.2 --with tree-sitter-javascript==0.25.0 python -m shexli --format text <unzipped dir>`. tree-sitter 0.26 segfaults.
- [ ] Optional: give the panel `St.BoxLayout` a `chronome-panel-box` class styled `spacing: 4px; > .system-status-icon { padding: 0; }`.
  - `.panel-status-menu-box` has had no theme rule since 49, so on 49 to 51 the icon keeps its 6px padding and the panel item is a few pixels wider than on 45 to 48.
- Manual checks on a 51 session: open the menu with Space or Return and confirm the first event row takes focus and Escape closes it, because `PopupMenuBase.open()` now emits `open-state-changed` before the actor is shown; confirm the service starts warning-free on gjs 1.90.

## Should Have

- [ ] Pre-meeting notification with Join, Snooze and Dismiss actions.
  - Own `MessageTray.Source`, destroyed in `disable()`. Never use or destroy `getSystemSource()`.
  - GNOME 45 needs its own code path. The constructor, `addNotification` and the property setters all changed in 46.
  - Three action buttons at most. On 45 they appear only in the banner.
  - Evaluate reminder times on a short tick, separate from the calendar refresh interval.
  - Key dedupe on UID, recurrence id and instance start. Weather events get a new UID on every refresh.
  - Keep `disable()` synchronous. Shell 51 throws `disable() must not be async` on a thenable return and puts the extension in the ERROR state. Tear the source down with a plain `destroy()`.
  - Default off. A `DISPLAY` VALARM is already shown by `evolution-alarm-notify` on 45 to 50 and by `gnome-shell-calendar-server` on 51, with Snooze and Dismiss. AUDIO and EMAIL alarms never reach the screen.
- [ ] Several reminder offsets, and respect for the event's own VALARM.
  - Suppress the extension's alert only when the event has a `DISPLAY` alarm near the same time. `EMAIL` alarms never reach the screen.
  - Alarms need `ECal.Component`. Build it with `new_from_string(comp.as_ical_string())`, which copies.
  - Branch on the trigger kind first. A relative trigger's duration is negative, and an absolute trigger has none.
  - Convert trigger durations with `as_utc_seconds` and fall back to `as_int`. libical-glib 4 drops `as_int`, and `as_seconds` returns 0 for day and week durations.
  - Honour `ESourceAlarms:include-me` as "no reminders from this calendar". The system reminder watcher filters on it and ignores `selected`.
  - A calendar with `for-every-event` and `defall-reminder-enabled` is reminded for every event, VALARM or not. `for-every-event` needs EDS 3.52; guard the getter on 3.50.
  - The system reminder can be switched off per app in Settings > Notifications: key `enable` under `/org/gnome/desktop/notifications/application/org-gnome-shell-calendarserver/` on 51, `org-gnome-evolution-alarm-notify` plus the EDS `notify-enable-display` key on 45 to 50. The 51 row exists only after the first reminder. Never infer from the Shell version alone.
- [ ] Multi-day agenda: today plus tomorrow, or N days, with day headers and an option to hide empty days.
  - [x] `rescheduledFromToday` is a `Set` of `uid:recurrenceIdMs` keys from `getOccurrenceKey()`. As a set of UIDs it would suppress every occurrence of the series in the window.
  - [x] Live fixture `Recur Four Slots`: two rescheduled instances of one series in the same window.
  - Issue one wide query and cache it. Every call pays a D-Bus round trip, and EDS caches nothing between calls.
  - Query the birthdays calendar on a slow path. Every entry is an endless yearly rule, so every contact matches any range and is expanded twice.
  - The cache key becomes the window bounds, not a date string.
  - Classify "moved off the window" by overlap of `DTSTART`..`DTEND` with the window, not by `DTSTART` alone. An instance moved onto a slot that crosses midnight into the window is skipped today.
- [ ] Global shortcuts to open the menu and to join the next meeting.
  - `Main.wm.addKeybinding` with `IGNORE_AUTOREPEAT` and `NORMAL | OVERVIEW | POPUP`. The schema key is type `as`.
  - Ship an empty default. Remove the binding in `disable()` and keep the same `Gio.Settings` instance for its lifetime.
- [ ] Event detail submenu: attendees with status, organizer, location, notes and calendar name.
- [ ] Per-event actions: copy link, choose another detected link, email attendees, open in the calendar app.
  - Evolution accepts `calendar:///?source-uid=…&comp-uid=…&comp-rid=…`.
  - GNOME Calendar has an `open-event` D-Bus action taking `<source-uid>:<component-uid>`. It only finds events in the loaded month. Its `--date` option rejects ISO dates.
- [ ] Quiet panel options.
  - Show the next meeting only within N minutes of its start.
  - A rule for when a running meeting yields the label to the next one.
  - Optional hiding of the whole indicator when nothing is upcoming. Hide the button, not its container. Keep it optional, because a hidden button leaves no path to the menu or Settings.
- [ ] Label colour as the meeting approaches. Toggle a style class at state changes only. A colour-only class change causes no relayout.
- [ ] Screen-share privacy: title shown, generic title, dot, or hidden, with a toggle in the menu and a shortcut.
- [ ] Translations.
  - Add `po/`, an `xgettext` step, and a `msgfmt` step in `release.sh` so the zip carries `locale/**/*.mo`. Do not ship `po/`.
  - Keep user-facing strings out of the service process.
- [ ] Read 12h or 24h from `org.gnome.desktop.interface clock-format` and retire the `time-format` key. Plan the settings migration.

## Could Have

- [ ] Follow the `selected` flag on each calendar source by default, with `enabled-calendars` as an override. GNOME Calendar writes it and the Shell's date menu filters on it. Update live through `notify::selected`.
- [ ] Filters: free-time events, title patterns, events without guests, only events with a link.
  - On EWS read `X-MICROSOFT-CDO-INTENDEDSTATUS`. That backend overwrites `TRANSP`.
- [ ] Working-hours filter with its own setting. Neither EDS nor GNOME stores working hours. Evolution's schema can act as an override, but look it up through `Gio.SettingsSchemaSource` first, because opening a missing schema aborts the Shell.
- [ ] Show, dim or hide per event type, replacing the binary toggles.
- [ ] Per-calendar "may drive the panel label", separate from menu visibility.
- [ ] Open links in the native app when a handler is registered.
  - Zoom: rewrite `/j/` links to `zoommtg://`, never `/my/` rooms. Teams: swap the scheme to `msteams`. Jitsi: swap to `jitsi-meet`. Webex and Meet stay on https.
  - Probe with `Gio.AppInfo.get_default_for_uri_scheme()`, passing the scheme without the colon. Treat null as no handler.
  - Launch through the returned `GAppInfo` with `launch_uris_async`, and fall back to the https link on error. Never rebuild a Flatpak command line.
- [ ] Choose the browser or profile for meeting links. Store desktop ids, not command lines. Use `GioUnix.DesktopAppInfo` on 46 and later to avoid a log warning, and feature-detect it for 45.
- [ ] Tasks from EDS task lists in the menu, with overdue tasks rolled onto today.
  - Connect with `ECal.ClientSourceType.TASKS` and query with an S-expression. A task with no start and no due date never matches a time range.
  - Complete with `ECal.util_mark_task_complete_sync()` then `modify_object` with `ObjModType.ALL`. A recurring task rolls forward instead of completing.
- [ ] Label format template with tokens, and a separate template for the accessible name.
- [ ] Panel position setting: box and index. To sit beside the clock, compute the index from `statusArea.dateMenu.container` on each enable.
- [ ] Middle-click and scroll actions on the indicator.
  - GNOME 50 replaced button events with a `Clutter.ClickGesture`. Feature-detect `_clickGesture` and keep two code paths.
  - Handle smooth scrolling and ignore pointer-emulated events.
- [ ] Copy meeting ID and passcode separately.
- [ ] Surface other links from the notes, such as documents and tickets.
- [ ] Show the room, from LOCATION or an attendee with `CUTYPE=ROOM`.
- [ ] Do Not Disturb during meetings by writing `org.gnome.desktop.notifications show-banners`.
  - `disable()` runs on every screen lock. Restore only a value the extension wrote.
  - Persist the taken-over state so the next enable can reconcile after a Shell crash.
  - Treat an outside change to the key as the user taking control back.
- [ ] RSVP from the menu.
  - Use `receive_objects` with a `METHOD:REPLY` component so EWS and Microsoft 365 send a native response. Nextcloud and other auto-scheduling CalDAV servers send the reply themselves.
  - Refuse when the source is read-only or the user is the organizer.
  - EDS deletes a declined meeting by default through `delete-meeting-on-decline`.
  - For one occurrence, build it with `ECal.util_construct_instance()` and use `ObjModType.THIS`.
- [ ] Dismiss an event until it changes.
- [ ] Stale-data status row when a refresh fails.
- [ ] User-defined link patterns with a tester in preferences.
- [ ] Document the D-Bus interface for scripting and other panels. The service already exports `GetEvents`.
- [ ] Prefer a per-event colour when the backend reports the `component-color` capability.

## Deferred

- Month grid, world clocks and week numbers. The Shell's date menu already has them.
- Quick event creation. `create_object` is simple, but natural-language entry is its own project.
- Auto-join and a user command on meeting start. No review rule forbids either. If built, default off, declare it in the `metadata.json` description, and never spawn synchronously in the Shell process.
- Fullscreen alert, bookmarks, ad-hoc meeting creation, alert sounds.
- Free/busy lookups. For the user's own calendars they repeat what the event query returns.
- `ECal.ClientViewFlags.NOTIFY_INITIAL`, which would let the view replace the polling fetch.

## Out of Scope

- Google's structured conference data, direct provider accounts, iCal URL sync.
- A Teams link from any property on Microsoft 365 sources. That backend never reads it, so the link survives only in DESCRIPTION.

## Unverified

- Whether Google applies an RSVP written through CalDAV.
- Whether `evolution-alarm-notify` runs under Shell 45 to 50 on a given distro. Its systemd user unit exists from EDS 3.57.3 but is disabled by preset on Fedora 44, and `X-systemd-skip` only covers the autostart entry. From EDS 3.61.3 the entry is `NotShowIn=GNOME` and `--autostart` exits under any GNOME desktop, so Shell 45 to 50 with EDS 3.62 may get no VALARM reminders at all, and Shell 51 with EDS 3.60 may get them twice.
- How the fixes above behave on Google, Exchange and iCloud calendars. The live suite covers the local backend only.
- The `STATUS` mapping on a real Microsoft 365 account, for accepted, tentative, declined and unanswered meetings. A meeting the organizer cancelled also shows as declined.
- Whether `teams.cloud.microsoft` serves meeting links. The pattern accepts it with the same two paths as the other Teams hosts.
