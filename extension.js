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

// Pure utility modules (display-side only)
import {formatDuration, formatTimeRange, truncateText} from './lib/formatting.js';
import {getCurrentMeetings} from './lib/eventUtils.js';

// D-Bus constants
const DBUS_NAME = 'tech.herzog.Chronome1';
const DBUS_PATH = '/tech/herzog/Chronome';

// Constants
const CONSTANTS = {
    OPACITY_DIMMED: 178,
    OPACITY_TENTATIVE: 204,
    MENU_ICON_SIZE: 16,
    SERVICE_RESTART_DELAY_SEC: 2,
};

// Main indicator class
const ChronomeIndicator = GObject.registerClass({
    GTypeName: 'ChronomeIndicator',
}, class ChronomeIndicator extends PanelMenu.Button {
    _init(extension, settings, proxy) {
        super._init(0.0, 'Chronome', false);
        this._extension = extension;
        this._settings = settings;
        this._proxy = proxy;

        // Create UI elements
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});

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

        // Timer to update display countdown (every second)
        this._displayTimeout = null;

        // Store parsed event data from service
        this._nextMeeting = null;
        this._events = [];
        this._dataLoaded = false;

        // D-Bus signal connection
        this._proxySignalId = this._proxy.connectSignal('EventsChanged',
            (_proxy, _sender, [json]) => this._onEventsChanged(json));

        // Connect settings signals for UI-only settings
        this._settingsSignals = [];

        const refreshSettings = ['show-past-events', 'show-event-end-time',
            'time-format', 'use-calendar-colors', 'event-types'];
        for (const key of refreshSettings) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._updateFromCache())
            );
        }

        const labelSettings = ['real-time-countdown', 'event-title-length'];
        for (const key of labelSettings) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => {
                    if (key === 'real-time-countdown') this._setupDisplayTimer();
                    this._updatePanelLabel(this._nextMeeting);
                })
            );
        }

        this._settingsSignals.push(
            this._settings.connect('changed::status-bar-icon-type', () => this._updateIcon())
        );
    }

    // Fetch initial data from service
    fetchInitialData() {
        this._proxy.call('GetEvents', null, Gio.DBusCallFlags.NONE, 5000, null,
            (proxy, res) => {
                try {
                    const result = proxy.call_finish(res);
                    if (result) {
                        const [json] = result.deep_unpack();
                        this._onEventsChanged(json);
                    }
                } catch (e) {
                    // Service may still be starting - EventsChanged signal will arrive later
                    console.debug(`Chronome: GetEvents call failed (service may be starting): ${e.message}`);
                }
            }
        );
    }

    // Handle EventsChanged signal from service
    _onEventsChanged(json) {
        try {
            const data = JSON.parse(json);
            this._nextMeeting = data.nextMeeting;
            this._events = data.events || [];
            this._dataLoaded = true;
            this._updateFromCache();
        } catch (e) {
            console.error(`Chronome: Failed to parse events JSON: ${e}`);
        }
    }

    // Update all UI from cached data
    _updateFromCache() {
        this._updateMenu(this._events);
        this._updatePanelLabel(this._nextMeeting);
        this._updateIcon();
    }

    // Update the top bar label
    _updateLabel(text) {
        if (text)
            this._label.set_text(text);
    }

    // Update the panel icon based on settings
    _updateIcon() {
        if (!this._nextMeeting) {
            this._icon.show();
            this._icon.icon_name = 'x-office-calendar-symbolic';
            return;
        }

        const iconType = this._settings.get_string('status-bar-icon-type');
        if (iconType === 'none') {
            this._icon.hide();
        } else if (iconType === 'calendar') {
            this._icon.show();
            this._icon.icon_name = 'x-office-calendar-symbolic';
        } else if (iconType === 'meeting-type') {
            if (this._nextMeeting.hasVideoLink) {
                this._icon.show();
                this._icon.icon_name = 'camera-video-symbolic';
            } else {
                this._icon.hide();
            }
        }
    }

    // Start the display timer
    startTimer() {
        this.stopTimer();
        this._setupDisplayTimer();
    }

    // Stop all timers
    stopTimer() {
        if (this._displayTimeout) {
            GLib.Source.remove(this._displayTimeout);
            this._displayTimeout = null;
        }
    }

    // Setup or teardown the display timer based on settings
    _setupDisplayTimer() {
        if (this._displayTimeout) {
            GLib.Source.remove(this._displayTimeout);
            this._displayTimeout = null;
        }

        if (this._settings.get_boolean('real-time-countdown')) {
            this._displayTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (this._nextMeeting) {
                    if (this._nextMeeting.endMs < Date.now()) {
                        // Meeting ended - clear stale data and ask service for fresh data
                        this._nextMeeting = null;
                        this._updatePanelLabel(null);
                        this._updateIcon();
                        this._refreshEvents();
                    } else {
                        this._updatePanelLabel(this._nextMeeting);
                    }
                } else if (this._dataLoaded) {
                    this._updatePanelLabel(null);
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    // Ask the D-Bus service to refresh
    _refreshEvents() {
        this._proxy.call('Refresh', null, Gio.DBusCallFlags.NONE, 5000, null, (_proxy, res) => {
            try { _proxy.call_finish(res); } catch (_e) { /* ignore */ }
        });
    }

    // Update panel label based on next meeting
    _updatePanelLabel(nextMeeting) {
        if (!nextMeeting) {
            this._label.hide();
            return;
        }

        this._label.show();

        const maxLength = this._settings.get_int('event-title-length');
        const shortenedTitle = truncateText(nextMeeting.title, maxLength);

        const startTime = nextMeeting.startMs;
        const endTime = nextMeeting.endMs;
        const now = Date.now();

        if (!this._settings.get_boolean('real-time-countdown')) {
            if (startTime <= now && endTime > now) {
                const concurrentSuffix = this._getConcurrentCurrentMeetingSuffix(nextMeeting, now);
                this._updateLabel(`${_('Now:')} ${shortenedTitle}${concurrentSuffix}`);
            } else {
                this._updateLabel(`${_('Next:')} ${shortenedTitle}`);
            }
            return;
        }

        if (startTime <= now && endTime > now) {
            const remainingMs = endTime - now;
            const remainingText = this._formatDuration(remainingMs) + ' ' + _('left');
            const concurrentSuffix = this._getConcurrentCurrentMeetingSuffix(nextMeeting, now);
            this._updateLabel(`${remainingText} ${_('in')} ${shortenedTitle}${concurrentSuffix}`);
            return;
        }

        const diffMs = startTime - now;
        this._updateLabel(`${this._formatDuration(diffMs)} ${_('until')} ${shortenedTitle}`);
    }

    // Show "+N" for additional meetings happening at the same time.
    _getConcurrentCurrentMeetingSuffix(nextMeeting, now) {
        const currentMeetings = getCurrentMeetings(this._events, {
            getEventStart: e => e.startMs,
            getEventEnd: e => e.endMs,
            isAllDayEvent: e => e.isAllDay,
            isDeclinedEvent: e => e.isDeclined,
            isTentativeEvent: e => e.isTentative,
            eventTypes: this._settings.get_strv('event-types'),
            now,
            minRemainingMs: 0,
        });

        if (currentMeetings.length <= 1)
            return '';

        let matchedPrimary = false;
        let additionalCount = 0;

        for (const event of currentMeetings) {
            if (!matchedPrimary && this._isSameMeeting(nextMeeting, event)) {
                matchedPrimary = true;
                continue;
            }
            additionalCount++;
        }

        if (!matchedPrimary || additionalCount <= 0)
            return '';

        return ` +${additionalCount}`;
    }

    _isSameMeeting(nextMeeting, event) {
        if (!nextMeeting || !event) return false;
        return nextMeeting.startMs === event.startMs &&
            nextMeeting.endMs === event.endMs &&
            nextMeeting.title === event.title;
    }

    // Update dropdown menu with today's events
    _updateMenu(events) {
        this.menu.removeAll();

        if (!events || events.length === 0) {
            const noEventsItem = new PopupMenu.PopupMenuItem(_('No events today'));
            noEventsItem.setSensitive(false);
            this.menu.addMenuItem(noEventsItem);
            return;
        }

        const eventTypes = this._settings.get_strv('event-types');
        const showPastEvents = this._settings.get_boolean('show-past-events');
        const showEndTime = this._settings.get_boolean('show-event-end-time');
        const useColors = this._settings.get_boolean('use-calendar-colors');
        const now = Date.now();

        // Sort by start time
        const sorted = [...events].sort((a, b) => a.startMs - b.startMs);

        // Filter and collect visible events
        const visibleEvents = [];
        for (const event of sorted) {
            const isPast = event.endMs < now;
            const isAllDay = event.isAllDay;
            const isDeclined = event.isDeclined;
            const isTentative = event.isTentative;

            if (isPast && !showPastEvents) continue;
            if (isAllDay && !eventTypes.includes('all-day')) continue;

            if (!isAllDay) {
                if (isDeclined) {
                    if (!eventTypes.includes('declined')) continue;
                } else if (isTentative) {
                    if (!eventTypes.includes('tentative')) continue;
                } else {
                    if (!eventTypes.includes('regular')) continue;
                }
            }

            visibleEvents.push({
                ...event,
                isPast,
                timeRange: isAllDay ? _('All Day') : this._formatTimeRange(event.startMs, event.endMs, showEndTime),
            });
        }

        if (visibleEvents.length === 0) {
            const noEventsItem = new PopupMenu.PopupMenuItem(_('No events today'));
            noEventsItem.setSensitive(false);
            this.menu.addMenuItem(noEventsItem);
            return;
        }

        for (const data of visibleEvents) {
            const {startMs, endMs, isPast, isDeclined, isTentative,
                   isNeedsResponse, timeRange, title, videoLink, calendarColor} = data;

            let statusIcon = null;
            if (isDeclined)
                statusIcon = 'radio-mixed-symbolic';
            else if (isTentative)
                statusIcon = 'radio-checked-symbolic';
            else if (isNeedsResponse)
                statusIcon = 'radio-symbolic';

            const menuItem = statusIcon
                ? new PopupMenu.PopupImageMenuItem('', statusIcon)
                : new PopupMenu.PopupMenuItem('');

            const gridLayout = new Clutter.GridLayout({orientation: Clutter.Orientation.HORIZONTAL});
            const labelBox = new St.Widget({layout_manager: gridLayout, x_expand: true});
            gridLayout.hookup_style(labelBox);

            let col = 0;

            if (useColors && calendarColor) {
                const colorBar = new St.Widget({
                    style: `background-color: ${calendarColor}; width: 3px; margin-right: 8px;`,
                    y_expand: true,
                });
                gridLayout.attach(colorBar, col++, 0, 1, 1);
            }

            const timeColumnWidth = showEndTime ? '128px' : '48px';
            const timeLabel = new St.Label({
                text: timeRange,
                y_align: Clutter.ActorAlign.CENTER,
                style: `min-width: ${timeColumnWidth}; margin-right: 8px;`,
            });
            gridLayout.attach(timeLabel, col++, 0, 1, 1);

            if (videoLink) {
                const videoIcon = new St.Icon({
                    icon_name: 'camera-video-symbolic',
                    style_class: 'popup-menu-icon',
                    icon_size: CONSTANTS.MENU_ICON_SIZE,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: 'margin-right: 6px;',
                });
                gridLayout.attach(videoIcon, col++, 0, 1, 1);
            }

            const titleLabel = new St.Label({
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            const titleText = videoLink ? `${title} \u2197` : title;
            if (isDeclined) {
                const escapedTitle = GLib.markup_escape_text(titleText, -1);
                titleLabel.clutter_text.set_markup(`<s>${escapedTitle}</s>`);
            } else {
                titleLabel.set_text(titleText);
            }
            gridLayout.attach(titleLabel, col++, 0, 1, 1);

            menuItem.label.hide();
            menuItem.add_child(labelBox);

            if (videoLink) {
                menuItem.connect('activate', () => {
                    try {
                        Gio.AppInfo.launch_default_for_uri(videoLink, null);
                    } catch (e) {
                        console.error(`Chronome: Failed to launch URL: ${e}`);
                    }
                });
            } else {
                menuItem.track_hover = false;
            }

            if (isPast) {
                menuItem.set_opacity(CONSTANTS.OPACITY_DIMMED);
            } else if (startMs <= now && endMs > now) {
                menuItem.add_style_class_name('chronome-current-event');
                menuItem.setOrnament(PopupMenu.Ornament.DOT);
            }

            if (isDeclined)
                menuItem.set_opacity(CONSTANTS.OPACITY_DIMMED);
            if (isTentative)
                menuItem.set_opacity(CONSTANTS.OPACITY_TENTATIVE);

            this.menu.addMenuItem(menuItem);
        }

        // Add refresh button
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh'));
        refreshItem.connect('activate', () => this._refreshEvents());
        this.menu.addMenuItem(refreshItem);

        // Add settings button
        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(settingsItem);
    }

    // Format a time range for display
    _formatTimeRange(startTs, endTs, showEndTime = true) {
        const use24Hour = this._settings.get_string('time-format') === '24h';
        return formatTimeRange(startTs, endTs, showEndTime, use24Hour);
    }

    // Format a duration in milliseconds
    _formatDuration(ms) {
        return formatDuration(ms, _);
    }

    destroy() {
        // Remove timers
        this.stopTimer();

        // Disconnect D-Bus signal
        if (this._proxySignalId && this._proxy) {
            this._proxy.disconnectSignal(this._proxySignalId);
            this._proxySignalId = null;
        }

        // Disconnect settings signals
        if (this._settings && this._settingsSignals) {
            for (const id of this._settingsSignals) {
                try { this._settings.disconnect(id); } catch (_e) { /* ignore */ }
            }
            this._settingsSignals = null;
        }

        this._proxy = null;
        this._settings = null;

        super.destroy();
    }
});

export default class ChronomeExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._chronomeIndicator = null;
        this._settings = null;
        this._subprocess = null;
        this._proxy = null;
        this._restartTimeoutId = null;
    }

    enable() {
        this._settings = this.getSettings();

        // Spawn the D-Bus service subprocess
        this._spawnService();

        // Create D-Bus proxy
        const nodeInfo = Gio.DBusNodeInfo.new_for_xml(`
            <node>
              <interface name="${DBUS_NAME}">
                <method name="GetEvents">
                  <arg type="s" direction="out" name="json"/>
                </method>
                <method name="Refresh"/>
                <method name="Ping">
                  <arg type="b" direction="out" name="alive"/>
                </method>
                <signal name="EventsChanged">
                  <arg type="s" name="json"/>
                </signal>
              </interface>
            </node>`);

        this._proxy = new Gio.DBusProxy({
            g_connection: Gio.DBus.session,
            g_name: DBUS_NAME,
            g_object_path: DBUS_PATH,
            g_interface_info: nodeInfo.interfaces[0],
            g_interface_name: DBUS_NAME,
        });
        this._proxy.init(null);

        // Create indicator with proxy
        this._chronomeIndicator = new ChronomeIndicator(this, this._settings, this._proxy);
        Main.panel.addToStatusArea('chronome-indicator', this._chronomeIndicator);
        this._chronomeIndicator.startTimer();

        // Fetch initial data (may fail if service still starting - that's OK)
        this._chronomeIndicator.fetchInitialData();
    }

    disable() {
        // Cancel any pending restart
        if (this._restartTimeoutId) {
            GLib.Source.remove(this._restartTimeoutId);
            this._restartTimeoutId = null;
        }

        // Destroy indicator first (disconnects proxy signal)
        if (this._chronomeIndicator) {
            this._chronomeIndicator.destroy();
            this._chronomeIndicator = null;
        }

        // Kill the service subprocess (SIGTERM for clean D-Bus unregistration)
        if (this._subprocess) {
            this._subprocess.send_signal(15); // SIGTERM
            this._subprocess = null;
        }

        this._proxy = null;
        this._settings = null;
    }

    _spawnService() {
        const servicePath = this.path + '/service.js';
        this._subprocess = Gio.Subprocess.new(
            ['gjs', '-m', servicePath],
            Gio.SubprocessFlags.NONE
        );

        // Monitor for unexpected death and auto-restart
        this._subprocess.wait_async(null, (proc, res) => {
            try { proc.wait_finish(res); } catch (_e) { /* ignore */ }

            // If we still have settings, extension is still enabled - restart service
            if (this._settings && !this._restartTimeoutId) {
                console.debug('Chronome: Service process died, restarting...');
                this._restartTimeoutId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    CONSTANTS.SERVICE_RESTART_DELAY_SEC,
                    () => {
                        this._restartTimeoutId = null;
                        if (this._settings) {
                            this._spawnService();
                            // Re-fetch data after restart
                            if (this._chronomeIndicator)
                                this._chronomeIndicator.fetchInitialData();
                        }
                        return GLib.SOURCE_REMOVE;
                    }
                );
            }
        });
    }
}
