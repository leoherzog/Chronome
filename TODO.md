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

Shell 51.0 pairs with mutter 51, gjs 1.90, GLib 2.90, GTK 4.24, libadwaita 1.10 and EDS 3.62. Nothing in the porting guide or in those releases removes an API this extension calls. Unverified on a desktop 51 session until the manual checks below pass.

- [x] Add `"51"` to `shell-version` in `metadata.json`, and to the version lists in `AGENTS.md` and `README.md`.
  - Without it the Shell marks the extension out of date and never enables it.
  - Rerun `release.sh` before uploading. The zip in the repo root is a gitignored local build and goes stale.
  - Adding a shell version always sends the upload to a human reviewer, and any `.js` change does too. Ship the metadata bump and every pending code change in one upload, and never upload again before it is reviewed: a second upload with the same shell-version set auto-rejects the first.
- [x] Replace the `GLib.unix_signal_add` and `Gio.UnixInputStream` aliases in `service.js`, which print stack-traced warnings on every service start from GNOME 46. GLib 2.78 keeps the aliases.
  - Load `GLibUnix` and `GioUnix` with `imports.gi` behind `GLib.check_version(2, 80, 0)`, never `await import()`. A top-level await starves the main loop.
  - GLibUnix names the function `signal_add_full` on GLib 2.80 to 2.86 and `signal_add` from 2.88. The gjs warning on 2.80 to 2.86 recommends `signal_add` anyway.
- [x] Add a row to the AGENTS.md "Review Guidelines" section naming the Shexli output the reviewer sees.
  - Shexli is advisory and runs on every manually reviewed upload. Expected on this package: EGO-A-005 for the clipboard write, EGO-P-007 that `service.js`, `service/` and the `lib/` modules only the service loads are unreachable from `extension.js`, and EGO-X-003 for the `run_dispose()` call in `prefs.js`.
  - The copy the site runs accepts `51`, because its EGO-M-004 ceiling follows the six-month release cadence. The PyPI `shexli` 0.2.1 that the upload page recommends predates that and reports EGO-M-004 for `51`.
  - Keep the `servicePath` identifier in the `Gio.Subprocess.new` argv. A template literal clears EGO-P-007 but adds EGO-L-001, L-003, L-004 and A-004, and a second EGO-X-003 location, because a launched module is then judged as Shell-process code.
  - Preview from the `shexli/` directory of an extensions-web clone: `uv run --no-project --python 3.14 --with tree-sitter==0.25.2 --with tree-sitter-javascript==0.25.0 python -m shexli --format text <path to chronome@herzog.tech.zip>`. Shexli needs Python 3.14, and tree-sitter 0.26 segfaults.
- [x] Dispose the `SourceRegistry` in `prefs.js` once the Calendars page has listed the calendars. The preferences service exits shortly after its window closes, and a registry still alive then crashes it with SIGSEGV on every Shell version.
- [x] Build the panel box like the Shell's battery indicator: `panel-status-indicators-box` plus `chronome-panel-box`, whose only rule is `spacing: 0`.
  - `.panel-status-menu-box` has no theme rule from 49, which leaves the icon its standalone `0 6px` padding. The theme supplies everything else, and the icon-to-label gap equals the battery's: 5px on 45, 4px on 46 to 51.
- [x] Restate the hover, focus and pressed highlights on `.chronome-current-event`. Extension rules outrank the theme's, so without state rules the current row shows no change in any of them. 51 focuses the first row when the menu opens from the keyboard.
- [x] Let the theme lay out the menu rows. Each event row is a `PopupBaseMenuItem` with its children added directly, so `.popup-menu-item` supplies the spacing and 12px corners and `.popup-menu-icon` sizes the icons, which follow the text scale from 46 on.
  - The time column takes the widest time label's width when the menu is built. A fixed min-width cannot hold 12-hour times in every font or follow the text scale. Call `ensure_style()` before measuring: on 51 the rebuild runs before the menu is shown.
  - The status icon sits after the time, and the current row has no ornament. Either one at the row start shifts that row's time column by an icon and a gap.
  - A past tentative event is dimmed like any other past event.
- Manual checks on a desktop 51 session:
  - In the light and dark styles, the panel icon-to-label gap equals the gap between the battery icon and its percentage.
  - In the light and dark styles, the current row's tint at rest, on hover, on keyboard focus, while pressed, and after the pointer leaves a hovered row.
  - One time column across all rows, with 12-hour and 24-hour times at 100% and 125% text scaling.
  - No new `gjs` entry in `coredumpctl list` after the preferences window closes.

## Should Have

- [ ] Pre-meeting notification with Join, Snooze and Dismiss actions.
  - Own `MessageTray.Source`, destroyed in `disable()`. Never use or destroy `getSystemSource()`.
  - GNOME 45 needs its own code path. The constructor, `addNotification` and the property setters all changed in 46.
  - Three action buttons at most. On 45 they appear only in the banner.
  - Evaluate reminder times on a short tick, separate from the calendar refresh interval.
  - Key dedupe on UID, recurrence id and instance start. Weather events get a new UID on every refresh.
  - Keep `disable()` synchronous. Shell 51 throws `disable() must not be async` on a thenable return and puts the extension in the ERROR state. Tear the source down with a plain `destroy()`.
  - Default off. A `DISPLAY` VALARM is already shown by `evolution-alarm-notify` on 45 to 50 and by `gnome-shell-calendar-server` on 51, with Snooze and Dismiss. `evolution-alarm-notify` also shows AUDIO alarms; the 51 calendar server ignores them. EMAIL alarms never reach the screen.
- [ ] Several reminder offsets, and respect for the event's own VALARM.
  - Suppress the extension's alert only when the event has a `DISPLAY` alarm near the same time, or an `AUDIO` alarm on 45 to 50. `EMAIL` alarms never reach the screen.
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
- Whether `evolution-alarm-notify` runs under Shell 45 to 50 on a given distro. Its systemd user unit exists from EDS 3.57.3 but is disabled by preset on Fedora 44, and `X-systemd-skip` only covers the autostart entry. From EDS 3.61.3 the autostart entry is `NotShowIn=GNOME`. In 3.62 both the entry and the unit pass `--autostart`, which exits when `XDG_CURRENT_DESKTOP` contains GNOME, `gnome-notifications-panel.desktop` is installed and the process is not a Flatpak. Shell 45 to 50 with EDS 3.62 may therefore get no VALARM reminders at all. Shell 51's calendar server shows reminders whatever the EDS version. Ubuntu 26.10 pairs it with EDS 3.56 and the old autostart entry, so each reminder probably shows twice there.
- How the fixes above behave on Google, Exchange and iCloud calendars. The live suite covers the local backend only.
- The `STATUS` mapping on a real Microsoft 365 account, for accepted, tentative, declined and unanswered meetings. A meeting the organizer cancelled also shows as declined.
- Whether `teams.cloud.microsoft` serves meeting links. The pattern accepts it with the same two paths as the other Teams hosts.
