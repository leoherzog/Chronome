import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// Load ECal 2.0, EDataServer, and ICalGLib modules with version specifiers
import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';
import ICalGLib from 'gi://ICalGLib?version=3.0';

// Meeting URL detection
import {findMeetingUrl} from './meetingServices.js';

// Calendar utilities (shared with prefs.js)
import {getAccountEmailForSource, getCalendarIdForSource, getCalendarColor, deduplicateSources} from './calendarUtils.js';

// Pure utility modules (testable with gjs -m)
import {formatDuration, formatTimeRange, truncateText} from './lib/formatting.js';
import {parseIcalDateTime, extractIcalDateString} from './lib/icalParser.js';
import {deduplicateEvents, getNextMeeting as getNextMeetingPure, isAllDayEventHeuristic} from './lib/eventUtils.js';
import {ONE_HOUR_MS, ONE_MINUTE_MS, FIVE_MINUTES_MS} from './lib/constants.js';

// Constants
const CONSTANTS = {
    ONE_HOUR_MS,
    ONE_MINUTE_MS,
    FIVE_MINUTES_MS,
    DEBOUNCE_MS: 500,
    CLIENT_CONNECT_TIMEOUT_SEC: 10,
    SYNC_DELAY_MS: 50,
    OPACITY_DIMMED: 178,      // ~70% opacity for past/declined events
    OPACITY_TENTATIVE: 204,   // ~80% opacity for tentative events
    MENU_ICON_SIZE: 16,
};

// Main indicator class
const ChronomeIndicator = GObject.registerClass({
    GTypeName: 'ChronomeIndicator',
}, class ChronomeIndicator extends PanelMenu.Button {
    _init(extension, settings) {
        super._init(0.0, 'Chronome', false);
        this._extension = extension;
        this._settings = settings;

        // Create UI elements
        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });

        this._icon = new St.Icon({
            icon_name: 'x-office-calendar-symbolic',
            style_class: 'system-status-icon',
        });

        this._label = new St.Label({
            text: _('Loading...'),
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        this._updateIcon();

        // Timer to fetch calendar data (less frequent)
        this._fetchTimeout = null;

        // Timer to update display countdown (every second)
        this._displayTimeout = null;

        // Store next meeting data
        this._nextMeeting = null;

        // Store calendar clients and metadata
        this._registry = null;
        this._clients = new Map();
        this._accountEmails = new Map();  // sourceUid -> account email
        this._calendarIds = new Map();    // sourceUid -> canonical calendar ID
        this._calendarReadonly = new Map(); // sourceUid -> boolean (true = readonly)
        this._calendarColors = new Map();   // sourceUid -> hex color string

        // Async operation tracking
        this._refreshInProgress = false;
        this._pendingRefresh = false;
        this._refreshDebounceId = null;

        // Cache for rescheduled instances: sourceUid -> { rescheduledFromToday: Map, movedToToday: Array }
        // rescheduledFromToday: events originally on today but moved elsewhere (skip these)
        // movedToToday: events moved TO today from another date (add these manually)
        this._rescheduledCache = new Map();
        this._cacheDate = null; // Track which date the cache is for

        // Flag to prevent post-destroy callbacks
        this._destroyed = false;

        // Cancellable for async EDS operations
        this._cancellable = new Gio.Cancellable();

        // Connect settings signals using consolidated pattern
        this._settingsSignals = [];

        // Settings that trigger a full refresh
        const refreshSettings = ['enabled-calendars', 'show-current-meeting', 'event-types',
            'show-past-events', 'show-event-end-time', 'time-format', 'use-calendar-colors'];
        for (const key of refreshSettings) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._refreshEvents())
            );
        }

        // Settings that trigger label update only
        const labelSettings = ['real-time-countdown', 'event-title-length'];
        for (const key of labelSettings) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => {
                    if (key === 'real-time-countdown') this._setupDisplayTimer();
                    this._updatePanelLabel(this._nextMeeting);
                })
            );
        }

        // Settings that trigger icon update only
        this._settingsSignals.push(
            this._settings.connect('changed::status-bar-icon-type', () => this._updateIcon())
        );
    }

    // Update the top bar label
    _updateLabel(text) {
        if (text) {
            this._label.set_text(text);
        }
    }

    // Update the panel icon based on settings
    _updateIcon() {
        // Always show calendar icon when no meetings (regardless of setting)
        if (!this._nextMeeting) {
            this._icon.show();
            this._icon.icon_name = 'x-office-calendar-symbolic';
            return;
        }

        // Apply user's icon preference when there is a meeting
        const iconType = this._settings.get_string('status-bar-icon-type');
        if (iconType === 'none') {
            this._icon.hide();
        } else if (iconType === 'calendar') {
            this._icon.show();
            this._icon.icon_name = 'x-office-calendar-symbolic';
        } else if (iconType === 'meeting-type') {
            // Show video icon only if next meeting has a video link
            const hasVideoLink = this._findVideoLink(this._nextMeeting);
            if (hasVideoLink) {
                this._icon.show();
                this._icon.icon_name = 'camera-video-symbolic';
            } else {
                this._icon.hide();
            }
        }
    }

    // Start the automatic refresh timers
    startTimer() {
        // Stop any existing timers
        this.stopTimer();

        // Update now
        this._refreshEvents();

        // Set up data fetch timer (lower frequency)
        const refreshInterval = this._settings.get_int('refresh-interval');
        this._fetchTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, refreshInterval, () => {
            this._refreshEvents();
            return GLib.SOURCE_CONTINUE;
        });

        // Set up display update timer if real-time countdown is enabled
        this._setupDisplayTimer();
    }

    // Stop all timers
    stopTimer() {
        if (this._fetchTimeout) {
            GLib.Source.remove(this._fetchTimeout);
            this._fetchTimeout = null;
        }

        if (this._displayTimeout) {
            GLib.Source.remove(this._displayTimeout);
            this._displayTimeout = null;
        }
    }

    // Setup or teardown the display timer based on settings
    _setupDisplayTimer() {
        // Stop existing display timer if any
        if (this._displayTimeout) {
            GLib.Source.remove(this._displayTimeout);
            this._displayTimeout = null;
        }

        // Start new timer if real-time countdown is enabled
        if (this._settings.get_boolean('real-time-countdown')) {
            this._displayTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (this._nextMeeting) {
                    const endTime = this._getEventEnd(this._nextMeeting);
                    if (endTime < Date.now()) {
                        this._refreshEvents();
                    } else {
                        this._updatePanelLabel(this._nextMeeting);
                    }
                } else {
                    // No meeting - just update the label, let fetch timer handle data refresh
                    this._updatePanelLabel(null);
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    // Trigger a backend sync for all connected calendars
    async _syncCalendars() {
        if (!this._clients) return;

        const clients = Array.from(this._clients.values());

        // Process clients one by one with a small delay to avoid flooding the system
        for (const client of clients) {
            // Yield to main loop
            await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONSTANTS.SYNC_DELAY_MS, () => {
                r();
                return GLib.SOURCE_REMOVE;
            }));

            try {
                // Try to refresh without checking support first (async)
                // This avoids potentially blocking property checks
                client.refresh(null, (obj, res) => {
                    // Check if extension was destroyed while waiting for callback
                    if (this._destroyed) return;
                    try {
                        obj.refresh_finish(res);
                    } catch (e) {
                        // Ignore "not supported" errors, log others
                        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED)) {
                             console.debug(`Chronome: Calendar sync failed: ${e.message}`);
                        }
                    }
                });
            } catch (e) {
                console.error(`Chronome: Error triggering sync: ${e}`);
            }
        }
    }

    // Refresh calendar events and update the UI
    _refreshEvents() {
        if (this._destroyed) {
            return GLib.SOURCE_REMOVE;
        }
        // Prevent concurrent refreshes - queue if already in progress
        if (this._refreshInProgress) {
            this._pendingRefresh = true;
            return GLib.SOURCE_CONTINUE;
        }

        this._refreshInProgress = true;
        this._pendingRefresh = false;

        // Start async refresh
        this._fetchAllEventsAsync().then(allEvents => {
            // Prevent UI updates after widget is destroyed
            if (this._destroyed) return;

            try {
                if (allEvents.length === 0) {
                    // No events found - could be no calendars or no events today
                    this._nextMeeting = null;
                    this._updateMenu([]);
                    this._updatePanelLabel(null);
                    this._updateIcon();
                } else {
                    const todayEvents = this._deduplicateEvents(allEvents);

                    // Update top bar text
                    this._nextMeeting = this._getNextMeeting(todayEvents);

                    // Update menu with today's events
                    this._updateMenu(todayEvents);

                    // Update panel label with next meeting info
                    this._updatePanelLabel(this._nextMeeting);

                    // Update icon (for meeting-type mode, depends on video link)
                    this._updateIcon();
                }
            } catch (e) {
                console.error(`Chronome: Error processing events: ${e}`);
                this._showError();
            }
        }).catch(e => {
            console.error(`Chronome: Error fetching events: ${e}`);
            this._showError();
        }).finally(() => {
            this._refreshInProgress = false;

            // Process any queued refresh (but not if destroyed)
            if (this._pendingRefresh && !this._destroyed) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (!this._destroyed) {
                        this._refreshEvents();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        });

        return GLib.SOURCE_CONTINUE;
    }

    // Show error state in UI
    _showError() {
        this._updateLabel(_('Calendar unavailable'));
        this.menu.removeAll();
        const errorItem = new PopupMenu.PopupMenuItem(_('Calendar service unavailable'));
        errorItem.setSensitive(false);
        this.menu.addMenuItem(errorItem);
    }

    // Update panel label based on next meeting
    _updatePanelLabel(nextMeeting) {
        if (!nextMeeting) {
            // Hide label when no events - only show icon
            this._label.hide();
            return;
        }

        // Show label when we have a meeting to display
        this._label.show();

        try {
            // Get meeting title
            const titleText = this._getEventTitle(nextMeeting);

            // Shorten title if needed
            const maxLength = this._settings.get_int('event-title-length');
            const shortenedTitle = truncateText(titleText, maxLength);

            // Get start and end times
            const startTime = this._getEventStart(nextMeeting);
            const endTime = this._getEventEnd(nextMeeting);

            // Current time
            const now = Date.now();

            // Simple mode when real-time countdown is disabled
            if (!this._settings.get_boolean('real-time-countdown')) {
                if (startTime <= now && endTime > now) {
                    this._updateLabel(`${_('Now:')} ${shortenedTitle}`);
                } else {
                    this._updateLabel(`${_('Next:')} ${shortenedTitle}`);
                }
                return;
            }

            // Check if meeting is happening now
            if (startTime <= now && endTime > now) {
                // Meeting is happening now - show time remaining
                const remainingMs = endTime - now;
                const remainingText = this._formatDuration(remainingMs) + ' ' + _('left');
                this._updateLabel(`${remainingText} ${_('in')} ${shortenedTitle}`);
                return;
            }

            // Time difference in milliseconds for upcoming meeting
            const diffMs = startTime - now;
            const display = this._formatDuration(diffMs);
            this._updateLabel(`${display} ${_('until')} ${shortenedTitle}`);

        } catch (e) {
            this._updateLabel(_('Meeting error'));
        }
    }

    // Update dropdown menu with today's events
    _updateMenu(todayEvents) {
        // Remove all existing menu items
        this.menu.removeAll();

        if (!todayEvents || todayEvents.length === 0) {
            const noEventsItem = new PopupMenu.PopupMenuItem(_('No events today'));
            noEventsItem.setSensitive(false);
            this.menu.addMenuItem(noEventsItem);
            return;
        }

        // Get settings
        const eventTypes = this._settings.get_strv('event-types');
        const showPastEvents = this._settings.get_boolean('show-past-events');
        const showEndTime = this._settings.get_boolean('show-event-end-time');
        const useColors = this._settings.get_boolean('use-calendar-colors');
        const now = Date.now();

        // Sort events by start time
        todayEvents.sort((a, b) => this._getEventStart(a) - this._getEventStart(b));

        // First pass: collect visible event data
        const visibleEvents = [];
        for (const event of todayEvents) {
            try {
                const startTime = this._getEventStart(event);
                const endTime = this._getEventEnd(event);
                const isPast = endTime < now;
                const isAllDay = this._isAllDayEvent(event);
                const isDeclined = this._isDeclinedEvent(event);
                const isTentative = this._isTentativeEvent(event);
                const isNeedsResponse = this._isNeedsResponseEvent(event);

                // Apply filters
                if (isPast && !showPastEvents) continue;
                if (isAllDay && !eventTypes.includes('all-day')) continue;

                // For non-all-day events: check declined/tentative first (they have their own toggles)
                if (!isAllDay) {
                    if (isDeclined) {
                        if (!eventTypes.includes('declined')) continue;
                    } else if (isTentative) {
                        if (!eventTypes.includes('tentative')) continue;
                    } else {
                        // Regular events (not declined or tentative)
                        if (!eventTypes.includes('regular')) continue;
                    }
                }

                visibleEvents.push({
                    event, startTime, endTime, isPast, isAllDay,
                    isDeclined, isTentative, isNeedsResponse,
                    timeRange: isAllDay ? _('All Day') : this._formatTimeRange(startTime, endTime, showEndTime),
                    title: this._getEventTitle(event),
                    link: this._findVideoLink(event),
                });
            } catch (e) {
                console.debug(`Chronome: Error processing event: ${e.message}`);
            }
        }

        if (visibleEvents.length === 0) {
            const noEventsItem = new PopupMenu.PopupMenuItem(_('No events today'));
            noEventsItem.setSensitive(false);
            this.menu.addMenuItem(noEventsItem);
            return;
        }

        // Create menu items - use grid layout for column alignment
        for (const data of visibleEvents) {
            const { event, startTime, endTime, isPast, isDeclined, isTentative,
                    isNeedsResponse, timeRange, title, link } = data;

            // Determine status icon
            let statusIcon = null;
            if (isDeclined) {
                statusIcon = 'radio-mixed-symbolic';
            } else if (isTentative) {
                statusIcon = 'radio-checked-symbolic';
            } else if (isNeedsResponse) {
                statusIcon = 'radio-symbolic';
            }

            // Create menu item
            const menuItem = statusIcon
                ? new PopupMenu.PopupImageMenuItem('', statusIcon)
                : new PopupMenu.PopupMenuItem('');

            // Build layout using grid for column alignment
            const gridLayout = new Clutter.GridLayout({ orientation: Clutter.Orientation.HORIZONTAL });
            const labelBox = new St.Widget({ layout_manager: gridLayout, x_expand: true });
            gridLayout.hookup_style(labelBox);

            let col = 0;

            // Column 0: Calendar color indicator
            if (useColors && event._calendarColor) {
                const colorBar = new St.Widget({
                    style: `background-color: ${event._calendarColor}; width: 3px; margin-right: 8px;`,
                    y_expand: true,
                });
                gridLayout.attach(colorBar, col++, 0, 1, 1);
            }

            // Column 1: Time (width based on whether end time is shown)
            const timeColumnWidth = showEndTime ? '128px' : '48px';
            const timeLabel = new St.Label({
                text: timeRange,
                y_align: Clutter.ActorAlign.CENTER,
                style: `min-width: ${timeColumnWidth}; margin-right: 8px;`,
            });
            gridLayout.attach(timeLabel, col++, 0, 1, 1);

            // Column 2: Video icon (optional)
            if (link) {
                const videoIcon = new St.Icon({
                    icon_name: 'camera-video-symbolic',
                    style_class: 'popup-menu-icon',
                    icon_size: CONSTANTS.MENU_ICON_SIZE,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'margin-right: 6px;',
                });
                gridLayout.attach(videoIcon, col++, 0, 1, 1);
            }

            // Column 3: Title
            const titleLabel = new St.Label({
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            const titleText = link ? `${title} ↗` : title;
            if (isDeclined) {
                const escapedTitle = GLib.markup_escape_text(titleText, -1);
                titleLabel.clutter_text.set_markup(`<s>${escapedTitle}</s>`);
            } else {
                titleLabel.set_text(titleText);
            }
            gridLayout.attach(titleLabel, col++, 0, 1, 1);

            // Replace default label with custom layout
            menuItem.label.hide();
            menuItem.add_child(labelBox);

            // Add click handler for video meeting links, or disable hover for non-links
            if (link) {
                menuItem.connect('activate', () => {
                    try {
                        Gio.AppInfo.launch_default_for_uri(link, null);
                    } catch (e) {
                        console.error(`Chronome: Failed to launch URL: ${e}`);
                    }
                });
            } else {
                // Disable hover highlighting without greying out
                menuItem.track_hover = false;
            }

            // Apply opacity and styles based on event type
            // Note: St CSS doesn't support 'opacity' property, so we use set_opacity() (0-255 scale)
            if (isPast) {
                menuItem.set_opacity(CONSTANTS.OPACITY_DIMMED);
            } else if (startTime <= now && endTime > now) {
                // Current event - highlight with background color
                menuItem.add_style_class_name('chronome-current-event');
                menuItem.setOrnament(PopupMenu.Ornament.DOT);
            }

            if (isDeclined) {
                menuItem.set_opacity(CONSTANTS.OPACITY_DIMMED);
            }

            if (isTentative) {
                menuItem.set_opacity(CONSTANTS.OPACITY_TENTATIVE);
            }

            this.menu.addMenuItem(menuItem);
        }

        // Add refresh button
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh'));
        refreshItem.connect('activate', () => {
            // Trigger sync in background
            this._syncCalendars();
            // Force a local refresh immediately to update relative times
            this._refreshEvents();
        });
        this.menu.addMenuItem(refreshItem);

        // Add settings button
        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => {
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(settingsItem);
    }

    // Format a time range for display (e.g., "9:30 AM - 10:30 AM")
    // Delegates to pure function from lib/formatting.js
    _formatTimeRange(startTs, endTs, showEndTime = true) {
        const use24Hour = this._settings.get_string('time-format') === '24h';
        return formatTimeRange(startTs, endTs, showEndTime, use24Hour);
    }

    // Format a duration in milliseconds as human-readable text
    // Delegates to pure function from lib/formatting.js
    _formatDuration(ms) {
        return formatDuration(ms, _);
    }

    // Check if an event is an all-day event
    _isAllDayEvent(event) {
        try {
            if (!event) return false;

            // The proper way to detect all-day events is to check if DTSTART
            // has VALUE=DATE (date-only, no time component)
            if (typeof event.get_dtstart === 'function') {
                const dtStart = event.get_dtstart();
                if (dtStart) {
                    // Check if the time is a DATE value (all-day) vs DATE-TIME
                    // In libical, DATE values have is_date() = true
                    if (typeof dtStart.is_date === 'function') {
                        if (dtStart.is_date()) {
                            return true;
                        }
                    }
                    // Alternative: check if the value has the is_date property
                    if (typeof dtStart.get_value === 'function') {
                        const dtValue = dtStart.get_value();
                        if (dtValue && typeof dtValue.is_date === 'function') {
                            if (dtValue.is_date()) {
                                return true;
                            }
                        }
                    }
                }
            }

            // Fallback heuristic: check if starts at midnight and duration is multiple of 24h
            // Delegates to pure function from lib/eventUtils.js
            const startTime = this._getEventStart(event);
            const endTime = this._getEventEnd(event);
            return isAllDayEventHeuristic(startTime, endTime);
        } catch (e) {
            return false;
        }
    }

    // Check if the current user (calendar account owner) has a specific PARTSTAT
    // Uses ICalGLib property iteration API (more reliable than get_attendees())
    _hasCurrentUserPartstat(event, targetPartstat) {
        try {
            if (!event) return false;

            // Get the underlying ICalGLib.Component
            const comp = event._comp;
            if (!comp) return false;

            // Get the account email for this calendar
            const accountEmail = event._accountEmail;
            if (!accountEmail) return false;

            // Map string PARTSTAT to ICalGLib enum values
            const partstatMap = {
                'DECLINED': ICalGLib.ParameterPartstat.DECLINED,
                'TENTATIVE': ICalGLib.ParameterPartstat.TENTATIVE,
                'NEEDS-ACTION': ICalGLib.ParameterPartstat.NEEDSACTION,
                'ACCEPTED': ICalGLib.ParameterPartstat.ACCEPTED,
            };
            const targetValue = partstatMap[targetPartstat];
            if (targetValue === undefined) return false;

            // Iterate through ATTENDEE properties to find the current user
            let prop = comp.get_first_property(ICalGLib.PropertyKind.ATTENDEE_PROPERTY);
            while (prop) {
                // Get attendee email
                let email = prop.get_value_as_string?.() || '';
                if (email.startsWith('mailto:')) {
                    email = email.substring(7);
                }
                email = email.toLowerCase();

                // Check if this is the current user's attendee entry
                if (email === accountEmail) {
                    // Get PARTSTAT parameter
                    const param = prop.get_first_parameter(ICalGLib.ParameterKind.PARTSTAT_PARAMETER);
                    if (param) {
                        const partstat = param.get_partstat?.();
                        return partstat === targetValue;
                    }
                    // No PARTSTAT found for this attendee
                    return false;
                }

                prop = comp.get_next_property(ICalGLib.PropertyKind.ATTENDEE_PROPERTY);
            }

            // Current user is not an attendee (might be organizer-only or local event)
            return false;
        } catch (e) {
            return false;
        }
    }

    // Check if an event is declined by the current user
    _isDeclinedEvent(event) {
        try {
            if (!event) return false;

            // Check if current user (calendar account owner) has DECLINED status
            if (this._hasCurrentUserPartstat(event, 'DECLINED')) {
                return true;
            }

            // Fallback: check if the event summary contains declined indicators
            const title = this._getEventTitle(event).toLowerCase();
            if (title.includes('declined:') || title.includes('rejected:')) {
                return true;
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    // Check if an event is tentative for the current user
    _isTentativeEvent(event) {
        try {
            if (!event) return false;

            // Check if current user (calendar account owner) has TENTATIVE status
            if (this._hasCurrentUserPartstat(event, 'TENTATIVE')) {
                return true;
            }

            // Check event-level status (applies to the whole event)
            if (typeof event.get_status === 'function') {
                const status = event.get_status();
                if (status === ICalGLib.PropertyStatus.TENTATIVE) {
                    return true;
                }
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    // Check if an event needs a response from the current user
    _isNeedsResponseEvent(event) {
        try {
            if (!event) return false;

            // Check if current user (calendar account owner) has NEEDS-ACTION status
            if (this._hasCurrentUserPartstat(event, 'NEEDS-ACTION')) {
                return true;
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    // Extract a string property from an event, handling both direct strings and ICalProperty wrappers
    _getPropertyString(event, methodName) {
        try {
            if (!event || typeof event[methodName] !== 'function') return null;
            const value = event[methodName]();
            if (!value) return null;
            if (typeof value.get_value === 'function') return value.get_value() || null;
            if (typeof value === 'string') return value || null;
            return null;
        } catch (e) {
            return null;
        }
    }

    // Extract event title
    _getEventTitle(event) {
        return this._getPropertyString(event, 'get_summary') || _('Untitled event');
    }

    // Convert ICalTime to JavaScript timestamp (milliseconds) with proper timezone handling
    _icalTimeToTimestamp(icalTime) {
        if (!icalTime) return 0;

        try {
            // Get the ICalTime value (might be wrapped in ICalProperty)
            let timeValue = icalTime;
            if (typeof icalTime.get_value === 'function') {
                timeValue = icalTime.get_value();
            }
            if (!timeValue) return 0;

            // Extract components directly instead of using as_timet().
            // as_timet() has bugs: it ignores TZID and treats all times as UTC,
            // causing events to appear on wrong days for non-UTC timezones.
            const year = typeof timeValue.get_year === 'function' ? timeValue.get_year() : 0;
            const month = typeof timeValue.get_month === 'function' ? timeValue.get_month() : 1;
            const day = typeof timeValue.get_day === 'function' ? timeValue.get_day() : 1;
            const hour = typeof timeValue.get_hour === 'function' ? timeValue.get_hour() : 0;
            const minute = typeof timeValue.get_minute === 'function' ? timeValue.get_minute() : 0;
            const second = typeof timeValue.get_second === 'function' ? timeValue.get_second() : 0;

            // Check if the time is explicitly UTC (e.g., DTSTART:20251220T060000Z)
            const isUtc = typeof timeValue.is_utc === 'function' && timeValue.is_utc();

            if (isUtc) {
                return Date.UTC(year, month - 1, day, hour, minute, second);
            } else {
                // For all non-UTC times (VALUE=DATE, TZID times, floating times),
                // interpret components as local time. EDS provides correct
                // wall-clock components; we just need to interpret them properly.
                return new Date(year, month - 1, day, hour, minute, second).getTime();
            }
        } catch (e) {
            return 0;
        }
    }

    // Get event start time as timestamp
    // Returns 0 if DTSTART is missing/invalid, allowing filters to skip the event
    _getEventStart(event) {
        try {
            if (!event) return 0;

            // Check for instance time from generate_instances (for recurring events)
            if (event._instanceStart) {
                return event._instanceStart;
            }

            // Get start time using ECal 2.0 API
            if (typeof event.get_dtstart === 'function') {
                const dtStart = event.get_dtstart();
                if (dtStart) {
                    const timestamp = this._icalTimeToTimestamp(dtStart);
                    if (timestamp > 0) {
                        return timestamp;
                    }
                }
            }

            // Return 0 for events without valid start time
            return 0;
        } catch (e) {
            return 0;
        }
    }

    // Get event end time as timestamp
    _getEventEnd(event) {
        try {
            if (!event) return 0;

            // Check for instance time from generate_instances (for recurring events)
            if (event._instanceEnd) {
                return event._instanceEnd;
            }

            // Get end time using ECal 2.0 API
            if (typeof event.get_dtend === 'function') {
                const dtEnd = event.get_dtend();
                if (dtEnd) {
                    const timestamp = this._icalTimeToTimestamp(dtEnd);
                    if (timestamp > 0) {
                        return timestamp;
                    }
                }
            }

            // If no end time, use start time + 1 hour as fallback
            return this._getEventStart(event) + CONSTANTS.ONE_HOUR_MS;
        } catch (e) {
            // Default to start time + 1 hour
            return this._getEventStart(event) + CONSTANTS.ONE_HOUR_MS;
        }
    }

    // Async helper: Get or create the SourceRegistry
    _ensureRegistryAsync() {
        return new Promise((resolve, reject) => {
            if (this._destroyed) {
                resolve(null);
                return;
            }
            if (this._registry) {
                resolve(this._registry);
                return;
            }

            EDataServer.SourceRegistry.new(this._cancellable, (obj, res) => {
                try {
                    if (this._destroyed) {
                        resolve(null);
                        return;
                    }
                    const registry = EDataServer.SourceRegistry.new_finish(res);
                    if (this._destroyed) {
                        resolve(null);
                        return;
                    }
                    this._registry = registry;

                    // Connect to registry for source changes
                    if (this._registry) {
                        try {
                            this._registryChangedSignalId = this._registry.connect('source-changed',
                                (reg, src) => this._onCalendarSourceChanged(src));
                            this._registryAddedSignalId = this._registry.connect('source-added',
                                (reg, src) => this._onCalendarSourceChanged(src));
                            this._registryRemovedSignalId = this._registry.connect('source-removed',
                                (reg, src) => this._onCalendarSourceChanged(src));
                        } catch (e) {
                            console.error(`Chronome: Failed to connect registry signals: ${e}`);
                        }
                    }

                    resolve(this._registry);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        resolve(null);
                        return;
                    }
                    console.error(`Chronome: Failed to create SourceRegistry: ${e}`);
                    reject(e);
                }
            });
        });
    }

    // Async helper: Connect to a calendar client
    _connectClientAsync(source, sourceUid) {
        return new Promise((resolve, reject) => {
            if (this._destroyed) {
                resolve(null);
                return;
            }
            // Check cache first
            if (this._clients.has(sourceUid)) {
                resolve(this._clients.get(sourceUid));
                return;
            }

            ECal.Client.connect(
                source,
                ECal.ClientSourceType.EVENTS,
                CONSTANTS.CLIENT_CONNECT_TIMEOUT_SEC,
                this._cancellable,
                (obj, res) => {
                    try {
                        if (this._destroyed) {
                            resolve(null);
                            return;
                        }
                        const client = ECal.Client.connect_finish(res);
                        if (client) {
                            this._clients.set(sourceUid, client);

                            // Store calendar metadata for deduplication
                            const accountEmail = getAccountEmailForSource(source, this._registry);
                            if (accountEmail) {
                                this._accountEmails.set(sourceUid, accountEmail);
                            }

                            const calendarId = getCalendarIdForSource(source);
                            if (calendarId) {
                                this._calendarIds.set(sourceUid, calendarId);
                            }

                            // Store readonly status (true = view only, false = can edit)
                            const isReadonly = client.is_readonly?.() ?? false;
                            this._calendarReadonly.set(sourceUid, isReadonly);

                            // Store calendar color
                            const calendarColor = getCalendarColor(source);
                            if (calendarColor) {
                                this._calendarColors.set(sourceUid, calendarColor);
                            }

                            this._setupClientViewAsync(client, sourceUid);
                        }
                        resolve(client);
                    } catch (e) {
                        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            resolve(null);
                            return;
                        }
                        console.error(`Chronome: Failed to connect to calendar: ${e}`);
                        resolve(null); // Don't reject, just skip this calendar
                    }
                }
            );
        });
    }

    // Async helper: Generate instances using idle callback to avoid blocking shell startup
    // Note: GJS bindings don't expose destroy_cb_data from generate_instances(), so we use
    // generate_instances_sync wrapped in an idle callback for non-blocking behavior
    _generateInstancesAsync(client, startTimet, endTimet, cancellable) {
        return new Promise((resolve, reject) => {
            // Use GLib.idle_add to run the sync operation without blocking shell startup
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (this._destroyed) {
                    resolve([]);
                    return GLib.SOURCE_REMOVE;
                }
                const instances = [];
                try {
                    client.generate_instances_sync(
                        startTimet,
                        endTimet,
                        cancellable,
                        (comp, instanceStart, instanceEnd) => {
                            instances.push({
                                comp,
                                startMs: this._icalTimeToTimestamp(instanceStart),
                                endMs: this._icalTimeToTimestamp(instanceEnd)
                            });
                            return true; // Continue iteration
                        }
                    );
                    resolve(instances);
                } catch (e) {
                    reject(e);
                }
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    // Async helper: Build map of rescheduled detached instances with caching
    // Uses targeted query '(has-recurrences? #t)' to only fetch recurring events (much smaller set)
    // Cache is invalidated when date changes or calendar is modified
    // Returns: { rescheduledFromToday: Map, movedToToday: Array }
    //   - rescheduledFromToday: events originally on today but moved elsewhere (skip these)
    //   - movedToToday: events moved TO today from another date (add these, EDS won't return them)
    _buildRescheduledMapAsync(client, sourceUid, todayDateStr) {
        // Check if date changed - invalidate entire cache
        if (this._cacheDate !== todayDateStr) {
            this._rescheduledCache.clear();
            this._cacheDate = todayDateStr;
        }

        // Check cache for this source
        if (this._rescheduledCache.has(sourceUid)) {
            return Promise.resolve(this._rescheduledCache.get(sourceUid));
        }

        const accountEmail = this._accountEmails.get(sourceUid) || null;
        const calendarColor = this._calendarColors.get(sourceUid) || null;

        return new Promise((resolve) => {
            const result = {
                rescheduledFromToday: new Map(),
                movedToToday: [],
            };

            try {
                if (this._destroyed) {
                    resolve(result);
                    return;
                }
                // Use targeted query: fetch recurring events AND detached instances
                // (has-recurrences? #t) checks for RRULE/RDATE
                // (contains? "recurrence-id" "") checks for detached instances (exceptions)
                const query = '(or (has-recurrences? #t) (contains? "recurrence-id" ""))';
                client.get_object_list_as_comps(query, this._cancellable, (obj, res) => {
                    try {
                        if (this._destroyed) {
                            resolve(result);
                            return;
                        }
                        const [success, storedComps] = client.get_object_list_as_comps_finish(res);

                        if (success && storedComps) {
                            for (const comp of storedComps) {
                                const icalStr = comp.get_as_string ? comp.get_as_string() : '';

                                // Check if this is a detached instance (has RECURRENCE-ID)
                                const recurIdDateStr = extractIcalDateString(icalStr, 'RECURRENCE-ID');
                                if (!recurIdDateStr) continue;

                                // Get the stored DTSTART
                                const storedDtstartDateStr = extractIcalDateString(icalStr, 'DTSTART');

                                // Get UID
                                const uid = comp.get_uid ? comp.get_uid() : '';

                                if (!uid || !storedDtstartDateStr) continue;

                                // Case 1: RECURRENCE-ID == today, DTSTART != today
                                // This event was originally on today but moved elsewhere - skip it
                                if (recurIdDateStr === todayDateStr && storedDtstartDateStr !== todayDateStr) {
                                    const key = `${uid}:${recurIdDateStr}`;
                                    result.rescheduledFromToday.set(key, storedDtstartDateStr);
                                }

                                // Case 2: RECURRENCE-ID != today, DTSTART == today
                                // This event was moved TO today from another date
                                // EDS generate_instances_sync won't return it, so we add it manually
                                if (recurIdDateStr !== todayDateStr && storedDtstartDateStr === todayDateStr) {
                                    // Parse the times from the iCal string
                                    const parsedStart = parseIcalDateTime(icalStr, 'DTSTART');
                                    const parsedEnd = parseIcalDateTime(icalStr, 'DTEND');
                                    const parsedRecurId = parseIcalDateTime(icalStr, 'RECURRENCE-ID');

                                    if (parsedStart?.timestampMs) {
                                        // Get the inner ICalGLib.Component from ECal.Component
                                        const icalComp = comp.get_icalcomponent ? comp.get_icalcomponent() : null;
                                        if (icalComp) {
                                            const instanceStartMs = parsedStart.timestampMs;
                                            const instanceEndMs = parsedEnd?.timestampMs || (instanceStartMs + ONE_HOUR_MS); // Default 1hr
                                            const recurrenceIdStartMs = parsedRecurId?.timestampMs || null;

                                            result.movedToToday.push(
                                                this._wrapICalComponent(icalComp, instanceStartMs, instanceEndMs,
                                                    accountEmail, calendarColor, recurrenceIdStartMs)
                                            );
                                        }
                                    }
                                }
                            }
                        }

                        // Store in cache
                        this._rescheduledCache.set(sourceUid, result);
                        resolve(result);
                    } catch (e) {
                        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            resolve(result);
                            return;
                        }
                        console.error(`Chronome: Error in get_object_list_as_comps callback: ${e}`);
                        // Store empty result in cache to avoid re-querying on error
                        this._rescheduledCache.set(sourceUid, result);
                        resolve(result);
                    }
                });
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    resolve(result);
                    return;
                }
                console.error(`Chronome: Error building rescheduled instances map: ${e}`);
                this._rescheduledCache.set(sourceUid, result);
                resolve(result);
            }
        });
    }

    // Async helper: Query events from a client using generate_instances for proper recurrence expansion
    async _queryEventsAsync(client, sourceUid) {
        if (!client) {
            return [];
        }
        if (this._destroyed) {
            return [];
        }

        // Create date range for today: [midnight today, 23:59:59.999 tonight)
        // Events that overlap with this range are included:
        // - Multi-day events that started before today and extend into today
        // - Events starting at any point during today
        // Events starting exactly at midnight tomorrow are excluded (they don't overlap with today)
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        // Convert to Unix timestamps (seconds)
        const startTimet = Math.floor(todayStart.getTime() / 1000);
        // Use floor to avoid including midnight of the next day
        // 23:59:59.999 -> 86399 seconds (events in the last second are still included)
        const endTimet = Math.floor(todayEnd.getTime() / 1000);

        // Format today's date as YYYYMMDD for comparison
        const todayDateStr = `${todayStart.getFullYear()}${String(todayStart.getMonth() + 1).padStart(2, '0')}${String(todayStart.getDate()).padStart(2, '0')}`;

        // PHASE 1: Build map of rescheduled detached instances (async, cached)
        // Returns: { rescheduledFromToday: Map, movedToToday: Array }
        const rescheduleData = await this._buildRescheduledMapAsync(client, sourceUid, todayDateStr);
        const { rescheduledFromToday, movedToToday } = rescheduleData;

        // PHASE 2: Generate instances (async)
        let rawInstances;
        try {
            rawInstances = await this._generateInstancesAsync(client, startTimet, endTimet, this._cancellable);
        } catch (e) {
            console.error(`Chronome: generate_instances failed for ${sourceUid}: ${e.message}`);
            return [];
        }

        // PHASE 3: Filter and wrap instances (fast, sync is fine here)
        const instances = [];
        for (const inst of rawInstances) {
            // Check if this is a detached instance that was rescheduled
            const recurrenceId = inst.comp.get_recurrenceid ? inst.comp.get_recurrenceid() : null;

            let instanceStartMs = inst.startMs;
            let instanceEndMs = inst.endMs;
            let recurrenceIdStartMs = recurrenceId ? this._icalTimeToTimestamp(recurrenceId) : null;

            // For detached instances, use DTSTART/DTEND from the raw iCal string (not the modified component)
            if (recurrenceId && inst.comp.as_ical_string) {
                const icalStr = inst.comp.as_ical_string();

                const parsedRecurId = parseIcalDateTime(icalStr, 'RECURRENCE-ID');
                if (!recurrenceIdStartMs && parsedRecurId?.timestampMs) {
                    recurrenceIdStartMs = parsedRecurId.timestampMs;
                }

                const parsedStart = parseIcalDateTime(icalStr, 'DTSTART');
                const parsedEnd = parseIcalDateTime(icalStr, 'DTEND');

                if (parsedStart?.timestampMs) {
                    const originalDuration = inst.endMs - inst.startMs;
                    instanceStartMs = parsedStart.timestampMs;
                    if (parsedEnd?.timestampMs) {
                        instanceEndMs = parsedEnd.timestampMs;
                    } else if (originalDuration > 0) {
                        instanceEndMs = instanceStartMs + originalDuration;
                    }
                }
            }

            if (recurrenceId) {
                const uid = inst.comp.get_uid ? inst.comp.get_uid() : '';
                const key = `${uid}:${todayDateStr}`;

                if (rescheduledFromToday.has(key)) {
                    // This instance was rescheduled to a different date - skip it
                    continue;
                }
            }

            // Get account email and calendar color for this calendar source
            const accountEmail = this._accountEmails.get(sourceUid) || null;
            const calendarColor = this._calendarColors.get(sourceUid) || null;
            instances.push(this._wrapICalComponent(inst.comp, instanceStartMs, instanceEndMs,
                accountEmail, calendarColor, recurrenceIdStartMs));
        }

        // PHASE 4: Add events that were moved TO today from another date
        // These won't be returned by generate_instances_sync (which matches by RECURRENCE-ID)
        // They were already wrapped in Phase 1
        instances.push(...movedToToday);

        // Filter out events that don't actually overlap with today's local date range.
        // This is needed because generate_instances_sync uses UTC-based overlap checks,
        // which can include tomorrow's all-day events for users in timezones behind UTC.
        const todayStartMs = todayStart.getTime();
        const todayEndMs = todayEnd.getTime();
        return instances.filter(event => {
            const startMs = event._instanceStart;
            const endMs = event._instanceEnd;
            // Event overlaps with today if it starts before today ends AND ends after today starts
            return startMs <= todayEndMs && endMs > todayStartMs;
        });
    }

    // Wrap an ICalGLib.Component with instance times and proxy methods
    _wrapICalComponent(comp, instanceStartMs, instanceEndMs, accountEmail, calendarColor, recurrenceIdStartMs = null) {
        const passthroughMethods = ['get_summary', 'get_uid', 'get_location',
            'get_description', 'get_dtstart', 'get_dtend', 'get_attendees',
            'get_organizer', 'get_status'];

        const wrapper = {
            _instanceStart: instanceStartMs,
            _instanceEnd: instanceEndMs,
            _recurrenceIdStart: recurrenceIdStartMs,
            _comp: comp,  // Store reference for property iteration
            _accountEmail: accountEmail,  // Store account email for PARTSTAT lookup
            _calendarColor: calendarColor,  // Store calendar color for display
            get_as_string: () => comp.as_ical_string?.() ?? null,
            get_recurid_as_string: () => {
                const recurid = comp.get_recurrenceid?.();
                return recurid?.as_ical_string?.() ?? (recurid ? String(recurid) : null);
            },
        };

        for (const method of passthroughMethods) {
            wrapper[method] = () => comp[method]?.() ?? null;
        }

        return wrapper;
    }

    // Find all events from all calendars (async version)
    async _fetchAllEventsAsync() {
        const events = [];

        try {
            if (this._destroyed) {
                return events;
            }
            // Verify we have the required libraries
            if (!ECal || !EDataServer) {
                return events;
            }

            // Get or create registry (async)
            const registry = await this._ensureRegistryAsync();
            if (!registry) {
                return events;
            }

            // Get all calendar sources
            const sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);
            if (!sources || sources.length === 0) {
                return events;
            }

            // Filter to user-selected calendars if specified in settings
            const filteredSources = [];
            const enabledCalendars = this._settings.get_strv('enabled-calendars');

            if (enabledCalendars.length > 0) {
                for (const source of sources) {
                    const uid = source.get_uid();
                    if (enabledCalendars.includes(uid)) {
                        filteredSources.push(source);
                    }
                }
            } else {
                filteredSources.push(...sources);
            }

            // Filter to enabled sources
            const enabledSources = filteredSources.filter(source => source.get_enabled());

            // PHASE 1: Connect to all sources in parallel (to get metadata for deduplication)
            const connectPromises = enabledSources.map(async (source) => {
                const sourceUid = source.get_uid();
                try {
                    const client = await this._connectClientAsync(source, sourceUid);
                    return client ? source : null;
                } catch (e) {
                    return null;
                }
            });

            const connectedSources = (await Promise.all(connectPromises)).filter(s => s !== null);

            // PHASE 2: Deduplicate sources by calendar ID (prefer higher privilege)
            const dedupedSources = deduplicateSources(connectedSources, this._registry, this._calendarReadonly);

            // PHASE 3: Query events only from deduplicated sources
            const queryPromises = dedupedSources.map(async (source) => {
                const sourceUid = source.get_uid();
                try {
                    const client = this._clients.get(sourceUid);
                    if (client) {
                        return await this._queryEventsAsync(client, sourceUid);
                    }
                    return [];
                } catch (e) {
                    return [];
                }
            });

            const results = await Promise.all(queryPromises);
            for (const comps of results) {
                events.push(...comps);
            }
        } catch (e) {
            console.error(`Chronome: Error fetching events: ${e}`);
        }

        return events;
    }

    // Deduplicate events - prefers exceptions over master occurrences
    // Delegates to pure function from lib/eventUtils.js
    _deduplicateEvents(events) {
        return deduplicateEvents(events, this._getEventStart.bind(this));
    }

    // Get the next upcoming meeting
    // Delegates to pure function from lib/eventUtils.js
    _getNextMeeting(events) {
        return getNextMeetingPure(events, {
            getEventStart: this._getEventStart.bind(this),
            getEventEnd: this._getEventEnd.bind(this),
            isAllDayEvent: this._isAllDayEvent.bind(this),
            isDeclinedEvent: this._isDeclinedEvent.bind(this),
            isTentativeEvent: this._isTentativeEvent.bind(this),
            eventTypes: this._settings.get_strv('event-types'),
            showCurrentMeeting: this._settings.get_boolean('show-current-meeting'),
        });
    }

    // Find a video conferencing link in an event
    _findVideoLink(event) {
        if (!event) return null;

        const searchTexts = [];

        const location = this._getPropertyString(event, 'get_location');
        if (location) searchTexts.push(location);

        const description = this._getPropertyString(event, 'get_description');
        if (description) searchTexts.push(description);

        if (searchTexts.length === 0 && typeof event.get_as_string === 'function') {
            searchTexts.push(event.get_as_string() || '');
        }

        return findMeetingUrl(searchTexts.join(' '));
    }

    // Set up ECalClientView for receiving calendar change notifications (async version)
    _setupClientViewAsync(client, sourceUid) {
        if (!client || this._destroyed) return;

        // Initialize views map if needed
        if (!this._clientViews) {
            this._clientViews = new Map();
        }

        // Create a view to monitor all events (async)
        client.get_view('#t', this._cancellable, (obj, res) => {
            try {
                if (this._destroyed) {
                    return;
                }
                const [success, view] = client.get_view_finish(res);

                if (success && view) {
                    const signals = [];

                    // Create bound handler that includes sourceUid for cache invalidation
                    const boundHandler = () => this._onCalendarObjectsChanged(sourceUid);

                    // Connect to view signals
                    try {
                        const addedId = view.connect('objects-added', boundHandler);
                        signals.push({ id: addedId, obj: view });
                    } catch (e) {
                        console.error(`Chronome: Failed to connect objects-added signal: ${e}`);
                    }

                    try {
                        const modifiedId = view.connect('objects-modified', boundHandler);
                        signals.push({ id: modifiedId, obj: view });
                    } catch (e) {
                        console.error(`Chronome: Failed to connect objects-modified signal: ${e}`);
                    }

                    try {
                        const removedId = view.connect('objects-removed', boundHandler);
                        signals.push({ id: removedId, obj: view });
                    } catch (e) {
                        console.error(`Chronome: Failed to connect objects-removed signal: ${e}`);
                    }

                    // Store view and signals for cleanup
                    this._clientViews.set(sourceUid, { view, signals });

                    // Start the view to begin receiving notifications
                    view.start();
                }
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    return;
                }
                console.error(`Chronome: Error setting up client view: ${e}`);
            }
        });
    }

    // Debounced refresh - prevents refresh storms from rapid signal emissions
    _debouncedRefresh() {
        if (this._destroyed) {
            return;
        }
        if (this._refreshDebounceId) {
            GLib.Source.remove(this._refreshDebounceId);
        }
        this._refreshDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONSTANTS.DEBOUNCE_MS, () => {
            this._refreshDebounceId = null;
            this._refreshEvents();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Handler for calendar source changes - clean up removed/changed sources
    _onCalendarSourceChanged(source) {
        if (this._rescheduledCache) {
            this._rescheduledCache.clear();
        }

        // Clean up client and view for changed/removed source
        if (source) {
            const sourceUid = source.get_uid?.();
            if (sourceUid) {
                // Clean up client view
                if (this._clientViews?.has(sourceUid)) {
                    const viewData = this._clientViews.get(sourceUid);
                    try {
                        viewData.view?.stop();
                        for (const sig of viewData.signals || []) {
                            try { sig.obj?.disconnect(sig.id); } catch (e) { /* ignore */ }
                        }
                    } catch (e) { /* ignore */ }
                    this._clientViews.delete(sourceUid);
                }

                // Clean up client
                if (this._clients?.has(sourceUid)) {
                    this._clients.delete(sourceUid);
                }
                // Note: _rescheduledCache already cleared entirely above
            }
        }

        this._debouncedRefresh();
    }

    // Handler for calendar objects changes - invalidates cache for the source
    _onCalendarObjectsChanged(sourceUid) {
        // Invalidate cache for this source so it's rebuilt on next refresh
        if (sourceUid && this._rescheduledCache) {
            this._rescheduledCache.delete(sourceUid);
        }
        this._debouncedRefresh();
    }

    // Disconnect all signals
    _disconnectSignals() {
        // Cancel any pending debounced refresh
        if (this._refreshDebounceId) {
            GLib.Source.remove(this._refreshDebounceId);
            this._refreshDebounceId = null;
        }

        // Disconnect settings signals (consolidated)
        if (this._settings && this._settingsSignals) {
            for (const id of this._settingsSignals) {
                try { this._settings.disconnect(id); } catch (e) { /* ignore */ }
            }
            this._settingsSignals = null;
        }

        // Disconnect registry signals
        if (this._registry) {
            if (this._registryChangedSignalId) {
                try {
                    this._registry.disconnect(this._registryChangedSignalId);
                } catch (e) {
                    console.error(`Chronome: Error disconnecting registry changed signal: ${e}`);
                }
                this._registryChangedSignalId = null;
            }
            if (this._registryAddedSignalId) {
                try {
                    this._registry.disconnect(this._registryAddedSignalId);
                } catch (e) {
                    console.error(`Chronome: Error disconnecting registry added signal: ${e}`);
                }
                this._registryAddedSignalId = null;
            }
            if (this._registryRemovedSignalId) {
                try {
                    this._registry.disconnect(this._registryRemovedSignalId);
                } catch (e) {
                    console.error(`Chronome: Error disconnecting registry removed signal: ${e}`);
                }
                this._registryRemovedSignalId = null;
            }
        }

        // Disconnect view signals and stop views
        if (this._clientViews) {
            for (const [sourceUid, viewData] of this._clientViews.entries()) {
                const { view, signals } = viewData;
                if (view) {
                    // Stop the view first
                    try {
                        view.stop();
                    } catch (e) {
                        console.error(`Chronome: Error stopping view: ${e}`);
                    }

                    // Disconnect signals
                    for (const signalInfo of signals) {
                        try {
                            signalInfo.obj.disconnect(signalInfo.id);
                        } catch (e) {
                            console.error(`Chronome: Error disconnecting view signal: ${e}`);
                        }
                    }
                }
            }
            this._clientViews.clear();
        }
    }

    destroy() {
        // Mark as destroyed to prevent post-destroy callbacks
        this._destroyed = true;

        // Disconnect all signals
        this._disconnectSignals();

        // Cancel any pending async operations
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        // Clear views
        if (this._clientViews) {
            this._clientViews.clear();
            this._clientViews = null;
        }

        // Clear client cache - ECal.Client objects are properly garbage collected
        // in GJS when references are released. No explicit close() needed.
        if (this._clients) {
            this._clients.clear();
            this._clients = null;
        }

        // Clear account emails cache
        if (this._accountEmails) {
            this._accountEmails.clear();
            this._accountEmails = null;
        }

        // Clear calendar metadata caches
        if (this._calendarIds) {
            this._calendarIds.clear();
            this._calendarIds = null;
        }
        if (this._calendarReadonly) {
            this._calendarReadonly.clear();
            this._calendarReadonly = null;
        }
        if (this._calendarColors) {
            this._calendarColors.clear();
            this._calendarColors = null;
        }

        // Clear rescheduled instances cache
        if (this._rescheduledCache) {
            this._rescheduledCache.clear();
            this._rescheduledCache = null;
        }

        // Clear registry
        this._registry = null;

        // Clear settings reference
        this._settings = null;

        // Stop refresh timer
        this.stopTimer();

        // Call parent destroy
        super.destroy();
    }
});

export default class ChronomeExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._chronomeIndicator = null;
        this._settings = null;
    }

    enable() {
        // Initialize settings
        this._settings = this.getSettings();

        // Load CSS
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        if (theme) {
            this._stylesheetFile = Gio.File.new_for_path(this.path + '/stylesheet.css');
            theme.load_stylesheet(this._stylesheetFile);
        }

        // Create the indicator
        this._chronomeIndicator = new ChronomeIndicator(this, this._settings);

        // Add to panel (right side)
        Main.panel.addToStatusArea('chronome-indicator', this._chronomeIndicator);

        // Start refresh timer
        this._chronomeIndicator.startTimer();
    }

    disable() {
        // Unload CSS
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        if (theme && this._stylesheetFile) {
            theme.unload_stylesheet(this._stylesheetFile);
            this._stylesheetFile = null;
        }

        // Stop and destroy indicator
        if (this._chronomeIndicator) {
            this._chronomeIndicator.stopTimer();
            this._chronomeIndicator.destroy();
            this._chronomeIndicator = null;
        }

        // Clean up settings
        this._settings = null;
    }
}
