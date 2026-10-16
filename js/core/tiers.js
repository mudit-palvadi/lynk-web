const MB = 1024 * 1024;

export function maxTotalSize(mode, unlocked) {
  if (mode === "p2p") {
    return unlocked ? 100 * MB : 10 * MB;
  }
  return unlocked ? 30 * MB : 10 * MB;
}

export function encryptedSize(plainSize) {
  const paddedBlocks = (Math.floor(plainSize / 16) + 1) * 16;
  return paddedBlocks + 16;
}

export function validateSelection(files, mode, unlocked) {
  if (!files || files.length === 0) {
    return { ok: false, reason: "Pick at least one file." };
  }
  const limit = maxTotalSize(mode, unlocked);
  const totalEncrypted = files.reduce((sum, f) => sum + encryptedSize(f.size), 0);
  if (totalEncrypted > limit) {
    return {
      ok: false,
      reason: `Total exceeds the ${limit / MB} MB limit.`,
    };
  }
  return { ok: true };
}
