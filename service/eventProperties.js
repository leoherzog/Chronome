// Stateless accessors for the event wrappers built by wrapICalComponent().
// Loaded only by the spawned Chronome D-Bus service process (see service.js).

import GLib from 'gi://GLib';

// ECal loads the ICalGLib version EDS was built against, so the unversioned import below reuses it.
import ECal from 'gi://ECal?version=2.0';
import ICalGLib from 'gi://ICalGLib';

import {resolveTimezone} from '../lib/icalParser.js';
import {isAllDayEventHeuristic} from '../lib/eventUtils.js';
import {ONE_HOUR_MS} from '../lib/constants.js';
import {findConferenceLink, LINK_PROPERTY_NAMES} from '../lib/conferenceLink.js';
import {getUserPartstat} from '../lib/rsvp.js';

export function icalTimeToTimestamp(icalTime) {
    if (!icalTime) return null;

    const year = icalTime.get_year();
    const month = icalTime.get_month();
    const day = icalTime.get_day();
    const hour = icalTime.get_hour();
    const minute = icalTime.get_minute();
    const second = icalTime.get_second();

    if (icalTime.is_utc())
        return Date.UTC(year, month - 1, day, hour, minute, second);

    let tz;
    const tzid = icalTime.get_tzid();
    if (tzid)
        tz = resolveTimezone(tzid);
    else
        tz = GLib.TimeZone.new_local();

    const dateTime = GLib.DateTime.new(tz, year, month, day, hour, minute, second);
    if (!dateTime) return null;
    return dateTime.to_unix() * 1000;
}

export function getEventStart(event) {
    if (event._instanceStart) return event._instanceStart;
    const dtStart = event.get_dtstart();
    if (dtStart) {
        const timestamp = icalTimeToTimestamp(dtStart);
        if (timestamp > 0) return timestamp;
    }
    return 0;
}

export function getEventEnd(event) {
    if (event._instanceEnd) return event._instanceEnd;
    const dtEnd = event.get_dtend();
    if (dtEnd) {
        const timestamp = icalTimeToTimestamp(dtEnd);
        if (timestamp > 0) return timestamp;
    }
    return getEventStart(event) + ONE_HOUR_MS;
}

export function getPropertyString(event, methodName) {
    return event[methodName]() || null;
}

export function getEventTitle(event) {
    return getPropertyString(event, 'get_summary') || 'Untitled event';
}

export function isAllDayEvent(event) {
    const dtStart = event.get_dtstart();
    if (dtStart && dtStart.is_date()) return true;
    const startTime = getEventStart(event);
    const endTime = getEventEnd(event);
    return isAllDayEventHeuristic(startTime, endTime);
}

// targetPartstat is an upper-case PARTSTAT value such as 'DECLINED' or 'NEEDS-ACTION'.
export function hasCurrentUserPartstat(event, targetPartstat) {
    return getUserPartstat({
        attendees: event._attendees,
        accountEmail: event._accountEmail,
        backendName: event._backendName,
        status: event._status,
    }) === targetPartstat;
}

export function isDeclinedEvent(event) {
    if (hasCurrentUserPartstat(event, 'DECLINED')) return true;
    // Title-prefix fallback for sources where no account e-mail resolves, so PARTSTAT cannot be matched.
    return /^(declined|rejected):/.test(getEventTitle(event).toLowerCase());
}

export function isTentativeEvent(event) {
    if (hasCurrentUserPartstat(event, 'TENTATIVE')) return true;
    return event._status === 'TENTATIVE';
}

export function isNeedsResponseEvent(event) {
    return hasCurrentUserPartstat(event, 'NEEDS-ACTION');
}

export function findVideoLink(event) {
    if (event._videoLink === undefined) {
        event._videoLink = findConferenceLink({
            properties: event._linkProperties,
            location: getPropertyString(event, 'get_location'),
            description: getPropertyString(event, 'get_description'),
            isAllDay: isAllDayEvent(event),
            fullText: () => event.get_as_string() || '',
        });
    }
    return event._videoLink;
}

// sourceMetadata is the object service._getSourceMetadata() returns.
export function wrapICalComponent(comp, instanceStartMs, instanceEndMs, sourceMetadata, recurrenceIdStartMs = null) {
    const passthroughMethods = ['get_summary', 'get_uid', 'get_location', 'get_description', 'get_dtstart', 'get_dtend'];
    const attendees = [];
    const linkProperties = [];
    let status = null;

    // A component has one shared property iterator, and every component getter (get_summary() and the like)
    // restarts it. Touch only `prop` inside this loop; its parameters have an iterator of their own.
    const anyProperty = ICalGLib.PropertyKind.ANY_PROPERTY;
    for (let prop = comp.get_first_property(anyProperty); prop; prop = comp.get_next_property(anyProperty)) {
        // get_property_name() returns the X- name for X properties, and CONFERENCE has no typed accessor in ICalGLib 3.0.
        const name = (prop.get_property_name() || '').toUpperCase();
        if (name === 'ATTENDEE') {
            attendees.push({
                // Exchange and iCloud carry the address in an EMAIL parameter, which this reads before the value.
                email: ECal.util_get_property_email(prop)?.toLowerCase() || null,
                partstat: prop.get_parameter_as_string('PARTSTAT')?.toUpperCase() || null,
            });
        } else if (name === 'STATUS') {
            status ??= prop.get_value_as_string()?.toUpperCase() || null;
        } else if (LINK_PROPERTY_NAMES.has(name)) {
            linkProperties.push({name, value: prop.get_value_as_string() || ''});
        }
    }

    const wrapper = {
        _instanceStart: instanceStartMs,
        _instanceEnd: instanceEndMs,
        _recurrenceIdStart: recurrenceIdStartMs,
        _accountEmail: sourceMetadata.accountEmail,
        _calendarColor: sourceMetadata.calendarColor,
        _backendName: sourceMetadata.backendName,
        _attendees: attendees,
        _status: status,
        _linkProperties: linkProperties,
        _videoLink: undefined,
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
