// src/lib/location.ts
import type { Attraction } from './ai';

export type LatLng = { lat: number; lng: number };
export type NearbyAttraction = Attraction & { _distKm: number; _score: number };
export type CachedLocation = LatLng & { savedAt: number };

const LOCATION_CACHE_KEY = 'ytp_user_location';
const DEFAULT_LOCATION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type NearbyOptions = {
  preferIndoor?: boolean;
  currentHour?: number;
  limit?: number;
  interests?: string[];
};

export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const sq =
    sinLat ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, sq)));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function loadCachedUserLocation(maxAgeMs = DEFAULT_LOCATION_MAX_AGE_MS): CachedLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCATION_CACHE_KEY) || 'null');
    if (!parsed || typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
    const savedAt = Number(parsed.savedAt) || 0;
    if (!savedAt || Date.now() - savedAt > maxAgeMs) return null;
    return { lat: parsed.lat, lng: parsed.lng, savedAt };
  } catch {
    return null;
  }
}

export function saveCachedUserLocation(location: LatLng): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({
      lat: location.lat,
      lng: location.lng,
      savedAt: Date.now(),
    }));
  } catch {
    // Ignore storage failures; geolocation still works for the current request.
  }
}

// src/lib/location.ts

export function getUserLocation(timeoutMs = 10_000): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Geolocation is not supported.'));
      return;
    }
    const timeout = window.setTimeout(() => {
      reject(new Error('Location request timed out.'));
    }, timeoutMs + 500);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timeout);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        window.clearTimeout(timeout);
        const message =
          err.code === err.PERMISSION_DENIED ? 'Location permission was denied.' :
          err.code === err.POSITION_UNAVAILABLE ? 'Location is unavailable.' :
          err.code === err.TIMEOUT ? 'Location request timed out.' :
          err.message || 'Unable to get current location.';
        reject(new Error(message));
      },
      {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      },
    );
  });
}

export function getNearbyAttractions(
  all: Attraction[],
  user: LatLng,
  radiusKm = 2,
  options: NearbyOptions = {},
): NearbyAttraction[] {
  const hour = options.currentHour ?? new Date().getHours();
  const isNight = hour >= 17 || hour <= 5;
  const isDaytime = hour >= 7 && hour < 17;

  return all
    .filter((a) => Number(a.suggestion_level) === 3)
    .filter((a) => a.lat != null && a.lng != null)
    .map((a) => {
      const _distKm = distanceKm(user, { lat: a.lat!, lng: a.lng! });
      return { ...a, _distKm, _score: scoreNearbyAttraction(a, _distKm, { ...options, currentHour: hour, isNight, isDaytime }) };
    })
    .filter((a) => a._distKm <= radiusKm)
    .sort((a, b) => b._score - a._score || a._distKm - b._distKm)
    .slice(0, options.limit ?? all.length);
}

function scoreNearbyAttraction(
  attraction: Attraction,
  distance: number,
  options: NearbyOptions & { isNight: boolean; isDaytime: boolean },
): number {
  const categories = (attraction.category ?? []).map((c) => c.toLowerCase());
  const tags = (attraction.tags ?? []).map((t) => t.toLowerCase());
  const level = Number(attraction.suggestion_level ?? 1);

  let score = 0;
  score += Math.max(0, 42 - distance * 10);
  score += Math.min(3, Math.max(1, level)) * 22;

  if (categories.some((c) => matchesInterest(c, 'culture'))) score += 10;
  if (categories.some((c) => matchesInterest(c, 'food') || matchesInterest(c, 'shopping'))) score += 8;
  if (categories.some((c) => matchesInterest(c, 'nature') || matchesInterest(c, 'relax'))) score += options.isDaytime ? 7 : -8;

  for (const interest of options.interests ?? []) {
    if (categories.some((c) => matchesInterest(c, interest))) score += 14;
  }

  if (options.preferIndoor) {
    if (tags.includes('indoor')) score += 18;
    if (tags.includes('outdoor')) score -= 12;
  }

  if (options.isNight) {
    if (tags.includes('night')) score += 20;
    if (tags.includes('daytime')) score -= 8;
  } else {
    if (tags.includes('daytime')) score += 6;
  }

  if (tags.includes('parent-child friendly')) score += 3;
  if (tags.includes('elders are friendly')) score += 3;

  return score;
}

function matchesInterest(value: string, interest: string): boolean {
  const normalized = value.toLowerCase();
  const aliases: Record<string, string[]> = {
    food: ['food', 'gourmet', '美食', 'グルメ', '맛있는 음식'],
    culture: ['culture', '文化', 'カルチャー', '문화'],
    nature: ['nature', '自然', '자연'],
    shopping: ['shopping', '購物', '買い物', 'ショッピング', '쇼핑'],
    relax: ['relax', 'leisure', '休閒', 'レジャー', '여가', '온천', '温泉'],
    night: ['night', '夜晚', '夜', 'ナイト', '밤', '나이트'],
  };
  return (aliases[interest] ?? [interest]).some((alias) => normalized.includes(alias.toLowerCase()));
}

export function guessDistrict(all: Attraction[], user: LatLng): string | undefined {
  const { lat, lng } = user;

  // --- GEOFENCING LOGIC ---
  // These boxes are approximations of the main urban areas of each district
  
  // 1. NEIHU DISTRICT (內湖區)
  // Rough box: From Miramar area to Xikang and out to Neihu Park
  if (lat >= 25.050 && lat <= 25.105 && lng >= 121.562 && lng <= 121.625) {
    return "內湖區";
  }

  // 2. ZHONGSHAN DISTRICT (中山區)
  // Rough box: Linsen N. Rd, Xingtian Temple area up to Dazhi (West of Miramar)
  if (lat >= 25.041 && lat <= 25.090 && lng >= 121.520 && lng <= 121.561) {
    return "中山區";
  }

  // 3. XINYI DISTRICT (信義區)
  // Rough box: Taipei 101 and surrounding shopping area
  if (lat >= 25.015 && lat <= 25.050 && lng >= 121.555 && lng <= 121.585) {
    return "信義區";
  }

  // --- FALLBACK: NEAREST NEIGHBOR (For other districts) ---
  let bestDist = Infinity;
  let bestDistrict: string | undefined;

  for (const a of all) {
    if (a.lat == null || a.lng == null || !a.district) continue;
    const d = distanceKm(user, { lat: a.lat, lng: a.lng });
    if (d < bestDist) {
      bestDist = d;
      bestDistrict = a.district;
    }
  }

  return bestDistrict;
}
