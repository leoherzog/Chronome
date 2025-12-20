// Chronome - iCal parsing utilities
// Functions for parsing iCalendar date/time properties

import GLib from 'gi://GLib';

/**
 * Extract raw property from iCal string (pure regex, no GLib)
 * @param {string} icalStr - Raw iCal string
 * @param {string} propName - Property name (DTSTART, DTEND, RECURRENCE-ID)
 * @returns {{params: string, value: string, isUtc: boolean}|null}
 */
export function extractIcalProperty(icalStr, propName) {
    if (!icalStr || !propName) return null;

    // Match lines like:
    // DTSTART;TZID=America/New_York:20250101T093000
    // DTSTART:20250101T093000Z
    // DTSTART;VALUE=DATE:20250101
    const re = new RegExp(`^${propName}([^:]*)?:(\\d{8}(?:T\\d{6})?)(Z)?`, 'mi');
    const match = icalStr.match(re);
    if (!match) return null;

    return {
        params: match[1] || '',
        value: match[2],
        isUtc: !!match[3],
    };
}

/**
 * Parse iCal date/time property from raw string
 * @param {string} icalStr - Raw iCal string
 * @param {string} propName - Property name (DTSTART, DTEND, RECURRENCE-ID)
 * @returns {{timestampMs: number, isDateOnly: boolean}|null}
 */
export function parseIcalDateTime(icalStr, propName) {
    const extracted = extractIcalProperty(icalStr, propName);
    if (!extracted) return null;

    const { params, value, isUtc } = extracted;

    const tzidMatch = params.match(/TZID=([^;:]+)/i);
    const tzid = tzidMatch ? tzidMatch[1] : null;

    const isDateOnly = value.length === 8;

    const year = Number.parseInt(value.slice(0, 4), 10);
    const month = Number.parseInt(value.slice(4, 6), 10);
    const day = Number.parseInt(value.slice(6, 8), 10);

    let hour = 0;
    let minute = 0;
    let second = 0;
    if (!isDateOnly) {
        hour = Number.parseInt(value.slice(9, 11), 10);
        minute = Number.parseInt(value.slice(11, 13), 10);
        second = Number.parseInt(value.slice(13, 15), 10);
    }

    let tz = null;
    if (isUtc) {
        tz = GLib.TimeZone.new_utc();
    } else if (tzid) {
        tz = GLib.TimeZone.new(tzid);
    } else {
        tz = GLib.TimeZone.new_local();
    }

    const dateTime = GLib.DateTime.new(tz, year, month, day, hour, minute, second);
    if (!dateTime) return null;

    return {
        timestampMs: dateTime.to_unix() * 1000,
        isDateOnly,
    };
}

/**
 * Parse iCal date string to extract just the date portion (YYYYMMDD)
 * Useful for building rescheduled instance maps
 * @param {string} icalStr - Raw iCal string
 * @param {string} propName - Property name
 * @returns {string|null} Date string in YYYYMMDD format, or null
 */
export function extractIcalDateString(icalStr, propName) {
    const extracted = extractIcalProperty(icalStr, propName);
    if (!extracted) return null;

    // Return just the date portion (first 8 chars)
    return extracted.value.slice(0, 8);
}
