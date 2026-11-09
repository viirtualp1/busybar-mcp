import { text, type PixelArt, type Scene } from '../bar.js';

// Open-Meteo: free, no key.

type Place = { name: string; latitude: number; longitude: number; timezone: string };

export type Weather = {
  place: string;
  tempC: number;
  feelsC: number;
  windKmh: number;
  code: number;
  kind: Kind;
  minC: number;
  maxC: number;
};

type Kind = 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog';

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'User-Agent': 'busybar-mcp' } });

  if (!res.ok) {
    throw new Error(`Open-Meteo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  return (await res.json()) as T;
}

async function geocode(city: string): Promise<Place> {
  const { results } = await json<{ results?: Place[] }>(
    `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(city)}`,
  );

  if (!results?.length) {
    throw new Error(`No place called "${city}"`);
  }

  return results[0];
}

/** WMO weather code → one of six pictures. */
function kindOf(code: number): Kind {
  if (code === 0 || code === 1) return 'sun';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  return 'cloud';
}

export async function weather(city: string): Promise<Weather> {
  const place = await geocode(city);
  const data = await json<{
    current: { temperature_2m: number; apparent_temperature: number; wind_speed_10m: number; weather_code: number };
    daily: { temperature_2m_min: number[]; temperature_2m_max: number[] };
  }>(
    'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${place.latitude}&longitude=${place.longitude}&timezone=auto&forecast_days=1` +
      '&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code' +
      '&daily=temperature_2m_min,temperature_2m_max',
  );

  return {
    place: place.name,
    tempC: Math.round(data.current.temperature_2m),
    feelsC: Math.round(data.current.apparent_temperature),
    windKmh: Math.round(data.current.wind_speed_10m),
    code: data.current.weather_code,
    kind: kindOf(data.current.weather_code),
    minC: Math.round(data.daily.temperature_2m_min[0]),
    maxC: Math.round(data.daily.temperature_2m_max[0]),
  };
}

const PALETTE = {
  '.': 'none',
  Y: '#FFC93C',
  W: '#E6E6E6',
  G: '#8A8F98',
  B: '#4DA3FF',
  S: '#FFFFFF',
  L: '#FFE14D',
};

const CLOUD = [
  '............',
  '............',
  '............',
  '....WWW.....',
  '...WWWWWW...',
  '.WWWWWWWWW..',
  'WWWWWWWWWWWW',
  'WWWWWWWWWWWW',
  '.WWWWWWWWWW.',
];

const ICONS: Record<Kind, string[]> = {
  sun: [
    '.....Y......',
    '.Y...Y...Y..',
    '..Y.....Y...',
    '....YYY.....',
    '...YYYYY....',
    'YY.YYYYY.YY.',
    '...YYYYY....',
    '....YYY.....',
    '..Y.....Y...',
    '.Y...Y...Y..',
    '.....Y......',
    '............',
  ],
  cloud: [...CLOUD, '............', '............', '............'],
  rain: [...CLOUD.map((r) => r.replace(/W/g, 'G')), '..B..B..B...', '.B..B..B....', '............'],
  snow: [...CLOUD, '..S...S..S..', '....S...S...', '..S...S.....'],
  storm: [...CLOUD.map((r) => r.replace(/W/g, 'G')), '.....LL.....', '....LL......', '.....L......'],
  fog: ['............', '............', 'GGGGGGGGGG..', '............', '..GGGGGGGGGG', '............', 'GGGGGGGGGG..', '............', '..GGGGGGGGGG', '............', '............', '............'],
};

export function weatherIcon(kind: Kind, x = 1, y = 2): PixelArt {
  return { palette: PALETTE, grid: ICONS[kind], x, y };
}

export function weatherScene(w: Weather): Scene {
  const temp = `${w.tempC > 0 ? '+' : ''}${w.tempC}C`;
  const tempColor = w.tempC <= 0 ? '#7FC8FFFF' : w.tempC >= 25 ? '#FF9F43FF' : '#FFFFFFFF';

  return {
    pixels: [weatherIcon(w.kind)],
    elements: [
      text('w-temp', temp, { x: 16, y: 1, color: tempColor }),
      text('w-place', w.place, { x: 16 + temp.length * 4 + 3, y: 1, color: '#AAAAAAFF', width: 72 - (16 + temp.length * 4 + 3) }),
      text('w-range', `${w.minC}..${w.maxC} ${w.windKmh}kmh`, { x: 16, y: 9, color: '#AAAAAAFF', width: 56 }),
    ],
  };
}
