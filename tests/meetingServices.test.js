// Tests for meetingServices.js
import { describe, it, expect } from './runner.js';
import { findMeetingUrl } from '../meetingServices.js';

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

    // Edge cases
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
