// Today's-events query pipeline for the Chronome D-Bus service.
// Loaded only by the spawned service process (see service.js).
// Each takes the ChronomeService instance and reads its live cancellable, source set and rescheduled cache.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseIcalDateTime} from '../lib/icalParser.js';
import {ONE_HOUR_MS} from '../lib/constants.js';
import {icalTimeToTimestamp, wrapICalComponent} from './eventProperties.js';

export function generateInstancesAsync(service, client, startTimet, endTimet, cancellable) {
    return new Promise((resolve, reject) => {
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            service._sourceIds.delete(id);
            const instances = [];
            try {
                client.generate_instances_sync(
                    startTimet, endTimet, cancellable,
                    (comp, instanceStart, instanceEnd) => {
                        instances.push({
                            comp,
                            startMs: icalTimeToTimestamp(instanceStart),
                            endMs: icalTimeToTimestamp(instanceEnd),
                        });
                        return true;
                    }
                );
                resolve(instances);
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                    resolve([]);
                } else {
                    reject(e);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        service._sourceIds.add(id);
    });
}

export async function buildRescheduledMapAsync(service, client, sourceUid, todayDateStr, todayStartMs, todayEndMs) {
    if (service._cacheDate !== todayDateStr) {
        service._rescheduledCache.clear();
        service._cacheDate = todayDateStr;
    }

    if (service._rescheduledCache.has(sourceUid))
        return service._rescheduledCache.get(sourceUid);

    const {accountEmail, calendarColor} = service._getSourceMetadata(sourceUid);
    const result = { rescheduledFromToday: new Set(), movedToToday: [] };

    const query = '(or (has-recurrences? #t) (contains? "recurrence-id" ""))';
    let storedComps;
    try {
        [storedComps] = await client.get_object_list_as_comps(query, service._cancellable);
    } catch (e) {
        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return result;
        service._logSourceFailure(sourceUid,
            `Chronome service: Error in get_object_list_as_comps: ${e}`);
        service._rescheduledCache.set(sourceUid, result);
        return result;
    }

    if (service._cancellable.is_cancelled()) return result;

    // Compare instants, not the raw wire dates: a property stored in UTC or in
    // a foreign TZID has a different calendar date from the viewer's.
    const isToday = ms => ms >= todayStartMs && ms <= todayEndMs;

    for (const comp of storedComps) {
        const icalStr = comp.get_as_string();
        const parsedRecurId = parseIcalDateTime(icalStr, 'RECURRENCE-ID');
        const parsedStart = parseIcalDateTime(icalStr, 'DTSTART');
        const uid = comp.get_uid();
        if (!uid || !parsedRecurId || !parsedStart) continue;

        const recurIdIsToday = isToday(parsedRecurId.timestampMs);
        const dtstartIsToday = isToday(parsedStart.timestampMs);

        if (recurIdIsToday && !dtstartIsToday)
            result.rescheduledFromToday.add(uid);

        if (!recurIdIsToday && dtstartIsToday) {
            const icalComp = comp.get_icalcomponent();
            if (icalComp) {
                const parsedEnd = parseIcalDateTime(icalStr, 'DTEND');
                const instanceStartMs = parsedStart.timestampMs;
                const instanceEndMs = parsedEnd?.timestampMs || (instanceStartMs + ONE_HOUR_MS);
                result.movedToToday.push(
                    wrapICalComponent(icalComp, instanceStartMs, instanceEndMs,
                        accountEmail, calendarColor, parsedRecurId.timestampMs)
                );
            }
        }
    }

    service._rescheduledCache.set(sourceUid, result);
    return result;
}

export async function queryEventsAsync(service, client, sourceUid) {
    if (service._cancellable.is_cancelled()) return [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const todayStartMs = todayStart.getTime();
    const todayEndMs = todayEnd.getTime();
    const startTimet = Math.floor(todayStartMs / 1000);
    const endTimet = Math.floor(todayEndMs / 1000);
    const todayDateStr = `${todayStart.getFullYear()}${String(todayStart.getMonth() + 1).padStart(2, '0')}${String(todayStart.getDate()).padStart(2, '0')}`;

    const {rescheduledFromToday, movedToToday} = await buildRescheduledMapAsync(
        service, client, sourceUid, todayDateStr, todayStartMs, todayEndMs);

    let rawInstances;
    try {
        rawInstances = await generateInstancesAsync(service, client, startTimet, endTimet, service._cancellable);
    } catch (e) {
        service._logSourceFailure(sourceUid,
            `Chronome service: generate_instances failed for ${sourceUid}: ${e.message}`);
        return [];
    }

    const instances = [];
    for (const inst of rawInstances) {
        // libical returns a truthy all-zero "null time" object (never
        // null) from get_recurrenceid() when there's no RECURRENCE-ID
        const rawRecurrenceId = inst.comp.get_recurrenceid();
        const recurrenceId = rawRecurrenceId && !rawRecurrenceId.is_null_time() ? rawRecurrenceId : null;
        let instanceStartMs = inst.startMs;
        let instanceEndMs = inst.endMs;
        let recurrenceIdStartMs = recurrenceId ? icalTimeToTimestamp(recurrenceId) : null;

        if (recurrenceId) {
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

        if (recurrenceId && rescheduledFromToday.has(inst.comp.get_uid())) continue;

        const {accountEmail, calendarColor} = service._getSourceMetadata(sourceUid);
        instances.push(wrapICalComponent(inst.comp, instanceStartMs, instanceEndMs,
            accountEmail, calendarColor, recurrenceIdStartMs));
    }

    instances.push(...movedToToday);

    return instances.filter(event => {
        const startMs = event._instanceStart;
        const endMs = event._instanceEnd;
        return startMs <= todayEndMs && endMs > todayStartMs;
    });
}
