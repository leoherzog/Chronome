// Loaded only by the spawned Chronome D-Bus service process (see service.js).

// EDS `*_finish` functions return `gboolean ok` plus the real value as an
// out-arg. GJS's Gio._promisify strips that leading success boolean, so a
// promisified `gboolean fn(out X)` resolves to `[X]` -- not `[ok, X]` like the
// matching `*_sync` call returns. (One GJS version was also seen to keep
// `[ok, X]`.) Normalize both shapes to just `X`.
export function unwrapAsyncResult(result) {
    if (!Array.isArray(result))
        return result;
    return typeof result[0] === 'boolean' ? result[1] : result[0];
}
