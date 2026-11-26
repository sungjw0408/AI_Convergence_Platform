export const categories = ["전체", "공구", "디지털", "생활용품", "캠핑·레저"];
export const neighborhoods = ["죽전동", "보정동"];
export const people = {
  renter: { name: "대여자", neighborhood: "죽전동" },
  lender: { name: "공급자", neighborhood: "죽전동" },
  admin: { name: "관리자", neighborhood: "죽전동" },
};

export const statuses = {
  pending: "승인 대기",
  confirmed: "예약 확정",
  rejected: "신청 거절",
  canceled: "취소됨",
  handover: "수령 확인 대기",
  active: "대여 중",
  checking: "반납 확인 중",
  disputed: "분쟁 검토 중",
  complete: "거래 완료",
};

export const catalog = [
  {
    id: "drill", title: "무선 전동드릴", category: "공구", owner: "lender",
    neighborhood: "죽전동", distance: "350m", price: 5000, image: "./assets/drill.webp",
    description: "가구 조립이나 간단한 집수리에 쓰기 좋아요. 배터리와 기본 비트를 같이 빌려드려요.",
  },
  {
    id: "projector", title: "미니 빔프로젝터", category: "디지털", owner: "lender",
    neighborhood: "보정동", distance: "800m", price: 9000, image: "./assets/projector.webp",
    description: "집에서 영화 볼 때 쓰던 소형 빔프로젝터예요. 리모컨과 전원 어댑터가 함께 있어요.",
    weekends: true,
  },
  {
    id: "ladder", title: "접이식 사다리", category: "생활용품", owner: "lender",
    neighborhood: "죽전동", distance: "1.2km", price: 4000, image: "./assets/ladder.webp",
    description: "높은 선반 정리나 전구 교체에 쓰기 좋은 3단 사다리예요. 접어서 이동할 수 있어요.",
  },
];

export function localDay(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return NaN;
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return NaN;
  return date.getTime() / 86_400_000;
}

export function rentalDays(start, end) {
  return dayNumber(end) - dayNumber(start) + 1;
}

export function findAvailability(item, start, end, rentals, ignoredRental) {
  const days = rentalDays(start, end);
  if (!Number.isFinite(days) || days < 1 || start < localDay()) return "유효한 대여 기간을 선택해 주세요.";
  if ((item.availableFrom && start < item.availableFrom) || (item.availableTo && end > item.availableTo)) {
    return "공급자가 설정한 대여 가능 기간을 선택해 주세요.";
  }
  if (item.weekends) {
    const weekday = new Date(start + "T00:00:00Z").getUTCDay();
    if (days > 2 || (weekday !== 6 && weekday !== 0) || (weekday === 0 && days > 1)) {
      return "이 물품은 주말에 대여할 수 있어요.";
    }
  }
  const occupies = ["confirmed", "handover", "active", "checking", "disputed"];
  const hasConflict = rentals.some((rental) => rental.id !== ignoredRental && rental.itemId === item.id
    && (["handover", "active", "checking"].includes(rental.status) || (rental.status === "disputed" && !rental.after)
      || (occupies.includes(rental.status) && start <= rental.end && rental.start <= end)));
  return hasConflict ? "선택한 기간에 대여할 수 없어요. 다른 날짜를 선택해 주세요." : "";
}

export function suggestedFields(title) {
  if (/드릴|드라이버|공구|렌치/.test(title)) return { category: "공구", price: 5000 };
  if (/빔|프로젝터|카메라|노트북|스피커/.test(title)) return { category: "디지털", price: 9000 };
  return { category: "생활용품", price: 4000 };
}

const storageKey = "neighbor-storage-demo-v1";

export function initialState() {
  return {
    role: "renter", area: "죽전동", favorites: [], listings: [], rentals: [], messages: {}, notices: [], memberships: {},
  };
}

export function readState(key = storageKey) {
  const initial = initialState();
  try {
    const stored = JSON.parse(localStorage.getItem(key));
    return stored ? { ...initial, ...stored } : initial;
  } catch {
    return initial;
  }
}

export function writeState(state, key = storageKey) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
