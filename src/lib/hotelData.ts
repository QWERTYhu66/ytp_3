import enrichedHotels from '../../scripts/hotel/taipei_travel_hotels_enriched_with_stars.json';

export type HotelLanguage = 'en' | 'zh' | 'jp' | 'kr';

export type Hotel = {
  id: string;
  legal_id: string;
  name: string;
  name_zh: string;
  name_en: string;
  location: string;
  address: string;
  address_zh: string;
  address_en: string;
  district: string;
  district_zh: string;
  district_en: string;
  district_jp: string;
  district_kr: string;
  lowest_price: number | null;
  highest_price: number | null;
  rooms: number | null;
  phone: string | null;
  closest_mrt: string;
  booking_link: string | null;
  official_star_rating: number;
  official_star_source: string | null;
  official_update_time: string | null;
};

type EnrichedHotel = {
  taipei_travel_index?: number;
  name_zh?: string | null;
  name_en?: string | null;
  address_zh?: string | null;
  address_en?: string | null;
  phone?: string | null;
  rooms?: number | null;
  lowest_price_twd?: number | null;
  highest_price_twd?: number | null;
  official_lowest_price_twd?: number | null;
  official_ceiling_price_twd?: number | null;
  official_star_rating?: number | null;
  official_star_source?: string | null;
  official_update_time?: string | null;
  legal_id?: string | null;
  official_license_number?: string | null;
  district_zh?: string | null;
  district_en?: string | null;
  closest_mrt?: string | null;
};

const districtLabels: Record<string, { jp: string; kr: string }> = {
  中正區: { jp: '中正区', kr: '중정구' },
  大同區: { jp: '大同区', kr: '다퉁구' },
  中山區: { jp: '中山区', kr: '중산구' },
  松山區: { jp: '松山区', kr: '쑹산구' },
  大安區: { jp: '大安区', kr: '다안구' },
  萬華區: { jp: '万華区', kr: '완화구' },
  信義區: { jp: '信義区', kr: '신이구' },
  士林區: { jp: '士林区', kr: '스린구' },
  北投區: { jp: '北投区', kr: '베이터우구' },
  內湖區: { jp: '内湖区', kr: '네이후구' },
  南港區: { jp: '南港区', kr: '난강구' },
  文山區: { jp: '文山区', kr: '원산구' },
};

const clean = (value?: string | null) => String(value || '').trim();

const normalizeHotel = (hotel: EnrichedHotel, index: number): Hotel => {
  const districtZh = clean(hotel.district_zh) || '臺北市';
  const labels = districtLabels[districtZh];
  const low = hotel.official_lowest_price_twd ?? hotel.lowest_price_twd ?? null;
  const high = hotel.official_ceiling_price_twd ?? hotel.highest_price_twd ?? null;
  const nameZh = clean(hotel.name_zh) || clean(hotel.name_en) || `Taipei Hotel ${index + 1}`;
  const nameEn = clean(hotel.name_en) || nameZh;
  const addressZh = clean(hotel.address_zh);
  const addressEn = clean(hotel.address_en) || addressZh;

  return {
    id: String(hotel.taipei_travel_index ?? index),
    legal_id: clean(hotel.official_license_number) || clean(hotel.legal_id),
    name: nameZh,
    name_zh: nameZh,
    name_en: nameEn,
    location: addressZh || addressEn,
    address: addressZh || addressEn,
    address_zh: addressZh || addressEn,
    address_en: addressEn || addressZh,
    district: districtZh,
    district_zh: districtZh,
    district_en: clean(hotel.district_en) || districtZh,
    district_jp: labels?.jp || districtZh,
    district_kr: labels?.kr || districtZh,
    lowest_price: low,
    highest_price: high,
    rooms: hotel.rooms ?? null,
    phone: clean(hotel.phone) || null,
    closest_mrt: clean(hotel.closest_mrt),
    booking_link: null,
    official_star_rating: hotel.official_star_rating ?? 0,
    official_star_source: hotel.official_star_source ?? null,
    official_update_time: hotel.official_update_time ?? null,
  };
};

export const hotelList = (enrichedHotels as EnrichedHotel[]).map(normalizeHotel);

export const getHotelsForLang = (lang: HotelLanguage = 'zh') =>
  hotelList.map((hotel) => {
    const useEnglishData = lang === 'en';
    return {
      ...hotel,
      name: useEnglishData ? hotel.name_en : hotel.name_zh,
      address: useEnglishData ? hotel.address_en : hotel.address_zh,
      location: useEnglishData ? hotel.address_en : hotel.address_zh,
      district:
        lang === 'en'
          ? hotel.district_en
          : lang === 'jp'
            ? hotel.district_jp
            : lang === 'kr'
              ? hotel.district_kr
              : hotel.district_zh,
    };
  });
