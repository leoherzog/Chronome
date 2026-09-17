#!/usr/bin/env -S gjs -m
// Chronome - rescheduled-instance diagnostic
//
// Reports, per calendar, which detached instances are rescheduled off of today
// and whether the service's skip map catches each of today's expanded
// occurrences. Mirrors the classification in service/eventQuery.js.
//
// Run with:  gjs -m tests/diagnose-rescheduled.js
//
// Manual diagnostic, not part of runAll.js (needs a real calendar).
// Read-only: it never writes to any calendar.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import ECal from 'gi://ECal?version=2.0';
import EDataServer from 'gi://EDataServer?version=1.2';

import {parseIcalDateTime} from '../lib/icalParser.js';

Gio._promisify(ECal.Client, 'connect', 'connect_finish');
Gio._promisify(ECal.Client.prototype, 'get_object_list_as_comps', 'get_object_list_as_comps_finish');
Gio._promisify(EDataServer.SourceRegistry, 'new', 'new_finish');

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function icalValue(ical, name) {
    if (!ical) return null;
    const m = ical.match(new RegExp(`^${name}[^:\\r\\n]*:(.*)$`, 'm'));
    return m ? m[1].trim() : null;
}

function buildRescheduledMap(comps, todayStartMs, todayEndMs) {
    const isToday = ms => ms >= todayStartMs && ms <= todayEndMs;
    const map = new Map();
    for (const comp of (comps || [])) {
        const ical = comp.get_as_string();
        const recurId = parseIcalDateTime(ical, 'RECURRENCE-ID');
        const dtstart = parseIcalDateTime(ical, 'DTSTART');
        const uid = comp.get_uid();
        if (!uid || !recurId || !dtstart) continue;

        if (isToday(recurId.timestampMs) && !isToday(dtstart.timestampMs)) {
            map.set(uid, {
                dtstart: new Date(dtstart.timestampMs).toDateString(),
                summary: icalValue(ical, 'SUMMARY') || '(untitled)',
            });
        }
    }
    return map;
}

async function run(loop) {
    let skipped = 0;

    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        const todayStartMs = todayStart.getTime();
        const todayEndMs = todayEnd.getTime();
        const p = n => String(n).padStart(2, '0');
        const todayDateStr = `${todayStart.getFullYear()}${p(todayStart.getMonth() + 1)}${p(todayStart.getDate())}`;

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
            } catch {
                continue;
            }

            const [comps] = await client.get_object_list_as_comps(query, null);
            const map = buildRescheduledMap(comps, todayStartMs, todayEndMs);

            if (map.size === 0) continue;
            const nm = source.get_display_name();
            if (seen.has(nm)) continue;
            seen.add(nm);

            print(`${C.bold}${C.cyan}Calendar: ${nm}${C.reset}`);
            print(`  rescheduledFromToday entries: ${C.bold}${map.size}${C.reset}`);
            for (const [, v] of map)
                print(`    ${C.yellow}"${v.summary}"${C.reset} rescheduled off today -> ${v.dtstart}`);

            const instances = [];
            client.generate_instances_sync(
                Math.floor(todayStartMs / 1000), Math.floor(todayEndMs / 1000), null, (comp) => {
                    instances.push({uid: comp.get_uid(), ical: comp.as_ical_string()});
                    return true;
                });

            for (const inst of instances) {
                if (!/^RECURRENCE-ID/m.test(inst.ical)) continue;
                const entry = map.get(inst.uid);
                if (!entry) continue;

                const summary = icalValue(inst.ical, 'SUMMARY') || '(untitled)';
                print(`  ${C.green}skipped today${C.reset}: ${C.bold}"${summary}"${C.reset}`);
                skipped++;
            }
            print('');
        }

        print('─'.repeat(60));
        if (skipped > 0)
            print(`${C.bold}${skipped} of today's expanded instance(s) are skipped as rescheduled.${C.reset}`);
        else
            print(`${C.dim}No instance is rescheduled off of today right now. Re-run on a day ` +
                  `when a recurring instance has been moved to a different date.${C.reset}`);
    } catch (e) {
        print(`${C.red}ERROR: ${e}\n${e.stack || ''}${C.reset}`);
    } finally {
        loop.quit();
    }
}

const loop = new GLib.MainLoop(null, false);
run(loop);
loop.run();
