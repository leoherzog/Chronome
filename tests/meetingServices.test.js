// Tests for meetingServices.js
import { describe, it, expect } from './runner.js';
import { findMeetingUrl } from '../lib/meetingServices.js';

describe('findMeetingUrl', function() {
    // Google Meet
    it('should find Google Meet URLs', function() {
        const text = 'Join the meeting at https://meet.google.com/abc-defg-hij';
        const result = findMeetingUrl(text);
        expect(result).not.toBeNull();
        expect(result).toContain('meet.google.com');
    });

    it('should find Google Meet URLs with _meet prefix', function() {
        const result = findMeetingUrl('https://meet.google.com/_meet/abc-defg');
        expect(result).not.toBeNull();
        expect(result).toContain('meet.google.com');
    });

    it('should find Google Meet Stream URLs', function() {
        const result = findMeetingUrl('https://stream.meet.google.com/stream/abc123-xyz');
        expect(result).not.toBeNull();
        expect(result).toContain('stream.meet.google.com');
    });

    // Zoom
    it('should find Zoom URLs', function() {
        const text = 'Zoom: https://zoom.us/j/123456789?pwd=abc';
        const result = findMeetingUrl(text);
        expect(result).not.toBeNull();
        expect(result).toContain('zoom.us');
    });

    it('should find Zoom with subdomain', function() {
        const result = findMeetingUrl('https://company.zoom.us/j/123456');
        expect(result).not.toBeNull();
        expect(result).toContain('zoom.us');
    });

    it('should find Zoom personal room URLs', function() {
        const result = findMeetingUrl('https://zoom.us/my/johndoe');
        expect(result).not.toBeNull();
        expect(result).toContain('zoom.us/my');
    });

    it('should find ZoomGov URLs', function() {
        const result = findMeetingUrl('https://company.zoomgov.com/j/123456789');
        expect(result).not.toBeNull();
        expect(result).toContain('zoomgov.com');
    });

    it('should keep ZoomGov passcodes containing - _ . + and /', function() {
        const urls = [
            'https://www.zoomgov.com/j/16111111111?pwd=abc-DEF123-GHI',
            'https://www.zoomgov.com/j/16111111111?pwd=abc_DEF_123',
            'https://www.zoomgov.com/j/16111111111?pwd=abcDEF123ghi.1',
            'https://www.zoomgov.com/j/16111111111?pwd=abc+DEF+123',
            'https://www.zoomgov.com/j/16111111111?pwd=abc/DEF/123',
            'https://www.zoomgov.com/j/16111111111?pwd=a-b_c.d+e/f&uname=Jo',
        ];
        for (const url of urls)
            expect(findMeetingUrl(url)).toBe(url);
    });

    it('should find ZoomGov personal room, webinar and registration URLs', function() {
        const urls = [
            'https://agency.zoomgov.com/my/jane.doe',
            'https://www.zoomgov.com/w/1601234567?tk=abc-DEF_123',
            'https://www.zoomgov.com/s/1601234567',
            'https://www.zoomgov.com/webinar/register/WN_abc-DEF_123',
            'https://my-agency.zoomgov.com/j/1601234567',
        ];
        for (const url of urls)
            expect(findMeetingUrl(url)).toBe(url);
    });

    it('should leave sentence punctuation out of a ZoomGov URL', function() {
        const url = 'https://www.zoomgov.com/j/16111111111?pwd=abc-DEF.1';
        expect(findMeetingUrl(`Join at ${url}.`)).toBe(url);
        expect(findMeetingUrl(`Dial in (or use ${url}) before noon.`)).toBe(url);
        expect(findMeetingUrl(`The link (${url}).`)).toBe(url);
        expect(findMeetingUrl(`Link: ${url}, passcode follows`)).toBe(url);
    });

    it('should not match ZoomGov pages that are not meetings', function() {
        expect(findMeetingUrl('https://www.zoomgov.com/')).toBeNull();
        expect(findMeetingUrl('https://www.zoomgov.com/j/')).toBeNull();
        expect(findMeetingUrl('https://www.zoomgov.com/signin')).toBeNull();
    });

    it('should require a dot or the scheme directly before zoomgov.com', function() {
        expect(findMeetingUrl('https://notzoomgov.com/j/123')).toBeNull();
        expect(findMeetingUrl('https://www.notzoomgov.com/j/123')).toBeNull();
        expect(findMeetingUrl('https://zoomgov.com.example.com/j/123')).toBeNull();
        expect(findMeetingUrl('https://zoomgov.com/j/123')).toBe('https://zoomgov.com/j/123');
        expect(findMeetingUrl('https://a.b-c.zoomgov.com/j/123')).toBe('https://a.b-c.zoomgov.com/j/123');
    });

    // Microsoft Teams
    it('should find Microsoft Teams URLs', function() {
        const text = 'Teams: https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc';
        const result = findMeetingUrl(text);
        expect(result).not.toBeNull();
        expect(result).toContain('teams.microsoft.com');
    });

    it('should find Microsoft Teams Gov URLs', function() {
        const result = findMeetingUrl('https://gov.teams.microsoft.us/l/meetup-join/abc');
        expect(result).not.toBeNull();
        expect(result).toContain('teams.microsoft');
    });

    it('should return a whole Teams meetup-join URL with its context query', function() {
        const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_MjA0ZGY1-abc%40thread.v2/0' +
            '?context=%7b%22Tid%22%3a%2272f988bf-86f1%22%2c%22Oid%22%3a%224b4b1a1e-0c9d%22%7d';
        expect(findMeetingUrl(url)).toBe(url);
        expect(findMeetingUrl(`${url}&anon=true`)).toBe(`${url}&anon=true`);
    });

    it('should find Teams meetup-join URLs on every supported host', function() {
        const hosts = ['teams.microsoft.com', 'teams.microsoft.us', 'gov.teams.microsoft.us', 'dod.teams.microsoft.us',
            'teams.live.com', 'teams.cloud.microsoft'];
        for (const host of hosts) {
            const url = `https://${host}/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d`;
            expect(findMeetingUrl(url)).toBe(url);
        }
    });

    it('should find short Teams /meet/ URLs with their passcode', function() {
        const urls = [
            'https://teams.microsoft.com/meet/1234567890?p=AbCdEf',
            'https://teams.live.com/meet/9312345678?p=xyz',
            'https://teams.live.com/meet/9425716001426?p=0SystrMw2goKHi8LK6',
            'https://teams.cloud.microsoft/meet/1234567890123?p=Aa1Bb2Cc3Dd4Ee5',
            'https://teams.microsoft.us/meet/1234567890123?p=Aa1Bb2Cc3Dd4Ee5',
            'https://gov.teams.microsoft.us/meet/1234567890123?p=Aa1Bb2Cc3Dd4Ee5',
            'https://teams.microsoft.com/meet/1234567890123?p=Aa1-Bb2_Cc3',
            'https://teams.microsoft.com/meet/1234567890123?p=Aa1Bb2Cc3Dd4Ee5&anon=true',
        ];
        for (const url of urls)
            expect(findMeetingUrl(url)).toBe(url);
    });

    it('should leave sentence punctuation out of a Teams URL', function() {
        const short = 'https://teams.microsoft.com/meet/1234567890?p=AbCdEf';
        const long = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d';
        expect(findMeetingUrl(`Join here: ${short}.`)).toBe(short);
        expect(findMeetingUrl(`Join (${short}) at noon.`)).toBe(short);
        expect(findMeetingUrl(`Join <${short}> at noon.`)).toBe(short);
        expect(findMeetingUrl(`Join here: ${long}. See you there.`)).toBe(long);
        expect(findMeetingUrl(`Join (${long}).`)).toBe(long);
    });

    it('should stop a Teams URL before an HTML-escaped ampersand', function() {
        const url = 'https://teams.microsoft.com/l/meetup-join/abc';
        expect(findMeetingUrl(`<a href="${url}&amp;anon=true">Join</a>`)).toBe(url);
        expect(findMeetingUrl(`${url}&amp;`)).toBe(url);
        expect(findMeetingUrl(`${url}?a=1&amplitude=2`)).toBe(`${url}?a=1&amplitude=2`);
        expect(findMeetingUrl('https://teams.microsoft.com/meet/1234567890?p=AbCdEf&amp;x=1')).toBe('https://teams.microsoft.com/meet/1234567890?p=AbCdEf');
    });

    it('should not match Teams pages that are not meetings', function() {
        const urls = [
            'https://teams.microsoft.com/',
            'https://teams.microsoft.com/v2/',
            'https://teams.microsoft.com/l/meeting/new?subject=Standup',
            'https://teams.microsoft.com/l/channel/19%3aabc%40thread.tacv2/General?groupId=1',
            'https://teams.microsoft.com/l/chat/0/0?users=someone@example.com',
            'https://teams.microsoft.com/l/meetup-join/',
            'https://teams.microsoft.com/meet/1234567890123',
            'https://teams.live.com/meet/9425716001426',
            'https://teams.microsoft.com/meet/channel?p=Aa1Bb2Cc3Dd4Ee5',
            'https://teams.cloud.microsoft/',
            'https://teams.cloud.microsoft.example.com/meet/1234567890?p=AbCdEf',
            'https://notteams.live.com/meet/1234567890?p=AbCdEf',
        ];
        for (const url of urls)
            expect(findMeetingUrl(url)).toBeNull();
    });

    it('should prefer the Teams pattern over Skype for Business Self-hosted', function() {
        const teams = 'https://teams.microsoft.com/meet/1234567890?p=AbCdEf';
        const skype = 'https://meet.contoso.com/contoso.com/meet/jane.doe/ABC123';
        expect(findMeetingUrl(skype)).toBe(skype);
        expect(findMeetingUrl(`Legacy: ${skype} or Teams: ${teams}`)).toBe(teams);
        expect(findMeetingUrl(`https://join.contoso.com/?url=${teams}`)).toBe(teams);
    });

    it('should stop a link at an escaped newline in serialized iCal text', function() {
        const teams = 'https://teams.microsoft.com/meet/1234567890?p=AbCdEf';
        const zoomGov = 'https://www.zoomgov.com/j/16111111111?pwd=abc-DEF_1.2+3/4';
        expect(findMeetingUrl(`DESCRIPTION:Join the meeting now\\n${teams}\\nMeeting ID: 123 456 789 0\\nPasscode: AbCdEf`)).toBe(teams);
        expect(findMeetingUrl(`DESCRIPTION:Join ZoomGov Meeting\\n${zoomGov}\\n\\nMeeting ID: 161 1111 1111`)).toBe(zoomGov);
    });

    it('should find links in an unfolded iCal DESCRIPTION', function() {
        const unfold = ical => ical.replace(/\r?\n[ \t]/g, '');
        const teams = 'https://teams.microsoft.com/meet/1234567890123?p=Aa1Bb2Cc3Dd4Ee5';
        const foldedTeams = 'DESCRIPTION:Microsoft Teams Need help?\\nJoin the meeting now: https://teams.mi\r\n crosoft.com/meet/12345678' +
            '\r\n 90123?p=Aa1Bb2Cc3\r\n Dd4Ee5\\nMeeting ID: 123 456 789 012 3\r\n';
        expect(findMeetingUrl(unfold(foldedTeams))).toBe(teams);

        const zoomGov = 'https://www.zoomgov.com/j/16111111111?pwd=abc-DEF_1.2+3/4';
        const foldedZoomGov = 'DESCRIPTION:Join ZoomGov Meeting\\nhttps://www.zoomgov.com/j/161111\r\n 11111?pwd=abc-DEF_\r\n 1.2+3/4\\n\\nMeeting ID: 161 1111 1111\r\n';
        expect(findMeetingUrl(unfold(foldedZoomGov))).toBe(zoomGov);
    });

    it('should not read across an iCal line fold, so findConferenceLink() unfolds first', function() {
        const folded = 'DESCRIPTION:https://www.zoomgov.com/j/16111111111?pwd=abc-\r\n DEF_123\r\n';
        expect(findMeetingUrl(folded)).toBe('https://www.zoomgov.com/j/16111111111?pwd=abc-');
        expect(findMeetingUrl('DESCRIPTION:https://teams.microsoft.com/meet/12345\r\n 67890?p=AbCdEf\r\n')).toBeNull();
    });

    // Webex
    it('should find Webex URLs', function() {
        const result = findMeetingUrl('https://company.webex.com/meet/john.doe');
        expect(result).not.toBeNull();
        expect(result).toContain('webex.com');
    });

    it('should find Webex join URLs', function() {
        const result = findMeetingUrl('https://company.webex.com/join/john.doe');
        expect(result).not.toBeNull();
        expect(result).toContain('webex.com');
    });

    // Jitsi Meet
    it('should find Jitsi Meet URLs', function() {
        const result = findMeetingUrl('https://meet.jit.si/MyMeetingRoom');
        expect(result).not.toBeNull();
        expect(result).toContain('meet.jit.si');
    });

    // Discord
    it('should find Discord URLs', function() {
        const result = findMeetingUrl('https://discord.gg/invite123');
        expect(result).not.toBeNull();
        expect(result).toContain('discord');
    });

    // Slack Huddle
    it('should find Slack Huddle URLs', function() {
        const result = findMeetingUrl('https://app.slack.com/huddle/T12345/C67890');
        expect(result).not.toBeNull();
        expect(result).toContain('slack.com/huddle');
    });

    // Amazon Chime
    it('should find Amazon Chime URLs', function() {
        const result = findMeetingUrl('https://chime.aws/1234567890');
        expect(result).not.toBeNull();
        expect(result).toContain('chime.aws');
    });

    // BlueJeans
    it('should find BlueJeans URLs', function() {
        const result = findMeetingUrl('https://bluejeans.com/123456789');
        expect(result).not.toBeNull();
        expect(result).toContain('bluejeans.com');
    });

    // GoToMeeting
    it('should find GoToMeeting URLs', function() {
        const result = findMeetingUrl('https://gotomeeting.com/join/123456789');
        expect(result).not.toBeNull();
        expect(result).toContain('gotomeeting.com');
    });

    // Skype
    it('should find Skype URLs', function() {
        const result = findMeetingUrl('https://join.skype.com/invite/abc123');
        expect(result).not.toBeNull();
        expect(result).toContain('join.skype.com');
    });

    // FaceTime
    it('should find FaceTime URLs', function() {
        const result = findMeetingUrl('https://facetime.apple.com/join#v=1&p=abc123');
        expect(result).not.toBeNull();
        expect(result).toContain('facetime.apple.com');
    });

    // Whereby
    it('should find Whereby URLs', function() {
        const result = findMeetingUrl('https://whereby.com/myroom');
        expect(result).not.toBeNull();
        expect(result).toContain('whereby.com');
    });

    // Around
    it('should find Around URLs', function() {
        const result = findMeetingUrl('https://around.co/r/myroom');
        expect(result).not.toBeNull();
        expect(result).toContain('around.co');
    });

    // YouTube
    it('should find YouTube URLs', function() {
        const result = findMeetingUrl('https://www.youtube.com/watch?v=abc123');
        expect(result).not.toBeNull();
        expect(result).toContain('youtube.com');
    });

    // StreamYard
    it('should find StreamYard URLs', function() {
        const result = findMeetingUrl('https://streamyard.com/abcd1234xyz');
        expect(result).not.toBeNull();
        expect(result).toContain('streamyard.com');
    });

    // RingCentral
    it('should find RingCentral URLs', function() {
        const result = findMeetingUrl('https://meetings.ringcentral.com/j/1234567890');
        expect(result).not.toBeNull();
        expect(result).toContain('ringcentral.com');
    });

    // 8x8
    it('should find 8x8 URLs', function() {
        const result = findMeetingUrl('https://8x8.vc/company/room');
        expect(result).not.toBeNull();
        expect(result).toContain('8x8.vc');
    });

    // Demio
    it('should find Demio URLs', function() {
        const result = findMeetingUrl('https://event.demio.com/anon/webinar-abc123');
        expect(result).not.toBeNull();
        expect(result).toContain('event.demio.com');
    });

    // Luma
    it('should find Luma URLs', function() {
        const result = findMeetingUrl('https://lu.ma/join/abcdef');
        expect(result).not.toBeNull();
        expect(result).toContain('lu.ma');
    });

    // Gather
    it('should find Gather URLs', function() {
        const result = findMeetingUrl('https://app.gather.town/app/ABC123/my-room?spawnToken=xyz');
        expect(result).not.toBeNull();
        expect(result).toContain('gather.town');
    });

    // LiveKit
    it('should find LiveKit URLs', function() {
        const result = findMeetingUrl('https://meet.livekit.io/rooms/abc-123-xyz');
        expect(result).not.toBeNull();
        expect(result).toContain('livekit.io');
    });

    // Cal.com
    it('should find Cal.com video URLs', function() {
        const result = findMeetingUrl('https://app.cal.com/video/abc123xyz');
        expect(result).not.toBeNull();
        expect(result).toContain('cal.com/video');
    });

    // Pumble
    it('should find Pumble URLs', function() {
        const result = findMeetingUrl('https://meet.pumble.com/my-meeting-room');
        expect(result).not.toBeNull();
        expect(result).toContain('meet.pumble.com');
    });

    // Doxy.me
    it('should find Doxy.me URLs', function() {
        const result = findMeetingUrl('https://doxy.me/drsmith');
        expect(result).not.toBeNull();
        expect(result).toContain('doxy.me');
    });

    // Vowel
    it('should find Vowel URLs', function() {
        const result = findMeetingUrl('https://vowel.com/#/g/meeting-abc123');
        expect(result).not.toBeNull();
        expect(result).toContain('vowel.com');
    });

    // GoToWebinar
    it('should find GoToWebinar URLs', function() {
        const result = findMeetingUrl('https://gotowebinar.com/join/123456789');
        expect(result).not.toBeNull();
        expect(result).toContain('gotowebinar.com');
    });

    // Join.me
    it('should find Join.me URLs', function() {
        const result = findMeetingUrl('https://join.me/my-meeting');
        expect(result).not.toBeNull();
        expect(result).toContain('join.me');
    });

    // UberConference
    it('should find UberConference URLs', function() {
        const result = findMeetingUrl('https://uberconference.com/john-doe');
        expect(result).not.toBeNull();
        expect(result).toContain('uberconference.com');
    });

    // Lark
    it('should find Lark URLs', function() {
        const result = findMeetingUrl('https://vc.larksuite.com/j/1234567890');
        expect(result).not.toBeNull();
        expect(result).toContain('larksuite.com');
    });

    // Feishu
    it('should find Feishu URLs', function() {
        const result = findMeetingUrl('https://vc.feishu.cn/j/1234567890');
        expect(result).not.toBeNull();
        expect(result).toContain('feishu.cn');
    });

    // Edge cases
    // Zhumu
    it('should find Zhumu URLs with and without a passcode', function() {
        expect(findMeetingUrl('https://welink.zhumu.com/j/123456789?pwd=abcDEF123'))
            .toBe('https://welink.zhumu.com/j/123456789?pwd=abcDEF123');
        expect(findMeetingUrl('https://welink.zhumu.com/j/123456789'))
            .toBe('https://welink.zhumu.com/j/123456789');
    });

    it('should find Zhumu web client join URLs', function() {
        expect(findMeetingUrl('https://welink.zhumu.com/wc/join/123456789?wpk=abc123'))
            .toBe('https://welink.zhumu.com/wc/join/123456789?wpk=abc123');
    });

    // Proton Meet
    it('should find Proton Meet URLs with their password fragment', function() {
        expect(findMeetingUrl('Join: https://meet.proton.me/join/id-ABC123#pwd-xyz789 today'))
            .toBe('https://meet.proton.me/join/id-ABC123#pwd-xyz789');
    });

    // Riverside
    it('should find Riverside studio URLs', function() {
        expect(findMeetingUrl('https://riverside.fm/studio/my-show?t=abc'))
            .toBe('https://riverside.fm/studio/my-show?t=abc');
        expect(findMeetingUrl('https://riverside.com/studio/my-show')).toContain('riverside.com/studio');
    });

    it('should return null for text without meeting URLs', function() {
        expect(findMeetingUrl('No meeting link here')).toBeNull();
        expect(findMeetingUrl('Just a regular email: test@example.com')).toBeNull();
        expect(findMeetingUrl('https://example.com/not-a-meeting')).toBeNull();
    });

    it('should return null for empty input', function() {
        expect(findMeetingUrl('')).toBeNull();
        expect(findMeetingUrl(null)).toBeNull();
        expect(findMeetingUrl(undefined)).toBeNull();
    });

    it('should find the first meeting URL when multiple exist', function() {
        const text = 'Primary: https://meet.google.com/abc-defg-hij and backup: https://zoom.us/j/123';
        const result = findMeetingUrl(text);
        // Google Meet is first in the pattern list and should match first
        expect(result).toContain('meet.google.com');
    });

    it('should find meeting URL embedded in longer text', function() {
        const text = `
            Meeting Details:
            Join us at https://meet.google.com/abc-defg-hij
            Please be on time.
        `;
        const result = findMeetingUrl(text);
        expect(result).not.toBeNull();
        expect(result).toContain('meet.google.com');
    });

    it('should handle URLs with query parameters', function() {
        const result = findMeetingUrl('https://zoom.us/j/123456789?pwd=abc123&uname=test');
        expect(result).not.toBeNull();
        expect(result).toContain('zoom.us');
    });
});
