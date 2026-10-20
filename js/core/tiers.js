const MB = 1024 * 1024;

// The `unlocked` tiers exist for the app's rewarded-ad flow: watching an ad
// raises the limit. The website has no ad or reward flow, so it always
// enforces the free tier - every call site here passes `false`. The sender
// page labels the same limit it validates, so the number the user sees is
// always the number that is enforced.
export function maxTotalSize(mode, unlocked) {
  if (mode === "p2p") {
    return unlocked ? 30 * MB : 10 * MB;
  }
  return unlocked ? 20 * MB : 10 * MB;
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
