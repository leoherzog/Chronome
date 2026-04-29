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
                    console.debug(`Chronome: GetEvents call failed (service may be starting): ${e.message}`);
                }
            }
        );
    }

    // Handle EventsChanged signal from service
    _onEventsChanged(json) {
        let data;
        try {
            data = JSON.parse(json);
        } catch (e) {
            console.error(`Chronome: Failed to parse events payload: ${e.message}`);
            return;
        }
        this._nextMeeting = data.nextMeeting;
        this._events = data.events || [];
        this._dataLoaded = true;
        this._updateFromCache();
    }

    // Update all UI from cached data
    _updateFromCache() {
        this._updateMenu(this._events);
        this._updatePanelLabel(this._nextMeeting);
        this._updateIcon();
    }

    // Update the top bar label
    _updateLabel(text) {
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
        this._proxy.call('Refresh', null, Gio.DBusCallFlags.NONE, 5000, null, null);
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

            const labelBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
            });

            if (useColors && calendarColor) {
                const colorBar = new St.Widget({
                    style_class: 'chronome-color-bar',
                    style: `background-color: ${calendarColor};`,
                    y_expand: true,
                });
                labelBox.add_child(colorBar);
            }

            const timeLabelClass = showEndTime
                ? 'chronome-time-label chronome-time-label-wide'
                : 'chronome-time-label';
            const timeLabel = new St.Label({
                text: timeRange,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: timeLabelClass,
            });
            labelBox.add_child(timeLabel);

            if (videoLink) {
                const videoIcon = new St.Icon({
                    icon_name: 'camera-video-symbolic',
                    style_class: 'popup-menu-icon chronome-video-icon',
                    icon_size: CONSTANTS.MENU_ICON_SIZE,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                labelBox.add_child(videoIcon);
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
            labelBox.add_child(titleLabel);

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
        this.stopTimer();

        if (this._proxySignalId) {
            this._proxy.disconnectSignal(this._proxySignalId);
            this._proxySignalId = null;
        }

        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = null;

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
        this._proxyCancellable = null;
        this._restartTimeoutId = null;
    }

    enable() {
        this._settings = this.getSettings();

        // Spawn the D-Bus service subprocess
        this._spawnService();

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

        this._proxyCancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            nodeInfo.interfaces[0],
            DBUS_NAME,
            DBUS_PATH,
            DBUS_NAME,
            this._proxyCancellable,
            (source, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.error(`Chronome: Failed to create D-Bus proxy: ${e.message}`);
                    return;
                }

                if (!this._settings) return;

                this._proxy = proxy;
                this._chronomeIndicator = new ChronomeIndicator(this, this._settings, this._proxy);
                Main.panel.addToStatusArea('chronome-indicator', this._chronomeIndicator);
                this._chronomeIndicator.startTimer();
                this._chronomeIndicator.fetchInitialData();
            }
        );
    }

    disable() {
        if (this._proxyCancellable) {
            this._proxyCancellable.cancel();
            this._proxyCancellable = null;
        }

        if (this._restartTimeoutId) {
            GLib.Source.remove(this._restartTimeoutId);
            this._restartTimeoutId = null;
        }

        if (this._chronomeIndicator) {
            this._chronomeIndicator.destroy();
            this._chronomeIndicator = null;
        }

        if (this._subprocess) {
            this._subprocess.send_signal(15); // SIGTERM
            this._subprocess = null;
        }

        this._proxy = null;
        this._settings = null;
    }

    _spawnService() {
        const servicePath = this.path + '/service.js';
        // STDIN_PIPE: child reads from a pipe owned by this process. When the
        // parent dies (or disable() closes the subprocess), the pipe's write
        // end closes and the child reads EOF — that's how _watchParent in
        // service.js detects parent death and shuts down cleanly.
        this._subprocess = Gio.Subprocess.new(
            ['gjs', '-m', servicePath],
            Gio.SubprocessFlags.STDIN_PIPE
        );

        this._subprocess.wait_async(null, (proc, res) => {
            try { proc.wait_finish(res); } catch (_e) { /* ignore */ }

            if (this._settings && !this._restartTimeoutId) {
                console.debug('Chronome: Service process died, restarting...');
                this._restartTimeoutId = GLib.timeout_add_seconds(
                    GLib.PRIORITY_DEFAULT,
                    CONSTANTS.SERVICE_RESTART_DELAY_SEC,
                    () => {
                        this._restartTimeoutId = null;
                        if (this._settings) {
                            this._spawnService();
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
