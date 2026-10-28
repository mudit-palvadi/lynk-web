// A sender picks the names in a transfer and every receiver writes those
// names to disk. A name carrying a path segment would therefore be able to
// escape the download directory, so names are reduced to a single safe
// segment on the way out.
//
// The app applies the same rules to the names it receives, and the server
// refuses unsafe names at the API boundary; this is the third layer, for the
// peer-to-peer path where the server never sees the name.

const MAX_FILE_NAME_BYTES = 255;

// NUL and the other control characters. They truncate paths on some
// platforms and corrupt them on others.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

// A name made only of dots is a directory reference (".", ".."), never a file.
const ONLY_DOTS = /^\.+$/;

/**
 * Reduces a sender-supplied file name to a single, safe path segment.
 *
 * The last path segment is kept, so "photos/2024/img.jpg" and
 * "../../img.jpg" both become "img.jpg". Everything that could still escape
 * the download directory is removed, and a name left with nothing usable
 * falls back to "file".
 *
 * @param {string} raw
 * @returns {string}
 */
export function safeFileName(raw) {
  const name = String(raw ?? "");

  // Treat a Windows separator as a separator too, so a name crafted for
  // Windows cannot slip past on POSIX.
  const normalized = name.replaceAll("\\", "/");

  const lastSeparator = normalized.lastIndexOf("/");
  const base = lastSeparator >= 0 ? normalized.slice(lastSeparator + 1) : normalized;

  // A colon is an alternate data stream on Windows, so it is not part of the name.
  // Windows drops trailing spaces and dots, so ".. " would become ".." on disk.
  const cleaned = base
    .replace(CONTROL_CHARACTERS, "")
    .replaceAll(":", "")
    .trim()
    .replace(/[. ]+$/g, "");

  if (cleaned === "" || ONLY_DOTS.test(cleaned)) {
    return "file";
  }

  return truncateToBytes(cleaned, MAX_FILE_NAME_BYTES);
}

/**
 * Trims a name to a byte budget without splitting a character.
 *
 * @param {string} name
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateToBytes(name, maxBytes) {
  const encoder = new TextEncoder();
  if (encoder.encode(name).length <= maxBytes) return name;

  const result = [];
  let used = 0;
  for (const character of name) {
    const size = encoder.encode(character).length;
    if (used + size > maxBytes) break;
    result.push(character);
    used += size;
  }

  const truncated = result.join("");
  return truncated.trim() === "" ? "file" : truncated;
}
