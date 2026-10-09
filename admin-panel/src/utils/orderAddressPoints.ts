interface SavedAddressPoint {
  latitude: number;
  longitude: number;
  updatedAt: number;
}

const SAVED_ADDRESS_POINTS_KEY = 'zaki_admin_saved_address_points';
const MAX_SAVED_ADDRESS_POINTS = 300;

const normalizeAddressKey = (address: string) => address.trim().toLowerCase().replace(/\s+/g, ' ');

export function getSavedAddressPoint(address: string): SavedAddressPoint | null {
  const key = normalizeAddressKey(address);
  if (!key) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_ADDRESS_POINTS_KEY) || '{}') as Record<string, SavedAddressPoint>;
    const point = saved[key];
    return point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) ? point : null;
  } catch {
    return null;
  }
}

export function saveAddressPoint(address: string, latitude: number, longitude: number) {
  const key = normalizeAddressKey(address);
  if (!key || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED_ADDRESS_POINTS_KEY) || '{}') as Record<string, SavedAddressPoint>;
    saved[key] = { latitude, longitude, updatedAt: Date.now() };
    const entries = Object.entries(saved);
    if (entries.length > MAX_SAVED_ADDRESS_POINTS) {
      entries
        .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)
        .slice(0, entries.length - MAX_SAVED_ADDRESS_POINTS)
        .forEach(([oldKey]) => delete saved[oldKey]);
    }
    localStorage.setItem(SAVED_ADDRESS_POINTS_KEY, JSON.stringify(saved));
  } catch {
    // The order can still be created if the browser blocks local storage.
  }
}

