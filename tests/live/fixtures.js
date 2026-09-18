// iCalendar fixtures for the live EDS suite, dated relative to the day the suite runs.
// Loaded by tests/live/runLive.js. Every SUMMARY is unique, because the suite looks events up by title.

import GLib from 'gi://GLib';

export const ACCOUNT_EMAIL = 'me@example.com';

export const MEET_LINK = 'https://meet.google.com/abc-defg-hij';
export const ZOOM_LINK = 'https://us02web.zoom.us/j/81234567890?pwd=AbC-dEf_123';
export const AKA_LINK = 'https://aka.ms/JoinTeamsMeeting?tenant=contoso';
export const TEAMS_SHORT_LINK = 'https://teams.microsoft.com/meet/2123456789012?p=AbCdEfGhIjKlMnOpQr';

const LOCAL_TZID = GLib.TimeZone.new_local().get_identifier();
const FOREIGN_TZID = 'Asia/Tokyo';

const pad = n => String(n).padStart(2, '0');

function localDate(dayOffset, hhmm = '0000') {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset,
        Number(hhmm.slice(0, 2)), Number(hhmm.slice(2, 4)));
}

/**
 * Epoch milliseconds of a local wall-clock time.
 * @param {number} dayOffset - Days from today
 * @param {string} hhmm - Local time as 'HHMM'
 * @returns {number}
 */
export function localMs(dayOffset, hhmm) {
    return localDate(dayOffset, hhmm).getTime();
}

function dateValue(dayOffset) {
    const d = localDate(dayOffset);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function floating(dayOffset, hhmm) {
    return `${dateValue(dayOffset)}T${hhmm}00`;
}

function inZone(dayOffset, hhmm, tzid) {
    const dt = GLib.DateTime.new_from_unix_utc(localMs(dayOffset, hhmm) / 1000)
        .to_timezone(GLib.TimeZone.new_identifier(tzid));
    return dt.format('%Y%m%dT%H%M%S');
}

const local = (dayOffset, hhmm) => `;TZID=${LOCAL_TZID}:${floating(dayOffset, hhmm)}`;
const foreign = (dayOffset, hhmm) => `;TZID=${FOREIGN_TZID}:${inZone(dayOffset, hhmm, FOREIGN_TZID)}`;
const utc = (dayOffset, hhmm) => `:${inZone(dayOffset, hhmm, 'UTC')}Z`;
const allDay = dayOffset => `;VALUE=DATE:${dateValue(dayOffset)}`;

function vevent(uid, summary, start, end, extra = []) {
    return [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        'DTSTAMP:20260101T000000Z',
        `DTSTART${start}`,
        `DTEND${end}`,
        `SUMMARY:${summary}`,
        ...extra,
        'END:VEVENT',
    ];
}

function vcalendar(events) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chronome//Live Tests//EN', 'METHOD:PUBLISH',
        ...events.flat(), 'END:VCALENDAR', ''].join('\r\n');
}

const timed = (uid, summary, hhmmStart, hhmmEnd, extra) =>
    vevent(uid, summary, local(0, hhmmStart), local(0, hhmmEnd), extra);

const me = partstat => `ATTENDEE;CN=Me;PARTSTAT=${partstat}:mailto:${ACCOUNT_EMAIL}`;

/** @returns {string} The main test calendar as VCALENDAR text */
export function buildMainCalendar() {
    return vcalendar([
        // Link ranking
        timed('link-conference', 'Link Conference', '0900', '0930', [
            `CONFERENCE;VALUE=URI;FEATURE=VIDEO:${MEET_LINK}`,
            `LOCATION:Room 4 ${ZOOM_LINK}`,
        ]),
        timed('link-conference-tel', 'Link Conference Tel', '0905', '0935', [
            'CONFERENCE;VALUE=URI;FEATURE=PHONE:tel:+1-555-0100',
            `DESCRIPTION:Dial in or use ${ZOOM_LINK}`,
        ]),
        timed('link-google-x', 'Link Google X', '0910', '0940', [`X-GOOGLE-CONFERENCE:${MEET_LINK}`]),
        timed('link-teams-aka', 'Link Teams Aka', '0915', '0945', [
            'X-MICROSOFT-ONLINEMEETINGCONFLINK:conf:sip:me@example.com\\;gruu\\;opaque=app:conf:focus:id:ABC',
            `X-MICROSOFT-SKYPETEAMSMEETINGURL:${AKA_LINK}`,
        ]),
        timed('link-sip-only', 'Link Sip Only', '0920', '0950', [
            `X-MICROSOFT-ONLINEMEETINGCONFLINK:${MEET_LINK}`,
        ]),
        timed('link-empty-x', 'Link Empty X', '0925', '0955', [
            'X-GOOGLE-CONFERENCE:',
            `DESCRIPTION:Agenda first.\\nJoin: ${ZOOM_LINK}\\nThanks`,
        ]),
        timed('link-url-generic', 'Link Url Generic', '0930', '1000', ['URL:https://example.com/agenda']),
        // Only the whole-component scan sees this property, and libical folds the line inside the link.
        timed('link-folded', 'Link Folded', '0935', '1005', [
            `X-CHRONOME-NOTE:The meeting for this quarter is at ${TEAMS_SHORT_LINK}`,
        ]),
        timed('link-none', 'Link None', '0940', '1010', ['LOCATION:Room 4']),

        // All-day events and the day boundary
        vevent('allday-today', 'All Day Today', allDay(0), allDay(1), [`X-CHRONOME-NOTE:${MEET_LINK}`]),
        vevent('allday-yesterday', 'All Day Yesterday', allDay(-1), allDay(0)),
        vevent('allday-tomorrow', 'All Day Tomorrow', allDay(1), allDay(2)),
        vevent('allday-spanning', 'All Day Spanning', allDay(-1), allDay(2)),
        vevent('edge-late-tonight', 'Edge Late Tonight', local(0, '2330'), local(0, '2350')),
        vevent('edge-early-today', 'Edge Early Today', local(0, '0010'), local(0, '0020')),
        vevent('edge-late-last-night', 'Edge Late Last Night', local(-1, '2330'), local(-1, '2350')),
        vevent('edge-early-tomorrow', 'Edge Early Tomorrow', local(1, '0010'), local(1, '0040')),
        vevent('edge-overnight', 'Edge Overnight', local(-1, '2300'), local(0, '0100')),

        // Time forms
        vevent('time-floating', 'Time Floating', `:${floating(0, '1000')}`, `:${floating(0, '1030')}`),
        vevent('time-utc', 'Time Utc', utc(0, '1400'), utc(0, '1430')),
        vevent('time-foreign', 'Time Foreign', foreign(0, '1500'), foreign(0, '1530')),

        // RSVP
        timed('rsvp-email-param', 'Rsvp Email Param', '1100', '1130', [
            `ATTENDEE;CN=Me;EMAIL=${ACCOUNT_EMAIL};PARTSTAT=DECLINED:urn:uuid:5f3c1b2a`,
        ]),
        timed('rsvp-mailto-case', 'Rsvp Mailto Case', '1105', '1135', [
            'ATTENDEE;CN=Me;PARTSTAT=TENTATIVE:MAILTO:Me@Example.COM',
        ]),
        timed('rsvp-needs-action', 'Rsvp Needs Action', '1110', '1140', [me('NEEDS-ACTION')]),
        timed('rsvp-last-attendee', 'Rsvp Last Attendee', '1115', '1145', [
            'ORGANIZER;CN=Boss:mailto:boss@example.com',
            'ATTENDEE;CN=Ann;PARTSTAT=DECLINED:mailto:ann@example.com',
            'ATTENDEE;CN=Bob;PARTSTAT=TENTATIVE:mailto:bob@example.com',
            me('ACCEPTED'),
        ]),
        timed('rsvp-others-declined', 'Rsvp Others Declined', '1120', '1150', [
            'ATTENDEE;CN=Ann;PARTSTAT=DECLINED:mailto:ann@example.com',
        ]),
        timed('rsvp-status-tentative', 'Rsvp Status Tentative', '1125', '1155', ['STATUS:TENTATIVE']),
        timed('rsvp-status-cancelled', 'Rsvp Status Cancelled', '1130', '1200', ['STATUS:CANCELLED']),
        timed('rsvp-title-prefix', 'Declined: Rsvp Title Prefix', '1135', '1205'),

        // Recurrence
        vevent('recur-plain', 'Recur Plain', local(-10, '0800'), local(-10, '0815'), ['RRULE:FREQ=DAILY']),

        vevent('recur-moved-off', 'Recur Moved Off', local(-5, '1600'), local(-5, '1630'), ['RRULE:FREQ=DAILY']),
        vevent('recur-moved-off', 'Recur Moved Off', local(1, '1615'), local(1, '1645'),
            [`RECURRENCE-ID${local(0, '1600')}`]),

        vevent('recur-moved-onto', 'Recur Moved Onto', local(-5, '1800'), local(-5, '1830'), ['RRULE:FREQ=DAILY']),
        vevent('recur-moved-onto', 'Recur Moved Onto (moved)', local(0, '1700'), local(0, '1730'),
            [`RECURRENCE-ID${local(1, '1800')}`]),

        vevent('recur-edited', 'Recur Edited', local(-5, '0700'), local(-5, '0730'), ['RRULE:FREQ=DAILY']),
        vevent('recur-edited', 'Recur Edited (edited)', local(0, '0715'), local(0, '0745'),
            [`RECURRENCE-ID${local(0, '0700')}`, `LOCATION:${MEET_LINK}`]),

        vevent('recur-foreign', 'Recur Foreign', foreign(-5, '1200'), foreign(-5, '1230'), ['RRULE:FREQ=DAILY']),
        vevent('recur-foreign', 'Recur Foreign (moved)', foreign(0, '1300'), foreign(0, '1330'),
            [`RECURRENCE-ID${foreign(1, '1200')}`]),

        vevent('recur-allday', 'Recur All Day', allDay(-7), allDay(-6), ['RRULE:FREQ=DAILY']),
    ]);
}

/** @returns {string} The second test calendar as VCALENDAR text */
export function buildSecondCalendar() {
    return vcalendar([timed('second-calendar', 'Second Calendar Event', '1215', '1245')]);
}

/** @returns {string} One VEVENT, added while the service is running */
export function buildLateEvent() {
    return timed('added-later', 'Added Later', '1230', '1300', [`LOCATION:${MEET_LINK}`]).join('\r\n');
}
