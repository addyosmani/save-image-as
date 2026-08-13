// Canonical output-format table.
//
// `probe: true` marks a format that today's Chrome cannot encode from a canvas.
// Those formats are only offered if a runtime probe proves the encoder is real.
// This matters: canvas.convertToBlob() does NOT throw for an unsupported type —
// it silently returns image/png. Trusting it blindly produces a ".avif" file
// full of PNG bytes. Every encode in this extension is verified against the
// blob's actual MIME type before it is allowed to reach disk.

export const FORMATS = {
  jpeg: {
    label: 'JPEG',
    blurb: 'photos',
    mime: 'image/jpeg',
    ext: 'jpg',
    qualityKey: 'jpegQuality',
    alpha: false,
    probe: false,
    hint: 'Photographs. Small files, no transparency.',
  },
  png: {
    label: 'PNG',
    blurb: 'lossless',
    mime: 'image/png',
    ext: 'png',
    qualityKey: null,
    alpha: true,
    probe: false,
    hint: 'Lossless. Screenshots, logos, transparency.',
  },
  webp: {
    label: 'WebP',
    blurb: 'photos + alpha',
    mime: 'image/webp',
    ext: 'webp',
    qualityKey: 'webpQuality',
    alpha: true,
    probe: false,
    hint: 'Smaller than JPEG at the same quality. Supports transparency.',
  },
  avif: {
    label: 'AVIF',
    blurb: 'best ratio',
    mime: 'image/avif',
    ext: 'avif',
    qualityKey: 'avifQuality',
    alpha: true,
    probe: true,
    hint: 'Best compression — only shown if your Chrome can encode it.',
  },
};

export const FORMAT_ORDER = ['jpeg', 'png', 'webp', 'avif'];

/** Formats the running browser has actually been proven able to encode. */
export function supportedFormats(encoderSupport) {
  return FORMAT_ORDER.filter((id) => {
    const f = FORMATS[id];
    if (!f.probe) return true;
    return encoderSupport?.[id] === true;
  });
}

/** Best-effort extension for a source MIME type, used for "Save original". */
export const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/tiff': 'tiff',
  'image/heic': 'heic',
};

/** Formats whose frames are animated — re-encoding keeps only frame 1. */
export const ANIMATED_MIMES = new Set(['image/gif', 'image/webp', 'image/avif', 'image/apng']);
