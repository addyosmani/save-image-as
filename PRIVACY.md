# Privacy Policy — SaveImage

**Last updated: 13 August 2026**

SaveImage does not collect, store, transmit, or sell any personal data.

## What the extension does with data

SaveImage runs entirely on your own computer. There is no backend, no account, no
telemetry, and no analytics. The developer receives nothing about you or your browsing.

| Data | What happens to it |
| --- | --- |
| The image you right-click | Downloaded from the site hosting it, decoded, re-encoded, written to your Downloads folder. It is never sent anywhere else. |
| Your settings (quality, filename template, save location) | Stored in `chrome.storage.sync`, which is Chrome's own profile sync. Only your browser and your Google account have it; the developer has no access. |
| Browsing history, page contents, credentials | Not read, not collected, not transmitted. |

## Network requests

The extension makes exactly one kind of network request: fetching the image you asked it
to save, from the server already hosting it.

When the *"Fetch the highest-quality source available"* setting is on, that request may go
to a slightly different URL on the **same host** — the page's own largest `srcset`
candidate, or the untransformed original of a Cloudinary-hosted image. It is still a
request for the same picture on the same server. No third party is contacted.

There are no requests to any developer-controlled server, analytics provider, CDN, or font
service. All code and assets ship inside the extension package.

## Permissions and why they exist

| Permission | Reason |
| --- | --- |
| `contextMenus` | Adds the "Save Image As..." entry to the right-click menu. |
| `downloads` | Writes the converted file to your Downloads folder. |
| `storage` | Remembers your quality and save-location preferences. |
| `offscreen` | Creates the hidden document that decodes and re-encodes the image. |
| `scripting` | Reads an image's `srcset` to find a higher-resolution version, and asks the page to fetch images the extension cannot reach directly (such as `blob:` URLs). Injected only when you invoke the menu, never automatically. |
| `notifications` | Reports a failed save. |
| `<all_urls>` | Images can be on any site, so the extension must be able to fetch from whichever site you are on. It is used only to retrieve the specific image you right-clicked. |

## Third parties

None. No data is shared with, or sold to, anyone.

## Changes

Any change to this policy will be committed to this repository, and the date above
updated.

## Contact

Open an issue at https://github.com/addyosmani/save-image-as/issues
