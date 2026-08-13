# Chrome Web Store listing

Copy-paste source for the developer dashboard. Keep this in sync with `manifest.json`.

---

## Item name

```
SaveImage — save any image as JPEG, PNG or WebP
```

*(47 / 75 characters. Must match `manifest.name`.)*

## Short description

```
Right-click any image to save it as JPEG, PNG or WebP. Re-encoding happens on your own machine, at a quality you choose.
```

*(120 / 132 characters. Must match `manifest.description`.)*

## Category

`Productivity` → Workflow & Planning

## Language

English (United Kingdom)

---

## Detailed description

```
Right-click any image on the web and save it in the format you actually need — JPEG, PNG or
WebP — instead of whatever the site happened to serve.

Everything happens on your own computer. There is no account, no upload, no server, and no
analytics.


HOW IT WORKS

  1. Right-click any image on any page.
  2. Choose "Save Image As..." and pick a format.
  3. The converted file lands in your Downloads folder.

There is also "Original file (no conversion)", which downloads exactly the bytes the server
sent — untouched, metadata and animation intact.


WHAT MAKES IT DIFFERENT

• It converts from the best source it can find.
  The picture displayed on a page is often a shrunken, already-compressed derivative.
  Converting that to PNG just gives you a lossless copy of a thumbnail. SaveImage follows
  the page's own srcset to the largest version available, and on Cloudinary-hosted images
  requests the untransformed original rather than the resized copy. If neither works, it
  falls back to the visible image.

• A .webp file is always genuinely WebP.
  Chrome does not report an error when asked for a format it cannot encode — it quietly
  returns a PNG instead. Extensions that trust it can write a file whose contents disagree
  with its extension. SaveImage tests each encoder once at install time, and verifies every
  single conversion against its real file type before saving. Formats your browser cannot
  encode never appear in the menu at all.

• It skips the conversion when it would only cause harm.
  Saving a PNG as a PNG copies the original bytes rather than pushing them through another
  encode, so you keep the metadata and avoid a second generation of loss.

• The details are handled properly.
  EXIF orientation is respected, so photos are not saved sideways. Transparency is flattened
  onto a colour you choose before the image is resized, which avoids the dark fringing that
  otherwise appears around edges. Downscaling is done in steps, so fine detail survives.
  SVG images are rasterised at a useful size.


SETTINGS

• Quality per format, and a size cap for the longest side
• Filename templates: {name} {ext} {w} {h} {date} {time} {host}
• Save to Downloads, be asked each time, or use a named subfolder
• The colour that replaces transparency when saving as JPEG
• Optional notifications


PRIVACY

No data is collected, stored or transmitted. The extension makes one kind of network
request: fetching the image you asked it to save, from the site already hosting it. There
are no requests to any developer server, analytics service or font provider.

Free and open source under the MIT licence. Read every line:
https://github.com/addyosmani/save-image-as
```

---

## Privacy practices tab

**Single purpose**

```
SaveImage converts an image the user right-clicks into a chosen image format (JPEG, PNG or
WebP) and saves it to the user's Downloads folder. That is its only function.
```

**Permission justifications**

| Field | Justification |
| --- | --- |
| `contextMenus` | Adds the "Save Image As..." item to the right-click menu on images. This is the extension's only entry point. |
| `downloads` | Writes the converted image file to the user's Downloads folder. The extension has no other way to deliver its output. |
| `storage` | Persists the user's own preferences — per-format quality, filename template, save location and size cap — so they do not have to be re-entered. No browsing data is stored. |
| `offscreen` | Image decoding and re-encoding require a canvas and `URL.createObjectURL`, neither of which exists in an MV3 service worker. An offscreen document performs the conversion and creates the blob URL passed to `chrome.downloads`. |
| `scripting` | Injected only in response to the user choosing the menu item, on the tab they used it in. It does two things: reads the clicked `<img>` element's `srcset` to find a higher-resolution version of the same image, and, when the extension cannot fetch a URL itself (`blob:` URLs exist only inside the page's own origin), asks the page to fetch those bytes. No page content is read or transmitted. |
| `notifications` | Shows a message when a save fails, so a failure is not silent. Success notifications are off by default. |
| `host_permissions` (`<all_urls>`) | Images the user wants to save can be hosted on any domain, and the image's host is frequently a different domain from the page it appears on (CDNs). The extension needs to fetch the specific image the user right-clicked, wherever it lives. It is used for nothing else: no content scripts run automatically, and no page data is read or sent anywhere. |

**Remote code**: No. All JavaScript, CSS and images are contained in the package.

**Data usage** — tick nothing. The extension collects none of the listed categories
(personally identifiable information, health, financial, authentication, personal
communications, location, web history, user activity, website content).

Confirm all three certifications:
- Data is not sold to third parties ✔
- Data is not used for purposes unrelated to the item's single purpose ✔
- Data is not used to determine creditworthiness or for lending ✔

**Privacy policy URL**

```
https://github.com/addyosmani/save-image-as/blob/main/PRIVACY.md
```

---

## Graphic assets

| Asset | Size | File | Required |
| --- | --- | --- | --- |
| Store icon | 128×128 | `icons/icon128.png` | Yes |
| Screenshot 1 | 1280×800 | `store/screenshots/1-context-menu.png` | Yes (≥1) |
| Screenshot 2 | 1280×800 | `store/screenshots/2-popup.png` | |
| Screenshot 3 | 1280×800 | `store/screenshots/3-original-source.png` | |
| Screenshot 4 | 1280×800 | `store/screenshots/4-format-verification.png` | |
| Screenshot 5 | 1280×800 | `store/screenshots/5-settings.png` | |
| Small promo tile | 440×280 | `store/promo/small-tile-440x280.png` | Optional |
| Marquee promo tile | 1400×560 | `store/promo/marquee-1400x560.png` | Optional |

Regenerate them all with `tools/make-store-assets.sh` — the scenes are composed from the
real extension UI, so they cannot drift out of date.

## Upload package

`tools/package.sh` → `dist/save-image-as-v<version>.zip` (runtime files only).
