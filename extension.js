'use strict';

const { Gio, GLib, St, Clutter } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Mainloop = imports.mainloop;
const Convenience = Me.imports.convenience;

// Load ECal 2.0 and EDataServer modules
let ECal, EDataServer;
try {
    imports.gi.versions.ECal = '2.0';
    ECal = imports.gi.ECal;
    imports.gi.versions.EDataServer = '1.2';
    EDataServer = imports.gi.EDataServer;
} catch (e) {
    log(`Chronome: Error loading ECal 2.0: ${e}`);
    throw new Error('ECal 2.0 is required for Chronome to work');
}

// Regex patterns for video conferencing URLs
// Thanks MeetingBar
// https://github.com/leits/MeetingBar/blob/master/MeetingBar/Services/MeetingServices.swift#L263
const MEETING_URL_PATTERNS = [
    // Google Meet
    /https?:\/\/meet\.google\.com\/(_meet\/)?[a-z-]+/i,
    // Google Meet Stream
    /https?:\/\/stream\.meet\.google\.com\/stream\/[a-z0-9-]+/i,
    // Zoom
    /https:\/\/(?:[a-zA-Z0-9-.]+)?zoom(-x)?\.(?:us|com|com\.cn|de)\/(?:my|[a-z]{1,2}|webinar)\/[-a-zA-Z0-9()@:%_\+.~#?&=\/]*/i,
    // Zoom Native
    /zoommtg:\/\/([a-z0-9-.]+)?zoom(-x)?\.(?:us|com|com\.cn|de)\/join[-a-zA-Z0-9()@:%_\+.~#?&=\/]*/i,
    // Zoom Gov
    /https?:\/\/([a-z0-9.]+)?zoomgov\.com\/j\/[a-zA-Z0-9?&=]+/i,
    // Microsoft Teams
    /https?:\/\/(gov.)?teams\.microsoft\.(com|us)\/l\/meetup-join\/[a-zA-Z0-9_%\/=\-\+\.?]+/i,
    // Webex
    /https?:\/\/(?:[A-Za-z0-9-]+\.)?webex\.com(?:(?:\/[-A-Za-z0-9]+\/j\.php\?MTID=[A-Za-z0-9]+(?:&\S*)?)|(?:\/(?:meet|join)\/[A-Za-z0-9\-._@]+(?:\?\S*)?))/i,
    // Amazon Chime
    /https?:\/\/([a-z0-9-.]+)?chime\.aws\/[0-9]*/i,
    // Jitsi Meet
    /https?:\/\/meet\.jit\.si\/[^\s]*/i,
    // RingCentral
    /https?:\/\/([a-z0-9.]+)?ringcentral\.com\/[^\s]*/i,
    // GoToMeeting
    /https?:\/\/([a-z0-9.]+)?gotomeeting\.com\/[^\s]*/i,
    // GoToWebinar
    /https?:\/\/([a-z0-9.]+)?gotowebinar\.com\/[^\s]*/i,
    // BlueJeans
    /https?:\/\/([a-z0-9.]+)?bluejeans\.com\/[^\s]*/i,
    // 8x8
    /https?:\/\/8x8\.vc\/[^\s]*/i,
    // Demio
    /https?:\/\/event\.demio\.com\/[^\s]*/i,
    // Join.me
    /https?:\/\/join\.me\/[^\s]*/i,
    // Whereby
    /https?:\/\/whereby\.com\/[^\s]*/i,
    // UberConference
    /https?:\/\/uberconference\.com\/[^\s]*/i,
    // Blizz
    /https?:\/\/go\.blizz\.com\/[^\s]*/i,
    // TeamViewer Meeting
    /https?:\/\/go\.teamviewer\.com\/[^\s]*/i,
    // VSee
    /https?:\/\/vsee\.com\/[^\s]*/i,
    // StarLeaf
    /https?:\/\/meet\.starleaf\.com\/[^\s]*/i,
    // Google Duo
    /https?:\/\/duo\.app\.goo\.gl\/[^\s]*/i,
    // VooV Meeting
    /https?:\/\/voovmeeting\.com\/[^\s]*/i,
    // Facebook Workplace
    /https?:\/\/([a-z0-9-.]+)?workplace\.com\/groupcall\/[^\s]+/i,
    // Skype
    /https?:\/\/join\.skype\.com\/[^\s]*/i,
    // Skype for Business
    /https?:\/\/meet\.lync\.com\/[^\s]*/i,
    // Skype for Business Self-hosted
    /https?:\/\/(meet|join)\.[^\s]*\/[a-z0-9.]+\/meet\/[A-Za-z0-9.\/]+/i,
    // Lifesize
    /https?:\/\/call\.lifesizecloud\.com\/[^\s]*/i,
    // YouTube
    /https?:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\/[^\s]*/i,
    // Vonage Meetings
    /https?:\/\/meetings\.vonage\.com\/[0-9]{9}/i,
    // Around
    /https?:\/\/(meet\.)?around\.co\/[^\s]*/i,
    // Jam
    /https?:\/\/jam\.systems\/[^\s]*/i,
    // Discord
    /(http|https|discord):\/\/(www\.)?(canary\.)?discord(app)?\.([a-zA-Z]{2,})(.+)?/i,
    // Blackboard Collaborate
    /https?:\/\/us\.bbcollab\.com\/[^\s]*/i,
    // CoScreen
    /https?:\/\/join\.coscreen\.co\/[^\s]*/i,
    // Vowel
    /https?:\/\/([a-z0-9.]+)?vowel\.com\/#\/g\/[^\s]*/i,
    // Zhumu
    /https:\/\/welink\.zhumu\.com\/j\/[0-9]+\?pwd=[a-zA-Z0-9]+/i,
    // Lark
    /https:\/\/vc\.larksuite\.com\/j\/[0-9]+/i,
    // Feishu
    /https:\/\/vc\.feishu\.cn\/j\/[0-9]+/i,
    // Vimeo
    /https:\/\/vimeo\.com\/(showcase|event)\/[0-9]+|https:\/\/venues\.vimeo\.com\/[^\s]+/i,
    // Ovice
    /https:\/\/([a-z0-9-.]+)?ovice\.in\/[^\s]*/i,
    // FaceTime
    /https:\/\/facetime\.apple\.com\/join[^\s]*/i,
    // Chorus
    /https?:\/\/go\.chorus\.ai\/[^\s]+/i,
    // Pop
    /https?:\/\/pop\.com\/j\/[0-9-]+/i,
    // Gong
    /https?:\/\/([a-z0-9-.]+)?join\.gong\.io\/[^\s]+/i,
    // Livestorm
    /https?:\/\/app\.livestorm\.com\/p\/[^\s]+/i,
    // Luma
    /https:\/\/lu\.ma\/join\/[^\s]*/i,
    // Preply
    /https:\/\/preply\.com\/[^\s]*/i,
    // UserZoom
    /https:\/\/go\.userzoom\.com\/participate\/[a-z0-9-]+/i,
    // Venue
    /https:\/\/app\.venue\.live\/app\/[^\s]*/i,
    // Teemyco
    /https:\/\/app\.teemyco\.com\/room\/[^\s]*/i,
    // Demodesk
    /https:\/\/demodesk\.com\/[^\s]*/i,
    // Zoho Cliq
    /https:\/\/cliq\.zoho\.eu\/meetings\/[^\s]*/i,
    // Google Hangouts
    /https?:\/\/hangouts\.google\.com\/[^\s]*/i,
    // Slack
    /https?:\/\/app\.slack\.com\/huddle\/[A-Za-z0-9.\/]+/i,
    // Reclaim
    /https?:\/\/reclaim\.ai\/z\/[A-Za-z0-9.\/]+/i,
    // Tuple
    /https:\/\/tuple\.app\/c\/[^\s]*/i,
    // Gather
    /https?:\/\/app.gather.town\/app\/[A-Za-z0-9]+\/[A-Za-z0-9_%\-]+\?(spawnToken|meeting)=[^\s]*/i,
    // Pumble
    /https?:\/\/meet\.pumble\.com\/[a-z-]+/i,
    // Suit Conference
    /https?:\/\/([a-z0-9.]+)?conference\.istesuit\.com\/[^\s]*/i,
    // Doxy.me
    /https:\/\/([a-z0-9.]+)?doxy\.me\/[^\s]*/i,
    // Cal.com
    /https?:\/\/app.cal\.com\/video\/[A-Za-z0-9.\/]+/i,
    // ZM Page
    /https?:\/\/([a-zA-Z0-9.]+)\.zm\.page/i,
    // LiveKit
    /https?:\/\/meet[a-zA-Z0-9.]*\.livekit\.io\/rooms\/[a-zA-Z0-9-#]+/i,
    // Meetecho
    /https?:\/\/meetings\.conf\.meetecho\.com\/.+/i
];

// Main indicator class
class ChronomeIndicator extends PanelMenu.Button {
    constructor(settings) {
        super(0.0, 'Chronome', false);
        this._settings = settings;
        
        // Create UI elements
        this._label = new St.Label({
            text: _('Loading...'),
            y_align: Clutter.ActorAlign.CENTER
        });
        
        // Panel UI layout
        this.add_child(this._label);
        
        // Timer to fetch calendar data (less frequent)
        this._fetchTimeout = null;
        
        // Timer to update display countdown (every second)
        this._displayTimeout = null;
        
        // Store next meeting data
        this._nextMeeting = null;
        
        // Store calendar clients and signals
        this._registry = null;
        this._clients = new Map();
        this._clientSignals = new Map();
        
        // Initial update
        this._refreshEvents();
    }
    
    // Update the top bar label
    updateLabel(text) {
        if (text) {
            this._label.set_text(text);
        }
    }
    
    // Start the automatic refresh timers
    startTimer() {
        // Stop any existing timers
        this.stopTimer();
        
        // Update now
        this._refreshEvents();
        
        // Set up data fetch timer (lower frequency)
        const refreshInterval = this._settings.get_int('refresh-interval');
        this._fetchTimeout = Mainloop.timeout_add_seconds(refreshInterval, () => {
            this._refreshEvents();
            return GLib.SOURCE_CONTINUE; // Keep the timer running
        });
        
        // Set up display update timer if real-time countdown is enabled
        if (this._settings.get_boolean('real-time-countdown')) {
            this._displayTimeout = Mainloop.timeout_add_seconds(1, () => {
                if (this._nextMeeting) {
                    // Check if the current meeting has ended or if we need to switch to next meeting
                    const now = Date.now();
                    const startTime = this._getEventStart(this._nextMeeting);
                    const endTime = this._getEventEnd(this._nextMeeting);
                    
                    // If current meeting ended, refresh to get next meeting
                    if (endTime <= now) {
                        log('Chronome: Current meeting ended, refreshing events');
                        this._refreshEvents();
                    } else {
                        // Just update the countdown
                        this._updatePanelLabel(this._nextMeeting);
                    }
                } else {
                    // No meeting to show, but check if any new meetings appeared
                    // Only refresh every 30 seconds to avoid spam
                    if (!this._lastNoMeetingRefresh || (Date.now() - this._lastNoMeetingRefresh) > 30000) {
                        this._lastNoMeetingRefresh = Date.now();
                        this._refreshEvents();
                    }
                }
                return GLib.SOURCE_CONTINUE; // Keep the timer running
            });
        }
    }
    
    // Stop all timers
    stopTimer() {
        if (this._fetchTimeout) {
            Mainloop.source_remove(this._fetchTimeout);
            this._fetchTimeout = null;
        }
        
        if (this._displayTimeout) {
            Mainloop.source_remove(this._displayTimeout);
            this._displayTimeout = null;
        }
    }
    
    // Refresh calendar events and update the UI
    _refreshEvents() {
        try {
            // Get events
            const allEvents = this._fetchAllEvents();
            
            if (allEvents.length === 0) {
                // No events found - could be no calendars or no events today
                log('Chronome: No events found');
                this._nextMeeting = null;
                this._updateMenu([]);
                this._updatePanelLabel(null);
                return GLib.SOURCE_CONTINUE;
            }
            
            const todayEvents = this._getTodayEvents(allEvents);
            
            // Update top bar text
            this._nextMeeting = this._getNextMeeting(todayEvents);
            
            // Update menu with today's events
            this._updateMenu(todayEvents);
            
            // Update panel label with next meeting info
            this._updatePanelLabel(this._nextMeeting);
            
        } catch (e) {
            log(`Chronome: Error refreshing events: ${e}`);
            this.updateLabel(_('Calendar unavailable'));
            
            // Clear menu on error
            this.menu.removeAll();
            const errorItem = new PopupMenu.PopupMenuItem(_('Calendar service unavailable'));
            errorItem.setSensitive(false);
            this.menu.addMenuItem(errorItem);
        }
        
        return GLib.SOURCE_CONTINUE;
    }
    
    // Update panel label based on next meeting
    _updatePanelLabel(nextMeeting) {
        if (!nextMeeting) {
            this.updateLabel(_('No upcoming meetings'));
            return;
        }
        
        try {
            // Get meeting title 
            const titleText = this._getEventTitle(nextMeeting);
            
            // Shorten title if needed
            const maxLength = this._settings.get_int('event-title-length');
            const shortenedTitle = titleText.length > maxLength 
                ? titleText.substring(0, maxLength) + '…' 
                : titleText;
            
            // Get start and end times
            const startTime = this._getEventStart(nextMeeting);
            const endTime = this._getEventEnd(nextMeeting);
            
            // Current time
            const now = Date.now();
            
            // Check if meeting is happening now
            if (startTime <= now && endTime > now) {
                // Meeting is happening now - show time remaining
                const remainingMs = endTime - now;
                const remainingMin = Math.max(0, Math.ceil(remainingMs / 60000));
                
                let remainingText;
                if (remainingMin < 60) {
                    remainingText = remainingMin === 1 ? _('1 minute left') : `${remainingMin} ${_('minutes left')}`;
                } else {
                    let remainingHrs = Math.floor(remainingMin / 60);
                    let extraMins = remainingMin % 60;
                    remainingText = remainingHrs === 1 ? _('1 hour left') : `${remainingHrs} ${_('hours left')}`;
                    if (extraMins > 0) {
                        remainingText += ` ${extraMins} ${_('min')}`;
                    }
                }
                
                const displayFormat = this._settings.get_string('display-format');
                if (displayFormat === 'compact') {
                    this.updateLabel(`${remainingText} ← ${shortenedTitle}`);
                } else {
                    this.updateLabel(`${remainingText} ${_('in')} ${shortenedTitle}`);
                }
                return;
            }
            
            // Time difference in milliseconds for upcoming meeting
            const diffMs = startTime - now;
            
            // Get icon based on event type and settings
            const iconType = this._settings.get_string('status-bar-icon-type');
            let icon = null;
            
            if (iconType === 'calendar') {
                icon = 'x-office-calendar-symbolic';
            } else if (iconType === 'meeting-type') {
                // Determine icon based on meeting service
                const link = this._findVideoLink(nextMeeting);
                if (link) {
                    icon = 'camera-video-symbolic';
                }
            }
            
            // Display format based on settings
            const displayFormat = this._settings.get_string('display-format');
            let diffMin = Math.max(0, Math.floor(diffMs / 60000));
            let display;
            
            if (diffMin < 60) {
                display = diffMin === 1 ? _('1 minute') : `${diffMin} ${_('minutes')}`;
            } else {
                let diffHrs = Math.floor(diffMin / 60);
                let remainingMins = diffMin % 60;
                
                if (displayFormat === 'compact') {
                    display = diffHrs === 1 ? _('1 hour') : `${diffHrs} ${_('hours')}`;
                } else {
                    display = diffHrs === 1 ? _('1 hour') : `${diffHrs} ${_('hours')}`;
                    if (remainingMins > 0) {
                        display += ` ${remainingMins} ${_('min')}`;
                    }
                }
            }
            
            // Check if this is still in the future
            if (diffMs <= 0) {
                // Event has passed, this shouldn't happen with proper filtering
                this.updateLabel(_('No upcoming meetings'));
                return;
            }
            
            // Format depends on user setting
            if (displayFormat === 'compact') {
                this.updateLabel(`${display} → ${shortenedTitle}`);
            } else {
                this.updateLabel(`${display} ${_('until')} ${shortenedTitle}`);
            }
            
        } catch (e) {
            log(`Chronome: Error updating panel label: ${e}`);
            this.updateLabel(_('Meeting error'));
        }
    }
    
    // Update dropdown menu with today's events
    _updateMenu(todayEvents) {
        // Remove all existing menu items
        this.menu.removeAll();
        
        if (!todayEvents || todayEvents.length === 0) {
            const noEventsItem = new PopupMenu.PopupMenuItem(_('No meetings today'));
            noEventsItem.setSensitive(false);
            this.menu.addMenuItem(noEventsItem);
            return;
        }
        
        // Show header with count
        const headerText = todayEvents.length === 1 ? 
            _('1 meeting today') : 
            `${todayEvents.length} ${_('meetings today')}`;
            
        const headerItem = new PopupMenu.PopupMenuItem(headerText);
        headerItem.setSensitive(false);
        this.menu.addMenuItem(headerItem);
        
        // Add separator
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Get event types to show
        const eventTypes = this._settings.get_strv('event-types');
        
        // Show past events?
        const showPastEvents = this._settings.get_boolean('show-past-events');
        
        // Show event end time?
        const showEndTime = this._settings.get_boolean('show-event-end-time');
        
        // Current time for filtering
        const now = Date.now();
        
        // Sort events by start time
        todayEvents.sort((a, b) => {
            const aStart = this._getEventStart(a);
            const bStart = this._getEventStart(b);
            return aStart - bStart;
        });
        
        // Add menu items for each event
        for (const event of todayEvents) {
            try {
                // Check if this is a past event
                const startTime = this._getEventStart(event);
                const endTime = this._getEventEnd(event);
                const isPast = endTime < now;
                
                // Skip past events if not showing them
                if (isPast && !showPastEvents) {
                    continue;
                }
                
                // Get event properties for filtering
                const isAllDay = this._isAllDayEvent(event);
                const isDeclined = this._isDeclinedEvent(event);
                const isTentative = this._isTentativeEvent(event);
                
                // Skip events based on type settings
                if (isAllDay && !eventTypes.includes('all-day')) {
                    continue;
                }
                
                if (!isAllDay && !eventTypes.includes('regular')) {
                    continue;
                }
                
                if (isDeclined && !eventTypes.includes('declined')) {
                    continue;
                }
                
                if (isTentative && !eventTypes.includes('tentative')) {
                    continue;
                }
                
                // Get event details
                const title = this._getEventTitle(event);
                const timeRange = this._formatTimeRange(startTime, endTime, showEndTime);
                const link = this._findVideoLink(event);
                
                // Format menu item label based on event type
                let itemLabel = `${title} — ${timeRange}`;
                
                // Create menu item (with or without icon)
                let menuItem;
                if (link) {
                    // Create menu item with video icon and link indicator
                    const linkLabel = `${title} ↗ — ${timeRange}`;
                    menuItem = new PopupMenu.PopupImageMenuItem(
                        linkLabel, 
                        'camera-video-symbolic'
                    );
                    
                    // Add click handler for video meeting links
                    menuItem.connect('activate', () => {
                        try {
                            // Check if we have a service configuration
                            const servicesConfig = this._settings.get_value('meeting-services').deep_unpack();
                            
                            // Always use default browser for now
                            // TODO: Add native app support when possible
                            Gio.AppInfo.launch_default_for_uri(link, null);
                        } catch (e) {
                            log(`Chronome: Error launching URL: ${e}`);
                        }
                    });
                } else {
                    menuItem = new PopupMenu.PopupMenuItem(itemLabel);
                }
                
                // Add style classes based on event type
                if (isPast) {
                    menuItem.add_style_class_name('chronome-past-event');
                    menuItem.setOrnament(PopupMenu.Ornament.NONE);
                } else if (startTime <= now && endTime > now) {
                    // Current event
                    menuItem.add_style_class_name('chronome-current-event');
                    menuItem.setOrnament(PopupMenu.Ornament.DOT);
                }
                
                if (isDeclined) {
                    menuItem.add_style_class_name('chronome-declined-event');
                    if (menuItem.label) {
                        menuItem.label.add_style_class_name('chronome-strike-through');
                    }
                }
                
                if (isTentative) {
                    menuItem.add_style_class_name('chronome-tentative-event');
                    if (menuItem.label) {
                        menuItem.label.add_style_class_name('chronome-italic');
                    }
                }
                
                this.menu.addMenuItem(menuItem);
            } catch (e) {
                log(`Chronome: Error adding menu item: ${e}`);
            }
        }
        
        // Add refresh button
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh'));
        refreshItem.connect('activate', () => {
            this._refreshEvents();
        });
        this.menu.addMenuItem(refreshItem);
        
        // Add settings button
        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings'));
        settingsItem.connect('activate', () => {
            ExtensionUtils.openPrefs();
        });
        this.menu.addMenuItem(settingsItem);
    }
    
    // Format a time range for display (e.g., "9:30 AM - 10:30 AM")
    _formatTimeRange(startTs, endTs, showEndTime = true) {
        try {
            if (!startTs) return '';
            
            const startDate = new Date(startTs);
            const endDate = new Date(endTs || startTs);
            
            // Format options
            const options = { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: this._settings.get_string('time-format') !== '24h'
            };
            
            // Format times
            const startTime = startDate.toLocaleTimeString([], options);
            
            if (showEndTime && endTs) {
                const endTime = endDate.toLocaleTimeString([], options);
                return `${startTime} - ${endTime}`;
            } else {
                return startTime;
            }
        } catch (e) {
            log(`Chronome: Error formatting time range: ${e}`);
            return '';
        }
    }
    
    // Check if an event is an all-day event
    _isAllDayEvent(event) {
        try {
            if (!event) return false;
            
            // All-day events typically have:
            // 1. Start time at midnight
            // 2. Duration divisible by 86400 seconds (24 hours)
            
            const startTime = this._getEventStart(event);
            const endTime = this._getEventEnd(event);
            
            if (!startTime || !endTime) return false;
            
            const startDate = new Date(startTime);
            
            // Check if start time is at midnight
            const isMidnight = startDate.getHours() === 0 && 
                              startDate.getMinutes() === 0 && 
                              startDate.getSeconds() === 0;
            
            // Check if duration is a multiple of 24 hours
            const durationHours = (endTime - startTime) / (1000 * 60 * 60);
            const isDivisibleBy24 = Math.abs(durationHours % 24) < 0.001;
            
            return isMidnight && isDivisibleBy24;
        } catch (e) {
            log(`Chronome: Error checking all-day event: ${e}`);
            return false;
        }
    }
    
    // Check if an event is declined
    _isDeclinedEvent(event) {
        try {
            if (!event) return false;
            
            // Check participant status using ECal 2.0 API
            if (typeof event.get_attendees === 'function') {
                const attendees = event.get_attendees();
                if (attendees && attendees.length > 0) {
                    // Look for our own participation status
                    for (const attendee of attendees) {
                        if (typeof attendee.get_partstat === 'function') {
                            const partstat = attendee.get_partstat();
                            // ECal.ICalParticipationStatus.DECLINED
                            if (partstat === 4) { // DECLINED
                                return true;
                            }
                        }
                    }
                }
            }
            
            // Alternative: check if the event summary contains declined indicators
            const title = this._getEventTitle(event).toLowerCase();
            if (title.includes('declined') || title.includes('rejected')) {
                return true;
            }
            
            return false;
        } catch (e) {
            log(`Chronome: Error checking declined event: ${e}`);
            return false;
        }
    }
    
    // Check if an event is tentative
    _isTentativeEvent(event) {
        try {
            if (!event) return false;
            
            // Check participant status using ECal 2.0 API
            if (typeof event.get_attendees === 'function') {
                const attendees = event.get_attendees();
                if (attendees && attendees.length > 0) {
                    // Look for our own participation status
                    for (const attendee of attendees) {
                        if (typeof attendee.get_partstat === 'function') {
                            const partstat = attendee.get_partstat();
                            // ECal.ICalParticipationStatus.TENTATIVE
                            if (partstat === 3) { // TENTATIVE
                                return true;
                            }
                        }
                    }
                }
            }
            
            // Alternative: check event status or transparency
            if (typeof event.get_status === 'function') {
                const status = event.get_status();
                // ECal.ICalComponentStatus.TENTATIVE
                if (status === 2) { // TENTATIVE
                    return true;
                }
            }
            
            // Check if the event summary contains tentative indicators
            const title = this._getEventTitle(event).toLowerCase();
            if (title.includes('tentative') || title.includes('maybe') || title.includes('?')) {
                return true;
            }
            
            return false;
        } catch (e) {
            log(`Chronome: Error checking tentative event: ${e}`);
            return false;
        }
    }
    
    // Extract event title, handling different API versions
    _getEventTitle(event) {
        try {
            if (!event) return '';
            
            // Get summary from ECal 2.0 API
            if (typeof event.get_summary === 'function') {
                const summary = event.get_summary();
                // Handle if summary is an object with get_value()
                if (summary && typeof summary.get_value === 'function') {
                    return summary.get_value() || _('Untitled event');
                }
                // Handle if summary is a string directly
                if (typeof summary === 'string') {
                    return summary || _('Untitled event');
                }
            }
            
            // Fallback to extracting from full string
            if (typeof event.get_as_string === 'function') {
                const fullString = event.get_as_string();
                // Try to extract SUMMARY from iCal format
                const summaryMatch = /SUMMARY:(.+?)\\n/i.exec(fullString);
                if (summaryMatch && summaryMatch[1]) {
                    return summaryMatch[1] || _('Untitled event');
                }
            }
            
            return _('Untitled event');
        } catch (e) {
            log(`Chronome: Error getting event title: ${e}`);
            return _('Untitled event');
        }
    }
    
    // Get event start time as timestamp
    _getEventStart(event) {
        try {
            if (!event) return 0;
            
            // Get start time using ECal 2.0 API
            if (typeof event.get_dtstart === 'function') {
                const dtStart = event.get_dtstart();
                if (dtStart) {
                    // Handle if dtStart is an object with get_value()
                    if (typeof dtStart.get_value === 'function') {
                        const dtValue = dtStart.get_value();
                        // Different time object representations
                        if (dtValue) {
                            if (typeof dtValue.as_timet === 'function') {
                                return dtValue.as_timet() * 1000; // Convert seconds to ms
                            } else if (typeof dtValue.get_time === 'function') {
                                return dtValue.get_time();
                            }
                        }
                    }
                    // Handle if dtStart has the time directly
                    if (typeof dtStart.as_timet === 'function') {
                        return dtStart.as_timet() * 1000; // Convert seconds to ms
                    } else if (typeof dtStart.get_time === 'function') {
                        return dtStart.get_time();
                    }
                }
            }
            
            // Fallback to current time if we can't parse the start time
            return Date.now();
        } catch (e) {
            log(`Chronome: Error getting event start: ${e}`);
            return Date.now();
        }
    }
    
    // Get event end time as timestamp
    _getEventEnd(event) {
        try {
            if (!event) return 0;
            
            // Get end time using ECal 2.0 API
            if (typeof event.get_dtend === 'function') {
                const dtEnd = event.get_dtend();
                if (dtEnd) {
                    // Handle if dtEnd is an object with get_value()
                    if (typeof dtEnd.get_value === 'function') {
                        const dtValue = dtEnd.get_value();
                        if (dtValue) {
                            if (typeof dtValue.as_timet === 'function') {
                                return dtValue.as_timet() * 1000;
                            } else if (typeof dtValue.get_time === 'function') {
                                return dtValue.get_time();
                            }
                        }
                    }
                    // Handle if dtEnd has the time directly
                    if (typeof dtEnd.as_timet === 'function') {
                        return dtEnd.as_timet() * 1000;
                    } else if (typeof dtEnd.get_time === 'function') {
                        return dtEnd.get_time();
                    }
                }
            }
            
            // If no end time, use start time + 1 hour as fallback
            return this._getEventStart(event) + 3600000;
        } catch (e) {
            log(`Chronome: Error getting event end: ${e}`);
            // Default to start time + 1 hour
            return this._getEventStart(event) + 3600000;
        }
    }
    
    // Find all events from all calendars
    _fetchAllEvents() {
        const events = [];
        
        try {
            // Verify we have the required libraries
            if (!ECal || !EDataServer) {
                log('Chronome: Required libraries not available');
                return events;
            }
            
            // Create or get registry to access calendar sources
            if (!this._registry) {
                this._registry = EDataServer.SourceRegistry.new_sync(null);
                
                // Connect to registry for source changes
                try {
                    this._registryChangedSignalId = this._registry.connect('source-changed', 
                        this._onCalendarSourceChanged.bind(this));
                    this._registryAddedSignalId = this._registry.connect('source-added', 
                        this._onCalendarSourceChanged.bind(this));
                    this._registryRemovedSignalId = this._registry.connect('source-removed', 
                        this._onCalendarSourceChanged.bind(this));
                } catch (e) {
                    log(`Chronome: Error connecting to registry signals: ${e}`);
                }
            }
            
            if (!this._registry) {
                log('Chronome: Could not create source registry');
                return events;
            }
            
            // Get all calendar sources
            const sources = this._registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);
            if (!sources || sources.length === 0) {
                log('Chronome: No calendar sources found');
                return events;
            }
            
            // Filter to user-selected calendars if specified in settings
            const filteredSources = [];
            const enabledCalendars = this._settings.get_strv('enabled-calendars');
            
            if (enabledCalendars.length > 0) {
                // Only include specified calendars
                for (const source of sources) {
                    const uid = source.get_uid();
                    if (enabledCalendars.includes(uid)) {
                        filteredSources.push(source);
                    }
                }
            } else {
                // Include all calendars
                filteredSources.push(...sources);
            }
            
            // Process each calendar source
            for (const source of filteredSources) {
                try {
                    // Skip disabled sources
                    if (!source.get_enabled()) continue;
                    
                    // Connect to calendar
                    let client = null;
                    
                    // Check if we already have this client in our cache
                    const sourceUid = source.get_uid();
                    if (this._clients.has(sourceUid)) {
                        client = this._clients.get(sourceUid);
                    } else {
                        // Create new client
                        client = ECal.Client.new();
                        if (typeof client.connect_sync === 'function') {
                            client = client.connect_sync(
                                source,
                                ECal.ClientSourceType.EVENTS,
                                30,  // Wait up to 30 seconds for connection
                                null
                            );
                            
                            // Connect signals for object changes in this calendar
                            if (client) {
                                // Store client in our cache
                                this._clients.set(sourceUid, client);
                                
                                // Connect to signals for changes
                                this._connectClientSignals(client, sourceUid);
                            }
                        }
                    }
                    
                    // Make sure we got a client
                    if (!client) {
                        log(`Chronome: Could not create ECal client for source ${source.get_display_name()}`);
                        continue;
                    }
                    
                    // Query for events in today's date range for better performance
                    let comps = [];
                    let success = false;
                    
                    try {
                        if (typeof client.get_object_list_as_comps_sync === 'function') {
                            // Create date range query for today
                            const now = new Date();
                            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                            const tomorrowStart = new Date(todayStart);
                            tomorrowStart.setDate(tomorrowStart.getDate() + 1);
                            
                            // Convert to RFC3339 format for EDS query
                            const startStr = todayStart.toISOString().split('T')[0].replace(/-/g, '');
                            const endStr = tomorrowStart.toISOString().split('T')[0].replace(/-/g, '');
                            
                            // Query with date range - fallback to all events if this fails
                            const query = `(occur-in-time-range? (make-time "${startStr}T000000Z") (make-time "${endStr}T000000Z"))`;
                            
                            try {
                                [success, comps] = client.get_object_list_as_comps_sync(query, null);
                            } catch (queryError) {
                                log(`Chronome: Date range query failed, falling back to all events: ${queryError}`);
                                [success, comps] = client.get_object_list_as_comps_sync("#t", null);
                            }
                        }
                        
                        // Add any found components to our events list
                        if (success && comps && comps.length > 0) {
                            events.push(...comps);
                        }
                    } catch (e) {
                        log(`Chronome: Error querying events: ${e}`);
                    }
                } catch (e) {
                    log(`Chronome: Error fetching from calendar ${source.get_display_name()}: ${e}`);
                }
            }
        } catch (e) {
            log(`Chronome: Error fetching events: ${e}`);
        }
        
        return events;
    }
    
    // Filter events to just those occurring today
    _getTodayEvents(allEvents) {
        const todayEvents = [];
        
        try {
            if (!allEvents || !Array.isArray(allEvents)) {
                return todayEvents;
            }
            
            // Get range for "today"
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const tomorrowStart = new Date(todayStart);
            tomorrowStart.setDate(tomorrowStart.getDate() + 1);
            
            // Convert to timestamps for comparison
            const todayStartTs = todayStart.getTime();
            const tomorrowStartTs = tomorrowStart.getTime();
            
            // Filter events
            for (const event of allEvents) {
                try {
                    // Get start and end times
                    const startTs = this._getEventStart(event);
                    const endTs = this._getEventEnd(event);
                    
                    // Skip events without valid times
                    if (!startTs) continue;
                    
                    // Include event if:
                    // 1. It starts before tomorrow AND
                    // 2. It ends on or after the start of today
                    if (startTs < tomorrowStartTs && endTs >= todayStartTs) {
                        todayEvents.push(event);
                    }
                } catch (e) {
                    log(`Chronome: Error processing event for today filter: ${e}`);
                }
            }
        } catch (e) {
            log(`Chronome: Error filtering today's events: ${e}`);
        }
        
        return todayEvents;
    }
    
    // Get the next upcoming meeting
    _getNextMeeting(events) {
        try {
            if (!events || !Array.isArray(events) || events.length === 0) {
                return null;
            }
            
            const now = Date.now();
            
            // Filter out declined events from consideration for "next meeting"
            const relevantEvents = events.filter(evt => {
                // Skip declined events unless specifically enabled
                if (this._isDeclinedEvent(evt)) {
                    const eventTypes = this._settings.get_strv('event-types');
                    if (!eventTypes.includes('declined')) {
                        return false;
                    }
                }
                return true;
            });
            
            // First check for currently ongoing meetings if enabled in settings
            if (this._settings.get_boolean('show-current-meeting')) {
                const currentEvents = relevantEvents.filter(evt => {
                    const start = this._getEventStart(evt);
                    const end = this._getEventEnd(evt);
                    return start <= now && end > now;
                });
                
                if (currentEvents.length > 0) {
                    // Sort by end time (to show the one ending soonest)
                    currentEvents.sort((a, b) => {
                        return this._getEventEnd(a) - this._getEventEnd(b);
                    });
                    return currentEvents[0];
                }
            }
            
            // Find upcoming events
            const upcomingEvents = relevantEvents.filter(evt => {
                const start = this._getEventStart(evt);
                return start > now;
            });
            
            if (upcomingEvents.length === 0) {
                return null;
            }
            
            // Sort by start time (earliest first)
            upcomingEvents.sort((a, b) => {
                return this._getEventStart(a) - this._getEventStart(b);
            });
            
            return upcomingEvents[0];
        } catch (e) {
            log(`Chronome: Error getting next meeting: ${e}`);
            return null;
        }
    }
    
    // Find a video conferencing link in an event
    _findVideoLink(event) {
        try {
            if (!event) return null;
            
            // Texts to search in
            let searchTexts = [];
            
            // Try to get location
            try {
                if (typeof event.get_location === 'function') {
                    const loc = event.get_location();
                    if (loc) {
                        // Handle if location is an object with get_value()
                        if (typeof loc.get_value === 'function') {
                            searchTexts.push(loc.get_value() || '');
                        } else if (typeof loc === 'string') {
                            searchTexts.push(loc);
                        }
                    }
                }
            } catch (e) {
                log(`Chronome: Error getting location: ${e}`);
            }
            
            // Try to get description
            try {
                if (typeof event.get_description === 'function') {
                    const desc = event.get_description();
                    if (desc) {
                        // Handle if description is an object with get_value()
                        if (typeof desc.get_value === 'function') {
                            searchTexts.push(desc.get_value() || '');
                        } else if (typeof desc === 'string') {
                            searchTexts.push(desc);
                        }
                    }
                }
            } catch (e) {
                log(`Chronome: Error getting description: ${e}`);
            }
            
            // If we couldn't get anything specific, try the full event string
            if (searchTexts.length === 0 && typeof event.get_as_string === 'function') {
                searchTexts.push(event.get_as_string() || '');
            }
            
            // Combine all texts for searching
            const fullText = searchTexts.join(' ');
            
            // Check each regex pattern
            for (const pattern of MEETING_URL_PATTERNS) {
                const match = fullText.match(pattern);
                if (match && match[0]) {
                    return match[0];
                }
            }
            
            return null;
        } catch (e) {
            log(`Chronome: Error finding video link: ${e}`);
            return null;
        }
    }
    
    // Connect signals to a calendar client
    _connectClientSignals(client, sourceUid) {
        if (!client) return;
        
        try {
            // Store signal IDs for cleanup
            if (!this._clientSignals) {
                this._clientSignals = new Map();
            }
            
            // Array to store signal connection IDs for this client
            const signals = [];
            
            // Connect to object-added signal
            if (typeof client.connect === 'function') {
                try {
                    // Object added signal
                    const addedId = client.connect('objects-added', 
                        this._onCalendarObjectsChanged.bind(this));
                    signals.push(addedId);
                } catch (e) {
                    log(`Chronome: Error connecting objects-added: ${e}`);
                }
                
                try {
                    // Object modified signal
                    const modifiedId = client.connect('objects-modified', 
                        this._onCalendarObjectsChanged.bind(this));
                    signals.push(modifiedId);
                } catch (e) {
                    log(`Chronome: Error connecting objects-modified: ${e}`);
                }
                
                try {
                    // Object removed signal
                    const removedId = client.connect('objects-removed', 
                        this._onCalendarObjectsChanged.bind(this));
                    signals.push(removedId);
                } catch (e) {
                    log(`Chronome: Error connecting objects-removed: ${e}`);
                }
            }
            
            // Store signal IDs
            if (signals.length > 0) {
                this._clientSignals.set(sourceUid, signals);
            }
        } catch (e) {
            log(`Chronome: Error connecting client signals: ${e}`);
        }
    }
    
    // Handler for calendar source changes
    _onCalendarSourceChanged() {
        log('Chronome: Calendar source changed, refreshing events');
        this._refreshEvents();
    }
    
    // Handler for calendar objects changes
    _onCalendarObjectsChanged() {
        log('Chronome: Calendar objects changed, refreshing events');
        this._refreshEvents();
    }
    
    // Disconnect all signals
    _disconnectSignals() {
        try {
            // Disconnect registry signals
            if (this._registry) {
                if (this._registryChangedSignalId) {
                    this._registry.disconnect(this._registryChangedSignalId);
                    this._registryChangedSignalId = null;
                }
                if (this._registryAddedSignalId) {
                    this._registry.disconnect(this._registryAddedSignalId);
                    this._registryAddedSignalId = null;
                }
                if (this._registryRemovedSignalId) {
                    this._registry.disconnect(this._registryRemovedSignalId);
                    this._registryRemovedSignalId = null;
                }
            }
            
            // Disconnect client signals
            if (this._clientSignals && this._clients) {
                for (const [sourceUid, signalIds] of this._clientSignals.entries()) {
                    const client = this._clients.get(sourceUid);
                    if (client) {
                        for (const signalId of signalIds) {
                            try {
                                client.disconnect(signalId);
                            } catch (e) {
                                log(`Chronome: Error disconnecting signal ${signalId}: ${e}`);
                            }
                        }
                    }
                }
                this._clientSignals.clear();
            }
        } catch (e) {
            log(`Chronome: Error disconnecting signals: ${e}`);
        }
    }
    
    destroy() {
        // Disconnect all signals
        this._disconnectSignals();
        
        // Clear client cache
        if (this._clients) {
            this._clients.clear();
            this._clients = null;
        }
        
        // Clear registry
        this._registry = null;
        
        // Stop refresh timer
        this.stopTimer();
        
        // Call parent destroy
        super.destroy();
    }
}

// Extension instance (set in enable, cleared in disable)
let _chronomeIndicator = null;
let _settings = null;

// Initialize translation
function init() {
    ExtensionUtils.initTranslations();
    return {
        enable: enable,
        disable: disable
    };
}

// Enable the extension
function enable() {
    log('Chronome: enabling');
    
    // Initialize settings
    _settings = Convenience.getSettings();
    
    // Load CSS
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    if (theme) {
        theme.load_stylesheet(Me.path + '/stylesheet.css');
    }
    
    // Create the indicator
    _chronomeIndicator = new ChronomeIndicator(_settings);
    
    // Add to panel (right side)
    Main.panel.addToStatusArea('chronome-indicator', _chronomeIndicator);
    
    // Start refresh timer
    _chronomeIndicator.startTimer();
    
    log('Chronome: enabled');
}

// Disable the extension
function disable() {
    log('Chronome: disabling');
    
    // Unload CSS
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    if (theme) {
        theme.unload_stylesheet(Me.path + '/stylesheet.css');
    }
    
    // Stop and destroy indicator
    if (_chronomeIndicator) {
        _chronomeIndicator.stopTimer();
        _chronomeIndicator.destroy();
        _chronomeIndicator = null;
    }
    
    // Clean up settings
    _settings = null;
    
    log('Chronome: disabled');
}