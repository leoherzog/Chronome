// Mock factories for testing Chronome extension
// These mocks simulate GNOME Shell and Evolution Data Server objects

/**
 * Format a timestamp as iCal date string
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @param {boolean} utc - Whether to format as UTC
 * @returns {string} iCal formatted date string
 */
function formatIcalDate(timestamp, utc = false) {
    const d = new Date(timestamp);
    let year, month, day, hour, min, sec;

    if (utc) {
        year = d.getUTCFullYear();
        month = String(d.getUTCMonth() + 1).padStart(2, '0');
        day = String(d.getUTCDate()).padStart(2, '0');
        hour = String(d.getUTCHours()).padStart(2, '0');
        min = String(d.getUTCMinutes()).padStart(2, '0');
        sec = String(d.getUTCSeconds()).padStart(2, '0');
    } else {
        year = d.getFullYear();
        month = String(d.getMonth() + 1).padStart(2, '0');
        day = String(d.getDate()).padStart(2, '0');
        hour = String(d.getHours()).padStart(2, '0');
        min = String(d.getMinutes()).padStart(2, '0');
        sec = String(d.getSeconds()).padStart(2, '0');
    }

    return `${year}${month}${day}T${hour}${min}${sec}${utc ? 'Z' : ''}`;
}

/**
 * Generate an iCal VEVENT string
 * @param {object} options - Event options
 * @returns {string} iCal formatted event string
 */
function generateIcalString(options) {
    const {
        uid = 'test-uid',
        summary = 'Test Event',
        startTime,
        endTime,
        location = '',
        description = '',
        recurrenceId = null,
        tzid = null,
        isAllDay = false,
    } = options;

    const lines = [
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `SUMMARY:${summary}`,
    ];

    if (isAllDay) {
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        const formatDate = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        lines.push(`DTSTART;VALUE=DATE:${formatDate(startDate)}`);
        lines.push(`DTEND;VALUE=DATE:${formatDate(endDate)}`);
    } else if (tzid) {
        lines.push(`DTSTART;TZID=${tzid}:${formatIcalDate(startTime)}`);
        lines.push(`DTEND;TZID=${tzid}:${formatIcalDate(endTime)}`);
    } else {
        lines.push(`DTSTART:${formatIcalDate(startTime, true)}`);
        lines.push(`DTEND:${formatIcalDate(endTime, true)}`);
    }

    if (location) lines.push(`LOCATION:${location}`);
    if (description) lines.push(`DESCRIPTION:${description}`);
    if (recurrenceId) lines.push(`RECURRENCE-ID:${formatIcalDate(recurrenceId)}`);

    lines.push('END:VEVENT');
    return lines.join('\r\n');
}

/**
 * Create a mock ICalTime value object
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @param {boolean} isDate - Whether this is a date-only value
 * @param {boolean} isUtc - Whether this is UTC time
 * @returns {object} Mock ICalTime object
 */
function createMockICalTime(timestamp, isDate = false, isUtc = false) {
    const d = new Date(timestamp);
    return {
        is_date: () => isDate,
        is_utc: () => isUtc,
        get_year: () => isUtc ? d.getUTCFullYear() : d.getFullYear(),
        get_month: () => (isUtc ? d.getUTCMonth() : d.getMonth()) + 1,
        get_day: () => isUtc ? d.getUTCDate() : d.getDate(),
        get_hour: () => isDate ? 0 : (isUtc ? d.getUTCHours() : d.getHours()),
        get_minute: () => isDate ? 0 : (isUtc ? d.getUTCMinutes() : d.getMinutes()),
        get_second: () => isDate ? 0 : (isUtc ? d.getUTCSeconds() : d.getSeconds()),
    };
}

/**
 * Create a mock event object for testing
 * @param {object} options - Event configuration
 * @returns {object} Mock event object
 */
export function createMockEvent(options = {}) {
    const {
        uid = 'test-uid-' + Math.random().toString(36).slice(2, 8),
        summary = 'Test Meeting',
        startTime = Date.now() + 3600000, // 1 hour from now
        endTime = null, // defaults to startTime + 1 hour
        location = '',
        description = '',
        isAllDay = false,
        isUtc = false,
        recurrenceId = null,
        accountEmail = 'user@example.com',
        calendarColor = '#1E90FF',
        attendees = [],
        status = null,
    } = options;

    const actualEndTime = endTime || startTime + 3600000;

    // Create mock ICalGLib component for attendee iteration
    let attendeeIndex = 0;
    const attendeeProps = attendees.map(a => ({
        get_value_as_string: () => `mailto:${a.email}`,
        get_first_parameter: (_kind) => {
            if (a.partstat) {
                return { get_partstat: () => a.partstat };
            }
            return null;
        },
    }));

    const mockComp = {
        get_first_property: (_kind) => {
            attendeeIndex = 0;
            return attendeeProps[0] || null;
        },
        get_next_property: (_kind) => {
            attendeeIndex++;
            return attendeeProps[attendeeIndex] || null;
        },
    };

    return {
        // Internal properties set by extension during processing
        _instanceStart: startTime,
        _instanceEnd: actualEndTime,
        _recurrenceIdStart: recurrenceId ? startTime : null,
        _accountEmail: accountEmail,
        _calendarColor: calendarColor,
        _comp: mockComp,

        // ECal.Component methods
        get_uid: () => uid,
        get_summary: () => ({ get_value: () => summary }),
        get_location: () => location,
        get_description: () => ({ get_value: () => description }),
        get_dtstart: () => createMockICalTime(startTime, isAllDay, isUtc),
        get_dtend: () => createMockICalTime(actualEndTime, isAllDay, isUtc),
        get_status: () => status,
        get_as_string: () => generateIcalString({
            uid,
            summary,
            startTime,
            endTime: actualEndTime,
            location,
            description,
            recurrenceId,
            isAllDay,
        }),
        get_recurid_as_string: () => {
            if (recurrenceId) {
                return `RECURRENCE-ID:${formatIcalDate(recurrenceId)}`;
            }
            return null;
        },
    };
}

/**
 * Create a mock GSettings object
 * @param {object} overrides - Setting overrides
 * @returns {object} Mock settings object
 */
export function createMockSettings(overrides = {}) {
    const defaults = {
        'refresh-interval': 60,
        'real-time-countdown': true,
        'time-format': '12h',
        'event-title-length': 30,
        'event-types': ['all-day', 'regular', 'tentative'],
        'show-past-events': false,
        'show-event-end-time': true,
        'show-current-meeting': true,
        'enabled-calendars': [],
        'use-calendar-colors': false,
        'status-bar-icon-type': 'calendar',
    };

    const settings = { ...defaults, ...overrides };

    return {
        get_int: (key) => settings[key],
        get_boolean: (key) => settings[key],
        get_string: (key) => settings[key],
        get_strv: (key) => settings[key],
        set_int: (key, value) => { settings[key] = value; },
        set_boolean: (key, value) => { settings[key] = value; },
        set_string: (key, value) => { settings[key] = value; },
        set_strv: (key, value) => { settings[key] = value; },
    };
}

/**
 * Create a mock EDataServer source object
 * @param {object} options - Source configuration
 * @returns {object} Mock source object
 */
export function createMockSource(options = {}) {
    const {
        uid = 'source-' + Math.random().toString(36).slice(2, 8),
        displayName = 'Test Calendar',
        color = '#1E90FF',
        enabled = true,
        writable = true,
        backendName = 'caldav',
    } = options;

    return {
        get_uid: () => uid,
        get_display_name: () => displayName,
        get_enabled: () => enabled,
        get_extension: (name) => {
            if (name === 'Calendar') {
                return { get_color: () => color };
            }
            if (name === 'WebDAV Backend') {
                return { get_resource_path: () => `/calendars/${uid}` };
            }
            return null;
        },
        has_extension: (name) => {
            return ['Calendar', 'WebDAV Backend'].includes(name);
        },
        get_backend_name: () => backendName,
    };
}
