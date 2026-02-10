// Chronome - Event utility functions
// Pure functions for event filtering, deduplication, and selection

import { ONE_HOUR_MS, FIVE_MINUTES_MS } from './constants.js';

/**
 * Check if event has RECURRENCE-ID (is an exception to a recurring event)
 * @param {object} event - Event object with get_recurid_as_string method
 * @returns {boolean}
 */
export function hasRecurrenceId(event) {
    if (!event) return false;
    const recurid = event.get_recurid_as_string?.();
    return recurid !== null && recurid !== '';
}

/**
 * Get a unique deduplication key for an event (UID + start time)
 * @param {object} event - Event object
 * @param {function} getEventStart - Function to get event start time
 * @returns {string}
 */
export function getEventDedupeKey(event, getEventStart) {
    const uid = event.get_uid?.() || '';
    // Prefer recurrence-id time for detached instances to avoid duplicates
    const startTs = event._recurrenceIdStart || getEventStart(event);
    return `${uid}:${startTs}`;
}

/**
 * Deduplicate events - prefers exceptions over master occurrences
 * When EDS returns both a master recurring event and an exception for the
 * same occurrence, prefer the exception (has RECURRENCE-ID) as it contains
 * instance-specific modifications.
 * @param {object[]} events - Array of event objects
 * @param {function} getEventStart - Function to get event start time
 * @returns {object[]}
 */
export function deduplicateEvents(events, getEventStart) {
    if (!events?.length) return [];

    const eventMap = new Map();

    for (const event of events) {
        // Skip events without valid start times
        if (!getEventStart(event)) continue;

        const key = getEventDedupeKey(event, getEventStart);
        const existing = eventMap.get(key);

        if (!existing) {
            eventMap.set(key, event);
        } else {
            // Prefer events with RECURRENCE-ID (exceptions) over master
            if (hasRecurrenceId(event) && !hasRecurrenceId(existing)) {
                eventMap.set(key, event);
            }
        }
    }

    return Array.from(eventMap.values());
}

/**
 * Check if event is all-day using heuristic (fallback when ICalGLib unavailable)
 * All-day events typically start at midnight and have duration in multiples of 24 hours
 * @param {number} startTime - Start timestamp in ms
 * @param {number} endTime - End timestamp in ms
 * @returns {boolean}
 */
export function isAllDayEventHeuristic(startTime, endTime) {
    if (!startTime || !endTime) return false;

    const startDate = new Date(startTime);

    // Check if start time is at midnight (local time)
    const isMidnight = startDate.getHours() === 0 &&
                       startDate.getMinutes() === 0 &&
                       startDate.getSeconds() === 0;

    // Check if duration is a multiple of 24 hours
    const durationHours = (endTime - startTime) / ONE_HOUR_MS;
    const isDivisibleBy24 = Math.abs(durationHours % 24) < 0.001;

    return isMidnight && isDivisibleBy24 && durationHours >= 24;
}

/**
 * Select next meeting from list of events
 * @param {object[]} events - Array of event objects
 * @param {object} options - Configuration options
 * @param {function} options.getEventStart - Get event start time
 * @param {function} options.getEventEnd - Get event end time
 * @param {function} options.isAllDayEvent - Check if all-day
 * @param {function} options.isDeclinedEvent - Check if declined
 * @param {function} options.isTentativeEvent - Check if tentative
 * @param {string[]} [options.eventTypes=['regular']] - Enabled event types
 * @param {boolean} [options.showCurrentMeeting=true] - Show ongoing meetings
 * @param {number} [options.now=Date.now()] - Current timestamp (for testing)
 * @returns {object|null}
 */
export function getNextMeeting(events, options) {
    const {
        getEventStart,
        getEventEnd,
        isAllDayEvent,
        isDeclinedEvent,
        isTentativeEvent,
        eventTypes = ['regular'],
        showCurrentMeeting = true,
        now = Date.now(),
    } = options;

    if (!events || !Array.isArray(events) || events.length === 0) {
        return null;
    }

    // Filter out events that shouldn't appear in the panel countdown
    const relevantEvents = events.filter(evt => {
        // Skip all-day events - they shouldn't show in countdown
        if (isAllDayEvent(evt)) return false;

        // Always skip declined events in the panel countdown
        // (they can still appear in the menu based on settings)
        if (isDeclinedEvent(evt)) return false;

        // Check tentative events - they have their own toggle
        if (isTentativeEvent(evt)) return eventTypes.includes('tentative');

        // Regular events (not declined or tentative)
        return eventTypes.includes('regular');
    });

    // First check for currently ongoing meetings if enabled
    // Use a 5-minute rolling window: once a meeting has less than 5 minutes left,
    // we switch to showing the next upcoming meeting instead
    if (showCurrentMeeting) {
        const fiveMinutesFromNow = now + FIVE_MINUTES_MS;
        const currentEvents = relevantEvents.filter(evt => {
            const start = getEventStart(evt);
            const end = getEventEnd(evt);
            return start <= now && end > fiveMinutesFromNow;
        });

        if (currentEvents.length > 0) {
            // Sort by end time (to show the one ending soonest)
            currentEvents.sort((a, b) => getEventEnd(a) - getEventEnd(b));
            return currentEvents[0];
        }
    }

    // Find upcoming events
    const upcomingEvents = relevantEvents.filter(evt => getEventStart(evt) > now);

    if (upcomingEvents.length === 0) return null;

    // Sort by start time (earliest first)
    upcomingEvents.sort((a, b) => getEventStart(a) - getEventStart(b));

    return upcomingEvents[0];
}

/**
 * Sort events by start time
 * @param {object[]} events - Array of event objects
 * @param {function} getEventStart - Function to get event start time
 * @returns {object[]} Sorted array (mutates original)
 */
export function sortEventsByStartTime(events, getEventStart) {
    if (!events?.length) return events || [];
    return events.sort((a, b) => getEventStart(a) - getEventStart(b));
}
