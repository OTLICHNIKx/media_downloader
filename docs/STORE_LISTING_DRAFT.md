# Chrome Web Store listing draft

## Name

Open Media Downloader

## Short description

Find open media streams on pages and save files you are allowed to keep.

## Full description

Open Media Downloader helps you detect media streams available on the current page and save accessible files for personal, permitted use.

It can find direct audio/video links, open HLS streams, DASH audio streams, and page-level media items exposed by supported sites. The extension also includes a panel for reviewing detected streams, copying URLs, opening HLS/DASH tools, and managing downloads.

The extension is intended for content you own, content that is openly downloadable, or content you otherwise have permission to save. It does not bypass DRM, paid access, login restrictions, or platform protections.

## Suggested feature bullets

- Detects direct audio and video media links.
- Shows detected streams in a clean panel.
- Supports open HLS and DASH stream workflows.
- Can hide page buttons per site.
- Runs locally in the browser.

## Permission justification draft

### downloads
Required to save user-selected media files through the browser download manager.

### storage
Required to remember per-site UI preferences, such as hiding download buttons on selected sites.

### activeTab
Required to work with the currently active page when the user opens the popup or panel.

### scripting
Required to communicate with and scan the current page for media elements.

### webRequest
Required to detect media stream requests initiated by pages, including open HLS/DASH manifests.

### host permissions: all URLs
Required because the extension is a general media detection tool and can be used on different user-selected sites. Consider narrowing this before public release or explaining it clearly in review notes.

## Review notes draft

Open Media Downloader detects media streams locally in the browser and allows users to save media they are allowed to keep. It does not include remote code execution and does not bypass DRM or paid access. The packaged ffmpeg/wasm files are bundled with the extension and used locally for supported stream conversion workflows.
