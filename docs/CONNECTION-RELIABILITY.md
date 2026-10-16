# Connection and clipboard reliability

## Root causes addressed

- Every signaling interruption (including the deployed Edge worker's normal 110-second rotation) destroyed a healthy WebRTC DataChannel. Foregrounding the optional account workspace also recreated its peer.
- Signaling and RTC retries stopped after eight attempts. A half-open socket could appear connected indefinitely, and a transient authorization request failure was confused with explicit revocation in legacy account mode.
- Sending required a live connection. Closing a channel rejected and discarded every unacknowledged update. Extension capture also dropped copies while offline or while another copy awaited its receipt.
- Approved guest capabilities lived only in memory. Reloads or offscreen-helper recreation lost the pairing.
- Deduplication was memory-only and connection-scoped; there was no persistent ordering watermark to stop an older queued clipboard from replacing a newer local or remote copy.

## Changes

- Retain healthy RTC links through signaling reconnects. Refresh authorization before resuming delivery; explicit expiry/revocation still stops delivery. Rebuild failed RTC paths automatically with bounded exponential backoff and jitter, without an arbitrary retry-count cutoff.
- Detect half-open WSS sockets with timed authenticated checks. Resume on network return, visibility, pageshow, and supported page-resume events, without resetting a healthy connection.
- Use a bounded local outbox (32 updates / 256 KiB per pair, individual text under 16 KiB). Persist before accepting an outbound update. Preserve immutable IDs and capture-order stamps across RTC reconnections, retry missing acknowledgements, and remove an entry only after its peer acknowledgement is persisted.
- Persist a receive/local-copy watermark, so duplicate retries are re-acknowledged without reapplying and stale queued updates do not overwrite newer clipboard state. Same-time copies use a monotonic sequence and deterministic device/ID tie break. This is a latest-clipboard conflict policy, not a merge of concurrent edits. Device clocks should be reasonably accurate; messages more than 30 seconds in the future are rejected.
- Restore approved, unexpired capabilities and outboxes from PWA sessionStorage or extension chrome.storage.session. Proofs/QR secrets are not retained. Scope restoration to the exact signaling endpoint, service, session, local device and peer. Original five-minute bootstrap and two-hour approved-session expiry/revocation remain enforced; no permanent trust is created.
- Capture copy events inside the PWA automatically and serialize extension capture without waiting on network acknowledgement. Password fields are excluded. Optional PC clipboard polling remains opt-in and can queue during outages. Echo suppression remains active.
- Retain the MV3 offscreen document for WebRTC/clipboard support. A one-minute extension alarm can recreate a missing helper and restore its still-valid browser-session pairing. It does not keep a terminated browser alive. Capture/settings changes do not unnecessarily recreate a healthy peer.
- Preserve receiving in memory if local recovery storage fails. Outbound persistence failures or full queues are reported rather than claiming the copy was safely queued. Clear pending state on explicit disconnect or terminal guest-session expiry/revocation.

## Platform limits

- A website/PWA cannot guarantee an active WebRTC connection or system-clipboard monitoring while a phone is locked, the OS suspends the app, or the browser is killed. No audio, video, timer, wake-lock, or service-worker keepalive hack is used. Resume recovery runs when the browser permits execution again.
- Background Sync is a finite service-worker request/retry API, not an always-on WebRTC or DOM clipboard runtime. No clipboard is uploaded to a server queue to simulate background P2P delivery.
- PWA sessionStorage survives reloads and supported browser session restoration, not every closed-tab/new-window or OS restart. Extension session storage survives worker/helper recreation, not a full browser restart, extension reload/update, or uninstall. If the platform discards recovery storage or the two-hour session expires, pair again. Storage is local plaintext within that browser session; avoid shared devices.
- Automatic receiving updates the app immediately. Reading a phone's system clipboard and writing it without an activation are restricted by browser permissions. Copy/Sync buttons remain available where a user gesture is required; copying elsewhere on a phone cannot be universally observed by a PWA.
- No delivery is promised while both endpoints cannot execute. Pending updates retry on recovery within the original session expiry. Explicit pause disables capture/delivery until resumed. Restrictive networks still require configured TURN credentials.

## Verification

Automated tests cover retained healthy peers, offline queues/rapid copies, lost acknowledgements and deduplication across rebuilt RTC channels, persisted outbox restoration, stale-write rejection after reload, queue bounds/storage errors, capability resume/revocation, more than eight automatic reconnect failures, half-open WSS detection, and stop-during-setup races. Browser acceptance uses real WebRTC and the live capability-authenticated signaling endpoint; physical locked-screen, Android/iOS, and personal extension installation checks are reported separately rather than simulated as completed.

References: [Chrome page lifecycle](https://developer.chrome.com/docs/web-platform/page-lifecycle-api), [MV3 worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API), [sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage), [Background Sync](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API).
