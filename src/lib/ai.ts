// src/lib/ai.ts
// Shared helpers for the /ai page across all 4 language routes.
// Implements Strategy B: keyword-filter the datasets client-side, then stuff
// the filtered subset into a system prompt with a strict "only recommend from
// this list" instruction so Gemini can't hallucinate places we don't have.
// Hotel (Safe Stay) support added: hotels are filtered by district/price/MRT
// and included in the system prompt. The PLACE:h:ID marker links to /hotel/[id].
import { getHotelsForLang } from './hotelData';

export type Lang = 'en' | 'zh' | 'jp' | 'kr';
export type LocationContext = {
  lat?: number;
  lng?: number;
  district?: string;
  nearbyNames: string[];
  radiusKm: number;
};

export type WeatherContext = string;
export type WeatherContextLine = WeatherContext;

export type Prefs = {
  interests: string[]; // e.g. ["food", "culture", "nature", "nightlife"]
  districts: string[]; // e.g. ["大安區", "信義區"]
  pace: 'relaxed' | 'balanced' | 'packed' | '';
  days: number; // 1, 2, 3...
};

export const PREFS_KEY = 'ytp_prefs';

export function loadPrefs(): Prefs | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      interests: Array.isArray(parsed.interests) ? parsed.interests : [],
      districts: Array.isArray(parsed.districts) ? parsed.districts : [],
      pace: parsed.pace ?? '',
      days: Number(parsed.days) || 0,
    };
  } catch {
    return null;
  }
}

export function savePrefs(prefs: Prefs): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// ---------- shape of the datasets we import ----------

export type Attraction = {
  id: string;
  suggestion_level?: number;
  name: string;
  district: string;
  category: string[]; // ["culture", "nature", "food", "shopping", "relax"]
  description: string;
  link?: string;
  lat?: number;
  lng?: number;
  nearby_mrt?: string;
  tags?: string[]; // ["day", "night", "outdoor", "indoor", "elder", "family", ...]
  image?: string;
};

export type MrtStation = {
  id: string;
  name: string;
  description?: string;
  address?: string;
  image_url?: string;
  lat: number;
  lng: number;
};

export type Hotel = {
  id: string;
  legal_id: string;
  name: string;
  location: string;
  address: string;
  district: string;
  lowest_price: number | null;
  highest_price: number | null;
  rooms: number | null;
  phone: string | null;
  closest_mrt: string;
  booking_link: string | null;
  official_star_rating?: number;
};

export type Restaurant = {
  name: string;
  photo?: string;
  district: string;
  opening_hours?: string[];
  categories: string[];
  avg_price?: number;
  rating?: number;
  suggestion_level?: number;
  blog_link?: string;
  google_map?: string;
  ifoodie_link?: string;
  /** Position in the original restaurants.json array — used as the detail-page ID. */
  _idx?: number;
};

// ---------- keyword vocabularies for query parsing ----------

// All 12 Taipei districts + a few common romanizations users might type.
const DISTRICT_ALIASES: Record<string, string> = {
  // core 12
  '大安區': '大安區', '大安区': '大安區', '大安': '大安區', '다안구': '大安區', '다안 지구': '大安區', 'daan': '大安區', "da'an": '大安區', 'daán': '大安區', 'daan district': '大安區',
  '信義區': '信義區', '信義区': '信義區', '信義': '信義區', '신이구': '信義區', '신이 지구': '信義區', 'xinyi': '信義區', 'shinyi': '信義區', 'xinyi district': '信義區',
  '中山區': '中山區', '中山区': '中山區', '中山': '中山區', '중산구': '中山區', '중산 지구': '中山區', 'zhongshan': '中山區', 'zhongshan district': '中山區',
  '中正區': '中正區', '中正区': '中正區', '中正': '中正區', '중정구': '中正區', '중정 지구': '中正區', 'zhongzheng': '中正區', 'zhongzheng district': '中正區',
  '松山區': '松山區', '松山区': '松山區', '松山': '松山區', '송산구': '松山區', '송산 지구': '松山區', 'songshan': '松山區', 'songshan district': '松山區',
  '士林區': '士林區', '士林区': '士林區', '士林': '士林區', '스린구': '士林區', '스린 지구': '士林區', 'shilin': '士林區', 'shilin district': '士林區',
  '大同區': '大同區', '大同区': '大同區', '大同': '大同區', '다퉁구': '大同區', '다퉁 지구': '大同區', 'datong': '大同區', 'datong district': '大同區',
  '萬華區': '萬華區', '万華区': '萬華區', '萬華': '萬華區', '완화구': '萬華區', '완화 지구': '萬華區', 'wanhua': '萬華區', 'wanhua district': '萬華區', 'ximending': '萬華區', '西門町': '萬華區',
  '內湖區': '內湖區', '内湖区': '內湖區', '內湖': '內湖區', '네이후구': '內湖區', '네이후 지구': '內湖區', 'neihu': '內湖區', 'neihu district': '內湖區',
  '北投區': '北投區', '北投区': '北投區', '北投': '北投區', '베이터우구': '北投區', '베이터우 지구': '北投區', 'beitou': '北投區', 'beitou district': '北投區',
  '文山區': '文山區', '文山区': '文山區', '文山': '文山區', '원산구': '文山區', '원산 지구': '文山區', 'wenshan': '文山區', 'wenshan district': '文山區',
  '南港區': '南港區', '南港区': '南港區', '南港': '南港區', '난강구': '南港區', '난강 지구': '南港區', 'nangang': '南港區', 'nangang district': '南港區',
};

const DISTRICT_EQUIVALENTS: Record<string, string[]> = {
  '大安區': ['大安區', '大安区', "Da'an District", 'Daan District', '다안구', '다안 지구'],
  '信義區': ['信義區', '信義区', 'Xinyi District', '신이구', '신이 지구'],
  '中山區': ['中山區', '中山区', 'Zhongshan District', '중산구', '중산 지구'],
  '中正區': ['中正區', '中正区', 'Zhongzheng District', '중정구', '중정 지구'],
  '松山區': ['松山區', '松山区', 'Songshan District', '송산구', '송산 지구'],
  '士林區': ['士林區', '士林区', 'Shilin District', '스린구', '스린 지구'],
  '大同區': ['大同區', '大同区', 'Datong District', '다퉁구', '다퉁 지구'],
  '萬華區': ['萬華區', '万華区', 'Wanhua District', '완화구', '완화 지구'],
  '內湖區': ['內湖區', '内湖区', 'Neihu District', '네이후구', '네이후 지구'],
  '北投區': ['北投區', '北投区', 'Beitou District', '베이터우구', '베이터우 지구'],
  '文山區': ['文山區', '文山区', 'Wenshan District', '원산구', '원산 지구'],
  '南港區': ['南港區', '南港区', 'Nangang District', '난강구', '난강 지구'],
};

function districtMatches(actual: string, wanted: Set<string>): boolean {
  if (!wanted.size) return false;
  for (const district of wanted) {
    const equivalents = DISTRICT_EQUIVALENTS[district] ?? [district];
    if (equivalents.includes(actual)) return true;
  }
  return false;
}

// Map English/JP/KR food cues to the Chinese category tags used in restaurants.json
const CATEGORY_ALIASES: Record<string, string[]> = {
  food: ['gourmet food', '美食', 'グルメ', '맛있는 음식'], 'food & drink': ['gourmet food', '美食', 'グルメ', '맛있는 음식'],
  culture: ['culture', '文化'], 'カルチャー': ['culture', '文化'], '문화': ['culture', '文化'],
  nature: ['nature', '自然'], '自然': ['nature', '自然'], '자연': ['nature', '自然'],
  shopping: ['Shopping', 'shopping', '購物', '買い物', 'ショッピング', '쇼핑'],
  relax: ['Leisure', '休閒', 'レジャー', '여가'], leisure: ['Leisure', '休閒', 'レジャー', '여가'],
  night: ['night', '夜晚', '夜', '밤'], nightlife: ['night', '夜晚', '夜', '밤'],
  hotpot: ['火鍋'], 'hot pot': ['火鍋'], '火鍋': ['火鍋'], '鍋': ['火鍋'], '나베': ['火鍋'],
  bbq: ['燒肉', '燒烤'], yakiniku: ['燒肉'], '燒肉': ['燒肉'],
  japanese: ['日本料理', '日式料理'], '日式': ['日本料理', '日式料理'], '日本': ['日本料理'], '일식': ['日本料理'],
  italian: ['義式料理'], pasta: ['義式料理'], pizza: ['義式料理'], '義式': ['義式料理'],
  korean: ['韓式料理'], '한식': ['韓式料理'], '韓式': ['韓式料理'], '韓國': ['韓式料理'],
  thai: ['泰式料理'], '泰式': ['泰式料理'],
  american: ['美式料理'], burger: ['美式料理'], '美式': ['美式料理'],
  seafood: ['海鮮'], '海鮮': ['海鮮'],
  vegetarian: ['素食'], vegan: ['素食'], '素食': ['素食'],
  noodle: ['麵食'], noodles: ['麵食'], ramen: ['麵食', '日本料理'], '麵': ['麵食'],
  brunch: ['早午餐'], '早午餐': ['早午餐'],
  dessert: ['甜點'], sweets: ['甜點'], '甜點': ['甜點'], '디저트': ['甜點'],
  coffee: ['咖啡廳', '咖啡'], cafe: ['咖啡廳', '咖啡'], café: ['咖啡廳', '咖啡'], '咖啡': ['咖啡廳', '咖啡'],
  drink: ['飲料', '冰品飲料'], drinks: ['飲料'], tea: ['飲料'],
  snack: ['小吃'], snacks: ['小吃'], '小吃': ['小吃'], streetfood: ['小吃'], 'street food': ['小吃'],
  buffet: ['自助餐', '吃到飽'],
  izakaya: ['居酒屋'], '居酒屋': ['居酒屋'],
  'late night': ['宵夜'], latenight: ['宵夜'], midnight: ['宵夜'], '宵夜': ['宵夜'],
  lunch: ['午餐'], '午餐': ['午餐'], '점심': ['午餐'],
  dinner: ['晚餐'], '晚餐': ['晚餐'], '저녁': ['晚餐'],
  date: ['約會餐廳'], romantic: ['約會餐廳'], '約會': ['約會餐廳'],
};

const ATTRACTION_INTEREST_CATEGORIES: Record<string, string[]> = {
  food: ['food', 'gourmet food', '美食', 'グルメ', '맛있는 음식'],
  culture: ['culture', '文化', 'カルチャー', '문화'],
  nature: ['nature', '自然', '자연'],
  shopping: ['shopping', '購物', '買い物', 'ショッピング', '쇼핑'],
  relax: ['relax', 'leisure', '休閒', 'レジャー', '여가', '온천', '温泉'],
  night: ['night', '夜晚', '夜', 'ナイト', '밤', '나이트'],
};

function normText(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function attractionCategoryMatchesInterest(category: string, interest: string): boolean {
  const c = normText(category);
  const needles = ATTRACTION_INTEREST_CATEGORIES[interest] ?? [interest];
  return needles.some((needle) => c.includes(normText(needle)));
}

function attractionCategoryMatchesFilter(category: string, filters: Set<string>): boolean {
  const c = normText(category);
  for (const filter of filters) {
    const f = normText(filter);
    if (c === f || c.includes(f) || f.includes(c)) return true;
    if (attractionCategoryMatchesInterest(category, f)) return true;
  }
  return false;
}

// Specific dish keywords → canonical tokens we'll use for substring matching.
// Unlike CATEGORY_ALIASES (which targets the coarse `categories` field), these
// target the restaurant NAME, which is where specific dishes actually live.
// When any of these trigger we switch into "strict dish mode": we refuse to
// silently expand the pool, and we tell Gemini exactly what coverage we have
// so it can say "I don't have that in my guide" instead of inventing.
const DISH_ALIASES: Record<string, string[]> = {
  // Taiwanese classics
  '臭豆腐': ['臭豆腐'], 'stinky tofu': ['臭豆腐'], 'stinky-tofu': ['臭豆腐'],
  '滷味': ['滷味'], '卤味': ['滷味'], 'braised': ['滷味'],
  '牛肉麵': ['牛肉麵'], '牛肉面': ['牛肉麵'], 'beef noodle': ['牛肉麵'], 'beef noodles': ['牛肉麵'],
  '小籠包': ['小籠包', '小笼包'], '小笼包': ['小籠包', '小笼包'], 'xiaolongbao': ['小籠包'], 'soup dumpling': ['小籠包'],
  '鹽酥雞': ['鹽酥雞', '鹽酥', '塩酥'], 'popcorn chicken': ['鹽酥雞'], '塩酥雞': ['鹽酥雞'],
  '蚵仔煎': ['蚵仔煎'], 'oyster omelet': ['蚵仔煎'], 'oyster omelette': ['蚵仔煎'],
  '肉圓': ['肉圓'], 'meatball': ['肉圓'],
  '雞排': ['雞排', '鸡排'], 'chicken cutlet': ['雞排'], 'fried chicken cutlet': ['雞排'],
  '擔仔麵': ['擔仔麵', '担仔面'], 'danzai': ['擔仔麵'],
  '魯肉飯': ['魯肉飯', '滷肉飯', '卤肉饭'], '滷肉飯': ['魯肉飯', '滷肉飯'], 'braised pork rice': ['魯肉飯'], 'lu rou fan': ['魯肉飯'],
  '刈包': ['刈包', '割包'], '割包': ['刈包', '割包'], 'gua bao': ['刈包'],
  '生煎包': ['生煎包'], 'pan-fried bun': ['生煎包'],
  '胡椒餅': ['胡椒餅'], 'pepper cake': ['胡椒餅'], 'pepper bun': ['胡椒餅'],
  '蚵仔麵線': ['蚵仔麵線', '麵線'], '麵線': ['麵線'], 'thin noodle': ['麵線'],
  '鴨血': ['鴨血'], 'duck blood': ['鴨血'],
  '豆花': ['豆花'], 'tofu pudding': ['豆花'], 'douhua': ['豆花'],
  '芋圓': ['芋圓'], 'taro ball': ['芋圓'],
  '刨冰': ['刨冰', '剉冰'], 'shaved ice': ['刨冰'],
  '珍珠奶茶': ['珍珠奶茶', '珍奶', '珍珠'], '珍奶': ['珍珠奶茶', '珍奶', '珍珠'], 'bubble tea': ['珍珠'], 'boba': ['珍珠'],
  '麻辣': ['麻辣'], 'mala': ['麻辣'],
  '酸菜白肉': ['酸菜白肉'],

  // Japanese (specific dishes — NOT the whole "日本料理" category)
  '壽司': ['壽司', '寿司'], '寿司': ['壽司', '寿司'], 'sushi': ['壽司', '寿司', 'sushi'],
  '拉麵': ['拉麵', '拉面', 'ラーメン'], 'ramen': ['拉麵', '拉面', 'ramen'],
  '丼飯': ['丼飯', '丼'], '丼': ['丼飯', '丼'], 'donburi': ['丼飯'], 'don': ['丼飯'],
  '親子丼': ['親子丼'], 'oyakodon': ['親子丼'],
  '豬排': ['豬排', '炸豬排', 'カツ'], 'tonkatsu': ['豬排', '豚カツ'], 'カツ': ['豬排', 'カツ'],
  '串燒': ['串燒', '串焼き'], 'yakitori': ['串燒', 'yakitori'],
  '天婦羅': ['天婦羅', '天ぷら'], 'tempura': ['天婦羅', 'tempura'],
  '鰻魚': ['鰻魚', '鰻', 'うなぎ'], 'unagi': ['鰻魚', '鰻'],
  '壽喜燒': ['壽喜燒', 'すき焼き'], 'sukiyaki': ['壽喜燒'],
  '涮涮鍋': ['涮涮鍋', 'しゃぶしゃぶ'], 'shabu': ['涮涮鍋', 'しゃぶ'], 'shabu shabu': ['涮涮鍋'],
  '定食': ['定食'], 'teishoku': ['定食'],
  '居酒屋': ['居酒屋'],  // cuisine tag, but also a specific format people search for

  // Korean (specific)
  '韓式炸雞': ['韓式炸雞'], 'korean fried chicken': ['韓式炸雞'], 'kfc': ['韓式炸雞'],
  '年糕': ['年糕', '年糕料理'], 'tteokbokki': ['年糕'],
  '부대찌개': ['部隊鍋'], '部隊鍋': ['部隊鍋'], 'army stew': ['部隊鍋'],
  '비빔밥': ['拌飯'], '拌飯': ['拌飯'], 'bibimbap': ['拌飯'],

  // Western / other
  '披薩': ['披薩', 'Pizza', 'pizza'], 'pizza': ['披薩', 'Pizza', 'pizza'],
  '義大利麵': ['義大利麵', 'Pasta', 'pasta'], 'pasta': ['義大利麵', 'Pasta', 'pasta'], 'spaghetti': ['義大利麵'],
  '漢堡': ['漢堡', 'Burger', 'burger'], 'burger': ['漢堡', 'Burger', 'burger'], 'hamburger': ['漢堡'],
  '牛排': ['牛排', 'Steak', 'steak'], 'steak': ['牛排', 'Steak', 'steak'],
  '鬆餅': ['鬆餅'], 'waffle': ['鬆餅'], 'pancake': ['鬆餅'],
};

const TAG_ALIASES: Record<string, string> = {
  outdoor: 'outdoor', '戶外': 'outdoor', '야외': 'outdoor',
  indoor: 'indoor', '室內': 'indoor', '실내': 'indoor',
  night: 'night', nightlife: 'night', '夜': 'night', '夜晚': 'night',
  day: 'day', '白天': 'day',
  elder: 'elder', senior: 'elder', '長輩': 'elder',
  family: 'family', kids: 'family', '家庭': 'family',
  cheap: 'cheaper', budget: 'cheaper', 'cheap eats': 'cheaper',
  fancy: 'expensive', luxury: 'expensive', expensive: 'expensive',
};

// --------- query parsing ----------

export type QueryFilters = {
  districts: Set<string>;
  categories: Set<string>;
  tags: Set<string>;
  /** Specific dish tokens (臭豆腐, 壽司, 滷味...). When non-empty we're in "strict dish mode": the pool is filtered by name/category substring and we do NOT silently fall back to the full set. */
  dishes: Set<string>;
  /** The raw dish term the user typed, for honest reporting back to the model. */
  dishQuery: string | null;
  priceHint: 'cheap' | 'expensive' | null;
  lateNight: boolean;
};

export function extractFilters(query: string, prefs: Prefs | null): QueryFilters {
  const q = (query || '').toLowerCase();
  const f: QueryFilters = {
    districts: new Set(),
    categories: new Set(),
    tags: new Set(),
    dishes: new Set(),
    dishQuery: null,
    priceHint: null,
    lateNight: false,
  };

  for (const [alias, canon] of Object.entries(DISTRICT_ALIASES)) {
    if (q.includes(alias.toLowerCase())) f.districts.add(canon);
  }
  for (const [alias, canons] of Object.entries(CATEGORY_ALIASES)) {
    if (q.includes(alias.toLowerCase())) canons.forEach((c) => f.categories.add(c));
  }
  // Dish-level extraction. First alias that hits sets dishQuery — we preserve
  // what the user actually typed rather than our internal canonical form.
  for (const [alias, tokens] of Object.entries(DISH_ALIASES)) {
    if (q.includes(alias.toLowerCase())) {
      if (!f.dishQuery) f.dishQuery = alias;
      tokens.forEach((t) => f.dishes.add(t));
    }
  }
  for (const [alias, canon] of Object.entries(TAG_ALIASES)) {
    if (q.includes(alias.toLowerCase())) f.tags.add(canon);
  }
  if (/\b(cheap|budget|便宜|값싼)\b/i.test(query)) f.priceHint = 'cheap';
  if (/\b(fancy|luxury|expensive|高級|高価)\b/i.test(query)) f.priceHint = 'expensive';
  if (/late.?night|midnight|宵夜|深夜|심야/i.test(query)) f.lateNight = true;

  // Fold in saved preferences as a soft bias so every query is personalized
  if (prefs) {
    for (const d of prefs.districts) f.districts.add(d);
  }
  return f;
}

/** True if any dish token appears in the restaurant's name OR categories. */
function restaurantMatchesDishes(r: Restaurant, dishes: Set<string>): boolean {
  if (dishes.size === 0) return true;
  const name = r.name || '';
  const cats = r.categories || [];
  for (const d of dishes) {
    if (name.includes(d)) return true;
    for (const c of cats) if (c.includes(d)) return true;
  }
  return false;
}

// --------- ranking ----------

function scoreRestaurant(r: Restaurant, f: QueryFilters, prefs: Prefs | null): number {
  let score = 0;
  // base quality
  score += (r.rating ?? 0) * 2;
  score += (r.suggestion_level ?? 0) * 3;
  // district match
  if (f.districts.size && f.districts.has(r.district)) score += 15;
  // category match
  const cats = r.categories || [];
  for (const c of cats) if (f.categories.has(c)) score += 10;
  if (f.lateNight && cats.includes('宵夜')) score += 12;
  // price hints
  if (f.priceHint === 'cheap' && typeof r.avg_price === 'number' && r.avg_price <= 250) score += 5;
  if (f.priceHint === 'expensive' && typeof r.avg_price === 'number' && r.avg_price >= 800) score += 5;
  // soft pref boost: if user interests include "food" we trust popularity more
  if (prefs?.interests.includes('food')) score += (r.rating ?? 0);
  return score;
}

export type FilterResult = {
  picks: Restaurant[];
  filters: QueryFilters;
  /** Whether the user asked for a specific dish (臭豆腐, 壽司, 滷味 etc.). */
  dishMode: boolean;
  /** How many restaurants in the DB match the dish term (before ranking/limit). 0 means we genuinely don't have it. */
  dishMatchCount: number;
};

export function filterRestaurants(
  all: Restaurant[],
  query: string,
  prefs: Prefs | null,
  limit = 20,
): FilterResult {
  const filters = extractFilters(query, prefs);
  const dishMode = filters.dishes.size > 0;

  // ── Strict dish mode ──────────────────────────────────────────────────────
  // User asked for a specific dish (臭豆腐, 壽司, 滷味…). We only return actual
  // matches — no silent fallback to the full set. If we have 0, the caller
  // tells Gemini "we don't have that" and Gemini tells the user honestly.
  if (dishMode) {
    let dishPool = all.filter((r) => restaurantMatchesDishes(r, filters.dishes));
    const dishMatchCount = dishPool.length;

    // Within the dish pool, still honor district if it was specified.
    if (filters.districts.size) {
      const withDistrict = dishPool.filter((r) => filters.districts.has(r.district));
      // Only narrow if it still leaves us something — otherwise the district was too tight.
      if (withDistrict.length >= 3) dishPool = withDistrict;
    }

    const ranked = dishPool
      .map((r) => ({ r, s: scoreRestaurant(r, filters, prefs) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.r);

    return { picks: ranked, filters, dishMode: true, dishMatchCount };
  }

  // ── Normal mode ───────────────────────────────────────────────────────────
  const hasAnyFilter =
    filters.districts.size || filters.categories.size || filters.tags.size || filters.priceHint || filters.lateNight;

  let pool = all;
  if (hasAnyFilter) {
    pool = all.filter((r) => {
      if (filters.districts.size && !filters.districts.has(r.district)) return false;
      if (filters.categories.size) {
        const hit = (r.categories || []).some((c) => filters.categories.has(c));
        if (!hit) return false;
      }
      if (filters.lateNight) {
        if (!(r.categories || []).includes('宵夜')) return false;
      }
      return true;
    });
    // If the filters were too strict, relax to "district OR category"
    if (pool.length < 5) {
      pool = all.filter(
        (r) =>
          (filters.districts.size && filters.districts.has(r.district)) ||
          (filters.categories.size && (r.categories || []).some((c) => filters.categories.has(c))),
      );
    }
    // Final fallback: top-rated everywhere
    if (pool.length < 5) pool = all;
  }

  const ranked = pool
    .map((r) => ({ r, s: scoreRestaurant(r, filters, prefs) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);

  return { picks: ranked, filters, dishMode: false, dishMatchCount: 0 };
}

export function filterAttractions(all: Attraction[], query: string, prefs: Prefs | null): Attraction[] {
  const f = extractFilters(query, prefs);
  const prefInterests = new Set(prefs?.interests ?? []);
  const scored = all.map((a) => {
    let s = 0;
    if (f.districts.size && districtMatches(a.district, f.districts)) s += 10;
    for (const c of a.category || []) {
      if (f.categories.size && attractionCategoryMatchesFilter(c, f.categories)) s += 5;
      for (const interest of prefInterests) {
        if (attractionCategoryMatchesInterest(c, interest)) s += 3;
      }
    }
    for (const t of a.tags || []) if (f.tags.has(t)) s += 6;
    return { a, s };
  });
  // Always return all 78 attractions (small dataset), but sort so best matches lead
  return scored.sort((x, y) => y.s - x.s).map((x) => x.a);
}

// --------- hotel filtering ----------

/** Keywords that suggest the user is asking about accommodation */
const HOTEL_KEYWORDS = [
  'hotel', 'stay', 'sleep', 'accommodation', 'hostel', 'inn', 'lodge', 'motel',
  'check in', 'room', 'booking', 'airbnb', 'book',
  '旅館', '旅宿', '住宿', '飯店', '民宿', '訂房', '房間', '入住',
  'ホテル', '宿泊', '旅館', '民宿', 'チェックイン',
  '호텔', '숙박', '여관', '체크인', '예약',
];

export function queryWantsHotels(query: string): boolean {
  const q = query.toLowerCase();
  return HOTEL_KEYWORDS.some((kw) => q.includes(kw));
}

export function filterHotels(
  all: Hotel[],
  query: string,
  prefs: Prefs | null,
  limit = 12,
): Hotel[] {
  const f = extractFilters(query, prefs);

  // Price keywords
  const q = query.toLowerCase();
  const wantsCheap = /cheap|budget|affordable|便宜|お手頃|저렴/i.test(q);
  const wantsLuxury = /luxury|fancy|high.end|高級|luxe|럭셔리/i.test(q);

  let pool = all;

  // District filter
  if (f.districts.size) {
    const byDistrict = all.filter((h) => f.districts.has(h.district));
    if (byDistrict.length >= 3) pool = byDistrict;
  }

  // Price filter
  if (wantsCheap) {
    const cheap = pool.filter((h) => h.lowest_price !== null && h.lowest_price < 3000);
    if (cheap.length >= 3) pool = cheap;
  } else if (wantsLuxury) {
    const luxury = pool.filter((h) => h.highest_price !== null && h.highest_price >= 10000);
    if (luxury.length >= 3) pool = luxury;
  }

  // MRT keyword match
  const mrtHit = [...f.districts].find((d) => d);
  if (mrtHit) {
    // already filtered by district above
  }

  // Sort: prefer hotels with both prices set, then by lowest_price asc
  pool = [...pool].sort((a, b) => {
    const ap = a.lowest_price ?? 999999;
    const bp = b.lowest_price ?? 999999;
    return wantsLuxury ? bp - ap : ap - bp;
  });

  return pool.slice(0, limit);
}

// --------- prompt building ----------

const SYSTEM_BY_LANG: Record<Lang, string> = {
  en: `You are Taipei Compass — a grounded travel assistant for Taipei.

LANGUAGE RULE (mandatory, highest priority): Always reply in English regardless of the user's language.

GROUNDING RULE: Only recommend places that appear in the ATTRACTIONS, RESTAURANTS, or HOTELS lists below. Never invent names, ratings, prices, or hours. Use exact names from the lists.

RECOMMENDATION COUNT RULE (mandatory): Recommend exactly 3–5 places per response. Never list more than 5. If you have many good matches, pick the best 3–5 and offer to show more if asked.

CLARIFICATION RULE (mandatory): If the user's request is vague — missing key details like cuisine type, activity type, vibe, district, budget, or time of day — you MUST ask 1–2 short clarifying questions BEFORE making recommendations. Format each clarifying question as a single line followed by 3–5 suggestion options on the next line, each option wrapped in double square brackets like [[Option]]. Example:
What kind of food are you in the mood for?
[[Taiwanese]] [[Japanese]] [[Italian]] [[Vegetarian]] [[Surprise me]]
Only ask clarifications when genuinely needed — if the request is specific enough, go straight to recommendations.

CONCISENESS RULE: Keep answers to 2–4 short paragraphs. Use bullet lists only when recommending 3 or more places.`,

  zh: `你是「台北指南針」——一位受資料約束的台北旅遊助手。

語言規則（強制，最高優先）：無論使用者用什麼語言提問，一律使用繁體中文回答。

資料規則：只能推薦下方 ATTRACTIONS、RESTAURANTS 或 HOTELS 清單中的地點。不可自行編造店名、評分、價格或營業時間，引用時使用清單原始名稱。

推薦數量規則（強制）：每次回應只推薦 3–5 個地點，絕對不超過 5 個。若有很多符合選項，挑最好的 3–5 個，並告知使用者可以繼續詢問更多。

追問規則（強制）：若使用者的要求不夠具體——缺少料理類型、活動性質、氛圍、行政區、預算或時段等關鍵資訊——必須先問 1–2 個簡短的釐清問題，再做推薦。每個問題後一行列出 3–5 個選項，每個選項用雙方括號包住，例如：
你今天想吃什麼類型的料理？
[[台式料理]] [[日式料理]] [[義式料理]] [[素食]] [[都可以]]
只在真的需要時才追問——如果請求已夠具體，直接給推薦即可。

簡潔規則：回答保持 2–4 段，只有一次推薦 3 個以上地點時才使用條列。`,

  jp: `あなたは「台北コンパス」——データに忠実な台北旅行アシスタントです。

言語ルール（必須・最優先）：ユーザーがどの言語で話しかけてきても、必ず日本語で返答してください。

グラウンディングルール：下記の ATTRACTIONS・RESTAURANTS・HOTELS リストにある場所のみを推薦してください。店名・評価・価格・営業時間を勝手に作らないこと。引用はリストの原文名を使用。

推薦件数ルール（必須）：1回の返答で推薦するのは必ず3〜5件。5件を超えないこと。候補が多い場合は最良の3〜5件を選び、希望があればさらに紹介できると伝えてください。

確認質問ルール（必須）：ユーザーのリクエストが曖昧な場合——料理の種類・活動・雰囲気・エリア・予算・時間帯などの情報が不足している場合——推薦する前に1〜2つの簡潔な確認質問をしてください。各質問の次の行に3〜5つの選択肢を二重角括弧で囲んで記載してください。例：
どんな料理がお好みですか？
[[台湾料理]] [[日本料理]] [[イタリアン]] [[ベジタリアン]] [[おまかせ]]
本当に必要な場合のみ質問してください。リクエストが十分に具体的であれば、すぐに推薦に進んでください。

簡潔ルール：回答は2〜4段落以内。3件以上推薦する場合のみ箇条書きを使います。`,

  kr: `당신은 「타이베이 나침반」 — 데이터에 근거한 타이베이 여행 도우미입니다.

언어 규칙 (필수, 최우선): 사용자가 어떤 언어로 질문하든 반드시 한국어로만 답변하세요.

근거 규칙: 아래 ATTRACTIONS, RESTAURANTS, HOTELS 목록에 있는 장소만 추천하세요. 이름·평점·가격·영업시간을 임의로 만들지 마세요. 인용 시 목록의 원본 이름을 그대로 사용하세요.

추천 수 규칙 (필수): 한 번에 반드시 3–5곳만 추천하세요. 절대 5곳을 초과하지 마세요. 후보가 많다면 최선의 3–5곳을 선택하고, 더 원하면 추가로 알려드릴 수 있다고 안내하세요.

명확화 규칙 (필수): 사용자의 요청이 모호한 경우——음식 종류, 활동 유형, 분위기, 지역, 예산, 시간대 등 핵심 정보가 없는 경우——추천하기 전에 1–2개의 짧은 확인 질문을 하세요. 각 질문 다음 줄에 3–5개의 선택지를 이중 대괄호로 감싸서 작성하세요. 예시:
어떤 종류의 음식을 원하세요?
[[한식]] [[일식]] [[이탈리안]] [[채식]] [[아무거나]]
정말 필요한 경우에만 질문하세요. 요청이 충분히 구체적이면 바로 추천으로 넘어가세요.

간결성 규칙: 2–4 단락으로 답변하세요. 3곳 이상 추천할 때만 글머리 기호를 사용하세요.`,
};

export function buildSystemPrompt(
  lang: Lang,
  attractions: Attraction[],
  mrt: MrtStation[],
  restaurants: Restaurant[],
  prefs: Prefs | null,
  coverage?: { dishQuery: string | null; matchCount: number },
  hotels?: Hotel[],
  weatherContext?: WeatherContext,
  locationContext?: LocationContext
): string {
  const base = SYSTEM_BY_LANG[lang];

  const prefBlock = prefs && (prefs.interests.length || prefs.districts.length || prefs.pace || prefs.days)
    ? `\nUSER_PREFERENCES (soft bias — weight suggestions accordingly):\n${JSON.stringify(prefs)}`
    : '';

  // ── Coverage/honesty block ──────────────────────────────────────────────
  // When the user asks for a specific dish (臭豆腐, 壽司, 滷味...), we tell
  // the model exactly how many restaurants we actually have for that dish.
  // With 0 matches the model MUST say "I don't have that in my guide" instead
  // of substituting with Solo Pasta, Da'an top-rated, or anything similar.
  let coverageBlock = '';
  if (coverage && coverage.dishQuery) {
    const n = coverage.matchCount;
    if (n === 0) {
      coverageBlock = `
DISH_COVERAGE:
- The user asked about: "${coverage.dishQuery}"
- Restaurants matching this dish in our database: 0
- HONESTY RULE (MANDATORY): You MUST tell the user that we currently have no "${coverage.dishQuery}" restaurants in our guide. Do NOT substitute with unrelated restaurants just to fill space. You may offer to show something related (e.g. the same cuisine category) but only if you clearly label it as a substitute, and only using real entries from the RESTAURANTS list. Never invent.`;
    } else if (n < 5) {
      coverageBlock = `
DISH_COVERAGE:
- The user asked about: "${coverage.dishQuery}"
- Restaurants matching this dish in our database: ${n} (limited)
- HONESTY RULE: Our coverage for "${coverage.dishQuery}" is thin — only ${n} spots in the RESTAURANTS list actually match. Tell the user this is a small selection. Do NOT pad with unrelated restaurants.`;
    } else {
      coverageBlock = `
DISH_COVERAGE:
- The user asked about: "${coverage.dishQuery}"
- Restaurants matching this dish in our database: ${n}
- All restaurants shown below already match "${coverage.dishQuery}". Pick the best 3–5.`;
    }
  }

  // Compact attractions: 78 entries, keep only fields the model needs.
  // `id` here is the attraction's own id field, used as the detail-page slug.
  const attrCompact = attractions.map((a) => ({
    id: a.id,
    name: a.name,
    district: a.district,
    category: a.category,
    tags: a.tags ?? [],
    mrt: a.nearby_mrt ?? null,
    summary: (a.description || '').slice(0, 120),
  }));

  // MRT: just name + coord so the model can mention nearby stations.
  const mrtCompact = mrt.map((s) => ({ name: s.name, lat: s.lat, lng: s.lng }));

  // Restaurants: these come pre-filtered to ~20 by the caller. Include `_idx`
  // as the detail-page ID so the model can cite it in place markers.
  const rCompact = restaurants.map((r) => ({
    id: r._idx,
    name: r.name,
    district: r.district,
    categories: r.categories,
    rating: r.rating,
    avg_price: r.avg_price,
    map: r.google_map,
  }));

  // A place-marker convention lets the UI turn each recommendation into a rich
  // clickable card that opens /place/a/<id>, /place/r/<id>, or /hotel/<id>.
  // We tell the model to wrap EVERY place it mentions in a marker — never invent IDs.
  const markerRule = `
PLACE-CITATION RULE (very important):
- Every time you mention a specific attraction, restaurant, or hotel, you MUST wrap the name in a place marker so the UI can render it as a tappable card:
    <<PLACE:a:ID>>Name<</PLACE>>     (for attractions — use the "id" field from ATTRACTIONS)
    <<PLACE:r:ID>>Name<</PLACE>>     (for restaurants — use the "id" field from RESTAURANTS)
    <<PLACE:h:ID>>Name<</PLACE>>     (for hotels — use the "id" field from HOTELS)
- Only use IDs that exist in the lists below. Never guess, invent, or alter an ID.
- If you want to mention a place that isn't in the lists, DON'T — pick something that is, or say nothing.
- MRT stations are NOT places — do NOT wrap them in any marker. Just mention them by name in plain text.
- Only three valid marker types exist: a, r, h. Never use any other type such as m, s, or anything else.
- You may still write normal prose around the markers. Short bullets work best.
- Keep replies under ~150 words unless the user asks for a full itinerary.
- SAFETY RULE: If the user asks about accommodation or booking a hotel, ALWAYS mention that every hotel in the HOTELS list is legally registered with the Taipei City Government, and warn them to verify any listing not on this list using the Safe Stay checker (/hotel-check).`;

  // Hotels: compact representation for the prompt
  const hotelBlock = hotels && hotels.length > 0
    ? [
        '\nHOTELS (legally registered Taipei hotels matching this query — ALL are verified by Taipei City Government):',
        JSON.stringify(hotels.map((h) => ({
          id: h.id,
          name: h.name,
          district: h.district,
          location: h.location,
          mrt: h.closest_mrt,
          price_range: h.lowest_price && h.highest_price
            ? `NT$${h.lowest_price.toLocaleString()}–NT$${h.highest_price.toLocaleString()}`
            : null,
          rooms: h.rooms,
          legal_id: h.legal_id,
        }))),
      ].join('\n')
    : '';

  const weatherBlock = weatherContext
    ? `\nREAL_TIME_WEATHER_CONTEXT (highest priority after safety and grounding rules):\n${weatherContext}\nUse this to bias recommendations. If weather is rainy, misty, stormy, or very hot, prefer indoor or weather-safe venues when relevant.`
    : '';

  let locationBlock = '';
  if (locationContext) {
    const coordText = locationContext.lat != null && locationContext.lng != null
      ? ` Approximate coordinates: ${locationContext.lat.toFixed(5)}, ${locationContext.lng.toFixed(5)}.`
      : '';
    locationBlock = `\nREAL_TIME_LOCATION_CONTEXT (highest priority after safety and grounding rules):\nUser is currently near ${locationContext.district ?? 'central Taipei'}.${coordText}`;
    if (locationContext.nearbyNames.length) {
      locationBlock += `\nAttractions within ~${locationContext.radiusKm} km: ${locationContext.nearbyNames.slice(0, 8).join(', ')}.`;
      locationBlock += '\nPrioritise these nearby places when relevant, especially for "near me", short-trip, now, or walkable requests.';
    }
  }

  return [
    base,
    markerRule,
    coverageBlock,
    weatherBlock,
    locationBlock,
    prefBlock,
    `\nATTRACTIONS (${attrCompact.length} curated in our guide, suggestion_level=3):`,
    JSON.stringify(attrCompact),
    '\nMRT_STATIONS (121 Taipei Metro stops, name + coord):',
    JSON.stringify(mrtCompact),
    '\nRESTAURANTS (top matches for this query, already filtered from our 8,269-entry database):',
    JSON.stringify(rCompact),
    hotelBlock,
  ].filter(Boolean).join('\n');
}

// Fetch restaurants.json lazily, cache after first load. Stamp each entry
// with its original array index so we can link the AI's recommendations
// directly to /place/r/<idx>.
let _restaurantsCache: Restaurant[] | null = null;
export async function loadRestaurants(): Promise<Restaurant[]> {
  if (_restaurantsCache) return _restaurantsCache;
  const res = await fetch('/data/restaurants.json');
  if (!res.ok) throw new Error(`Failed to load restaurants.json: ${res.status}`);
  const raw = (await res.json()) as Restaurant[];
  _restaurantsCache = raw.map((r, i) => ({ ...r, _idx: i }));
  return _restaurantsCache;
}

// Lazy hotel cache
let _hotelsCache: Hotel[] | null = null;
export async function loadHotels(): Promise<Hotel[]> {
  if (_hotelsCache) return _hotelsCache;
  _hotelsCache = getHotelsForLang('zh') as Hotel[];
  return _hotelsCache;
}

// Convenience for the AI page: given a user question, return the full grounded prompt.
export async function buildGroundedPrompt(
  lang: Lang,
  userQuery: string,
  attractions: Attraction[],
  mrt: MrtStation[],
  weatherContext?: WeatherContext,
  locationContext?: LocationContext,
): Promise<{ systemPrompt: string; picks: Restaurant[]; dishMode: boolean; dishMatchCount: number; hotelPicks: Hotel[] }> {
  const prefs = loadPrefs();
  const all = await loadRestaurants();
  const { picks, filters, dishMode, dishMatchCount } = filterRestaurants(all, userQuery, prefs, 20);
  const filteredAttractions = filterAttractions(attractions, userQuery, prefs);
  const coverage = dishMode
    ? { dishQuery: filters.dishQuery, matchCount: dishMatchCount }
    : undefined;

  // Include hotels if the query is about accommodation
  let hotelPicks: Hotel[] = [];
  if (queryWantsHotels(userQuery)) {
    const allHotels = await loadHotels();
    hotelPicks = filterHotels(allHotels, userQuery, prefs, 12);
  }

  const systemPrompt = buildSystemPrompt(
    lang, filteredAttractions, mrt, picks, prefs, coverage,
    hotelPicks.length > 0 ? hotelPicks : undefined,
    weatherContext,
    locationContext,
  );
  return { systemPrompt, picks, dishMode, dishMatchCount, hotelPicks };
}
