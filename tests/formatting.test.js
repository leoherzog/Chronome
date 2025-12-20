// Tests for lib/formatting.js
import { describe, it, expect } from './runner.js';
import { formatDuration, formatTime, formatTimeRange, truncateText } from '../lib/formatting.js';

describe('formatDuration', function() {
    // Seconds
    it('should format 0 seconds correctly', function() {
        expect(formatDuration(0)).toBe('0 seconds');
    });

    it('should format 1 second correctly', function() {
        expect(formatDuration(1000)).toBe('1 second');
    });

    it('should format multiple seconds correctly', function() {
        expect(formatDuration(5000)).toBe('5 seconds');
        expect(formatDuration(30000)).toBe('30 seconds');
        expect(formatDuration(59000)).toBe('59 seconds');
    });

    it('should handle sub-second values', function() {
        expect(formatDuration(500)).toBe('0 seconds');
        expect(formatDuration(999)).toBe('0 seconds');
    });

    // Minutes
    it('should format 1 minute correctly', function() {
        expect(formatDuration(60000)).toBe('1 minute');
    });

    it('should format multiple minutes correctly', function() {
        expect(formatDuration(120000)).toBe('2 minutes');
        expect(formatDuration(300000)).toBe('5 minutes');
        expect(formatDuration(1800000)).toBe('30 minutes');
        expect(formatDuration(3540000)).toBe('59 minutes');
    });

    // Hours
    it('should format 1 hour correctly', function() {
        expect(formatDuration(3600000)).toBe('1 hour');
    });

    it('should format multiple hours correctly', function() {
        expect(formatDuration(7200000)).toBe('2 hours');
        expect(formatDuration(10800000)).toBe('3 hours');
    });

    // Hours and minutes
    it('should format hours with extra minutes', function() {
        expect(formatDuration(3660000)).toBe('1 hour 1 min');
        expect(formatDuration(3720000)).toBe('1 hour 2 min');
        expect(formatDuration(5400000)).toBe('1 hour 30 min');
        expect(formatDuration(9000000)).toBe('2 hours 30 min');
        expect(formatDuration(12600000)).toBe('3 hours 30 min');
    });

    it('should not show 0 extra minutes for exact hours', function() {
        expect(formatDuration(3600000)).toBe('1 hour');
        expect(formatDuration(7200000)).toBe('2 hours');
    });

    // Negative values
    it('should handle negative values gracefully', function() {
        expect(formatDuration(-1000)).toBe('0 seconds');
        expect(formatDuration(-60000)).toBe('0 seconds');
    });

    // Translation function
    it('should use custom translation function', function() {
        const mockTranslate = (s) => s.toUpperCase();
        expect(formatDuration(1000, mockTranslate)).toBe('1 SECOND');
        expect(formatDuration(60000, mockTranslate)).toBe('1 MINUTE');
        expect(formatDuration(3600000, mockTranslate)).toBe('1 HOUR');
    });
});

describe('formatTime', function() {
    // 12-hour format
    it('should format morning times in 12-hour format', function() {
        expect(formatTime(new Date(2025, 0, 1, 9, 30), false)).toBe('9:30 AM');
        expect(formatTime(new Date(2025, 0, 1, 6, 0), false)).toBe('6:00 AM');
        expect(formatTime(new Date(2025, 0, 1, 11, 45), false)).toBe('11:45 AM');
    });

    it('should format afternoon times in 12-hour format', function() {
        expect(formatTime(new Date(2025, 0, 1, 14, 45), false)).toBe('2:45 PM');
        expect(formatTime(new Date(2025, 0, 1, 18, 0), false)).toBe('6:00 PM');
        expect(formatTime(new Date(2025, 0, 1, 23, 59), false)).toBe('11:59 PM');
    });

    it('should format midnight as 12:00 AM', function() {
        expect(formatTime(new Date(2025, 0, 1, 0, 0), false)).toBe('12:00 AM');
    });

    it('should format noon as 12:00 PM', function() {
        expect(formatTime(new Date(2025, 0, 1, 12, 0), false)).toBe('12:00 PM');
        expect(formatTime(new Date(2025, 0, 1, 12, 30), false)).toBe('12:30 PM');
    });

    // 24-hour format
    it('should format times in 24-hour format', function() {
        expect(formatTime(new Date(2025, 0, 1, 9, 30), true)).toBe('09:30');
        expect(formatTime(new Date(2025, 0, 1, 14, 45), true)).toBe('14:45');
        expect(formatTime(new Date(2025, 0, 1, 0, 0), true)).toBe('00:00');
        expect(formatTime(new Date(2025, 0, 1, 23, 59), true)).toBe('23:59');
    });

    it('should pad single-digit hours in 24-hour format', function() {
        expect(formatTime(new Date(2025, 0, 1, 6, 5), true)).toBe('06:05');
        expect(formatTime(new Date(2025, 0, 1, 0, 0), true)).toBe('00:00');
    });

    it('should pad single-digit minutes', function() {
        expect(formatTime(new Date(2025, 0, 1, 9, 5), false)).toBe('9:05 AM');
        expect(formatTime(new Date(2025, 0, 1, 9, 5), true)).toBe('09:05');
    });

    // Default parameter
    it('should default to 12-hour format', function() {
        expect(formatTime(new Date(2025, 0, 1, 14, 30))).toBe('2:30 PM');
    });
});

describe('formatTimeRange', function() {
    const morning9 = new Date(2025, 0, 1, 9, 0).getTime();
    const morning10 = new Date(2025, 0, 1, 10, 0).getTime();
    const afternoon2 = new Date(2025, 0, 1, 14, 0).getTime();
    const afternoon3 = new Date(2025, 0, 1, 15, 30).getTime();

    it('should format time range with end time in 12h', function() {
        expect(formatTimeRange(morning9, morning10, true, false)).toBe('9:00 AM – 10:00 AM');
        expect(formatTimeRange(afternoon2, afternoon3, true, false)).toBe('2:00 PM – 3:30 PM');
    });

    it('should format time range with end time in 24h', function() {
        expect(formatTimeRange(morning9, morning10, true, true)).toBe('09:00 – 10:00');
        expect(formatTimeRange(afternoon2, afternoon3, true, true)).toBe('14:00 – 15:30');
    });

    it('should format time range without end time', function() {
        expect(formatTimeRange(morning9, morning10, false, false)).toBe('9:00 AM');
        expect(formatTimeRange(morning9, morning10, false, true)).toBe('09:00');
    });

    it('should handle missing start time', function() {
        expect(formatTimeRange(null, morning10, true, false)).toBe('');
        expect(formatTimeRange(undefined, morning10, true, false)).toBe('');
        expect(formatTimeRange(0, morning10, true, false)).toBe('');
    });

    it('should handle missing end time', function() {
        expect(formatTimeRange(morning9, null, true, false)).toBe('9:00 AM');
        expect(formatTimeRange(morning9, undefined, true, false)).toBe('9:00 AM');
    });

    // Default parameters
    it('should default to showing end time in 12h format', function() {
        expect(formatTimeRange(morning9, morning10)).toBe('9:00 AM – 10:00 AM');
    });
});

describe('truncateText', function() {
    it('should not truncate text shorter than maxLength', function() {
        expect(truncateText('Hello', 10)).toBe('Hello');
        expect(truncateText('Hi', 10)).toBe('Hi');
    });

    it('should not truncate text equal to maxLength', function() {
        expect(truncateText('Hello', 5)).toBe('Hello');
    });

    it('should truncate text longer than maxLength', function() {
        expect(truncateText('Hello World', 8)).toBe('Hello W\u2026');
        expect(truncateText('This is a very long title', 10)).toBe('This is a\u2026');
    });

    it('should handle empty or null input', function() {
        expect(truncateText('', 10)).toBe('');
        expect(truncateText(null, 10)).toBe('');
        expect(truncateText(undefined, 10)).toBe('');
    });

    it('should use unicode ellipsis', function() {
        const result = truncateText('Hello World', 8);
        expect(result).toContain('\u2026');
        expect(result).not.toContain('...');
    });
});
