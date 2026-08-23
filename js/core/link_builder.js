export function buildSendLink(base, transferId, aesKey) {
  return `${base.replace(/\/+$/, "")}/send/${encodeURIComponent(transferId)}#${aesKey}`;
}
