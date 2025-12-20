// Tests for lib/eventUtils.js
import { describe, it, expect } from './runner.js';
import { createMockEvent } from './mocks.js';
import {
    hasRecurrenceId,
    getEventDedupeKey,
    deduplicateEvents,
    isAllDayEventHeuristic,
    getNextMeeting,
    sortEventsByStartTime,
} from '../lib/eventUtils.js';

// Helper to get event start time from mock
const getEventStart = (e) => e._instanceStart;
const getEventEnd = (e) => e._instanceEnd;

describe('hasRecurrenceId', function() {
    it('should return true for events with recurrence ID', function() {
        const event = createMockEvent({ recurrenceId: Date.now() });
        expect(hasRecurrenceId(event)).toBeTruthy();
    });

    it('should return false for events without recurrence ID', function() {
        const event = createMockEvent({});
        expect(hasRecurrenceId(event)).toBeFalsy();
    });

    it('should return false for null event', function() {
        expect(hasRecurrenceId(null)).toBeFalsy();
    });

    it('should return false for undefined event', function() {
        expect(hasRecurrenceId(undefined)).toBeFalsy();
    });

    it('should return false for event with null recurrence ID', function() {
        const event = createMockEvent({});
        // Override to return null explicitly
        event.get_recurid_as_string = () => null;
        expect(hasRecurrenceId(event)).toBeFalsy();
    });

    it('should return false for event with empty recurrence ID', function() {
        const event = createMockEvent({});
        event.get_recurid_as_string = () => '';
        expect(hasRecurrenceId(event)).toBeFalsy();
    });
});

describe('getEventDedupeKey', function() {
    it('should generate consistent keys for same event', function() {
        const event = createMockEvent({ uid: 'test-123', startTime: 1000000 });
        const key1 = getEventDedupeKey(event, getEventStart);
        const key2 = getEventDedupeKey(event, getEventStart);
        expect(key1).toBe(key2);
    });

    it('should include UID in key', function() {
        const event = createMockEvent({ uid: 'unique-id-xyz', startTime: 1000000 });
        const key = getEventDedupeKey(event, getEventStart);
        expect(key).toContain('unique-id-xyz');
    });

    it('should include start time in key', function() {
        const event = createMockEvent({ uid: 'test', startTime: 1234567890 });
        const key = getEventDedupeKey(event, getEventStart);
        expect(key).toContain('1234567890');
    });

    it('should generate different keys for different UIDs', function() {
        const event1 = createMockEvent({ uid: 'event-1', startTime: 1000 });
        const event2 = createMockEvent({ uid: 'event-2', startTime: 1000 });
        const key1 = getEventDedupeKey(event1, getEventStart);
        const key2 = getEventDedupeKey(event2, getEventStart);
        expect(key1).not.toBe(key2);
    });

    it('should generate different keys for same UID but different times', function() {
        const event1 = createMockEvent({ uid: 'same-uid', startTime: 1000 });
        const event2 = createMockEvent({ uid: 'same-uid', startTime: 2000 });
        const key1 = getEventDedupeKey(event1, getEventStart);
        const key2 = getEventDedupeKey(event2, getEventStart);
        expect(key1).not.toBe(key2);
    });

    it('should use recurrence ID start when present', function() {
        const event = createMockEvent({ uid: 'recurring', startTime: 2000, recurrenceId: 1000 });
        // Mock sets _recurrenceIdStart to startTime when recurrenceId is present
        const key = getEventDedupeKey(event, getEventStart);
        expect(key).toContain('recurring');
    });
});

describe('deduplicateEvents', function() {
    it('should return empty array for empty input', function() {
        expect(deduplicateEvents([], getEventStart)).toEqual([]);
        expect(deduplicateEvents(null, getEventStart)).toEqual([]);
        expect(deduplicateEvents(undefined, getEventStart)).toEqual([]);
    });

    it('should remove duplicate events with same UID and start', function() {
        const event1 = createMockEvent({ uid: 'same', startTime: 1000 });
        const event2 = createMockEvent({ uid: 'same', startTime: 1000 });
        const result = deduplicateEvents([event1, event2], getEventStart);
        expect(result).toHaveLength(1);
    });

    it('should prefer events with recurrence ID over master', function() {
        const master = createMockEvent({ uid: 'recurring', startTime: 1000 });
        const exception = createMockEvent({ uid: 'recurring', startTime: 1000, recurrenceId: 1000 });
        const result = deduplicateEvents([master, exception], getEventStart);
        expect(result).toHaveLength(1);
        expect(hasRecurrenceId(result[0])).toBeTruthy();
    });

    it('should prefer exception even when added first', function() {
        const master = createMockEvent({ uid: 'recurring', startTime: 1000 });
        const exception = createMockEvent({ uid: 'recurring', startTime: 1000, recurrenceId: 1000 });
        const result = deduplicateEvents([exception, master], getEventStart);
        expect(result).toHaveLength(1);
        expect(hasRecurrenceId(result[0])).toBeTruthy();
    });

    it('should keep events with different UIDs', function() {
        const event1 = createMockEvent({ uid: 'event-1', startTime: 1000 });
        const event2 = createMockEvent({ uid: 'event-2', startTime: 1000 });
        const result = deduplicateEvents([event1, event2], getEventStart);
        expect(result).toHaveLength(2);
    });

    it('should keep events with same UID but different start times', function() {
        const event1 = createMockEvent({ uid: 'recurring', startTime: 1000 });
        const event2 = createMockEvent({ uid: 'recurring', startTime: 2000 });
        const result = deduplicateEvents([event1, event2], getEventStart);
        expect(result).toHaveLength(2);
    });

    it('should skip events without valid start times', function() {
        const validEvent = createMockEvent({ uid: 'valid', startTime: 1000 });
        const invalidEvent = createMockEvent({ uid: 'invalid', startTime: 0 });
        const result = deduplicateEvents([validEvent, invalidEvent], getEventStart);
        expect(result).toHaveLength(1);
    });
});

describe('isAllDayEventHeuristic', function() {
    it('should detect all-day events', function() {
        const midnight = new Date(2025, 0, 1, 0, 0, 0).getTime();
        const nextMidnight = midnight + 24 * 60 * 60 * 1000;
        expect(isAllDayEventHeuristic(midnight, nextMidnight)).toBeTruthy();
    });

    it('should detect multi-day all-day events', function() {
        const midnight = new Date(2025, 0, 1, 0, 0, 0).getTime();
        const threeDaysLater = midnight + 3 * 24 * 60 * 60 * 1000;
        expect(isAllDayEventHeuristic(midnight, threeDaysLater)).toBeTruthy();
    });

    it('should not flag regular events as all-day', function() {
        const start = new Date(2025, 0, 1, 9, 0, 0).getTime();
        const end = start + 60 * 60 * 1000; // 1 hour
        expect(isAllDayEventHeuristic(start, end)).toBeFalsy();
    });

    it('should not flag events starting at midnight with odd duration', function() {
        const midnight = new Date(2025, 0, 1, 0, 0, 0).getTime();
        const oddEnd = midnight + 23 * 60 * 60 * 1000; // 23 hours
        expect(isAllDayEventHeuristic(midnight, oddEnd)).toBeFalsy();
    });

    it('should handle null/undefined values', function() {
        expect(isAllDayEventHeuristic(null, 1000)).toBeFalsy();
        expect(isAllDayEventHeuristic(1000, null)).toBeFalsy();
        expect(isAllDayEventHeuristic(null, null)).toBeFalsy();
    });
});

describe('getNextMeeting', function() {
    const now = new Date(2025, 0, 1, 10, 0, 0).getTime();

    const createHelpers = (overrides = {}) => ({
        getEventStart: (e) => e._instanceStart,
        getEventEnd: (e) => e._instanceEnd,
        isAllDayEvent: () => false,
        isDeclinedEvent: () => false,
        isTentativeEvent: () => false,
        eventTypes: ['regular'],
        showCurrentMeeting: true,
        now,
        ...overrides,
    });

    it('should return null for empty events', function() {
        expect(getNextMeeting([], createHelpers())).toBeNull();
        expect(getNextMeeting(null, createHelpers())).toBeNull();
        expect(getNextMeeting(undefined, createHelpers())).toBeNull();
    });

    it('should return upcoming event', function() {
        const futureEvent = createMockEvent({
            uid: 'future',
            startTime: now + 3600000, // 1 hour from now
            endTime: now + 7200000,   // 2 hours from now
        });
        const result = getNextMeeting([futureEvent], createHelpers());
        expect(result).not.toBeNull();
        expect(result.get_uid()).toBe('future');
    });

    it('should return earliest upcoming event', function() {
        const later = createMockEvent({ uid: 'later', startTime: now + 7200000 });
        const sooner = createMockEvent({ uid: 'sooner', startTime: now + 3600000 });
        const result = getNextMeeting([later, sooner], createHelpers());
        expect(result.get_uid()).toBe('sooner');
    });

    it('should return current event when enabled', function() {
        const currentEvent = createMockEvent({
            uid: 'current',
            startTime: now - 1800000, // Started 30 mins ago
            endTime: now + 1800000,   // Ends in 30 mins (> 5 min remaining)
        });
        const result = getNextMeeting([currentEvent], createHelpers());
        expect(result).not.toBeNull();
        expect(result.get_uid()).toBe('current');
    });

    it('should skip current event ending within 5 minutes', function() {
        const endingSoon = createMockEvent({
            uid: 'ending-soon',
            startTime: now - 1800000,   // Started 30 mins ago
            endTime: now + 4 * 60000,   // Ends in 4 minutes
        });
        const nextEvent = createMockEvent({
            uid: 'next',
            startTime: now + 10 * 60000,  // Starts in 10 minutes
            endTime: now + 70 * 60000,
        });
        const result = getNextMeeting([endingSoon, nextEvent], createHelpers());
        expect(result.get_uid()).toBe('next');
    });

    it('should not show current event when disabled', function() {
        const currentEvent = createMockEvent({
            uid: 'current',
            startTime: now - 1800000,
            endTime: now + 1800000,
        });
        const result = getNextMeeting([currentEvent], createHelpers({ showCurrentMeeting: false }));
        expect(result).toBeNull();
    });

    it('should skip all-day events', function() {
        const allDay = createMockEvent({ uid: 'all-day', startTime: now + 3600000 });
        const options = createHelpers({
            isAllDayEvent: () => true,
        });
        expect(getNextMeeting([allDay], options)).toBeNull();
    });

    it('should skip declined events unless enabled', function() {
        const declined = createMockEvent({ uid: 'declined', startTime: now + 3600000 });
        const options = createHelpers({
            isDeclinedEvent: (e) => e.get_uid() === 'declined',
            eventTypes: ['regular'], // declined not included
        });
        expect(getNextMeeting([declined], options)).toBeNull();
    });

    it('should show declined events when enabled', function() {
        const declined = createMockEvent({ uid: 'declined', startTime: now + 3600000 });
        const options = createHelpers({
            isDeclinedEvent: (e) => e.get_uid() === 'declined',
            eventTypes: ['regular', 'declined'],
        });
        const result = getNextMeeting([declined], options);
        expect(result).not.toBeNull();
        expect(result.get_uid()).toBe('declined');
    });

    it('should skip tentative events unless enabled', function() {
        const tentative = createMockEvent({ uid: 'tentative', startTime: now + 3600000 });
        const options = createHelpers({
            isTentativeEvent: (e) => e.get_uid() === 'tentative',
            eventTypes: ['regular'], // tentative not included
        });
        expect(getNextMeeting([tentative], options)).toBeNull();
    });

    it('should prefer current meeting over upcoming', function() {
        const current = createMockEvent({
            uid: 'current',
            startTime: now - 1800000,
            endTime: now + 1800000,
        });
        const upcoming = createMockEvent({
            uid: 'upcoming',
            startTime: now + 300000,
            endTime: now + 3900000,
        });
        const result = getNextMeeting([current, upcoming], createHelpers());
        expect(result.get_uid()).toBe('current');
    });

    it('should return null when all events are in past', function() {
        const pastEvent = createMockEvent({
            uid: 'past',
            startTime: now - 7200000,
            endTime: now - 3600000,
        });
        const result = getNextMeeting([pastEvent], createHelpers());
        expect(result).toBeNull();
    });
});

describe('sortEventsByStartTime', function() {
    it('should sort events by start time', function() {
        const event1 = createMockEvent({ uid: 'first', startTime: 1000 });
        const event2 = createMockEvent({ uid: 'second', startTime: 3000 });
        const event3 = createMockEvent({ uid: 'third', startTime: 2000 });

        const sorted = sortEventsByStartTime([event2, event3, event1], getEventStart);
        expect(sorted[0].get_uid()).toBe('first');
        expect(sorted[1].get_uid()).toBe('third');
        expect(sorted[2].get_uid()).toBe('second');
    });

    it('should handle empty array', function() {
        expect(sortEventsByStartTime([], getEventStart)).toEqual([]);
    });

    it('should handle null/undefined', function() {
        expect(sortEventsByStartTime(null, getEventStart)).toEqual([]);
        expect(sortEventsByStartTime(undefined, getEventStart)).toEqual([]);
    });

    it('should handle single element', function() {
        const event = createMockEvent({ uid: 'only', startTime: 1000 });
        const sorted = sortEventsByStartTime([event], getEventStart);
        expect(sorted).toHaveLength(1);
        expect(sorted[0].get_uid()).toBe('only');
    });
});
