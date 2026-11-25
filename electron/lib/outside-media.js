// Videos outside a .mdz (spec §9.4, §9.6): a document's `../reel.mp4` names
// a file next to the .mdz. The editor shows where it is and asks the reader;
// only once they allow it does Studio hand the player a mdzip-media: URL,
// which streams that one file from disk in pieces (Range requests), so a
// film of several gigabytes plays without being read into memory. In a folder
// the reader trusts (File > Trust Files in This Folder), a video in that
// folder or below it plays without asking.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const MEDIA_SCHEME = 'mdzip-media';

// The video formats the editor makes a player for (@mdzip/renderer's
// MDZIP_VIDEO_EXTENSIONS), with the types the player is told.
const VIDEO_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
};

/**
 * The file a path from the editor names: `relativePath` is relative to the
 * folder that holds the .mdz at `mdzPath`. Null unless it's a relative path
 * to a video file.
 */
function outsideVideoFile(mdzPath, relativePath) {
  if (typeof mdzPath !== 'string' || !/\.mdz$/i.test(mdzPath)) return null;
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) return null;
  if (path.isAbsolute(relativePath) || /^[a-z][a-z\d+.-]*:/i.test(relativePath) || /^[\\/]/.test(relativePath)) return null;
  const resolved = path.resolve(path.dirname(mdzPath), relativePath);
  return VIDEO_TYPES[path.extname(resolved).toLowerCase()] ? resolved : null;
}

/** Whether `target` is `folder` or inside it. */
function isInside(folder, target) {
  const relative = path.relative(path.resolve(folder), path.resolve(target));
  return relative === '' || (relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative));
}

/**
 * Whether the reader trusts `folder` (File > Trust Files in This Folder):
 * it's one of `trustedFolders` or inside one.
 */
function isTrustedFolder(trustedFolders, folder) {
  return Array.isArray(trustedFolders) && trustedFolders.some((trusted) => isInside(trusted, folder));
}

/**
 * Whether a video outside the .mdz at `mdzPath` loads without a click: it's
 * in the .mdz's folder or below it (the trust boundary, spec §9.6), and the
 * reader trusts that folder. A path that climbs above it never is.
 */
function isTrustedOutsideFile(trustedFolders, mdzPath, filePath) {
  const folder = path.dirname(mdzPath);
  return isInside(folder, filePath) && isTrustedFolder(trustedFolders, folder);
}

/**
 * The trusted folders after File > Trust Files in This Folder is clicked for
 * `folder`: trusted, it stops being (with any trusted folder it's inside);
 * otherwise it's added (replacing trusted folders inside it).
 */
function toggleTrustedFolder(trustedFolders, folder) {
  const list = Array.isArray(trustedFolders) ? trustedFolders : [];
  const resolved = path.resolve(folder);
  if (isTrustedFolder(list, resolved)) {
    return list.filter((trusted) => !isInside(trusted, resolved));
  }
  return [...list.filter((trusted) => !isInside(resolved, trusted)), resolved];
}

/**
 * The byte range a Range header asks for, within a file of `size` bytes:
 * `{ start, end }` (inclusive), null for the whole file, or 'unsatisfiable'.
 * Only one range is served; a request for several gets the first.
 */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)/i.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    // The last N bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** The response to a request for `filePath`, a part of it when `rangeHeader` asks. */
async function mediaResponse(filePath, rangeHeader) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!stat.isFile()) return new Response(null, { status: 404 });
  const size = stat.size;
  const type = VIDEO_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const range = parseRange(rangeHeader, size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = size === 0 ? null : Readable.toWeb(fs.createReadStream(filePath, { start, end }));
  const headers = {
    'Content-Type': type,
    'Content-Length': String(size === 0 ? 0 : end - start + 1),
    'Accept-Ranges': 'bytes',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

/**
 * The videos readers have allowed: a URL per file and window, unguessable,
 * and forgotten when that window closes or opens another document.
 */
class AllowedMedia {
  constructor() {
    this.byToken = new Map();
  }

  /** A mdzip-media: URL for `filePath`, allowed in the window `owner`. */
  allow(owner, filePath) {
    for (const [token, entry] of this.byToken) {
      if (entry.owner === owner && entry.filePath === filePath) return mediaUrl(token, filePath);
    }
    const token = crypto.randomBytes(16).toString('hex');
    this.byToken.set(token, { owner, filePath });
    return mediaUrl(token, filePath);
  }

  /** The file a mdzip-media: URL was allowed for, or null. */
  fileFor(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== 'video') return null;
    const token = parsed.pathname.split('/')[1] ?? '';
    return this.byToken.get(token)?.filePath ?? null;
  }

  /** Forgets everything allowed in the window `owner`. */
  forget(owner) {
    for (const [token, entry] of this.byToken) {
      if (entry.owner === owner) this.byToken.delete(token);
    }
  }
}

// The file name goes last, for anyone looking at the URL (and the player's
// own Save As); only the token is read.
function mediaUrl(token, filePath) {
  return `${MEDIA_SCHEME}://video/${token}/${encodeURIComponent(path.basename(filePath))}`;
}

module.exports = {
  MEDIA_SCHEME,
  VIDEO_TYPES,
  outsideVideoFile,
  isInside,
  isTrustedFolder,
  isTrustedOutsideFile,
  toggleTrustedFolder,
  parseRange,
  mediaResponse,
  AllowedMedia,
};
