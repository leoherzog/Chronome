// Tests for lib/icalParser.js
import { describe, it, expect } from './runner.js';
import { extractIcalProperty, parseIcalDateTime, extractIcalDateString, resolveTimezone } from '../lib/icalParser.js';

describe('extractIcalProperty', function() {
    it('should extract DTSTART with UTC time', function() {
        const ical = 'DTSTART:20250120T093000Z';
        const result = extractIcalProperty(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.value).toBe('20250120T093000');
        expect(result.isUtc).toBeTruthy();
        expect(result.params).toBe('');
    });

    it('should extract DTSTART with TZID', function() {
        const ical = 'DTSTART;TZID=America/New_York:20250120T093000';
        const result = extractIcalProperty(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.value).toBe('20250120T093000');
        expect(result.isUtc).toBeFalsy();
        expect(result.params).toContain('TZID=America/New_York');
    });

    it('should extract date-only DTSTART', function() {
        const ical = 'DTSTART;VALUE=DATE:20250120';
        const result = extractIcalProperty(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.value).toBe('20250120');
        expect(result.isUtc).toBeFalsy();
    });

    it('should extract DTEND', function() {
        const ical = 'DTEND:20250120T103000Z';
        const result = extractIcalProperty(ical, 'DTEND');
        expect(result).not.toBeNull();
        expect(result.value).toBe('20250120T103000');
    });

    it('should extract RECURRENCE-ID', function() {
        const ical = 'RECURRENCE-ID:20250115T093000Z';
        const result = extractIcalProperty(ical, 'RECURRENCE-ID');
        expect(result).not.toBeNull();
        expect(result.value).toBe('20250115T093000');
    });

    it('should find property in multiline iCal', function() {
        const ical = `BEGIN:VEVENT
UID:test-123
DTSTART;TZID=America/Los_Angeles:20250120T090000
DTEND;TZID=America/Los_Angeles:20250120T100000
SUMMARY:Test Meeting
END:VEVENT`;
        const result = extractIcalProperty(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.value).toBe('20250120T090000');
        expect(result.params).toContain('America/Los_Angeles');
    });

    it('should return null for missing property', function() {
        const ical = 'DTSTART:20250120T093000Z';
        expect(extractIcalProperty(ical, 'RECURRENCE-ID')).toBeNull();
    });

    it('should return null for empty input', function() {
        expect(extractIcalProperty('', 'DTSTART')).toBeNull();
        expect(extractIcalProperty(null, 'DTSTART')).toBeNull();
        expect(extractIcalProperty('DTSTART:20250120', null)).toBeNull();
    });
});

describe('resolveTimezone', function() {
    it('should resolve a plain IANA tzid directly', function() {
        const tz = resolveTimezone('Europe/London');
        expect(tz.get_identifier()).toBe('Europe/London');
    });

    it('should resolve another plain IANA tzid directly', function() {
        const tz = resolveTimezone('America/New_York');
        expect(tz.get_identifier()).toBe('America/New_York');
    });

    it('should strip a globally-unique TZID domain prefix (GNOME Calendar local calendars)', function() {
        const tz = resolveTimezone('/freeassociation.sourceforge.net/Europe/London');
        expect(tz.get_identifier()).toBe('Europe/London');
    });

    it('should strip a globally-unique TZID prefix for a multi-segment Olson name', function() {
        const tz = resolveTimezone('/freeassociation.sourceforge.net/America/Indiana/Indianapolis');
        expect(tz.get_identifier()).toBe('America/Indiana/Indianapolis');
    });

    it('should fall back to UTC for a totally bogus tzid (same as before the fix)', function() {
        const tz = resolveTimezone('Not/A/Real/Zone');
        expect(tz.get_identifier()).toBe('UTC');
    });

    it('should not mistake a plain slash-prefixed non-domain string for the GNOME Calendar case', function() {
        // First segment has no dot, so this isn't the domain-prefix pattern --
        // should fall through to the same UTC fallback as any bogus tzid.
        const tz = resolveTimezone('/Europe/London');
        expect(tz.get_identifier()).toBe('UTC');
    });
});

describe('parseIcalDateTime', function() {
    it('should parse UTC datetime correctly', function() {
        const ical = 'DTSTART:20250120T120000Z';
        const result = parseIcalDateTime(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.isDateOnly).toBeFalsy();
        // 2025-01-20 12:00:00 UTC in milliseconds
        expect(result.timestampMs).toBe(Date.UTC(2025, 0, 20, 12, 0, 0));
    });

    it('should parse date-only value correctly', function() {
        const ical = 'DTSTART;VALUE=DATE:20250120';
        const result = parseIcalDateTime(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.isDateOnly).toBeTruthy();
    });

    it('should parse timezone-aware datetime', function() {
        const ical = 'DTSTART;TZID=America/New_York:20250120T090000';
        const result = parseIcalDateTime(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.isDateOnly).toBeFalsy();
        // Should have a valid timestamp (exact value depends on system timezone handling)
        expect(result.timestampMs).toBeGreaterThan(0);
    });

    it('should parse multiline iCal', function() {
        const ical = `BEGIN:VEVENT
UID:test-123
DTSTART:20250615T140000Z
DTEND:20250615T150000Z
SUMMARY:Summer Meeting
END:VEVENT`;
        const startResult = parseIcalDateTime(ical, 'DTSTART');
        const endResult = parseIcalDateTime(ical, 'DTEND');

        expect(startResult).not.toBeNull();
        expect(endResult).not.toBeNull();
        expect(startResult.timestampMs).toBe(Date.UTC(2025, 5, 15, 14, 0, 0));
        expect(endResult.timestampMs).toBe(Date.UTC(2025, 5, 15, 15, 0, 0));
    });

    it('should return null for invalid input', function() {
        expect(parseIcalDateTime('', 'DTSTART')).toBeNull();
        expect(parseIcalDateTime(null, 'DTSTART')).toBeNull();
        expect(parseIcalDateTime('DTSTART:invalid', 'DTSTART')).toBeNull();
    });

    it('should handle European timezones', function() {
        const ical = 'DTSTART;TZID=Europe/London:20250120T090000';
        const result = parseIcalDateTime(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.timestampMs).toBeGreaterThan(0);
    });

    it('should resolve a GNOME Calendar globally-unique TZID to the correct DST-aware offset', function() {
        // Regression test for the ~60min offset bug: this TZID form (observed
        // from a real GNOME Calendar local calendar) used to silently resolve
        // to UTC instead of Europe/London's BST (+1h) summer offset.
        const buggyTzidIcal = 'DTSTART;TZID=/freeassociation.sourceforge.net/Europe/London:20250715T111500';
        const plainTzidIcal = 'DTSTART;TZID=Europe/London:20250715T111500';

        const buggyResult = parseIcalDateTime(buggyTzidIcal, 'DTSTART');
        const plainResult = parseIcalDateTime(plainTzidIcal, 'DTSTART');

        expect(buggyResult).not.toBeNull();
        expect(buggyResult.timestampMs).toBe(plainResult.timestampMs);
    });

    it('should parse Feb 29 on a leap year (2024) correctly', function() {
        const ical = 'DTSTART:20240229T120000Z';
        const result = parseIcalDateTime(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.isDateOnly).toBeFalsy();
        expect(result.timestampMs).toBe(Date.UTC(2024, 1, 29, 12, 0, 0));
    });

    it('should parse Feb 29 date-only on a leap year (2024) correctly', function() {
        const ical = 'DTSTART;VALUE=DATE:20240229';
        const result = parseIcalDateTime(ical, 'DTSTART');
        expect(result).not.toBeNull();
        expect(result.isDateOnly).toBeTruthy();
    });
});

describe('extractIcalDateString', function() {
    it('should extract date portion from datetime', function() {
        const ical = 'DTSTART:20250120T093000Z';
        expect(extractIcalDateString(ical, 'DTSTART')).toBe('20250120');
    });

    it('should extract date from date-only property', function() {
        const ical = 'DTSTART;VALUE=DATE:20250120';
        expect(extractIcalDateString(ical, 'DTSTART')).toBe('20250120');
    });

    it('should extract date from RECURRENCE-ID', function() {
        const ical = 'RECURRENCE-ID:20250115T140000Z';
        expect(extractIcalDateString(ical, 'RECURRENCE-ID')).toBe('20250115');
    });

    it('should return null for missing property', function() {
        expect(extractIcalDateString('DTSTART:20250120T093000Z', 'RECURRENCE-ID')).toBeNull();
    });
});
