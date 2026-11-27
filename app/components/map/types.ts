import type { Category, ListingType, RentPeriod } from "~/shared/constants";
import type { BBox } from "~/shared/geo";

/** Client-side mirrors of the /api/v1 map payloads (server/services/searchService.ts, areaService.ts). */

export interface AreaLevelInfo {
  level: string;
  minZoom: number;
}

export interface AreaSummary {
  id: number;
  parentId: number | null;
  level: string;
  nameAr: string;
  nameEn: string;
  bbox: BBox;
}

export interface PointFeature {
  type: "Feature";
  id: number;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: number;
    price: number | null;
    currency: string;
    listing_type: ListingType;
    rent_period: RentPeriod | null;
    category: Category;
    is_featured: boolean;
    /** Pin text, added on the client ("85K", "450/mo"). */
    label?: string;
  };
}

export interface MapPoints {
  type: "FeatureCollection";
  features: PointFeature[];
}

export interface ListingCard {
  id: number;
  title: string;
  price: number | null;
  currency: string;
  listingType: ListingType;
  rentPeriod: RentPeriod | null;
  category: Category;
  areaName: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  isFeatured: boolean;
  thumbnailUrl: string | null;
}

export interface ListingsPage {
  items: ListingCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ViewChange {
  lng: number;
  lat: number;
  zoom: number;
  bbox: BBox;
}
