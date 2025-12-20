// calendar handling utilities for EDS

import EDataServer from 'gi://EDataServer?version=1.2';

/**
 * Get the color associated with a calendar source.
 * @param {EDataServer.Source} source - The calendar source
 * @returns {string|null} The calendar color as hex string (e.g., "#1E90FF"), or null if not found
 */
export function getCalendarColor(source) {
    try {
        if (source.has_extension(EDataServer.SOURCE_EXTENSION_CALENDAR)) {
            const calExt = source.get_extension(EDataServer.SOURCE_EXTENSION_CALENDAR);
            const color = calExt.get_color?.();
            if (color) {
                return color;
            }
        }
    } catch (e) {
        // Ignore errors
    }
    return null;
}

/**
 * Get the account email address associated with a calendar source.
 * This is the email of the authenticated user who owns/has access to this calendar.
 * @param {EDataServer.Source} source - The calendar source
 * @param {EDataServer.SourceRegistry} registry - The source registry
 * @returns {string|null} The account email in lowercase, or null if not found
 */
export function getAccountEmailForSource(source, registry) {
    try {
        // Try WebDAV backend extension first (most reliable for CalDAV)
        if (source.has_extension(EDataServer.SOURCE_EXTENSION_WEBDAV_BACKEND)) {
            const webdavExt = source.get_extension(EDataServer.SOURCE_EXTENSION_WEBDAV_BACKEND);
            const email = webdavExt.get_email_address?.();
            if (email) return email.toLowerCase();
        }

        // Try Authentication extension
        if (source.has_extension(EDataServer.SOURCE_EXTENSION_AUTHENTICATION)) {
            const authExt = source.get_extension(EDataServer.SOURCE_EXTENSION_AUTHENTICATION);
            const user = authExt.get_user?.();
            if (user && user.includes('@')) return user.toLowerCase();
        }

        // Try parent source's Collection extension (for GOA accounts)
        const parentUid = source.get_parent?.();
        if (parentUid && parentUid !== 'local-stub' && registry) {
            const parentSource = registry.ref_source(parentUid);
            if (parentSource?.has_extension(EDataServer.SOURCE_EXTENSION_COLLECTION)) {
                const collExt = parentSource.get_extension(EDataServer.SOURCE_EXTENSION_COLLECTION);
                const identity = collExt.get_identity?.();
                if (identity && identity.includes('@')) return identity.toLowerCase();
            }
        }
    } catch (e) {
        // Ignore errors
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
    try {
        if (source.has_extension(EDataServer.SOURCE_EXTENSION_WEBDAV_BACKEND)) {
            const webdavExt = source.get_extension(EDataServer.SOURCE_EXTENSION_WEBDAV_BACKEND);
            const resourcePath = webdavExt.get_resource_path?.();
            if (resourcePath) {
                // Extract calendar ID from path like /caldav/v2/{calendar-id}/events/
                const match = resourcePath.match(/\/caldav\/v2\/([^/]+)\/events\/?/);
                if (match) {
                    return decodeURIComponent(match[1]).toLowerCase();
                }
            }
        }
    } catch (e) {
        // Ignore errors
    }
    return null;
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
    // Build metadata for each source
    const sourceMetadata = new Map();
    for (const source of sources) {
        const uid = source.get_uid();
        const calendarId = getCalendarIdForSource(source);
        const accountEmail = getAccountEmailForSource(source, registry);
        const isReadonly = readonlyMap?.get(uid) ?? true;
        const score = getCalendarPrivilegeScore(calendarId, accountEmail, isReadonly);

        sourceMetadata.set(uid, { source, calendarId, accountEmail, score });
    }

    // Group by calendar ID
    const calendarGroups = new Map();
    const noCalendarId = [];

    for (const [uid, meta] of sourceMetadata) {
        if (meta.calendarId) {
            if (!calendarGroups.has(meta.calendarId)) {
                calendarGroups.set(meta.calendarId, []);
            }
            calendarGroups.get(meta.calendarId).push({ uid, ...meta });
        } else {
            noCalendarId.push(meta.source);
        }
    }

    // Select best source for each calendar ID (highest privilege score)
    const result = [...noCalendarId];

    for (const [calendarId, group] of calendarGroups) {
        if (group.length === 1) {
            result.push(group[0].source);
        } else {
            // Pick highest score (owner > editor > readonly)
            group.sort((a, b) => b.score - a.score);
            result.push(group[0].source);
        }
    }

    return result;
}
