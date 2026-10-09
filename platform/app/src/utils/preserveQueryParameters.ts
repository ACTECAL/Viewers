function preserve(query, current, key) {
  const value = current.get(key);
  if (value) {
    query.append(key, value);
  }
}

// Guest share links (?sharecode=...) and ERP launches (?userId=, ?tenant=)
// must survive OHIF's SPA route rewrites, otherwise navigating inside the
// viewer drops the guest session params and the next refresh looks like a
// fresh (unauthenticated) visit.
export const preserveKeys = [
  'configUrl',
  'multimonitor',
  'screenNumber',
  'hangingProtocolId',
  'sharecode',
  'userId',
  'tenant',
];

export function preserveQueryParameters(
  query,
  current = new URLSearchParams(window.location.search)
) {
  for (const key of preserveKeys) {
    preserve(query, current, key);
  }
}

export function preserveQueryStrings(query, current = new URLSearchParams(window.location.search)) {
  for (const key of preserveKeys) {
    const value = current.get(key);
    if (value) {
      query[key] = value;
    }
  }
}
