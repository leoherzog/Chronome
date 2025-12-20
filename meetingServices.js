// Regex patterns for video conferencing URLs
// Thanks MeetingBar
// https://github.com/leits/MeetingBar/blob/master/MeetingBar/Services/MeetingServices.swift#L264

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
    /https:\/\/([a-z0-9-.]+)?ovice\.(in|com)\/[^\s]*/i,
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
    /https?:\/\/meetings\.conf\.meetecho\.com\/.+/i,
    // StreamYard
    /https:\/\/(?:www\.)?streamyard\.com\/(?:guest\/)?[a-z0-9]{8,13}(?:\/|\?[^ \n]*)?/i,
];

/**
 * Find a video conferencing link in text
 * @param {string} text - Text to search for meeting URLs
 * @returns {string|null} - The first matching meeting URL or null
 */
export function findMeetingUrl(text) {
    if (!text) return null;

    for (const pattern of MEETING_URL_PATTERNS) {
        const match = text.match(pattern);
        if (match && match[0]) {
            return match[0];
        }
    }

    return null;
}
