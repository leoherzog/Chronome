// Tests for rsvp.js
import { describe, it, expect } from './runner.js';
import { getUserPartstat } from '../lib/rsvp.js';

const ME = 'user@example.com';
const OTHER = 'other@example.com';

function partstat(options = {}) {
    return getUserPartstat({attendees: [], accountEmail: ME, backendName: 'caldav', status: null, ...options});
}

describe('getUserPartstat', function() {
    it('should read the PARTSTAT of the account attendee', function() {
        const attendees = [{email: OTHER, partstat: 'ACCEPTED'}, {email: ME, partstat: 'DECLINED'}];
        expect(partstat({attendees})).toBe('DECLINED');
    });

    it('should return null when the account is not an attendee', function() {
        expect(partstat({attendees: [{email: OTHER, partstat: 'DECLINED'}]})).toBeNull();
    });

    it('should return null when the attendee line has no PARTSTAT', function() {
        expect(partstat({attendees: [{email: ME, partstat: null}]})).toBeNull();
    });

    it('should return null without an account e-mail', function() {
        expect(partstat({accountEmail: null, attendees: [{email: null, partstat: 'DECLINED'}]})).toBeNull();
    });

    it('should ignore STATUS on other backends', function() {
        const attendees = [{email: ME, partstat: 'ACCEPTED'}];
        expect(partstat({attendees, status: 'CANCELLED'})).toBe('ACCEPTED');
        expect(partstat({status: 'CANCELLED'})).toBeNull();
    });
});

describe('getUserPartstat on Microsoft 365', function() {
    const m365 = options => partstat({backendName: 'microsoft365', ...options});

    it('should map STATUS to the user response', function() {
        expect(m365({status: 'CANCELLED'})).toBe('DECLINED');
        expect(m365({status: 'TENTATIVE'})).toBe('TENTATIVE');
        expect(m365({status: 'NEEDS-ACTION'})).toBe('NEEDS-ACTION');
        expect(m365({status: 'CONFIRMED'})).toBe('ACCEPTED');
    });

    it('should let STATUS win over the ATTENDEE line', function() {
        expect(m365({status: 'CANCELLED', attendees: [{email: ME, partstat: 'NEEDS-ACTION'}]})).toBe('DECLINED');
    });

    it('should not need an account e-mail', function() {
        expect(m365({status: 'CANCELLED', accountEmail: null})).toBe('DECLINED');
    });

    it('should fall back to PARTSTAT when STATUS is absent', function() {
        expect(m365({attendees: [{email: ME, partstat: 'TENTATIVE'}]})).toBe('TENTATIVE');
        expect(m365({})).toBeNull();
    });
});
