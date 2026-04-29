#!/usr/bin/env -S gjs -m
// Chronome D-Bus Service
// Owns EDS connections, processes calendar events, emits results over D-Bus.
// Spawned by extension.js on enable(), killed on disable().

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// Load ECal 2.0, EDataServer, and ICalGLib modules with version specifiers
import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';
import ICalGLib from 'gi://ICalGLib?version=3.0';

// Resolve lib/ relative to this script
import {getAccountEmailForSource, getCalendarColor, deduplicateSources} from './lib/calendarUtils.js';
// truncateText not needed - service sends full titles, extension truncates for display
import {parseIcalDateTime, extractIcalDateString} from './lib/icalParser.js';
import {deduplicateEvents, getNextMeeting as getNextMeetingPure, isAllDayEventHeuristic} from './lib/eventUtils.js';
import {ONE_HOUR_MS} from './lib/constants.js';
import {findMeetingUrl} from './lib/meetingServices.js';

Gio._promisify(ECal.Client, 'connect', 'connect_finish');
Gio._promisify(ECal.Client.prototype, 'refresh', 'refresh_finish');
Gio._promisify(ECal.Client.prototype, 'get_object_list_as_comps', 'get_object_list_as_comps_finish');
Gio._promisify(ECal.Client.prototype, 'get_view', 'get_view_finish');
Gio._promisify(EDataServer.SourceRegistry, 'new', 'new_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

// D-Bus interface
const DBUS_NAME = 'tech.herzog.Chronome1';
const DBUS_PATH = '/tech/herzog/Chronome';
const DBUS_IFACE = `
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
</node>`;

const CONSTANTS = {
    DEBOUNCE_MS: 500,
    CLIENT_CONNECT_TIMEOUT_SEC: 10,
    SYNC_DELAY_MS: 50,
};

class ChronomeService {
    constructor() {
        // Load GSettings from extension's schemas/ dir
        const schemaDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('schemas');
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            schemaDir.get_path(), Gio.SettingsSchemaSource.get_default(), false);
        const schema = schemaSource.lookup('org.gnome.shell.extensions.chronome', false);
        this._settings = new Gio.Settings({settings_schema: schema});

        // EDS state
        this._registry = null;
        this._clients = new Map();
        this._accountEmails = new Map();
        this._calendarReadonly = new Map();
        this._calendarColors = new Map();
        this._rescheduledCache = new Map();
        this._cacheDate = null;
        this._clientViews = new Map();

        // Async operation tracking
        this._refreshInProgress = false;
        this._pendingRefresh = false;
        this._refreshDebounceId = null;
        this._cancellable = new Gio.Cancellable();
        this._sourceIds = new Set();
        this._shuttingDown = false;

        // Last computed JSON payload
        this._lastJson = '{"nextMeeting":null,"events":[]}';

        // D-Bus registration
        this._exportedObject = null;
        this._nameOwnerId = 0;

        // Refresh timer
        this._fetchTimeout = null;

        // Signal source IDs
        this._sigtermSourceId = 0;
        this._sigintSourceId = 0;

        // Settings signals
        this._settingsSignals = [];
        const dataSettings = ['enabled-calendars', 'event-types', 'show-current-meeting', 'refresh-interval'];
        for (const key of dataSettings) {
            this._settingsSignals.push(
                this._settings.connect(`changed::${key}`, () => {
                    if (key === 'refresh-interval')
                        this._startFetchTimer();
                    else
                        this._refreshEvents();
                })
            );
        }
    }

    start() {
        this._loop = new GLib.MainLoop(null, false);

        this._nameOwnerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            DBUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            (conn) => this._onBusAcquired(conn),
            () => {},
            () => {
                console.error('Chronome service: failed to acquire D-Bus name');
                this._loop?.quit();
            }
        );

        this._startFetchTimer();
        this._refreshEvents();
        this._watchParent();

        const onSignal = () => {
            this._shutdown();
            return GLib.SOURCE_REMOVE;
        };
        this._sigtermSourceId = GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15 /* SIGTERM */, onSignal);
        this._sigintSourceId = GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 2 /* SIGINT */, onSignal);

        this._loop.run();
    }

    _watchParent() {
        this._stdinStream ??= Gio.UnixInputStream.new(0, false);
        this._stdinStream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, this._cancellable)
            .then(bytes => {
                if (this._shuttingDown) return;
                if (!bytes || bytes.get_size() === 0) {
                    this._shutdown();
                    return;
                }
                this._watchParent();
            })
            .catch(e => {
                if (this._shuttingDown) return;
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                this._shutdown();
            });
    }

    _shutdown() {
        if (this._shuttingDown) return;
        this._shuttingDown = true;

        this._cancellable.cancel();
        this._cancellable = null;

        this._stopFetchTimer();

        if (this._refreshDebounceId) {
            GLib.Source.remove(this._refreshDebounceId);
            this._refreshDebounceId = null;
        }

        if (this._sigtermSourceId) {
            GLib.Source.remove(this._sigtermSourceId);
            this._sigtermSourceId = 0;
        }
        if (this._sigintSourceId) {
            GLib.Source.remove(this._sigintSourceId);
            this._sigintSourceId = 0;
        }

        if (this._sourceIds) {
            for (const id of this._sourceIds)
                GLib.Source.remove(id);
            this._sourceIds.clear();
            this._sourceIds = null;
        }

        if (this._settings && this._settingsSignals) {
            for (const id of this._settingsSignals)
                this._settings.disconnect(id);
            this._settingsSignals = null;
        }

        this._disconnectEdsSignals();

        if (this._clientViews) {
            for (const [, viewData] of this._clientViews.entries()) {
                viewData.view.stop();
                for (const sig of viewData.signals || [])
                    sig.obj.disconnect(sig.id);
            }
            this._clientViews.clear();
        }

        this._clients?.clear();
        this._accountEmails?.clear();
        this._calendarReadonly?.clear();
        this._calendarColors?.clear();
        this._rescheduledCache?.clear();

        if (this._exportedObject) {
            this._exportedObject.unexport();
            this._exportedObject = null;
        }

        if (this._nameOwnerId) {
            Gio.bus_unown_name(this._nameOwnerId);
            this._nameOwnerId = 0;
        }

        this._loop?.quit();
    }

    _disconnectEdsSignals() {
        if (this._registry) {
            if (this._registryChangedSignalId) {
                this._registry.disconnect(this._registryChangedSignalId);
                this._registryChangedSignalId = null;
            }
            if (this._registryAddedSignalId) {
                this._registry.disconnect(this._registryAddedSignalId);
                this._registryAddedSignalId = null;
            }
            if (this._registryRemovedSignalId) {
                this._registry.disconnect(this._registryRemovedSignalId);
                this._registryRemovedSignalId = null;
            }
        }
    }

    // --- D-Bus ---

    _onBusAcquired(connection) {
        this._exportedObject = Gio.DBusExportedObject.wrapJSObject(DBUS_IFACE, this);
        this._exportedObject.export(connection, DBUS_PATH);
    }

    GetEvents() {
        return this._lastJson;
    }

    Refresh() {
        this._syncCalendars();
        this._refreshEvents();
    }

    Ping() {
        return true;
    }

    _emitEventsChanged(json) {
        if (!this._exportedObject) return;
        this._exportedObject.emit_signal('EventsChanged', new GLib.Variant('(s)', [json]));
    }

    // --- Timers ---

    _startFetchTimer() {
        this._stopFetchTimer();
        const interval = this._settings.get_int('refresh-interval');
        this._fetchTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refreshEvents();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopFetchTimer() {
        if (this._fetchTimeout) {
            GLib.Source.remove(this._fetchTimeout);
            this._fetchTimeout = null;
        }
    }

    // --- Refresh pipeline ---

    _refreshEvents() {
        if (this._shuttingDown) return;

        if (this._refreshInProgress) {
            this._pendingRefresh = true;
            return;
        }

        this._refreshInProgress = true;
        this._pendingRefresh = false;

        this._fetchAllEventsAsync().then(allEvents => {
            if (this._shuttingDown) return;

            const json = this._computeEventData(allEvents);
            this._lastJson = json;
            this._emitEventsChanged(json);
        }).catch(e => {
            console.error(`Chronome service: Error fetching events: ${e}`);
        }).finally(() => {
            this._refreshInProgress = false;

            if (this._pendingRefresh && !this._shuttingDown) {
                const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._sourceIds?.delete(id);
                    if (!this._shuttingDown) this._refreshEvents();
                    return GLib.SOURCE_REMOVE;
                });
                this._sourceIds?.add(id);
            }
        });
    }

    _computeEventData(allEvents) {
        if (!allEvents || allEvents.length === 0)
            return '{"nextMeeting":null,"events":[]}';

        const deduped = deduplicateEvents(allEvents, this._getEventStart.bind(this));

        // Build next meeting
        const nextMeetingRaw = getNextMeetingPure(deduped, {
            getEventStart: this._getEventStart.bind(this),
            getEventEnd: this._getEventEnd.bind(this),
            isAllDayEvent: this._isAllDayEvent.bind(this),
            isDeclinedEvent: this._isDeclinedEvent.bind(this),
            isTentativeEvent: this._isTentativeEvent.bind(this),
            eventTypes: this._settings.get_strv('event-types'),
            showCurrentMeeting: this._settings.get_boolean('show-current-meeting'),
        });

        let nextMeeting = null;
        if (nextMeetingRaw) {
            nextMeeting = {
                startMs: this._getEventStart(nextMeetingRaw),
                endMs: this._getEventEnd(nextMeetingRaw),
                title: this._getEventTitle(nextMeetingRaw),
                hasVideoLink: !!this._findVideoLink(nextMeetingRaw),
            };
        }

        // Build events array
        const events = deduped.map(event => ({
            startMs: this._getEventStart(event),
            endMs: this._getEventEnd(event),
            title: this._getEventTitle(event),
            videoLink: this._findVideoLink(event),
            calendarColor: event._calendarColor || null,
            isAllDay: this._isAllDayEvent(event),
            isDeclined: this._isDeclinedEvent(event),
            isTentative: this._isTentativeEvent(event),
            isNeedsResponse: this._isNeedsResponseEvent(event),
        }));

        return JSON.stringify({nextMeeting, events});
    }

    // --- Calendar sync ---

    async _syncCalendars() {
        if (!this._clients) return;

        const clients = Array.from(this._clients.values());

        for (const client of clients) {
            if (this._shuttingDown) return;

            await new Promise(r => {
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONSTANTS.SYNC_DELAY_MS, () => {
                    this._sourceIds?.delete(id);
                    r();
                    return GLib.SOURCE_REMOVE;
                });
                this._sourceIds?.add(id);
            });

            if (this._shuttingDown) return;

            try {
                await client.refresh(this._cancellable);
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED))
                    console.debug(`Chronome service: Calendar sync failed: ${e.message}`);
            }
        }
    }

    // --- Event analysis (ported from extension.js) ---

    _isAllDayEvent(event) {
        if (!event) return false;
        const dtStart = event.get_dtstart();
        if (dtStart) {
            if (dtStart.is_date?.()) return true;
            if (dtStart.get_value?.()?.is_date?.()) return true;
        }
        const startTime = this._getEventStart(event);
        const endTime = this._getEventEnd(event);
        return isAllDayEventHeuristic(startTime, endTime);
    }

    _hasCurrentUserPartstat(event, targetPartstat) {
        if (!event) return false;
        const comp = event._comp;
        if (!comp) return false;
        const accountEmail = event._accountEmail;
        if (!accountEmail) return false;

        const partstatMap = {
            'DECLINED': ICalGLib.ParameterPartstat.DECLINED,
            'TENTATIVE': ICalGLib.ParameterPartstat.TENTATIVE,
            'NEEDS-ACTION': ICalGLib.ParameterPartstat.NEEDSACTION,
            'ACCEPTED': ICalGLib.ParameterPartstat.ACCEPTED,
        };
        const targetValue = partstatMap[targetPartstat];
        if (targetValue === undefined) return false;

        let prop = comp.get_first_property(ICalGLib.PropertyKind.ATTENDEE_PROPERTY);
        while (prop) {
            let email = prop.get_value_as_string?.() || '';
            if (email.startsWith('mailto:'))
                email = email.substring(7);
            email = email.toLowerCase();

            if (email === accountEmail) {
                const param = prop.get_first_parameter(ICalGLib.ParameterKind.PARTSTAT_PARAMETER);
                return param ? param.get_partstat?.() === targetValue : false;
            }

            prop = comp.get_next_property(ICalGLib.PropertyKind.ATTENDEE_PROPERTY);
        }

        return false;
    }

    _isDeclinedEvent(event) {
        if (!event) return false;
        if (this._hasCurrentUserPartstat(event, 'DECLINED')) return true;
        const title = this._getEventTitle(event).toLowerCase();
        return title.includes('declined:') || title.includes('rejected:');
    }

    _isTentativeEvent(event) {
        if (!event) return false;
        if (this._hasCurrentUserPartstat(event, 'TENTATIVE')) return true;
        return event.get_status?.() === ICalGLib.PropertyStatus.TENTATIVE;
    }

    _isNeedsResponseEvent(event) {
        if (!event) return false;
        return this._hasCurrentUserPartstat(event, 'NEEDS-ACTION');
    }

    _getPropertyString(event, methodName) {
        if (!event) return null;
        return event[methodName]?.() || null;
    }

    _getEventTitle(event) {
        return this._getPropertyString(event, 'get_summary') || 'Untitled event';
    }

    _icalTimeToTimestamp(icalTime) {
        if (!icalTime) return null;
        const timeValue = icalTime.get_value?.() ?? icalTime;
        if (!timeValue) return null;

        const year = timeValue.get_year();
        const month = timeValue.get_month();
        const day = timeValue.get_day();
        const hour = timeValue.get_hour();
        const minute = timeValue.get_minute();
        const second = timeValue.get_second();

        if (timeValue.is_utc?.())
            return Date.UTC(year, month - 1, day, hour, minute, second);

        let tz;
        const tzid = timeValue.get_tzid?.();
        if (tzid)
            tz = GLib.TimeZone.new(tzid);
        else
            tz = GLib.TimeZone.new_local();

        const dateTime = GLib.DateTime.new(tz, year, month, day, hour, minute, second);
        if (!dateTime) return null;
        return dateTime.to_unix() * 1000;
    }

    _getEventStart(event) {
        if (!event) return 0;
        if (event._instanceStart) return event._instanceStart;
        const dtStart = event.get_dtstart();
        if (dtStart) {
            const timestamp = this._icalTimeToTimestamp(dtStart);
            if (timestamp > 0) return timestamp;
        }
        return 0;
    }

    _getEventEnd(event) {
        if (!event) return 0;
        if (event._instanceEnd) return event._instanceEnd;
        const dtEnd = event.get_dtend();
        if (dtEnd) {
            const timestamp = this._icalTimeToTimestamp(dtEnd);
            if (timestamp > 0) return timestamp;
        }
        return this._getEventStart(event) + ONE_HOUR_MS;
    }

    _findVideoLink(event) {
        if (!event) return null;
        const location = this._getPropertyString(event, 'get_location');
        if (location) {
            const url = findMeetingUrl(location);
            if (url) return url;
        }
        const description = this._getPropertyString(event, 'get_description');
        if (description) {
            const url = findMeetingUrl(description);
            if (url) return url;
        }
        const icalStr = event.get_as_string?.() || '';
        return icalStr ? findMeetingUrl(icalStr) : null;
    }

    // --- EDS pipeline (ported from extension.js) ---

    async _ensureRegistryAsync() {
        if (this._shuttingDown) return null;
        if (this._registry) return this._registry;

        try {
            const registry = await EDataServer.SourceRegistry.new(this._cancellable);
            if (this._shuttingDown) return null;
            this._registry = registry;

            if (this._registry) {
                this._registryChangedSignalId = this._registry.connect('source-changed',
                    (_reg, src) => this._onCalendarSourceChanged(src));
                this._registryAddedSignalId = this._registry.connect('source-added',
                    (_reg, src) => this._onCalendarSourceChanged(src));
                this._registryRemovedSignalId = this._registry.connect('source-removed',
                    (_reg, src) => this._onCalendarSourceChanged(src));
            }

            return this._registry;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return null;
            console.error(`Chronome service: Failed to create SourceRegistry: ${e}`);
            throw e;
        }
    }

    async _connectClientAsync(source, sourceUid) {
        if (this._shuttingDown) return null;
        if (this._clients.has(sourceUid))
            return this._clients.get(sourceUid);

        try {
            const client = await ECal.Client.connect(
                source, ECal.ClientSourceType.EVENTS,
                CONSTANTS.CLIENT_CONNECT_TIMEOUT_SEC,
                this._cancellable
            );
            if (this._shuttingDown) return null;
            if (client) {
                this._clients.set(sourceUid, client);
                const accountEmail = getAccountEmailForSource(source, this._registry);
                if (accountEmail) this._accountEmails.set(sourceUid, accountEmail);
                const isReadonly = client.is_readonly?.() ?? false;
                this._calendarReadonly.set(sourceUid, isReadonly);
                const calendarColor = getCalendarColor(source);
                if (calendarColor) this._calendarColors.set(sourceUid, calendarColor);
                this._setupClientViewAsync(client, sourceUid);
            }
            return client;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return null;
            console.error(`Chronome service: Failed to connect to calendar: ${e}`);
            return null;
        }
    }

    _generateInstancesAsync(client, startTimet, endTimet, cancellable) {
        return new Promise((resolve, reject) => {
            const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._sourceIds?.delete(id);
                if (this._shuttingDown) { resolve([]); return GLib.SOURCE_REMOVE; }
                const instances = [];
                try {
                    client.generate_instances_sync(
                        startTimet, endTimet, cancellable,
                        (comp, instanceStart, instanceEnd) => {
                            instances.push({
                                comp,
                                startMs: this._icalTimeToTimestamp(instanceStart),
                                endMs: this._icalTimeToTimestamp(instanceEnd),
                            });
                            return true;
                        }
                    );
                    resolve(instances);
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        resolve([]);
                    } else {
                        reject(e);
                    }
                }
                return GLib.SOURCE_REMOVE;
            });
            this._sourceIds?.add(id);
        });
    }

    async _buildRescheduledMapAsync(client, sourceUid, todayDateStr) {
        if (this._cacheDate !== todayDateStr) {
            this._rescheduledCache.clear();
            this._cacheDate = todayDateStr;
        }

        if (this._rescheduledCache.has(sourceUid))
            return this._rescheduledCache.get(sourceUid);

        const accountEmail = this._accountEmails.get(sourceUid) || null;
        const calendarColor = this._calendarColors.get(sourceUid) || null;
        const result = { rescheduledFromToday: new Map(), movedToToday: [] };

        if (this._shuttingDown) return result;

        const query = '(or (has-recurrences? #t) (contains? "recurrence-id" ""))';
        let storedComps;
        try {
            [, storedComps] = await client.get_object_list_as_comps(query, this._cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return result;
            console.error(`Chronome service: Error in get_object_list_as_comps: ${e}`);
            this._rescheduledCache.set(sourceUid, result);
            return result;
        }

        if (this._shuttingDown) return result;

        if (storedComps) {
            for (const comp of storedComps) {
                const icalStr = comp.get_as_string();
                const recurIdDateStr = extractIcalDateString(icalStr, 'RECURRENCE-ID');
                if (!recurIdDateStr) continue;

                const storedDtstartDateStr = extractIcalDateString(icalStr, 'DTSTART');
                const uid = comp.get_uid();
                if (!uid || !storedDtstartDateStr) continue;

                if (recurIdDateStr === todayDateStr && storedDtstartDateStr !== todayDateStr) {
                    const key = `${uid}:${recurIdDateStr}`;
                    result.rescheduledFromToday.set(key, storedDtstartDateStr);
                }

                if (recurIdDateStr !== todayDateStr && storedDtstartDateStr === todayDateStr) {
                    const parsedStart = parseIcalDateTime(icalStr, 'DTSTART');
                    const parsedEnd = parseIcalDateTime(icalStr, 'DTEND');
                    const parsedRecurId = parseIcalDateTime(icalStr, 'RECURRENCE-ID');

                    if (parsedStart?.timestampMs) {
                        const icalComp = comp.get_icalcomponent();
                        if (icalComp) {
                            const instanceStartMs = parsedStart.timestampMs;
                            const instanceEndMs = parsedEnd?.timestampMs || (instanceStartMs + ONE_HOUR_MS);
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

        this._rescheduledCache.set(sourceUid, result);
        return result;
    }

    async _queryEventsAsync(client, sourceUid) {
        if (!client || this._shuttingDown) return [];

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const startTimet = Math.floor(todayStart.getTime() / 1000);
        const endTimet = Math.floor(todayEnd.getTime() / 1000);
        const todayDateStr = `${todayStart.getFullYear()}${String(todayStart.getMonth() + 1).padStart(2, '0')}${String(todayStart.getDate()).padStart(2, '0')}`;

        const rescheduleData = await this._buildRescheduledMapAsync(client, sourceUid, todayDateStr);
        const {rescheduledFromToday, movedToToday} = rescheduleData;

        let rawInstances;
        try {
            rawInstances = await this._generateInstancesAsync(client, startTimet, endTimet, this._cancellable);
        } catch (e) {
            console.error(`Chronome service: generate_instances failed for ${sourceUid}: ${e.message}`);
            return [];
        }

        const instances = [];
        for (const inst of rawInstances) {
            const recurrenceId = inst.comp.get_recurrenceid ? inst.comp.get_recurrenceid() : null;
            let instanceStartMs = inst.startMs;
            let instanceEndMs = inst.endMs;
            let recurrenceIdStartMs = recurrenceId ? this._icalTimeToTimestamp(recurrenceId) : null;

            if (recurrenceId && inst.comp.as_ical_string) {
                const icalStr = inst.comp.as_ical_string();
                const parsedRecurId = parseIcalDateTime(icalStr, 'RECURRENCE-ID');
                if (!recurrenceIdStartMs && parsedRecurId?.timestampMs)
                    recurrenceIdStartMs = parsedRecurId.timestampMs;

                const parsedStart = parseIcalDateTime(icalStr, 'DTSTART');
                const parsedEnd = parseIcalDateTime(icalStr, 'DTEND');

                if (parsedStart?.timestampMs) {
                    const originalDuration = inst.endMs - inst.startMs;
                    instanceStartMs = parsedStart.timestampMs;
                    if (parsedEnd?.timestampMs)
                        instanceEndMs = parsedEnd.timestampMs;
                    else if (originalDuration > 0)
                        instanceEndMs = instanceStartMs + originalDuration;
                }
            }

            if (recurrenceId) {
                const uid = inst.comp.get_uid();
                const key = `${uid}:${todayDateStr}`;
                if (rescheduledFromToday.has(key)) continue;
            }

            const accountEmail = this._accountEmails.get(sourceUid) || null;
            const calendarColor = this._calendarColors.get(sourceUid) || null;
            instances.push(this._wrapICalComponent(inst.comp, instanceStartMs, instanceEndMs,
                accountEmail, calendarColor, recurrenceIdStartMs));
        }

        instances.push(...movedToToday);

        const todayStartMs = todayStart.getTime();
        const todayEndMs = todayEnd.getTime();
        return instances.filter(event => {
            const startMs = event._instanceStart;
            const endMs = event._instanceEnd;
            return startMs <= todayEndMs && endMs > todayStartMs;
        });
    }

    _wrapICalComponent(comp, instanceStartMs, instanceEndMs, accountEmail, calendarColor, recurrenceIdStartMs = null) {
        const passthroughMethods = ['get_summary', 'get_uid', 'get_location',
            'get_description', 'get_dtstart', 'get_dtend', 'get_attendees',
            'get_organizer', 'get_status'];

        const wrapper = {
            _instanceStart: instanceStartMs,
            _instanceEnd: instanceEndMs,
            _recurrenceIdStart: recurrenceIdStartMs,
            _comp: comp,
            _accountEmail: accountEmail,
            _calendarColor: calendarColor,
            get_as_string: () => comp.as_ical_string?.() ?? null,
            get_recurid_as_string: () => {
                const recurid = comp.get_recurrenceid?.();
                return recurid?.as_ical_string?.() ?? null;
            },
        };

        for (const method of passthroughMethods)
            wrapper[method] = () => comp[method]?.() ?? null;

        return wrapper;
    }

    async _fetchAllEventsAsync() {
        if (this._shuttingDown) return [];

        const registry = await this._ensureRegistryAsync();
        if (!registry) return [];

        const sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);
        if (!sources || sources.length === 0) return [];

        const enabledCalendars = this._settings.get_strv('enabled-calendars');
        const filteredSources = enabledCalendars.length > 0
            ? sources.filter(s => enabledCalendars.includes(s.get_uid()))
            : sources;

        const enabledSources = filteredSources.filter(source => source.get_enabled());

        const connectPromises = enabledSources.map(async (source) => {
            const client = await this._connectClientAsync(source, source.get_uid());
            return client ? source : null;
        });
        const connectedSources = (await Promise.all(connectPromises)).filter(s => s !== null);

        const dedupedSources = deduplicateSources(connectedSources, this._registry, this._calendarReadonly);

        const queryPromises = dedupedSources.map(async (source) => {
            const client = this._clients.get(source.get_uid());
            return client ? await this._queryEventsAsync(client, source.get_uid()) : [];
        });

        const results = await Promise.all(queryPromises);
        const events = [];
        for (const comps of results)
            events.push(...comps);
        return events;
    }

    // --- EDS change notifications ---

    async _setupClientViewAsync(client, sourceUid) {
        if (!client || this._shuttingDown) return;

        // '#t' matches every component. A narrower (occur-in-time-range? ...)
        // query would also filter which changes emit objects-added/modified/
        // removed signals, so edits to events outside the window would not
        // trigger a refresh and the UI would drift stale until the next poll.
        let success, view;
        try {
            [success, view] = await client.get_view('#t', this._cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
            console.error(`Chronome service: Error setting up client view: ${e}`);
            return;
        }

        if (this._shuttingDown) {
            if (success && view) view.stop();
            return;
        }

        if (success && view) {
            const boundHandler = () => this._onCalendarObjectsChanged(sourceUid);
            const signals = [
                {id: view.connect('objects-added', boundHandler), obj: view},
                {id: view.connect('objects-modified', boundHandler), obj: view},
                {id: view.connect('objects-removed', boundHandler), obj: view},
            ];
            this._clientViews.set(sourceUid, {view, signals});
            view.start();
        }
    }

    _debouncedRefresh() {
        if (this._shuttingDown) return;
        if (this._refreshDebounceId)
            GLib.Source.remove(this._refreshDebounceId);
        this._refreshDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONSTANTS.DEBOUNCE_MS, () => {
            this._refreshDebounceId = null;
            this._refreshEvents();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onCalendarSourceChanged(source) {
        if (this._rescheduledCache)
            this._rescheduledCache.clear();

        if (source) {
            const sourceUid = source.get_uid?.();
            if (sourceUid) {
                if (this._clientViews?.has(sourceUid)) {
                    const viewData = this._clientViews.get(sourceUid);
                    viewData.view.stop();
                    for (const sig of viewData.signals || [])
                        sig.obj.disconnect(sig.id);
                    this._clientViews.delete(sourceUid);
                }

                if (this._clients?.has(sourceUid))
                    this._clients.delete(sourceUid);

                // Clean up stale metadata
                this._accountEmails?.delete(sourceUid);
                this._calendarReadonly?.delete(sourceUid);
                this._calendarColors?.delete(sourceUid);
            }
        }

        this._debouncedRefresh();
    }

    _onCalendarObjectsChanged(sourceUid) {
        if (sourceUid && this._rescheduledCache)
            this._rescheduledCache.delete(sourceUid);
        this._debouncedRefresh();
    }
}

// --- Entry point ---
const service = new ChronomeService();
service.start();
