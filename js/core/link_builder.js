export function buildSendLink(base, transferId, aesKey, accessToken) {
  const capability = accessToken ? `&a=${accessToken}` : "";
  return `${base.replace(/\/+$/, "")}/send/${encodeURIComponent(transferId)}#${aesKey}${capability}`;
}
