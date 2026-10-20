// Live suite: builds test calendars in Evolution Data Server, runs service.js against them and asserts on its D-Bus output.
// Run through ./run-tests.sh, which starts it on a private session bus with throwaway XDG directories.
// It refuses to run anywhere else, so it cannot touch real calendars.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';
import ICalGLib from 'gi://ICalGLib';

import {DBUS_NAME, DBUS_PATH, DBUS_IFACE_XML} from '../../lib/dbusInterface.js';
import {describe, it, expect, printSummary} from '../runner.js';
import {
    ACCOUNT_EMAIL, MEET_LINK, ZOOM_LINK, AKA_LINK, TEAMS_SHORT_LINK,
    localMs, buildMainCalendar, buildSecondCalendar, buildLateEvent,
} from './fixtures.js';

Gio._promisify(ECal.Client, 'connect', 'connect_finish');
Gio._promisify(ECal.Client.prototype, 'receive_objects', 'receive_objects_finish');
Gio._promisify(ECal.Client.prototype, 'create_object', 'create_object_finish');
Gio._promisify(ECal.Client.prototype, 'remove_object', 'remove_object_finish');
Gio._promisify(EDataServer.SourceRegistry, 'new', 'new_finish');
Gio._promisify(EDataServer.SourceRegistry.prototype, 'commit_source', 'commit_source_finish');
Gio._promisify(EDataServer.Source.prototype, 'remove', 'remove_finish');
Gio._promisify(Gio.Subprocess.prototype, 'wait_async', 'wait_finish');

const MAIN_UID = 'chronome-live-main';
const SECOND_UID = 'chronome-live-second';
const MAIN_COLOR = '#123456';
const SECOND_COLOR = '#abcdef';
const WAIT_TIMEOUT_MS = 20000;

const repoDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent();

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function waitUntil(description, predicate, timeoutMs = WAIT_TIMEOUT_MS) {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    while (GLib.get_monotonic_time() < deadline) {
        const result = await predicate();
        if (result) return result;
        await sleep(100);
    }
    throw new Error(`Timed out waiting for ${description}`);
}

async function createCalendar(registry, uid, displayName, color) {
    const source = EDataServer.Source.new_with_uid(uid, null);
    source.set_display_name(displayName);
    source.set_parent('local-stub');
    const calendar = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR);
    calendar.set_backend_name('local');
    calendar.set_color(color);
    // The service resolves the account address from this extension, which the RSVP fixtures rely on.
    source.get_extension(EDataServer.SOURCE_EXTENSION_AUTHENTICATION).set_user(ACCOUNT_EMAIL);
    await registry.commit_source(source, null);

    const registered = await waitUntil(`source ${uid}`, () => registry.ref_source(uid));
    const client = await ECal.Client.connect(registered, ECal.ClientSourceType.EVENTS, 10, null);
    return {source: registered, client};
}

function loadChronomeSettings() {
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        repoDir.get_child('schemas').get_path(), Gio.SettingsSchemaSource.get_default(), false);
    return new Gio.Settings({settings_schema: schemaSource.lookup('org.gnome.shell.extensions.chronome', false)});
}

class ServiceUnderTest {
    async start() {
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDIN_PIPE});
        this.process = launcher.spawnv(['gjs', '-m', repoDir.get_child('service.js').get_path()]);

        const Proxy = Gio.DBusProxy.makeProxyWrapper(DBUS_IFACE_XML);
        this.proxy = await new Promise((resolve, reject) => {
            new Proxy(Gio.DBus.session, DBUS_NAME, DBUS_PATH,
                (proxy, error) => error ? reject(error) : resolve(proxy));
        });
        await waitUntil('the service to own its bus name', () => this.proxy.g_name_owner !== null);
    }

    async payload() {
        const [json] = await this.proxy.GetEventsAsync();
        return JSON.parse(json);
    }

    waitForPayload(description, predicate) {
        return waitUntil(description, async () => {
            const payload = await this.payload();
            return predicate(payload) ? payload : null;
        });
    }

    async stop() {
        this.process.send_signal(15);
        const exited = this.process.wait_async(null).then(() => true);
        const timedOut = sleep(5000).then(() => false);
        const exitedInTime = await Promise.race([exited, timedOut]);
        if (!exitedInTime) this.process.force_exit();
        if (!exitedInTime) return 'still running after 5 s';
        return this.process.get_if_exited()
            ? `exit ${this.process.get_exit_status()}`
            : `signal ${this.process.get_term_sig()}`;
    }
}

const titlesOf = payload => payload.events.map(event => event.title);
const hasTitle = title => payload => titlesOf(payload).includes(title);

function checkInitialPayload(payload) {
    const byTitle = title => payload.events.filter(event => event.title === title);
    const only = title => {
        const matches = byTitle(title);
        if (matches.length !== 1)
            throw new Error(`Expected one "${title}", got ${matches.length}`);
        return matches[0];
    };

    describe('Live: conference link ranking', () => {
        it('prefers CONFERENCE over a link in LOCATION', () => {
            expect(only('Link Conference').videoLink).toBe(MEET_LINK);
        });
        it('skips a tel: CONFERENCE and falls through to DESCRIPTION', () => {
            expect(only('Link Conference Tel').videoLink).toBe(ZOOM_LINK);
        });
        it('reads X-GOOGLE-CONFERENCE', () => {
            expect(only('Link Google X').videoLink).toBe(MEET_LINK);
        });
        it('accepts an aka.ms Teams property and ignores the SIP property beside it', () => {
            expect(only('Link Teams Aka').videoLink).toBe(AKA_LINK);
        });
        it('never reads X-MICROSOFT-ONLINEMEETINGCONFLINK, even in the whole-component scan', () => {
            expect(only('Link Sip Only').videoLink).toBeNull();
        });
        it('treats an empty X- value as absent and keeps the passcode of the DESCRIPTION link', () => {
            expect(only('Link Empty X').videoLink).toBe(ZOOM_LINK);
        });
        it('ignores a URL property that is not a meeting link', () => {
            expect(only('Link Url Generic').videoLink).toBeNull();
        });
        it('finds a link that libical folded across two lines', () => {
            expect(only('Link Folded').videoLink).toBe(TEAMS_SHORT_LINK);
        });
        it('returns null when the event has no link', () => {
            expect(only('Link None').videoLink).toBeNull();
        });
    });

    describe('Live: all-day events and the day boundary', () => {
        it('shows today\'s all-day event, flagged all-day, on local midnight', () => {
            const event = only('All Day Today');
            expect(event.isAllDay).toBe(true);
            expect(event.startMs).toBe(localMs(0, '0000'));
            expect(event.endMs).toBe(localMs(1, '0000'));
        });
        it('skips the whole-component link scan for an all-day event', () => {
            expect(only('All Day Today').videoLink).toBeNull();
        });
        it('drops yesterday\'s and tomorrow\'s all-day events from the padded range', () => {
            expect(byTitle('All Day Yesterday').length).toBe(0);
            expect(byTitle('All Day Tomorrow').length).toBe(0);
        });
        it('shows an all-day event that spans today', () => {
            expect(only('All Day Spanning').isAllDay).toBe(true);
        });
        it('expands an all-day series onto today once', () => {
            const event = only('Recur All Day');
            expect(event.isAllDay).toBe(true);
            expect(event.startMs).toBe(localMs(0, '0000'));
        });
        it('shows events in the first and last half hour of the local day', () => {
            expect(only('Edge Early Today').startMs).toBe(localMs(0, '0010'));
            expect(only('Edge Late Tonight').startMs).toBe(localMs(0, '2330'));
        });
        it('drops events just outside the local day', () => {
            expect(byTitle('Edge Late Last Night').length).toBe(0);
            expect(byTitle('Edge Early Tomorrow').length).toBe(0);
        });
        it('shows an event that started yesterday and ends today', () => {
            expect(only('Edge Overnight').endMs).toBe(localMs(0, '0100'));
        });
    });

    describe('Live: time forms', () => {
        it('reads a floating time as local', () => {
            expect(only('Time Floating').startMs).toBe(localMs(0, '1000'));
        });
        it('reads a UTC time', () => {
            expect(only('Time Utc').startMs).toBe(localMs(0, '1400'));
        });
        it('reads a foreign TZID', () => {
            expect(only('Time Foreign').startMs).toBe(localMs(0, '1500'));
            expect(only('Time Foreign').endMs).toBe(localMs(0, '1530'));
        });
    });

    describe('Live: RSVP', () => {
        const flags = title => {
            const {isDeclined, isTentative, isNeedsResponse} = only(title);
            return {isDeclined, isTentative, isNeedsResponse};
        };
        const none = {isDeclined: false, isTentative: false, isNeedsResponse: false};

        it('matches the address in an EMAIL parameter', () => {
            expect(flags('Rsvp Email Param')).toEqual({...none, isDeclined: true});
        });
        it('matches a MAILTO: value in any case', () => {
            expect(flags('Rsvp Mailto Case')).toEqual({...none, isTentative: true});
        });
        it('reports NEEDS-ACTION', () => {
            expect(flags('Rsvp Needs Action')).toEqual({...none, isNeedsResponse: true});
        });
        it('reads the user\'s own line when it comes after other attendees', () => {
            expect(flags('Rsvp Last Attendee')).toEqual(none);
        });
        it('ignores other attendees\' answers when the user is not invited', () => {
            expect(flags('Rsvp Others Declined')).toEqual(none);
        });
        it('treats STATUS:TENTATIVE as tentative on any backend', () => {
            expect(flags('Rsvp Status Tentative')).toEqual({...none, isTentative: true});
        });
        it('does not read STATUS:CANCELLED as declined on a local calendar', () => {
            expect(flags('Rsvp Status Cancelled')).toEqual(none);
        });
        it('falls back to a Declined: title prefix', () => {
            expect(flags('Declined: Rsvp Title Prefix')).toEqual({...none, isDeclined: true});
        });
    });

    describe('Live: recurrence and detached instances', () => {
        it('expands a daily series onto today once', () => {
            expect(only('Recur Plain').startMs).toBe(localMs(0, '0800'));
        });
        it('hides an occurrence that was moved off today', () => {
            expect(byTitle('Recur Moved Off').length).toBe(0);
        });
        it('shows an occurrence moved onto today once, beside today\'s own occurrence', () => {
            expect(only('Recur Moved Onto (moved)').startMs).toBe(localMs(0, '1700'));
            expect(only('Recur Moved Onto').startMs).toBe(localMs(0, '1800'));
        });
        it('replaces an occurrence edited in place with its detached instance', () => {
            const event = only('Recur Edited (edited)');
            expect(event.startMs).toBe(localMs(0, '0715'));
            expect(event.videoLink).toBe(MEET_LINK);
            expect(byTitle('Recur Edited').length).toBe(0);
        });
        it('shows a foreign-TZID occurrence moved onto today once', () => {
            expect(only('Recur Foreign (moved)').startMs).toBe(localMs(0, '1300'));
            expect(only('Recur Foreign').startMs).toBe(localMs(0, '1200'));
        });
        it('keeps the other slots of a series when two of today\'s slots are moved off', () => {
            expect(byTitle('Recur Four Slots (moved)').length).toBe(0);
            expect(byTitle('Recur Four Slots (moved again)').length).toBe(0);
            expect(only('Recur Four Slots').startMs).toBe(localMs(0, '2200'));
            const edited = only('Recur Four Slots (edited)');
            expect(edited.startMs).toBe(localMs(0, '1415'));
            expect(edited.videoLink).toBe(MEET_LINK);
        });
    });

    describe('Live: payload', () => {
        it('carries each calendar\'s colour', () => {
            expect(only('Link None').calendarColor).toBe(MAIN_COLOR);
            expect(only('Second Calendar Event').calendarColor).toBe(SECOND_COLOR);
        });
        it('sorts nothing away: every event has a positive duration inside today', () => {
            for (const event of payload.events) {
                if (!(event.endMs > event.startMs && event.startMs <= localMs(0, '2359') && event.endMs > localMs(0, '0000')))
                    throw new Error(`"${event.title}" lies outside today`);
            }
        });
        it('picks a next meeting that has not ended, or none', () => {
            if (payload.nextMeeting === null) return;
            expect(titlesOf(payload)).toContain(payload.nextMeeting.title);
            expect(payload.nextMeeting.endMs > Date.now()).toBe(true);
        });
    });
}

async function main() {
    const registry = await EDataServer.SourceRegistry.new(null);
    const service = new ServiceUnderTest();
    const calendars = [];

    try {
        const main = await createCalendar(registry, MAIN_UID, 'Chronome Live Main', MAIN_COLOR);
        calendars.push(main);
        const second = await createCalendar(registry, SECOND_UID, 'Chronome Live Second', SECOND_COLOR);
        calendars.push(second);

        await main.client.receive_objects(
            ICalGLib.Component.new_from_string(buildMainCalendar()), ECal.OperationFlags.NONE, null);
        await second.client.receive_objects(
            ICalGLib.Component.new_from_string(buildSecondCalendar()), ECal.OperationFlags.NONE, null);

        await service.start();
        const initial = await service.waitForPayload('both calendars in the payload',
            payload => hasTitle('Link None')(payload) && hasTitle('Second Calendar Event')(payload));
        checkInitialPayload(initial);

        const ping = await service.proxy.PingAsync();
        await service.proxy.RefreshAsync();

        const [lateUid] = await main.client.create_object(
            ICalGLib.Component.new_from_string(buildLateEvent()), ECal.OperationFlags.NONE, null);
        const afterAdd = await service.waitForPayload('the added event', hasTitle('Added Later')).catch(() => null);

        await main.client.remove_object(lateUid, null, ECal.ObjModType.ALL, ECal.OperationFlags.NONE, null);
        const afterRemove = await service.waitForPayload('the removed event to go',
            payload => !hasTitle('Added Later')(payload)).catch(() => null);

        const settings = loadChronomeSettings();
        settings.set_strv('enabled-calendars', [MAIN_UID]);
        const afterFilter = await service.waitForPayload('the second calendar to be filtered out',
            payload => !hasTitle('Second Calendar Event')(payload)).catch(() => null);
        settings.reset('enabled-calendars');
        const afterReset = await service.waitForPayload('the second calendar to return',
            hasTitle('Second Calendar Event')).catch(() => null);

        const stopped = await service.stop();
        const nameReleased = await waitUntil('the bus name to be released',
            () => service.proxy.g_name_owner === null, 5000).then(() => true, () => false);

        describe('Live: service behaviour', () => {
            it('answers Ping and accepts Refresh on calendars that cannot refresh', () => {
                expect(ping[0]).toBe(true);
            });
            it('picks up an event added while running, with its link', () => {
                expect(afterAdd?.events.find(event => event.title === 'Added Later')?.videoLink).toBe(MEET_LINK);
            });
            it('drops an event removed while running', () => {
                expect(afterRemove !== null).toBe(true);
            });
            it('follows enabled-calendars', () => {
                expect(afterFilter !== null).toBe(true);
                expect(afterFilter && hasTitle('Link None')(afterFilter)).toBe(true);
                expect(afterReset !== null).toBe(true);
            });
            it('exits cleanly on SIGTERM and releases its bus name', () => {
                expect(stopped).toBe('exit 0');
                expect(nameReleased).toBe(true);
            });
        });
    } finally {
        if (service.process?.get_identifier())
            service.process.force_exit();
        for (const {source} of calendars)
            await source.remove(null);
        // Same teardown trap as service.js: an undisposed registry crashes the interpreter's final collection.
        registry.run_dispose();
    }
}

const requiredDir = GLib.getenv('CHRONOME_LIVE_TEST_DIR');
if (!requiredDir || !GLib.get_user_data_dir().startsWith(requiredDir)) {
    printerr('tests/live/runLive.js must be started by ./run-tests.sh, which isolates it from real calendars.');
    System.exit(2);
}

print(`Chronome Live Suite (${GLib.TimeZone.new_local().get_identifier()})`);
print('='.repeat(50));

const loop = new GLib.MainLoop(null, false);
let crashed = null;
main().catch(e => {
    crashed = e;
}).finally(() => loop.quit());
loop.run();

if (crashed) {
    printerr(`Live suite aborted: ${crashed.message}\n${crashed.stack ?? ''}`);
    System.exit(1);
}
printSummary();
