// Resolves the calendar account's own RSVP from plain attendee and STATUS data.
// Loaded by service/eventProperties.js (service process).

// The Microsoft 365 backend writes the user's response to STATUS; the ATTENDEE lines carry only what
// the server reports for each invitee. STATUS:CANCELLED also marks a meeting the organizer cancelled.
const M365_STATUS_TO_PARTSTAT = new Map([
    ['CANCELLED', 'DECLINED'],
    ['TENTATIVE', 'TENTATIVE'],
    ['NEEDS-ACTION', 'NEEDS-ACTION'],
    ['CONFIRMED', 'ACCEPTED'],
]);

/**
 * The user's participation status as an upper-case PARTSTAT value.
 * @param {object} data
 * @param {{email: string|null, partstat: string|null}[]} data.attendees - Addresses lower-case, PARTSTAT upper-case
 * @param {string|null} data.accountEmail - The account's address, lower-case
 * @param {string|null} data.backendName - EDS backend name of the calendar source
 * @param {string|null} data.status - Upper-case STATUS value of the component
 * @returns {string|null} Null when the user is not an attendee or the line has no PARTSTAT
 */
export function getUserPartstat({attendees, accountEmail, backendName, status}) {
    if (backendName === 'microsoft365' && M365_STATUS_TO_PARTSTAT.has(status))
        return M365_STATUS_TO_PARTSTAT.get(status);

    if (!accountEmail) return null;
    const own = attendees.find(attendee => attendee.email === accountEmail);
    return own ? own.partstat : null;
}
