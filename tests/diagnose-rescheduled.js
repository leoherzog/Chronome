#!/usr/bin/env -S gjs -m
// Chronome - rescheduled-instance diagnostic
//
// Reproduces, against the live Evolution Data Server, the bug where a
// recurring-event instance that was rescheduled onto another day still showed
// in the panel on its original day.
//
// Root cause: service.js promisifies `e_cal_client_get_object_list_as_comps`
// and destructured the awaited result as `[, storedComps]`, expecting
// `[ok, comps]` like the *_sync variant returns. But GJS's Gio._promisify
// strips the leading `gboolean` success value, so the async call resolves to
// `[comps]` -- index 1 is `undefined`. `storedComps` was therefore always
// undefined, the `rescheduledFromToday` map was always empty, and no
// rescheduled instance was ever skipped.
//
// This script shows, per calendar:
//   * the actual shape of the awaited get_object_list_as_comps() result
//   * the rescheduledFromToday map built the OLD (buggy) way vs the FIXED way
//   * for every instance rescheduled off of today, whether each map skips it
//
// Run with:  gjs -m tests/diagnose-rescheduled.js
//
// Manual diagnostic, NOT part of runAll.js (needs a real calendar).
// Read-only: it never writes to any calendar.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';

import {extractIcalDateString} from '../lib/icalParser.js';

Gio._promisify(ECal.Client, 'connect', 'connect_finish');
Gio._promisify(ECal.Client.prototype, 'get_object_list_as_comps', 'get_object_list_as_comps_finish');
Gio._promisify(EDataServer.SourceRegistry, 'new', 'new_finish');

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

// The fix in service.js: normalize `[ok, X]` / `[X]` / `X` down to `X`.
function unwrapAsyncResult(result) {
    if (!Array.isArray(result))
        return result;
    return typeof result[0] === 'boolean' ? result[1] : result[0];
}

function dateStrOf(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function icalValue(ical, name) {
    if (!ical) return null;
    const m = ical.match(new RegExp(`^${name}[^:\\r\\n]*:(.*)$`, 'm'));
    return m ? m[1].trim() : null;
}

// Build service.js's `rescheduledFromToday` map from a comp list.
function buildRescheduledMap(comps, todayDateStr) {
    const map = new Map();
    for (const comp of (comps || [])) {
        const ical = comp.get_as_string();
        const recurIdDate = extractIcalDateString(ical, 'RECURRENCE-ID');
        if (!recurIdDate) continue;
        const dtstartDate = extractIcalDateString(ical, 'DTSTART');
        const uid = comp.get_uid();
        if (recurIdDate === todayDateStr && dtstartDate && dtstartDate !== todayDateStr)
            map.set(`${uid}:${recurIdDate}`, {
                dtstartDate, summary: icalValue(ical, 'SUMMARY') || '(untitled)',
            });
    }
    return map;
}

async function run(loop) {
    let leaksUnderOldCode = 0;

    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const todayDateStr = dateStrOf(todayStart.getTime());
        const startTimet = Math.floor(todayStart.getTime() / 1000);
        const endTimet = Math.floor(todayEnd.getTime() / 1000);

        print(`${C.bold}=== Chronome rescheduled-instance diagnostic ===${C.reset}`);
        print(`Today: ${todayStart.toDateString()} (${todayDateStr})\n`);

        const registry = await EDataServer.SourceRegistry.new(null);
        const sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR)
            .filter(s => s.get_enabled());
        const query = '(or (has-recurrences? #t) (contains? "recurrence-id" ""))';
        const seen = new Set();

        for (const source of sources) {
            let client;
            try {
                client = await ECal.Client.connect(
                    source, ECal.ClientSourceType.EVENTS, 10, null);
            } catch (e) {
                continue;
            }

            // --- Phase 1: get_object_list_as_comps (async, promisified) ----
            const rawResult = await client.get_object_list_as_comps(query, null);

            // OLD service.js:  [, storedComps] = await ...   (reads index 1)
            const oldComps = Array.isArray(rawResult) ? rawResult[1] : undefined;
            // FIXED service.js: unwrapAsyncResult(await ...)
            const fixedComps = unwrapAsyncResult(rawResult);

            const oldMap = buildRescheduledMap(oldComps, todayDateStr);
            const fixedMap = buildRescheduledMap(fixedComps, todayDateStr);

            // Only report calendars that actually have a today-reschedule.
            if (fixedMap.size === 0) continue;
            const nm = source.get_display_name();
            if (seen.has(nm)) continue;
            seen.add(nm);

            const shape = Array.isArray(rawResult)
                ? `Array(len=${rawResult.length}, [0]=${typeof rawResult[0]})`
                : typeof rawResult;
            print(`${C.bold}${C.cyan}Calendar: ${nm}${C.reset}`);
            print(`  await get_object_list_as_comps() resolved as: ${C.bold}${shape}${C.reset}`);
            print(`  rescheduledFromToday map size  ` +
                  `${C.red}OLD code: ${oldMap.size}${C.reset}  ` +
                  `${C.green}FIXED code: ${fixedMap.size}${C.reset}`);
            for (const [, v] of fixedMap)
                print(`    ${C.yellow}"${v.summary}"${C.reset} rescheduled off today -> ${v.dtstartDate}`);

            // --- Phase 2: expand recurrences for today --------------------
            const instances = [];
            client.generate_instances_sync(startTimet, endTimet, null, (comp) => {
                instances.push({uid: comp.get_uid(), ical: comp.as_ical_string()});
                return true;
            });

            for (const inst of instances) {
                const hasRecurId = /^RECURRENCE-ID/m.test(inst.ical);
                if (!hasRecurId) continue;
                const key = `${inst.uid}:${todayDateStr}`;
                if (!fixedMap.has(key)) continue;   // not a rescheduled-away instance

                const summary = icalValue(inst.ical, 'SUMMARY') || '(untitled)';
                const oldSkips = oldMap.has(key);
                const fixedSkips = fixedMap.has(key);
                print(`  instance ${C.bold}"${summary}"${C.reset} (was rescheduled away):`);
                print(`    OLD code skips it?   ` +
                      (oldSkips ? `${C.green}yes${C.reset}`
                                : `${C.red}NO -> leaks into today (the bug)${C.reset}`));
                print(`    FIXED code skips it? ` +
                      (fixedSkips ? `${C.green}yes${C.reset}` : `${C.red}NO${C.reset}`));
                if (!oldSkips) leaksUnderOldCode++;
            }
            print('');
        }

        print('─'.repeat(60));
        if (leaksUnderOldCode > 0) {
            print(`${C.red}${C.bold}Reproduced: ${leaksUnderOldCode} instance(s) leak under the ` +
                  `old code.${C.reset}`);
            print(`${C.green}${C.bold}The fix (unwrapAsyncResult) skips all of them.${C.reset}`);
        } else {
            print(`${C.dim}No instance is rescheduled off of today right now, so there is ` +
                  `nothing to leak. Re-run on a day when a recurring instance has been ` +
                  `moved to a different date.${C.reset}`);
        }
    } catch (e) {
        print(`${C.red}ERROR: ${e}\n${e.stack || ''}${C.reset}`);
    } finally {
        loop.quit();
    }
}

const loop = new GLib.MainLoop(null, false);
run(loop);
loop.run();

// Note: gjs may print "Segmentation fault" after this point. That is a known
// libical/GJS crash during interpreter teardown -- it happens after all output
// above is complete and does not affect the diagnostic result.
