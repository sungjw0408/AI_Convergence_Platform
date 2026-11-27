"""Access rules for Firestore records owned by Firebase Auth users."""
import re
from datetime import date, datetime
from zoneinfo import ZoneInfo

from google.cloud.firestore_v1.base_query import FieldFilter

IDS = re.compile(r"[a-zA-Z0-9_-]{1,128}")
IMAGE = re.compile(r"data:image/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/]+=*")
CAPTURE = re.compile(r"capture:[a-f0-9-]{36}")
AREAS = {"죽전동", "보정동"}
CATEGORIES = {"공구", "디지털", "생활용품", "캠핑·레저"}
CHAT_STATUSES = {"confirmed", "handover", "active", "checking", "disputed", "complete"}
RENTAL_KEYS = {"id", "itemId", "renterId", "lenderId", "start", "end", "total", "deposit", "createdAt"}
TRANSITIONS = {
    ("pending", "confirmed"): "lenderId",
    ("pending", "rejected"): "lenderId",
    ("pending", "canceled"): "renterId",
    ("confirmed", "canceled"): "party",
    ("confirmed", "handover"): "lenderId",
    ("handover", "active"): "renterId",
    ("active", "checking"): "renterId",
    ("checking", "disputed"): "lenderId",
    ("checking", "complete"): "lenderId",
}


class ForbiddenRecord(PermissionError):
    pass


def require(condition):
    if not condition:
        raise ForbiddenRecord("이 기록을 저장할 권한이 없거나 데이터가 올바르지 않아요.")


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def text(value, limit, required=False):
    return isinstance(value, str) and len(value) <= limit and (not required or bool(value.strip()))


def integer(value, maximum):
    return type(value) is int and 0 <= value <= maximum


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("날짜 형식을 확인해 주세요.")
    return date.fromisoformat(value)


def query(root, name, field, op, value, transaction):
    return root.collection(name).where(filter=FieldFilter(field, op, value)).stream(transaction=transaction)


def account_documents(root, uid, transaction):
    rentals = {}
    for field in ("renterId", "lenderId"):
        for doc in query(root, "rentals", field, "==", uid, transaction):
            rentals[doc.id] = doc.to_dict()
    profile = root.collection("profiles").document(uid).get(transaction=transaction).to_dict()
    return {
        "listings": [doc.to_dict() for doc in root.collection("listings").stream(transaction=transaction)],
        "rentals": list(rentals.values()),
        "messages": [doc.to_dict() for doc in query(root, "messages", "participantIds", "array_contains", uid, transaction)
                     if doc.get("rentalId") in rentals],
        "notices": [doc.to_dict() for doc in query(root, "notices", "role", "==", uid, transaction)],
        "profiles": [profile] if profile else [],
    }


def validate_listing(record, uid, current):
    require(not current and record.get("owner") == uid)
    require(set(record) <= {"id", "title", "description", "category", "neighborhood", "price", "deposit",
                            "image", "availableFrom", "availableTo", "owner", "createdAt",
                            "photos", "coverPhotoId", "inspectionPlan"})
    require(text(record.get("title"), 48, True) and text(record.get("description"), 600, True))
    require(record.get("category") in CATEGORIES and record.get("neighborhood") in AREAS)
    require(integer(record.get("price"), 10_000_000) and integer(record.get("deposit"), 10_000_000))
    require(integer(record.get("createdAt"), 2**53 - 1))
    image = record.get("image")
    require(image == "" or matches(IMAGE, image))
    if {"photos", "coverPhotoId", "inspectionPlan"} & record.keys():
        validate_listing_photos(record)
    if record.get("availableFrom") or record.get("availableTo"):
        require(day(record.get("availableFrom")) <= day(record.get("availableTo")))


def check_availability(root, transaction, record, item, *, confirming):
    start, end = day(record.get("start")), day(record.get("end"))
    today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    require(today <= start <= end)
    if item.get("availableFrom"):
        require(day(item["availableFrom"]) <= start <= end <= day(item["availableTo"]))
    for snapshot in query(root, "rentals", "itemId", "==", record["itemId"], transaction):
        other = snapshot.to_dict()
        if other["id"] == record["id"]:
            continue
        overlap = record["start"] <= other["end"] and other["start"] <= record["end"]
        if other["status"] in ("handover", "active", "checking") or (other["status"] == "disputed" and not other.get("after")):
            raise ValueError("물품이 이미 대여 중이에요.")
        if overlap and (other["status"] in ("confirmed", "disputed") or (
            not confirming and other["status"] == "pending" and other["renterId"] == record["renterId"]
        )):
            raise ValueError("이미 예약되었거나 신청한 날짜예요.")
    return (end - start).days + 1


def validate_plan(plan):
    require(isinstance(plan, dict) and isinstance(plan.get("views"), list) and 1 <= len(plan["views"]) <= 4)
    require(isinstance(plan.get("checks"), list) and len(plan["checks"]) <= 8)
    require(all(isinstance(view, dict) and matches(IDS, view.get("id"))
                and text(view.get("label"), 100, True) and text(view.get("instruction"), 250, True)
                and type(view.get("compare")) is bool for view in plan["views"]))
    require(all(isinstance(check, dict) and matches(IDS, check.get("id")) and text(check.get("label"), 200, True)
                for check in plan["checks"]))


def validate_listing_photos(record):
    plan = record.get("inspectionPlan")
    validate_plan(plan)
    photos = record.get("photos")
    require(isinstance(photos, list) and 1 <= len(photos) <= 8)
    required_views = {view["id"] for view in plan["views"]}
    photos_by_id = {}
    assigned_views = []
    for photo in photos:
        require(isinstance(photo, dict) and matches(IDS, photo.get("id")))
        require(photo.get("origin") == "camera" and text(photo.get("label"), 100, True))
        source = photo.get("source")
        require(matches(IMAGE, source) and len(source) <= 95_000)
        view = photo.get("viewId")
        require(isinstance(view, str) and (not view or view in required_views))
        if view:
            assigned_views.append(view)
        photos_by_id[photo["id"]] = source
    require(len(photos_by_id) == len(photos) and len(assigned_views) == len(required_views)
            and set(assigned_views) == required_views)
    cover_id = record.get("coverPhotoId")
    require(matches(IDS, cover_id) and photos_by_id.get(cover_id) == record["image"])


def validate_inspection(record, field):
    inspection = record.get("inspection")
    require(isinstance(inspection, dict))
    plan = inspection.get("plan")
    validate_plan(plan)
    for phase in ("before", "after"):
        photos = inspection.get(phase)
        require(isinstance(photos, dict) and len(photos) <= 4)
        if phase == field or photos:
            require(set(photos) == {view["id"] for view in plan["views"]})
            require(all(isinstance(photo, dict) and matches(CAPTURE, photo.get("source")) for photo in photos.values()))
            require(record.get(phase) in {photo["source"] for photo in photos.values()})
        require(text(inspection.get(phase + "Note", ""), 500))
        checks = inspection.get(phase + "Checks", [])
        require(isinstance(checks, list) and all(matches(IDS, check) for check in checks))
    results = inspection.get("results", {})
    require(isinstance(results, dict) and len(results) <= 4)
    for result in results.values():
        require(isinstance(result, dict) and result.get("status") in ("clear", "changes", "retake"))
        regions = result.get("regions", [])
        require(isinstance(regions, list) and len(regions) <= 100)
        require(all(isinstance(region, list) and len(region) == 4 and
                    all(type(n) in (int, float) and 0 <= n <= 1 for n in region) for region in regions))
        if result["status"] == "changes":
            require(bool(regions))


def validate_rental(root, transaction, uid, record, current):
    if current and current.get("lifecycleVersion") == 1:
        # Command-only state machine: never accept a client-provided payment/state change.
        allowed = {"inspection", "photoAnalysis", "review"}
        require(all(record.get(k) == current.get(k) for k in record.keys() | current.keys() if k not in allowed))
    require(matches(IDS, record.get("itemId")))
    if not current:
        require(set(record) == RENTAL_KEYS | {"status"} and record.get("status") == "pending" and record.get("renterId") == uid)
        item = root.collection("listings").document(record["itemId"]).get(transaction=transaction).to_dict()
        require(item and record.get("lenderId") == item["owner"] and item["owner"] != uid)
        days = check_availability(root, transaction, record, item, confirming=False)
        require(record["total"] == item["price"] * days and record["deposit"] == item["deposit"])
        require(integer(record["createdAt"], 2**53 - 1))
        return

    require(uid in (current["renterId"], current["lenderId"]))
    require(all(record.get(key) == current.get(key) for key in RENTAL_KEYS))
    previous, status = current["status"], record.get("status")
    require(isinstance(status, str))
    allowed = {"status"}
    if status != previous:
        actor = TRANSITIONS.get((previous, status))
        require(actor and (actor == "party" or current[actor] == uid))
        if status == "confirmed":
            item = root.collection("listings").document(record["itemId"]).get(transaction=transaction).to_dict()
            require(item)
            check_availability(root, transaction, record, item, confirming=True)
        if status == "handover":
            validate_inspection(record, "before")
            allowed.update(("inspection", "before"))
        elif status == "checking":
            validate_inspection(record, "after")
            allowed.update(("inspection", "after"))
        elif status == "disputed":
            require(text(record.get("dispute"), 500, True) and record.get("resolution", "") == "")
            allowed.update(("dispute", "resolution"))
    elif status == "complete" and uid == current["renterId"] and not current.get("review"):
        review = record.get("review")
        require(isinstance(review, dict) and integer(review.get("rating"), 5) and review["rating"] >= 1
                and text(review.get("text"), 500, True))
        allowed.add("review")
    elif status == "checking":
        validate_inspection(record, "after")
        if uid == current["lenderId"]:
            require({k: v for k, v in record["inspection"].items() if k != "results"} ==
                    {k: v for k, v in current["inspection"].items() if k != "results"})
        else:
            allowed.add("after")
        allowed.add("inspection")
    require(all(record.get(key) == current.get(key) for key in record.keys() | current.keys() if key not in allowed))
    if "inspection" in allowed and current.get("inspection"):
        require(all(record["inspection"].get(key) == current["inspection"].get(key)
                    for key in ("plan", "before", "beforeNote", "beforeChecks")))


def authorize_updates(root, transaction, uid, updates):
    from rental_database import app_fields

    changes = {(name, record["id"]): record for name, record in updates}
    require(len(changes) == len(updates))
    existing = {key: root.collection(key[0]).document(key[1]).get(transaction=transaction).to_dict() for key in changes}
    result = []
    for (name, record_id), record in changes.items():
        current = existing[(name, record_id)]
        if current and name == "rentals":
            current = app_fields(current)
        if name == "profiles":
            favorites = record.get("favorites")
            require(record_id == uid and set(record) == {"id", "area", "favorites"} and record.get("area") in AREAS)
            require(isinstance(favorites, list) and len(favorites) <= 500
                    and all(matches(IDS, item) for item in favorites))
        elif name == "listings":
            validate_listing(record, uid, current)
        elif name == "rentals":
            validate_rental(root, transaction, uid, record, current)
        elif name == "messages":
            rental = root.collection("rentals").document(record["rentalId"]).get(transaction=transaction).to_dict()
            require(rental and uid in (rental["renterId"], rental["lenderId"]) and rental["status"] in CHAT_STATUSES)
            require(not current and record.get("sender") == uid and text(record.get("text"), 350, True))
            require(integer(record.get("sentAt"), 2**53 - 1))
            record = {key: record[key] for key in ("id", "rentalId", "sender", "text", "sentAt")}
            record["participantIds"] = [rental["renterId"], rental["lenderId"]]
        elif current:
            require(current["role"] == uid and record == {**current, "read": True})
        else:
            rental = changes.get(("rentals", record["rentalId"]))
            require(rental and uid in (rental.get("renterId"), rental.get("lenderId"))
                    and record.get("role") in (rental.get("renterId"), rental.get("lenderId")) and record["role"] != uid)
            require(set(record) == {"id", "rentalId", "role", "message", "createdAt", "read"})
            require(text(record.get("message"), 160, True) and record.get("read") is False
                    and integer(record.get("createdAt"), 2**53 - 1))
        result.append((name, record))
    return result
