// Stateless accessors for the event wrappers built by wrapICalComponent().
// Loaded only by the spawned Chronome D-Bus service process (see service.js).

import GLib from 'gi://GLib';

// ICalGLib 3.0 or 4.0. See AGENTS.md "GI Module Versions" section. service.js
// imports ECal before this module, so EDS has already loaded the matching
// ICalGLib typelib by the time the unversioned import here is resolved.
import ICalGLib from 'gi://ICalGLib';

import {resolveTimezone} from '../lib/icalParser.js';
import {isAllDayEventHeuristic} from '../lib/eventUtils.js';
import {ONE_HOUR_MS} from '../lib/constants.js';
import {findMeetingUrl} from '../lib/meetingServices.js';

export function icalTimeToTimestamp(icalTime) {
    if (!icalTime) return null;
    const timeValue = icalTime;

    const year = timeValue.get_year();
    const month = timeValue.get_month();
    const day = timeValue.get_day();
    const hour = timeValue.get_hour();
    const minute = timeValue.get_minute();
    const second = timeValue.get_second();

    if (timeValue.is_utc())
        return Date.UTC(year, month - 1, day, hour, minute, second);

    let tz;
    const tzid = timeValue.get_tzid();
    if (tzid)
        tz = resolveTimezone(tzid);
    else
        tz = GLib.TimeZone.new_local();

    const dateTime = GLib.DateTime.new(tz, year, month, day, hour, minute, second);
    if (!dateTime) return null;
    return dateTime.to_unix() * 1000;
}

export function getEventStart(event) {
    if (!event) return 0;
    if (event._instanceStart) return event._instanceStart;
    const dtStart = event.get_dtstart();
    if (dtStart) {
        const timestamp = icalTimeToTimestamp(dtStart);
        if (timestamp > 0) return timestamp;
    }
    return 0;
}

export function getEventEnd(event) {
    if (!event) return 0;
    if (event._instanceEnd) return event._instanceEnd;
    const dtEnd = event.get_dtend();
    if (dtEnd) {
        const timestamp = icalTimeToTimestamp(dtEnd);
        if (timestamp > 0) return timestamp;
    }
    return getEventStart(event) + ONE_HOUR_MS;
}

export function getPropertyString(event, methodName) {
    if (!event) return null;
    return event[methodName]() || null;
}

export function getEventTitle(event) {
    return getPropertyString(event, 'get_summary') || 'Untitled event';
}

export function isAllDayEvent(event) {
    if (!event) return false;
    const dtStart = event.get_dtstart();
    if (dtStart && dtStart.is_date()) return true;
    const startTime = getEventStart(event);
    const endTime = getEventEnd(event);
    return isAllDayEventHeuristic(startTime, endTime);
}

export function hasCurrentUserPartstat(event, targetPartstat) {
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
        let email = prop.get_value_as_string() || '';
        if (email.startsWith('mailto:'))
            email = email.substring(7);
        email = email.toLowerCase();

        if (email === accountEmail) {
            const param = prop.get_first_parameter(ICalGLib.ParameterKind.PARTSTAT_PARAMETER);
            return param ? param.get_partstat() === targetValue : false;
        }

        prop = comp.get_next_property(ICalGLib.PropertyKind.ATTENDEE_PROPERTY);
    }

    return false;
}

export function isDeclinedEvent(event) {
    if (!event) return false;
    if (hasCurrentUserPartstat(event, 'DECLINED')) return true;
    const title = getEventTitle(event).toLowerCase();
    return title.includes('declined:') || title.includes('rejected:');
}

export function isTentativeEvent(event) {
    if (!event) return false;
    if (hasCurrentUserPartstat(event, 'TENTATIVE')) return true;
    return event.get_status() === ICalGLib.PropertyStatus.TENTATIVE;
}

export function isNeedsResponseEvent(event) {
    if (!event) return false;
    return hasCurrentUserPartstat(event, 'NEEDS-ACTION');
}

export function findVideoLink(event) {
    if (!event) return null;
    const location = getPropertyString(event, 'get_location');
    if (location) {
        const url = findMeetingUrl(location);
        if (url) return url;
    }
    const description = getPropertyString(event, 'get_description');
    if (description) {
        const url = findMeetingUrl(description);
        if (url) return url;
    }
    const icalStr = event.get_as_string() || '';
    return icalStr ? findMeetingUrl(icalStr) : null;
}

export function wrapICalComponent(comp, instanceStartMs, instanceEndMs, accountEmail, calendarColor, recurrenceIdStartMs = null) {
    const passthroughMethods = ['get_summary', 'get_uid', 'get_location',
        'get_description', 'get_dtstart', 'get_dtend', 'get_status'];

    const wrapper = {
        _instanceStart: instanceStartMs,
        _instanceEnd: instanceEndMs,
        _recurrenceIdStart: recurrenceIdStartMs,
        _comp: comp,
        _accountEmail: accountEmail,
        _calendarColor: calendarColor,
        get_as_string: () => comp.as_ical_string(),
        get_recurid_as_string: () => {
            const recurid = comp.get_recurrenceid();
            if (!recurid || recurid.is_null_time())
                return null;
            return recurid.as_ical_string();
        },
    };

    for (const method of passthroughMethods)
        wrapper[method] = () => comp[method]();

    return wrapper;
}
