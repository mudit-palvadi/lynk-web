export function resolveApiBase(location = globalThis.location) {
  const override = location.searchParams?.get("api");
  if (override) return override.replace(/\/+$/, "");

  const meta = document.querySelector('meta[name="lynk-api-base"]');
  const configured = meta?.content?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  return location.origin;
}
