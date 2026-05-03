// src/lib/weather.ts
// Uses Open-Meteo — free, no API key needed.

export type WeatherData = {
  tempC: number;
  feelsLikeC: number;
  humidity: number;
  windKph: number;
  wmoCode: number;
  condition: string;
  description: string;
  emoji: string;
  isDay: boolean;
};

export type WeatherHint = string;

function wmoToInfo(code: number): { condition: string; description: string; emoji: string } {
  if (code === 0)  return { condition: 'Clear',        description: 'clear sky',     emoji: '☀️' };
  if (code === 1)  return { condition: 'Clear',        description: 'mainly clear',  emoji: '🌤️' };
  if (code === 2)  return { condition: 'Clouds',       description: 'partly cloudy', emoji: '⛅' };
  if (code === 3)  return { condition: 'Clouds',       description: 'overcast',      emoji: '☁️' };
  if (code <= 48)  return { condition: 'Mist',         description: 'foggy',         emoji: '🌫️' };
  if (code <= 57)  return { condition: 'Drizzle',      description: 'drizzle',       emoji: '🌦️' };
  if (code <= 67)  return { condition: 'Rain',         description: 'rain',          emoji: '🌧️' };
  if (code <= 77)  return { condition: 'Snow',         description: 'snow',          emoji: '❄️' };
  if (code <= 82)  return { condition: 'Rain',         description: 'rain showers',  emoji: '🌧️' };
  if (code <= 86)  return { condition: 'Snow',         description: 'snow showers',  emoji: '❄️' };
  if (code === 95) return { condition: 'Thunderstorm', description: 'thunderstorm',  emoji: '⛈️' };
  return                  { condition: 'Thunderstorm', description: 'heavy storm',   emoji: '⛈️' };
}

export async function fetchWeather(lat: number, lng: number): Promise<WeatherData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lng));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day');
  url.searchParams.set('timezone', 'Asia/Taipei');
  url.searchParams.set('forecast_days', '1');

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
  const d = await res.json();
  const c = d.current;
  const { condition, description, emoji } = wmoToInfo(c.weather_code ?? 0);

  return {
    tempC:      Math.round(c.temperature_2m ?? 25),
    feelsLikeC: Math.round(c.apparent_temperature ?? 25),
    humidity:   Math.round(c.relative_humidity_2m ?? 70),
    windKph:    Math.round(c.wind_speed_10m ?? 0),
    wmoCode:    c.weather_code ?? 0,
    condition,
    description,
    emoji,
    isDay:      Boolean(c.is_day),
  };
}

export function buildWeatherHint(w: WeatherData): WeatherHint {
  const isRainy     = ['Rain', 'Drizzle', 'Thunderstorm'].includes(w.condition);
  const isMisty     = w.condition === 'Mist';
  const isHot       = w.tempC >= 31;
  const isWarm      = w.tempC >= 24 && w.tempC < 31;
  const isCool      = w.tempC < 20;
  const goodOutdoor = !isRainy && !isMisty && isWarm;
  let contextLine = `Current weather: ${w.tempC}°C (feels ${w.feelsLikeC}°C), ${w.description}.`;

  if (isRainy || isMisty) {
    contextLine += ' Wet/misty — strongly prefer indoor venues: cafés, museums, covered markets, galleries, malls.';
  } else if (isHot) {
    contextLine += ` Hot (${w.tempC}°C) — suggest air-conditioned spots for daytime; evening outdoor is fine.`;
  } else if (isCool) {
    contextLine += ` Cool (${w.tempC}°C) — great for outdoor strolls, hiking, parks, and hot food.`;
  } else if (goodOutdoor) {
    contextLine += ' Comfortable weather — outdoor attractions, rooftops, and parks are excellent right now.';
  }

  if (!w.isDay) {
    contextLine += ' It is currently nighttime — prioritise night-friendly venues and night-markets.';
  }

  return contextLine;
}

export function weatherBadge(w: WeatherData): string {
  return `${w.emoji} ${w.tempC}°C · ${w.description}`;
}
