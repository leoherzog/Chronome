// Chronome - Time and duration formatting utilities
// Pure functions with no GNOME Shell dependencies
// Loaded by ui/indicator.js only (shell process)

import {ONE_SECOND_MS, ONE_MINUTE_MS, ONE_HOUR_MS} from './constants.js';

/**
 * Format milliseconds as human-readable duration
 * @param {number} ms - Duration in milliseconds
 * @param {function} [_] - Gettext translation function (optional, defaults to identity)
 * @returns {string} Formatted duration string
 */
export function formatDuration(ms, _ = (s) => s) {
    if (ms < ONE_MINUTE_MS) {
        const sec = Math.max(0, Math.floor(ms / ONE_SECOND_MS));
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
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    } else {
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
    if (!startTs) return '';

    const startTime = formatTime(new Date(startTs), use24Hour);

    if (showEndTime && endTs) {
        return `${startTime} – ${formatTime(new Date(endTs), use24Hour)}`;
    }
    return startTime;
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength) {
    // Cut by code point so an astral character is never split into a lone surrogate.
    const chars = [...(text || '')];
    if (chars.length <= maxLength) {
        return text || '';
    }
    return chars.slice(0, maxLength - 1).join('') + '\u2026';
}
