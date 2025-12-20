// Tests for lib/icalParser.js
import { describe, it, expect } from './runner.js';
import { extractIcalProperty, parseIcalDateTime, extractIcalDateString } from '../lib/icalParser.js';

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
