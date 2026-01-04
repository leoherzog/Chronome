// Chronome - Time and duration formatting utilities
// Pure functions with no GNOME Shell dependencies

import { ONE_MINUTE_MS, ONE_HOUR_MS } from './constants.js';

/**
 * Format milliseconds as human-readable duration
 * @param {number} ms - Duration in milliseconds
 * @param {function} [_] - Gettext translation function (optional, defaults to identity)
 * @returns {string} Formatted duration string
 */
export function formatDuration(ms, _ = (s) => s) {
    if (ms < ONE_MINUTE_MS) {
        const sec = Math.max(0, Math.floor(ms / 1000));
        return sec === 1 ? _('1 second') : `${sec} ${_('seconds')}`;
    }

    const min = Math.floor(ms / ONE_MINUTE_MS);
    if (min < 60) {
        return min === 1 ? _('1 minute') : `${min} ${_('minutes')}`;
    }

    const hrs = Math.floor(min / 60);
    const extraMin = min % 60;
    let text = hrs === 1 ? _('1 hour') : `${hrs} ${_('hours')}`;
    if (extraMin > 0) {
        text += ` ${extraMin} ${_('min')}`;
    }
    return text;
}

/**
 * Format a Date object as time string
 * @param {Date} date - The date to format
 * @param {boolean} [use24Hour=false] - Use 24-hour format
 * @returns {string} Formatted time string (e.g., "1:30 PM" or "13:30")
 */
export function formatTime(date, use24Hour = false) {
    const hours = date.getHours();
    const minutes = date.getMinutes();

    if (use24Hour) {
        // 24-hour format: "13:30"
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    } else {
        // 12-hour format: "1:30 PM"
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHours = hours % 12 || 12;
        return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
    }
}

/**
 * Format a time range for display
 * @param {number} startTs - Start timestamp in milliseconds
 * @param {number} endTs - End timestamp in milliseconds
 * @param {boolean} [showEndTime=true] - Whether to show end time
 * @param {boolean} [use24Hour=false] - Use 24-hour format
 * @returns {string} Formatted time range (e.g., "9:30 AM – 10:30 AM")
 */
export function formatTimeRange(startTs, endTs, showEndTime = true, use24Hour = false) {
    try {
        if (!startTs) return '';

        const startDate = new Date(startTs);
        const endDate = new Date(endTs || startTs);

        const startTime = formatTime(startDate, use24Hour);

        if (showEndTime && endTs) {
            const endTime = formatTime(endDate, use24Hour);
            return `${startTime} – ${endTime}`;
        } else {
            return startTime;
        }
    } catch (e) {
        return '';
    }
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) {
        return text || '';
    }
    return text.slice(0, maxLength - 1) + '\u2026'; // Unicode ellipsis
}
