// Loaded only by the GNOME Shell process (never by prefs.js).

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatDuration, formatTimeRange, truncateText} from '../lib/formatting.js';
import {getCurrentMeetings, sortEventsByStartTime} from '../lib/eventUtils.js';

const CONSTANTS = {
    OPACITY_DIMMED: 178,
    OPACITY_TENTATIVE: 204,
    MENU_ICON_SIZE: 16,
    DBUS_CALL_TIMEOUT_MS: 5000,
};

export const ChronomeIndicator = GObject.registerClass({
    GTypeName: 'ChronomeIndicator',
}, class ChronomeIndicator extends PanelMenu.Button {
    _init(extension, settings, proxy) {
        super._init(0.0, 'Chronome', false);
        this._extension = extension;
        this._settings = settings;
        this._proxy = proxy;
        this._cancellable = new Gio.Cancellable();

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

        this._displayTimeout = null;
        this._nextMeeting = null;
        this._events = [];

        this._updateIcon();

        this._proxySignalId = this._proxy.connectSignal('EventsChanged',
            (_proxy, _sender, [json]) => this._onEventsChanged(json));

        this._settingsSignals = [];

        const refreshSettings = ['show-past-events', 'show-event-end-time',
            'time-format', 'use-calendar-colors', 'event-types'];
        for (const key of refreshSettings) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => this._updateFromCache())
            );
        }

        this._settingsSignals.push(
            this._settings.connect('changed::real-time-countdown', () => {
                this.startTimer();
                this._updatePanelLabel(this._nextMeeting);
            }),
            this._settings.connect('changed::event-title-length',
                () => this._updatePanelLabel(this._nextMeeting))
        );

        this._settingsSignals.push(
            this._settings.connect('changed::status-bar-icon-type', () => this._updateIcon())
        );
    }

    fetchInitialData() {
        this._proxy.call('GetEvents', null, Gio.DBusCallFlags.NONE, CONSTANTS.DBUS_CALL_TIMEOUT_MS,
            this._cancellable, (proxy, res) => {
                let result;
                try {
                    result = proxy.call_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.debug(`Chronome: GetEvents call failed (service may be starting): ${e.message}`);
                    return;
                }
                const [json] = result.deep_unpack();
                this._onEventsChanged(json);
            }
        );
    }

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
        this._updateFromCache();
    }

    // An empty PopupMenu refuses to open, so the closed menu is kept built; removeAll() while open would destroy the focused row.
    _updateFromCache() {
        if (!this.menu.isOpen)
            this._updateMenu();
        this._updatePanelLabel(this._nextMeeting);
        this._updateIcon();
    }

    _onOpenStateChanged(menu, open) {
        if (open)
            this._updateMenu();
        super._onOpenStateChanged(menu, open);
    }

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

    startTimer() {
        this._stopTimer();
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
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
    }

    _stopTimer() {
        if (this._displayTimeout) {
            GLib.Source.remove(this._displayTimeout);
            this._displayTimeout = null;
        }
    }

    _refreshEvents() {
        this._proxy.call('Refresh', null, Gio.DBusCallFlags.NONE, CONSTANTS.DBUS_CALL_TIMEOUT_MS, null, null);
    }

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
                this._label.set_text(`${_('Now:')} ${shortenedTitle}${concurrentSuffix}`);
            } else {
                this._label.set_text(`${_('Next:')} ${shortenedTitle}`);
            }
            return;
        }

        if (startTime <= now && endTime > now) {
            const remainingMs = endTime - now;
            const remainingText = formatDuration(remainingMs, _) + ' ' + _('left');
            const concurrentSuffix = this._getConcurrentCurrentMeetingSuffix(nextMeeting, now);
            this._label.set_text(`${remainingText} ${_('in')} ${shortenedTitle}${concurrentSuffix}`);
            return;
        }

        const diffMs = startTime - now;
        this._label.set_text(`${formatDuration(diffMs, _)} ${_('until')} ${shortenedTitle}`);
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

    _addNoEventsItem() {
        const noEventsItem = new PopupMenu.PopupMenuItem(_('No events today'));
        noEventsItem.setSensitive(false);
        this.menu.addMenuItem(noEventsItem);
    }

    _updateMenu() {
        this.menu.removeAll();

        if (this._events.length === 0) {
            this._addNoEventsItem();
            return;
        }

        const eventTypes = this._settings.get_strv('event-types');
        const showPastEvents = this._settings.get_boolean('show-past-events');
        const showEndTime = this._settings.get_boolean('show-event-end-time');
        const useColors = this._settings.get_boolean('use-calendar-colors');
        const use24Hour = this._settings.get_string('time-format') === '24h';
        const now = Date.now();

        const sorted = sortEventsByStartTime([...this._events], e => e.startMs);

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
                timeRange: isAllDay ? _('All Day') : formatTimeRange(event.startMs, event.endMs, showEndTime, use24Hour),
            });
        }

        if (visibleEvents.length === 0) {
            this._addNoEventsItem();
            return;
        }

        for (const data of visibleEvents) {
            const {startMs, endMs, isPast, isDeclined, isTentative,
                   isNeedsResponse, timeRange, title, videoLink, calendarColor} = data;

            const [statusIcon, statusText] = isDeclined ? ['radio-mixed-symbolic', _('Declined')]
                : isTentative ? ['radio-checked-symbolic', _('Tentative')]
                : isNeedsResponse ? ['radio-symbolic', _('Needs response')]
                : [null, null];

            const menuItem = statusIcon
                ? new PopupMenu.PopupImageMenuItem('', statusIcon)
                : new PopupMenu.PopupMenuItem('');

            const labelBox = new St.BoxLayout({x_expand: true});

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
            if (isDeclined) {
                const escapedTitle = GLib.markup_escape_text(title, -1);
                titleLabel.clutter_text.set_markup(`<s>${escapedTitle}</s>`);
            } else {
                titleLabel.set_text(title);
            }
            labelBox.add_child(titleLabel);

            menuItem.label.hide();
            menuItem.add_child(labelBox);

            // The hidden built-in label leaves the row with no accessible name of its own.
            menuItem.accessible_name = [timeRange, title, statusText, videoLink ? _('Video call') : null]
                .filter(s => s)
                .join(', ');

            if (videoLink) {
                menuItem.connect('activate', () => {
                    try {
                        Gio.AppInfo.launch_default_for_uri(videoLink, global.create_app_launch_context(0, -1));
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

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh'));
        refreshItem.connect('activate', () => this._refreshEvents());
        this.menu.addMenuItem(refreshItem);

        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(settingsItem);
    }

    destroy() {
        this._stopTimer();

        this._cancellable.cancel();
        this._cancellable = null;

        this._proxy.disconnectSignal(this._proxySignalId);
        this._proxySignalId = null;

        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = null;

        this._proxy = null;
        this._settings = null;
        this._extension = null;
        this._nextMeeting = null;
        this._events = null;

        super.destroy();
    }
});
