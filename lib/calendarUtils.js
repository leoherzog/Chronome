// calendar handling utilities for EDS

import EDataServer from 'gi://EDataServer?version=1.2';

/**
 * Get the color associated with a calendar source.
 * @param {EDataServer.Source} source - The calendar source
 * @returns {string|null} The calendar color as hex string (e.g., "#1E90FF"), or null if not found
 */
export function getCalendarColor(source) {
    if (!source.has_extension(EDataServer.SOURCE_EXTENSION_CALENDAR))
        return null;
    return source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR).get_color?.() || null;
}

/**
 * Get the account email address associated with a calendar source.
 * This is the email of the authenticated user who owns/has access to this calendar.
 * @param {EDataServer.Source} source - The calendar source
 * @param {EDataServer.SourceRegistry} registry - The source registry
 * @returns {string|null} The account email in lowercase, or null if not found
 */
export function getAccountEmailForSource(source, registry) {
    // Try WebDAV backend extension first (most reliable for CalDAV)
    if (source.has_extension(EDataServer.SOURCE_EXTENSION_WEBDAV_BACKEND)) {
        const email = source.get_extension(EDataServer.SOURCE_EXTENSION_WEBDAV_BACKEND).get_email_address?.();
        if (email) return email.toLowerCase();
    }

    // Try Authentication extension
    if (source.has_extension(EDataServer.SOURCE_EXTENSION_AUTHENTICATION)) {
        const user = source.get_extension(EDataServer.SOURCE_EXTENSION_AUTHENTICATION).get_user?.();
        if (user?.includes('@')) return user.toLowerCase();
    }

    // Try parent source's Collection extension (for GOA accounts)
    const parentUid = source.get_parent?.();
    if (parentUid && parentUid !== 'local-stub' && registry) {
        const parentSource = registry.ref_source(parentUid);
        if (parentSource?.has_extension(EDataServer.SOURCE_EXTENSION_COLLECTION)) {
            const identity = parentSource.get_extension(EDataServer.SOURCE_EXTENSION_COLLECTION).get_identity?.();
            if (identity?.includes('@')) return identity.toLowerCase();
        }
    }

    return null;
}

/**
 * Get the canonical calendar ID from a source (extracted from WebDAV resource path).
 * For Google Calendar, the path is like: /caldav/v2/{calendar-id}/events/
 * @param {EDataServer.Source} source - The calendar source
 * @returns {string|null} The calendar ID in lowercase, or null if not found
 */
export function getCalendarIdForSource(source) {
    if (!source.has_extension(EDataServer.SOURCE_EXTENSION_WEBDAV_BACKEND))
        return null;
    const resourcePath = source.get_extension(EDataServer.SOURCE_EXTENSION_WEBDAV_BACKEND).get_resource_path?.();
    if (!resourcePath) return null;
    // Extract calendar ID from path like /caldav/v2/{calendar-id}/events/
    const match = resourcePath.match(/\/caldav\/v2\/([^/]+)\/events\/?/);
    return match ? decodeURIComponent(match[1]).toLowerCase() : null;
}

/**
 * Calculate privilege score for a calendar source.
 * Higher score = more privileged access.
 * @param {string|null} calendarId - The calendar ID
 * @param {string|null} accountEmail - The account email
 * @param {boolean} isReadonly - Whether the calendar is read-only
 * @returns {number} Score: 3 = owner, 2 = can edit, 1 = read-only/unknown
 */
export function getCalendarPrivilegeScore(calendarId, accountEmail, isReadonly = true) {
    // Owner check: account email matches calendar ID (for primary calendars)
    if (calendarId && accountEmail && calendarId === accountEmail) {
        return 3; // Owner - highest privilege
    }

    // Edit vs read-only
    if (!isReadonly) {
        return 2; // Can edit
    }

    return 1; // Read-only or unknown
}

/**
 * Deduplicate calendar sources by calendar ID, keeping the one with highest privilege.
 * When a calendar is shared between accounts (e.g., personal calendar shared with work account),
 * this keeps only the owner's version to avoid duplicate events.
 * @param {EDataServer.Source[]} sources - Array of calendar sources
 * @param {EDataServer.SourceRegistry} registry - The source registry
 * @param {Map<string, boolean>} [readonlyMap] - Optional map of sourceUid -> isReadonly
 * @returns {EDataServer.Source[]} Deduplicated array of sources
 */
export function deduplicateSources(sources, registry, readonlyMap = null) {
    const groupedByCalId = new Map();
    const result = [];

    for (const source of sources) {
        const calendarId = getCalendarIdForSource(source);

        if (!calendarId) {
            result.push(source);
            continue;
        }

        const uid = source.get_uid();
        const accountEmail = getAccountEmailForSource(source, registry);
        const isReadonly = readonlyMap?.get(uid) ?? true;
        const score = getCalendarPrivilegeScore(calendarId, accountEmail, isReadonly);

        const existing = groupedByCalId.get(calendarId);
        if (!existing || score > existing.bestScore) {
            groupedByCalId.set(calendarId, { bestScore: score, bestSource: source });
        }
    }

    for (const { bestSource } of groupedByCalId.values()) {
        result.push(bestSource);
    }

    return result;
}
