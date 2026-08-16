# Chrome Web Store listing

**Published and live.** v1.0.0 cleared review on 17 August 2026.

| | |
| --- | --- |
| Listing | https://chromewebstore.google.com/detail/saveimageas-save-images-a/oeehjomgmadhlpdfckeblmfpiimlcpfp |
| Item ID | `oeehjomgmadhlpdfckeblmfpiimlcpfp` |
| Dashboard | https://chrome.google.com/webstore/devconsole/94f6cdcd-77cc-4c76-bf6e-b084bfd4b83f |

Everything below is the copy currently on the listing. It is kept here so an update can be
reviewed in a diff rather than retyped into the dashboard, and it must stay in sync with
`manifest.json`. Note that a version bump touching permissions puts the item back into the
in-depth review queue, so expect the same wait as the first submission.

---

## Store listing tab

### Item name

```
SaveImageAs: Save images as JPEG, PNG or WebP
```

45 of 75 characters. Must match `manifest.name`.

### Short description

```
Right-click any image and save it as JPEG, PNG or WebP. The conversion runs on your own computer, at a quality you set.
```

118 of 132 characters. Must match `manifest.description`.

### Category

Productivity → Workflow & Planning

### Language

English (United Kingdom)

### Detailed description

```
Right-click an image, choose a format, and it saves. JPEG, PNG or WebP.

The conversion runs on your computer. There is no account to create, nothing is uploaded, and no
server is involved.


WHY NOT JUST USE CHROME'S OWN SAVE IMAGE AS

Chrome saves whatever the site sent, in whatever format it happens to be in. If you need a PNG
and the page serves WebP, you end up on a converter site or opening an image editor. This skips
that step.


IT CONVERTS FROM THE RIGHT SOURCE

Pages usually display a shrunk, re-compressed copy of a much better original. Converting that to
PNG only gets you a lossless copy of a thumbnail, which is not what anyone wants.

So it looks for something better first. It reads the page's srcset and takes the largest version
listed there. On Cloudinary-hosted images it strips the resize and quality parameters out of the
URL, which makes Cloudinary hand back the original upload instead of the derivative. If neither
of those works it falls back to the image you can see, so you are never worse off than before.


A .WEBP FILE WILL ACTUALLY BE WEBP

Chrome has an awkward quirk here. Ask it to encode a format it does not support and it hands
back a PNG without raising an error. Extensions that do not check for this write PNG bytes into
a file called something.avif, and you only find out weeks later when a program refuses to open
it.

SaveImageAs tests every encoder once when it installs, then checks each conversion against the
real file type before anything gets written. Formats your browser cannot encode never appear in
the menu.


SOMETIMES THE RIGHT ANSWER IS NOT TO CONVERT

Saving a PNG as a PNG copies the file as it is instead of putting it through another encode. The
metadata survives and you avoid a second round of loss for no reason.

There is also an "Original file" option in the menu, for when you want exactly what the server
sent, animation included.


THE FIDDLY PARTS

Photos keep their orientation instead of arriving on their side. Transparent areas get filled
with a colour you choose before any resizing happens, which avoids the dark fringe that
otherwise shows up around edges. Large images are scaled down in stages so fine detail survives.
SVG files are rasterised at a sensible size rather than a tiny one.


SETTINGS

Quality per format. An optional cap on the longest side. Filename templates using {name}, {ext},
{w}, {h}, {date}, {time} and {host}. Files can go straight to Downloads, prompt you each time,
or land in a named subfolder of your choosing.


PRIVACY

Nothing is collected and nothing is sent anywhere. The only network request it makes is for the
image you asked it to save, from the site already hosting it.

Source code, MIT licensed: https://github.com/addyosmani/save-image-as
```

---

## Privacy tab

### Single purpose

```
SaveImageAs converts an image the user right-clicks into a chosen image format (JPEG, PNG or
WebP) and saves it to the user's Downloads folder. That is its only function.
```

### Permission justifications

**contextMenus**

```
Adds the "Save Image As..." entry to the right-click menu on images. This is the only way the
user starts the extension.
```

**downloads**

```
Writes the converted image to the user's Downloads folder. There is no other way for the
extension to deliver the file it produces.
```

**storage**

```
Saves the user's own preferences: quality per format, filename template, save location and an
optional size cap. No browsing data is stored.
```

**offscreen**

```
Decoding and re-encoding an image needs a canvas and URL.createObjectURL, neither of which
exists in a Manifest V3 service worker. An offscreen document does the conversion and creates
the blob URL that gets passed to chrome.downloads.
```

**scripting**

```
Injected only when the user picks the menu item, and only into the tab they used it in. It does
two things: it reads the clicked image element's srcset so a higher-resolution version of the
same image can be fetched, and where the extension cannot fetch a URL itself (blob: URLs only
exist inside the page's own origin) it asks the page to fetch those bytes. No page content is
read or transmitted.
```

**notifications**

```
Shows a message when a save fails so the failure is not silent. Success notifications are off by
default.
```

**Host permission (`<all_urls>`)**

```
Images can be hosted on any domain, and the image host is very often a different domain from the
page showing it, because most sites serve images from a CDN. The extension needs to fetch the
one image the user right-clicked, wherever it happens to live. It is used for nothing else: no
content script runs automatically, no page data is read, and nothing is sent anywhere.
```

### Remote code

**No.** All JavaScript, CSS and images are inside the package. Nothing is fetched and executed
at runtime.

### Data usage

Tick nothing. The extension collects none of the listed categories: no personally identifiable
information, health, financial or authentication information, no personal communications, no
location, no web history, no user activity, no website content.

Then confirm all three certifications:

- Data is not being sold to third parties
- Data is not being used or transferred for purposes unrelated to the item's single purpose
- Data is not being used or transferred to determine creditworthiness or for lending purposes

### Privacy policy URL

```
https://github.com/addyosmani/save-image-as/blob/main/PRIVACY.md
```

---

## Graphic assets

| Asset | Size | File | Required |
| --- | --- | --- | --- |
| Store icon | 128x128 | `icons/icon128.png` | Yes |
| Screenshot 1 | 1280x800 | `store/screenshots/1-context-menu.png` | Yes, at least one |
| Screenshot 2 | 1280x800 | `store/screenshots/2-popup.png` | |
| Screenshot 3 | 1280x800 | `store/screenshots/3-original-source.png` | |
| Screenshot 4 | 1280x800 | `store/screenshots/4-format-verification.png` | |
| Screenshot 5 | 1280x800 | `store/screenshots/5-settings.png` | |
| Small promo tile | 440x280 | `store/promo/small-tile-440x280.png` | Optional |
| Marquee promo tile | 1400x560 | `store/promo/marquee-1400x560.png` | Optional |

Regenerate all of them with `tools/make-store-assets.sh`. The scenes are built from the real
extension UI, so they cannot fall out of date.

---

## Upload package

```bash
tools/package.sh
```

Produces `dist/save-image-as-v<version>.zip` containing runtime files only, and fails the build
if anything from `test/`, `tools/` or `store/` ends up inside it.

---

## Before each submission

- [ ] `tools/package.sh` run against the current version number
- [ ] Extension loaded unpacked and tested once more in a clean profile
- [ ] `manifest.json` name and description match the two fields above
- [ ] Privacy policy URL resolves publicly (the repo must be public first)
- [ ] Distribution set to Public, and the correct regions selected

Expect a slower first review than usual. `<all_urls>` puts the item in the broad host permission
queue, which is reviewed by hand.
