// Ranks the places an event can carry its video conference link and returns the best one.
// Loaded by service/eventProperties.js (service process).

import {findMeetingUrl} from './meetingServices.js';

/**
 * First http(s) URL at the start of a property value. Rejects tel:, sip: and empty values.
 * @param {string} value - Raw property value
 * @returns {string|null}
 */
function httpUrl(value) {
    const match = value.trim().match(/^https?:\/\/\S+/i);
    return match ? match[0] : null;
}

// Highest rank first. CONFERENCE and the vendor properties exist only to carry a meeting link, so any http(s)
// value is accepted; the Teams one can be an aka.ms redirect that no host pattern knows. URL is a generic
// property and has to match a known service. X-MICROSOFT-ONLINEMEETINGCONFLINK is a SIP address and is not listed.
const RANKED_PROPERTIES = [
    ['CONFERENCE', httpUrl],
    ['URL', findMeetingUrl],
    ['X-GOOGLE-CONFERENCE', httpUrl],
    ['X-MICROSOFT-SKYPETEAMSMEETINGURL', httpUrl],
];

// libical folds serialized lines at 75 octets, which can land inside a URL.
const ICAL_LINE_FOLD = /\r?\n[ \t]/g;
// Covers the whole property only once the text is unfolded.
const SIP_PROPERTY_LINE = /^X-MICROSOFT-ONLINEMEETINGCONFLINK[^\r\n]*/gim;

/** Upper-case names of the properties `findConferenceLink()` reads from `properties`. */
export const LINK_PROPERTY_NAMES = new Set(RANKED_PROPERTIES.map(([name]) => name));

/**
 * Find an event's video conference link: ranked properties, then LOCATION, DESCRIPTION, and last the whole component.
 * @param {object} data
 * @param {{name: string, value: string}[]} data.properties - Component properties in order, names upper-case
 * @param {string|null} data.location
 * @param {string|null} data.description
 * @param {boolean} data.isAllDay - All-day events skip the whole-component scan
 * @param {function(): string} data.fullText - Serializes the whole component, folded or not; called only as the last resort
 * @returns {string|null}
 */
export function findConferenceLink({properties, location, description, isAllDay, fullText}) {
    for (const [name, extract] of RANKED_PROPERTIES) {
        for (const prop of properties) {
            if (prop.name !== name || !prop.value) continue;
            const url = extract(prop.value);
            if (url) return url;
        }
    }

    const url = findMeetingUrl(location) || findMeetingUrl(description);
    if (url || isAllDay) return url;
    return findMeetingUrl(fullText().replace(ICAL_LINE_FOLD, '').replace(SIP_PROPERTY_LINE, ''));
}
