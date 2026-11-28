import { findAvailability, localDay, publicListing } from "./model.js?v=rento-home-5-ren";
import { depositBlock } from "./listing-pricing.js";

const normalize = (value) => String(value ?? "").normalize("NFC").toLowerCase().trim();

export function rankListings({ items, rentals, availability = rentals, uid, area, isFavorite, filters, policy, requireValue = false, today = localDay() }) {
  const terms = normalize(filters.query).split(/\s+/).filter(Boolean);
  const byId = new Map(items.map((item) => [item.id, item]));
  const categories = new Map();
  for (const item of items) {
    if (isFavorite(item.id)) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
  }
  for (const rental of rentals) {
    const category = byId.get(rental.itemId)?.category;
    if (category && rental.renterId === uid && rental.status === "complete") {
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
  }
  const first = filters.date?.start || today;
  const last = filters.date?.end || first;
  const rows = [];
  for (const item of items) {
    if (!publicListing(item)) continue;
    const title = normalize(item.title);
    const searchable = [title, item.category, item.neighborhood, item.description].map(normalize).join(" ");
    if ((filters.category && filters.category !== "전체" && item.category !== filters.category)
        || (filters.maxPrice != null && item.price > filters.maxPrice)
        || !terms.every((term) => searchable.includes(term))) continue;
    const available = uid !== "admin" && item.owner !== uid && !depositBlock(item, policy, requireValue)
      && !findAvailability(item, first, last, availability, undefined, today);
    if (filters.date?.start && !available) continue;
    const reasons = [];
    let score = 0;
    if (terms.length && terms.every((term) => title.includes(term))) { score += 40; reasons.push("물품명 검색 일치"); }
    if (item.neighborhood === area) { score += 20; reasons.push("내 동네"); }
    if (isFavorite(item.id)) { score += 12; reasons.push("관심 물품"); }
    const affinity = Math.min(categories.get(item.category) ?? 0, 3);
    if (affinity) { score += 5 * affinity; reasons.push("관심·대여 이력과 같은 분류"); }
    rows.push({ item, score, reasons, available });
  }
  return rows.sort((a, b) => Number(b.available) - Number(a.available) || b.score - a.score
    || a.item.price - b.item.price || (a.item.id < b.item.id ? -1 : a.item.id === b.item.id ? 0 : 1));
}

// Shared candidate contract for the AI chat owner. The AI receives no user histories.
export function recommendationCandidates(context) {
  return rankListings(context).filter((row) => row.available).map(({ item, score, reasons }) => ({
    id: item.id, title: item.title, category: item.category, neighborhood: item.neighborhood,
    price: item.price, description: (item.description ?? "").slice(0, 180),
    availability: context.filters.date?.start
      ? `${context.filters.date.start}~${context.filters.date.end || context.filters.date.start} 대여 가능` : "오늘 대여 가능",
    score, reasons,
  })).slice(0, 12);
}
