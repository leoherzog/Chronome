// Mock factories for testing Chronome extension
// These mocks simulate GNOME Shell and Evolution Data Server objects

/**
 * Create a mock event object for testing
 * @param {object} options - Event configuration
 * @returns {object} Mock event object
 */
export function createMockEvent(options = {}) {
    const {
        uid = 'test-uid-' + Math.random().toString(36).slice(2, 8),
        startTime = Date.now() + 3600000,
        endTime = null,
        recurrenceId = null,
        accountEmail = 'user@example.com',
        calendarColor = '#1E90FF',
    } = options;

    const actualEndTime = endTime || startTime + 3600000;

    return {
        _instanceStart: startTime,
        _instanceEnd: actualEndTime,
        _recurrenceIdStart: recurrenceId || null,
        _accountEmail: accountEmail,
        _calendarColor: calendarColor,

        get_uid: () => uid,
        get_recurid_as_string: () => recurrenceId ? `RECURRENCE-ID:${recurrenceId}` : null,
    };
}
