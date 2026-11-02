# Folio Bridge

This extension reads X bookmark data for Folio in the currently selected Chrome profile. It does not create or navigate tabs. In Chrome, open `chrome://extensions`, enable Developer mode, and choose “Load unpacked” to select this folder. During import, enter the one-time connection code shown by Folio in the extension popup. A new code is required after Folio restarts.

The extension connects only to Folio at `127.0.0.1`, and it sends requests only to `https://x.com`. Cookies and CSRF values remain inside Chrome. It can remove a bookmark only when the user explicitly requests it in Folio and the current X account matches the library. It cannot post or delete tweets, and it never removes bookmarks automatically. X's undocumented interfaces and extension-origin requests may change or be rejected; Folio will report failure instead of opening tabs or falling back to a different collector.

The request feature flags and operation IDs are adapted from OpenCLI, Apache-2.0: https://github.com/jackwener/OpenCLI
