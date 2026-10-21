#!/usr/bin/env -S gjs -m
// Chronome D-Bus Service
// Owns EDS connections, processes calendar events, emits results over D-Bus.
// Spawned by extension.js on enable(), killed on disable().

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

// ECal loads the ICalGLib version EDS was built against, so the unversioned import below reuses it.
import ECal from 'gi://ECal?version=2.0';
import ICalGLib from 'gi://ICalGLib';
import EDataServer from 'gi://EDataServer?version=1.2';

import {getAccountEmailForSource, getCalendarColor, deduplicateSources} from './lib/calendarUtils.js';
import {DBUS_NAME, DBUS_PATH, DBUS_IFACE_XML} from './lib/dbusInterface.js';
import {deduplicateEvents, getNextMeeting as getNextMeetingPure} from './lib/eventUtils.js';
import {
    getEventStart, getEventEnd, getEventTitle, findVideoLink,
    isAllDayEvent, isDeclinedEvent, isTentativeEvent, isNeedsResponseEvent,
} from './service/eventProperties.js';
import {queryEventsAsync} from './service/eventQuery.js';

Gio._promisify(ECal.Client, 'connect', 'connect_finish');
Gio._promisify(ECal.Client.prototype, 'refresh', 'refresh_finish');
Gio._promisify(ECal.Client.prototype, 'get_object_list_as_comps', 'get_object_list_as_comps_finish');
Gio._promisify(ECal.Client.prototype, 'get_view', 'get_view_finish');
Gio._promisify(EDataServer.SourceRegistry, 'new', 'new_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

// gjs warns on GLib.unix_signal_add and Gio.UnixInputStream from GLib 2.80, where they moved to GLibUnix and GioUnix,
// and GLibUnix names the signal function signal_add_full before GLib 2.88. GNOME 45 has neither namespace, and a
// top-level await would starve the main loop, so they load through imports.gi.
let unixSignalAdd, UnixInputStream;
if (GLib.check_version(2, 80, 0) !== null) {
    unixSignalAdd = GLib.unix_signal_add;
    UnixInputStream = Gio.UnixInputStream;
} else {
    const {GLibUnix, GioUnix} = imports.gi;
    unixSignalAdd = GLib.check_version(2, 88, 0) === null ? GLibUnix.signal_add : GLibUnix.signal_add_full;
    UnixInputStream = GioUnix.InputStream;
}

const CONSTANTS = {
    DEBOUNCE_MS: 500,
    CLIENT_CONNECT_TIMEOUT_SEC: 10,
    SYNC_DELAY_MS: 50,
};

// There is no Extension object in this process, so the schema has to be located
// by hand. The id is read out of metadata.json rather than repeated here, so
// metadata.json stays the single source of truth for it.
function loadSettings() {
    const scriptDir = Gio.File.new_for_uri(import.meta.url).get_parent();
    let schema = null;
    try {
        const [, contents] = scriptDir.get_child('metadata.json').load_contents(null);
        const metadata = JSON.parse(new TextDecoder().decode(contents));
        const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            scriptDir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
        schema = schemaSource.lookup(metadata['settings-schema'], false);
    } catch (e) {
        console.error(`Chronome service: failed to load GSettings schema: ${e}`);
    }

    if (!schema) {
        console.error('Chronome service: GSettings schema not found, exiting');
        System.exit(1);
    }

    return new Gio.Settings({settings_schema: schema});
}

// GLib's local zone honours TZ, as Date and icalTimeToTimestamp() do. ECal.util_get_system_timezone() reads only
// the system configuration, so it is the fallback for an identifier libical does not know.
function getLocalICalTimezone() {
    return ICalGLib.Timezone.get_builtin_timezone(GLib.TimeZone.new_local().get_identifier()) ||
        ECal.util_get_system_timezone();
}

class ChronomeService {
    constructor() {
        this._settings = loadSettings();

        this._registry = null;
        this._clients = new Map();
        this._accountEmails = new Map();
        this._calendarReadonly = new Map();
        this._calendarColors = new Map();
        this._backendNames = new Map();
        this._rescheduledCache = new Map();
        this._cacheDate = null;
        this._clientViews = new Map();
        this._sourceFailures = new Set();

        this._refreshInProgress = false;
        this._pendingRefresh = false;
        this._refreshDebounceId = null;
        // Cancelled, never replaced, by _shutdown().
        this._cancellable = new Gio.Cancellable();
        this._sourceIds = new Set();

        this._lastJson = '{"nextMeeting":null,"events":[]}';

        this._exportedObject = null;
        this._nameOwnerId = 0;

        this._fetchTimeout = null;

        this._sigtermSourceId = 0;
        this._sigintSourceId = 0;
        this._stdinStream = null;
        this._loop = null;

        this._registrySignals = [];

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
                this._loop.quit();
            }
        );

        this._startFetchTimer();
        this._refreshEvents();
        this._watchParent();

        const onSignal = () => {
            this._shutdown();
            return GLib.SOURCE_REMOVE;
        };
        this._sigtermSourceId = unixSignalAdd(GLib.PRIORITY_DEFAULT, 15 /* SIGTERM */, onSignal);
        this._sigintSourceId = unixSignalAdd(GLib.PRIORITY_DEFAULT, 2 /* SIGINT */, onSignal);

        this._loop.run();
    }

    _watchParent() {
        this._stdinStream ??= UnixInputStream.new(0, false);
        this._stdinStream.read_bytes_async(4096, GLib.PRIORITY_DEFAULT, this._cancellable)
            .then(bytes => {
                if (this._cancellable.is_cancelled()) return;
                if (!bytes || bytes.get_size() === 0) {
                    this._shutdown();
                    return;
                }
                this._watchParent();
            })
            .catch(e => {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                this._shutdown();
            });
    }

    _shutdown() {
        if (this._cancellable.is_cancelled()) return;
        this._cancellable.cancel();

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

        for (const id of this._sourceIds)
            GLib.Source.remove(id);
        this._sourceIds.clear();

        for (const id of this._settingsSignals)
            this._settings.disconnect(id);

        if (this._registry) {
            for (const id of this._registrySignals)
                this._registry.disconnect(id);
            // Disposing the registry iterates the main context. Left to the interpreter's final collection, that
            // dispatches a source whose JS callback is already gone and the process dies with SIGSEGV.
            this._registry.run_dispose();
            this._registry = null;
        }

        for (const [, viewData] of this._clientViews.entries())
            this._teardownClientView(viewData);
        this._clientViews.clear();

        this._clients.clear();
        this._accountEmails.clear();
        this._calendarReadonly.clear();
        this._calendarColors.clear();
        this._backendNames.clear();
        this._rescheduledCache.clear();
        this._sourceFailures.clear();

        if (this._exportedObject) {
            this._exportedObject.unexport();
            this._exportedObject = null;
        }

        if (this._nameOwnerId) {
            Gio.bus_unown_name(this._nameOwnerId);
            this._nameOwnerId = 0;
        }

        this._loop.quit();
    }

    // e_cal_client_view_stop() is a synchronous D-Bus call into the calendar
    // backend and raises a GError once that backend is gone.
    _stopView(view) {
        try {
            view.stop();
        } catch (e) {
            console.debug(`Chronome service: stopping client view failed: ${e.message}`);
        }
    }

    _teardownClientView(viewData) {
        this._stopView(viewData.view);
        for (const sig of viewData.signals)
            sig.obj.disconnect(sig.id);
    }

    _dropSource(sourceUid) {
        const viewData = this._clientViews.get(sourceUid);
        if (viewData) {
            this._teardownClientView(viewData);
            this._clientViews.delete(sourceUid);
        }

        this._clients.delete(sourceUid);
        this._accountEmails.delete(sourceUid);
        this._calendarReadonly.delete(sourceUid);
        this._calendarColors.delete(sourceUid);
        this._backendNames.delete(sourceUid);
        this._rescheduledCache.delete(sourceUid);
    }

    _getSourceMetadata(sourceUid) {
        return {
            accountEmail: this._accountEmails.get(sourceUid) || null,
            calendarColor: this._calendarColors.get(sourceUid) || null,
            backendName: this._backendNames.get(sourceUid) || null,
        };
    }

    // A calendar that is offline, revoked or unreachable fails on every poll,
    // i.e. every 30-60s forever. Only the first failure of a given source is
    // worth an error in the journal; the repeats go to debug until it recovers.
    _logSourceFailure(sourceUid, message) {
        if (this._sourceFailures.has(sourceUid)) {
            console.debug(message);
            return;
        }
        this._sourceFailures.add(sourceUid);
        console.error(message);
    }

    // --- D-Bus ---

    _onBusAcquired(connection) {
        this._exportedObject = Gio.DBusExportedObject.wrapJSObject(DBUS_IFACE_XML, this);
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
        if (this._cancellable.is_cancelled()) return;

        if (this._refreshInProgress) {
            this._pendingRefresh = true;
            return;
        }

        this._refreshInProgress = true;
        this._pendingRefresh = false;

        this._fetchAllEventsAsync().then(allEvents => {
            if (this._cancellable.is_cancelled()) return;

            const json = this._computeEventData(allEvents);
            this._lastJson = json;
            this._emitEventsChanged(json);
        }).catch(e => {
            console.error(`Chronome service: Error fetching events: ${e}`);
        }).finally(() => {
            this._refreshInProgress = false;

            if (this._pendingRefresh && !this._cancellable.is_cancelled()) {
                const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    this._sourceIds.delete(id);
                    this._refreshEvents();
                    return GLib.SOURCE_REMOVE;
                });
                this._sourceIds.add(id);
            }
        });
    }

    _computeEventData(allEvents) {
        if (allEvents.length === 0)
            return '{"nextMeeting":null,"events":[]}';

        const deduped = deduplicateEvents(allEvents, getEventStart);

        const nextMeetingRaw = getNextMeetingPure(deduped, {
            getEventStart,
            getEventEnd,
            isAllDayEvent,
            isDeclinedEvent,
            isTentativeEvent,
            eventTypes: this._settings.get_strv('event-types'),
            showCurrentMeeting: this._settings.get_boolean('show-current-meeting'),
        });

        let nextMeeting = null;
        if (nextMeetingRaw) {
            nextMeeting = {
                startMs: getEventStart(nextMeetingRaw),
                endMs: getEventEnd(nextMeetingRaw),
                title: getEventTitle(nextMeetingRaw),
                hasVideoLink: !!findVideoLink(nextMeetingRaw),
            };
        }

        const events = deduped.map(event => ({
            startMs: getEventStart(event),
            endMs: getEventEnd(event),
            title: getEventTitle(event),
            videoLink: findVideoLink(event),
            calendarColor: event._calendarColor || null,
            isAllDay: isAllDayEvent(event),
            isDeclined: isDeclinedEvent(event),
            isTentative: isTentativeEvent(event),
            isNeedsResponse: isNeedsResponseEvent(event),
        }));

        return JSON.stringify({nextMeeting, events});
    }

    // --- Calendar sync ---

    async _syncCalendars() {
        const clients = Array.from(this._clients.values());

        for (const client of clients) {
            if (this._cancellable.is_cancelled()) return;
            // A cached capability read, so a source that cannot refresh costs no D-Bus call and no delay.
            if (!client.check_refresh_supported()) continue;

            await new Promise(r => {
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONSTANTS.SYNC_DELAY_MS, () => {
                    this._sourceIds.delete(id);
                    r();
                    return GLib.SOURCE_REMOVE;
                });
                this._sourceIds.add(id);
            });

            try {
                await client.refresh(this._cancellable);
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED))
                    console.debug(`Chronome service: Calendar sync failed: ${e.message}`);
            }
        }
    }

    // --- EDS pipeline ---

    async _ensureRegistryAsync() {
        if (this._registry) return this._registry;

        try {
            const registry = await EDataServer.SourceRegistry.new(this._cancellable);
            if (this._cancellable.is_cancelled()) return null;
            this._registry = registry;

            for (const signal of ['source-changed', 'source-added', 'source-removed']) {
                this._registrySignals.push(this._registry.connect(signal,
                    (_reg, src) => this._onCalendarSourceChanged(src)));
            }

            return this._registry;
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.error(`Chronome service: Failed to create SourceRegistry: ${e}`);
            return null;
        }
    }

    async _connectClientAsync(source, sourceUid) {
        if (this._clients.has(sourceUid))
            return this._clients.get(sourceUid);

        try {
            const client = await ECal.Client.connect(
                source, ECal.ClientSourceType.EVENTS,
                CONSTANTS.CLIENT_CONNECT_TIMEOUT_SEC,
                this._cancellable
            );
            if (this._cancellable.is_cancelled()) return null;

            // A new client resolves all-day and floating times against UTC.
            const localZone = getLocalICalTimezone();
            if (localZone) client.set_default_timezone(localZone);

            this._clients.set(sourceUid, client);
            this._sourceFailures.delete(sourceUid);
            const accountEmail = getAccountEmailForSource(source, this._registry);
            if (accountEmail) this._accountEmails.set(sourceUid, accountEmail);
            this._calendarReadonly.set(sourceUid, client.is_readonly());
            const calendarColor = getCalendarColor(source);
            if (calendarColor) this._calendarColors.set(sourceUid, calendarColor);
            const backendName = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR).get_backend_name();
            if (backendName) this._backendNames.set(sourceUid, backendName);
            this._setupClientViewAsync(client, sourceUid);

            return client;
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return null;
            this._logSourceFailure(sourceUid, `Chronome service: Failed to connect to calendar: ${e}`);
            return null;
        }
    }

    async _fetchAllEventsAsync() {
        const registry = await this._ensureRegistryAsync();
        if (!registry) return [];

        const sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);
        if (sources.length === 0) return [];

        const enabledCalendars = this._settings.get_strv('enabled-calendars');
        const filteredSources = enabledCalendars.length > 0
            ? sources.filter(s => enabledCalendars.includes(s.get_uid()))
            : sources;

        const enabledSources = filteredSources.filter(source => source.get_enabled());

        const wanted = new Set(enabledSources.map(s => s.get_uid()));
        for (const uid of this._clients.keys()) {
            if (!wanted.has(uid)) this._dropSource(uid);
        }

        const connectPromises = enabledSources.map(async (source) => {
            const client = await this._connectClientAsync(source, source.get_uid());
            return client ? source : null;
        });
        const connectedSources = (await Promise.all(connectPromises)).filter(s => s !== null);

        const dedupedSources = deduplicateSources(connectedSources, this._registry, this._calendarReadonly);

        const queryPromises = dedupedSources.map(async (source) => {
            const client = this._clients.get(source.get_uid());
            return client ? await queryEventsAsync(this, client, source.get_uid()) : [];
        });

        const results = await Promise.all(queryPromises);
        const events = [];
        for (const comps of results)
            events.push(...comps);
        return events;
    }

    // --- EDS change notifications ---

    async _setupClientViewAsync(client, sourceUid) {
        // '#t' matches every component. A narrower (occur-in-time-range? ...)
        // query would also filter which changes emit objects-added/modified/
        // removed signals, so edits to events outside the window would not
        // trigger a refresh and the UI would drift stale until the next poll.
        let view;
        try {
            [view] = await client.get_view('#t', this._cancellable);
            if (!view) return;

            // `_shutdown()` clears `_clients`, so this also catches a setup
            // that outlived the service or its source.
            if (this._clients.get(sourceUid) !== client) {
                this._stopView(view);
                return;
            }

            const boundHandler = () => this._onCalendarObjectsChanged(sourceUid);
            const signals = [
                {id: view.connect('objects-added', boundHandler), obj: view},
                {id: view.connect('objects-modified', boundHandler), obj: view},
                {id: view.connect('objects-removed', boundHandler), obj: view},
            ];
            view.start();
            this._clientViews.set(sourceUid, {view, signals});
        } catch (e) {
            // A view that was created but not registered would otherwise be
            // left running with nothing able to stop it.
            if (view) this._stopView(view);
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
            this._logSourceFailure(sourceUid, `Chronome service: Error setting up client view: ${e}`);
        }
    }

    _debouncedRefresh() {
        if (this._cancellable.is_cancelled()) return;
        if (this._refreshDebounceId)
            GLib.Source.remove(this._refreshDebounceId);
        this._refreshDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONSTANTS.DEBOUNCE_MS, () => {
            this._refreshDebounceId = null;
            this._refreshEvents();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onCalendarSourceChanged(source) {
        const sourceUid = source ? source.get_uid() : null;
        if (sourceUid)
            this._dropSource(sourceUid);
        else
            this._rescheduledCache.clear();

        this._debouncedRefresh();
    }

    _onCalendarObjectsChanged(sourceUid) {
        if (sourceUid)
            this._rescheduledCache.delete(sourceUid);
        this._debouncedRefresh();
    }
}

const service = new ChronomeService();
service.start();
