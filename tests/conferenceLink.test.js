// Tests for conferenceLink.js
import { describe, it, expect } from './runner.js';
import { findConferenceLink, LINK_PROPERTY_NAMES } from '../lib/conferenceLink.js';

const MEET = 'https://meet.google.com/abc-defg-hij';
const ZOOM = 'https://zoom.us/j/123456789';
const TEAMS = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc';
const WEBEX = 'https://company.webex.com/meet/jdoe';
const JITSI = 'https://meet.jit.si/standup';

function find(options = {}) {
    let fullTextCalls = 0;
    const result = findConferenceLink({
        properties: [],
        location: null,
        description: null,
        isAllDay: false,
        ...options,
        fullText: () => {
            fullTextCalls++;
            return options.fullText || '';
        },
    });
    return {result, fullTextCalls};
}

describe('findConferenceLink ranking', function() {
    it('should rank CONFERENCE above every other source', function() {
        const {result, fullTextCalls} = find({
            properties: [
                {name: 'X-MICROSOFT-SKYPETEAMSMEETINGURL', value: TEAMS},
                {name: 'X-GOOGLE-CONFERENCE', value: 'https://meet.google.com/xyz-xyzx-xyz'},
                {name: 'URL', value: ZOOM},
                {name: 'CONFERENCE', value: MEET},
            ],
            location: WEBEX,
            description: JITSI,
        });
        expect(result).toBe(MEET);
        expect(fullTextCalls).toBe(0);
    });

    it('should rank URL above the vendor properties', function() {
        const {result} = find({
            properties: [
                {name: 'X-MICROSOFT-SKYPETEAMSMEETINGURL', value: TEAMS},
                {name: 'X-GOOGLE-CONFERENCE', value: MEET},
                {name: 'URL', value: ZOOM},
            ],
        });
        expect(result).toBe(ZOOM);
    });

    it('should rank X-GOOGLE-CONFERENCE above the Teams property', function() {
        const {result} = find({
            properties: [
                {name: 'X-MICROSOFT-SKYPETEAMSMEETINGURL', value: TEAMS},
                {name: 'X-GOOGLE-CONFERENCE', value: MEET},
            ],
        });
        expect(result).toBe(MEET);
    });

    it('should rank the Teams property above LOCATION', function() {
        const {result} = find({
            properties: [{name: 'X-MICROSOFT-SKYPETEAMSMEETINGURL', value: TEAMS}],
            location: WEBEX,
        });
        expect(result).toBe(TEAMS);
    });

    it('should rank LOCATION above DESCRIPTION', function() {
        const {result, fullTextCalls} = find({location: `Room 4 / ${WEBEX}`, description: `Join: ${JITSI}`});
        expect(result).toBe(WEBEX);
        expect(fullTextCalls).toBe(0);
    });

    it('should rank DESCRIPTION above the full-component scan', function() {
        const {result, fullTextCalls} = find({description: `Join: ${JITSI}`, fullText: `COMMENT:${ZOOM}`});
        expect(result).toBe(JITSI);
        expect(fullTextCalls).toBe(0);
    });

    it('should fall back to the full-component scan', function() {
        const {result, fullTextCalls} = find({location: 'Room 4', fullText: `BEGIN:VEVENT\r\nCOMMENT:${ZOOM}\r\nEND:VEVENT`});
        expect(result).toBe(ZOOM);
        expect(fullTextCalls).toBe(1);
    });

    it('should return null when nothing matches', function() {
        expect(find({location: 'Room 4', description: 'Agenda'}).result).toBeNull();
    });

    it('should prefer a Meet CONFERENCE over an unrelated link in LOCATION', function() {
        const {result} = find({
            properties: [{name: 'CONFERENCE', value: MEET}],
            location: 'https://maps.example.com/place/office https://youtu.be/dQw4w9WgXcQ',
        });
        expect(result).toBe(MEET);
    });
});

describe('findConferenceLink property values', function() {
    it('should treat an empty X- value as absent', function() {
        const {result} = find({
            properties: [
                {name: 'X-GOOGLE-CONFERENCE', value: ''},
                {name: 'X-MICROSOFT-SKYPETEAMSMEETINGURL', value: '   '},
            ],
            description: JITSI,
        });
        expect(result).toBe(JITSI);
    });

    it('should take the first usable value among duplicates', function() {
        const {result} = find({
            properties: [
                {name: 'X-GOOGLE-CONFERENCE', value: ''},
                {name: 'X-GOOGLE-CONFERENCE', value: MEET},
                {name: 'X-GOOGLE-CONFERENCE', value: 'https://meet.google.com/zzz-zzzz-zzz'},
            ],
        });
        expect(result).toBe(MEET);
    });

    it('should accept an aka.ms Teams redirect as is', function() {
        const akaMs = 'https://aka.ms/JoinTeamsMeeting?omkt=en-US';
        const {result} = find({
            properties: [{name: 'X-MICROSOFT-SKYPETEAMSMEETINGURL', value: akaMs}],
            location: WEBEX,
        });
        expect(result).toBe(akaMs);
    });

    it('should trim whitespace around a property value', function() {
        const {result} = find({properties: [{name: 'X-GOOGLE-CONFERENCE', value: ` ${MEET}\r\n`}]});
        expect(result).toBe(MEET);
    });

    it('should never read the SIP conference link property', function() {
        const {result} = find({
            properties: [{name: 'X-MICROSOFT-ONLINEMEETINGCONFLINK', value: 'conf:sip:user@example.com;gruu;opaque=app:conf:focus:id:ABC'}],
        });
        expect(result).toBeNull();
        expect(LINK_PROPERTY_NAMES.has('X-MICROSOFT-ONLINEMEETINGCONFLINK')).toBe(false);
    });

    it('should ignore the SIP property even when it holds an http URL', function() {
        const {result, fullTextCalls} = find({
            properties: [{name: 'X-MICROSOFT-ONLINEMEETINGCONFLINK', value: 'https://meet.lync.com/example/user/ABC123'}],
            fullText: 'BEGIN:VEVENT\r\nX-MICROSOFT-ONLINEMEETINGCONFLINK:https://meet.lync.com/example/user/ABC123\r\nEND:VEVENT',
        });
        expect(result).toBeNull();
        expect(fullTextCalls).toBe(1);
    });

    it('should ignore a folded SIP property and still scan the lines after it', function() {
        const sip = 'X-MICROSOFT-ONLINEMEETINGCONFLINK:https://meet.lync.com/example/us\r\n er/ABC123\r\n';
        expect(find({fullText: `BEGIN:VEVENT\r\n${sip}END:VEVENT`}).result).toBeNull();
        expect(find({fullText: `BEGIN:VEVENT\r\n${sip}COMMENT:${ZOOM}\r\nEND:VEVENT`}).result).toBe(ZOOM);
    });

    it('should skip tel: and sip: CONFERENCE values', function() {
        const {result} = find({
            properties: [
                {name: 'CONFERENCE', value: 'tel:+1-412-555-0123,,,654321'},
                {name: 'CONFERENCE', value: 'sip:room@example.com'},
                {name: 'CONFERENCE', value: MEET},
            ],
        });
        expect(result).toBe(MEET);
    });

    it('should fall through when CONFERENCE holds only a phone number', function() {
        const {result} = find({
            properties: [{name: 'CONFERENCE', value: 'tel:+1-412-555-0123'}],
            location: WEBEX,
        });
        expect(result).toBe(WEBEX);
    });

    it('should accept any http(s) CONFERENCE value without a host match', function() {
        const selfHosted = 'https://video.example.org/room/42';
        expect(find({properties: [{name: 'CONFERENCE', value: selfHosted}]}).result).toBe(selfHosted);
    });

    it('should require URL to match a known meeting service', function() {
        const {result} = find({
            properties: [{name: 'URL', value: 'https://example.com/events/42'}],
            description: JITSI,
        });
        expect(result).toBe(JITSI);
    });
});

describe('findConferenceLink folded component text', function() {
    it('should read a short Teams link across a fold inside the meeting id', function() {
        const {result} = find({fullText: 'BEGIN:VEVENT\r\nCOMMENT:Join https://teams.microsoft.com/meet/12345\r\n 67890?p=AbCdEf\r\nEND:VEVENT'});
        expect(result).toBe('https://teams.microsoft.com/meet/1234567890?p=AbCdEf');
    });

    it('should read a long link across several folds, LF or tab included', function() {
        const folded = 'X-ALT-DESC;FMTTYPE=text/html:<a href="https://teams.microsoft.com/l/meetup-j\r\n oin/19%3ameeting_abc%40th\n\tread.v2/0?context=%7b%22Tid%22%7d">Join</a>\r\n';
        expect(find({fullText: folded}).result).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d');
    });

    it('should keep an escaped newline as the end of a link', function() {
        const {result} = find({fullText: `DESCRIPTION:Join\\n${ZOOM}\\nPasscode: 1\r\n 234\r\n`});
        expect(result).toBe(ZOOM);
    });
});

describe('findConferenceLink all-day events', function() {
    it('should skip the full-component scan', function() {
        const {result, fullTextCalls} = find({isAllDay: true, fullText: `COMMENT:${ZOOM}`});
        expect(result).toBeNull();
        expect(fullTextCalls).toBe(0);
    });

    it('should still read properties, LOCATION and DESCRIPTION', function() {
        expect(find({isAllDay: true, properties: [{name: 'CONFERENCE', value: MEET}]}).result).toBe(MEET);
        expect(find({isAllDay: true, location: WEBEX}).result).toBe(WEBEX);
        expect(find({isAllDay: true, description: JITSI}).result).toBe(JITSI);
    });
});
