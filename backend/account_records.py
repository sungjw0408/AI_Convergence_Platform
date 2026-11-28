"""Access rules for Firestore records owned by Firebase Auth users."""

from community_records import can_submit, feedback, now_ms, public_reviews, reputation, valid_use
import re
from base64 import b64decode
from binascii import Error as Base64Error
from datetime import date, datetime
from io import BytesIO
from zoneinfo import ZoneInfo

from google.cloud.firestore_v1.base_query import FieldFilter
from PIL import Image
from listing_pricing import deposit_for_value, valid_item_value, valid_pricing_context
from listing_visibility import LISTING_VISIBILITIES, public_listing
from rental_lifecycle import calendar_date, held_extension

IDS = re.compile(r"[a-zA-Z0-9_-]{1,128}")
IMAGE = re.compile(r"data:image/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/]+=*")
CAPTURE = re.compile(r"capture:[a-f0-9-]{36}")

AREAS = {"죽전동", "보정동"}
PROFILE_PHOTO_PREFIX = "data:image/jpeg;base64,"
PROFILE_PHOTO_MAX_LENGTH = 48_000
PROFILE_NAME_MAX_LENGTH = 48
CATEGORIES = {"공구", "디지털", "생활용품", "캠핑·레저"}

CHAT_STATUSES = {
    "confirmed",
    "handover",
    "active",
    "checking",
    "disputed",
    "complete",
}

RENTAL_KEYS = {
    "id",
    "itemId",
    "renterId",
    "lenderId",
    "start",
    "end",
    "total",
    "deposit",
    "createdAt",
}

BUSY_STATUSES = ("payment_pending", "confirmed", "handover", "active", "checking", "disputed")
LISTING_DATE_FIELDS = {"availableFrom", "availableTo"}
LISTING_EDIT_FIELDS = {"title", "description", "category", "neighborhood", "price"} | LISTING_DATE_FIELDS
VALUE_SNAPSHOT_KEYS = {"itemValue", "depositPolicy"}
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
        raise ForbiddenRecord(
            "이 기록을 저장할 권한이 없거나 데이터가 올바르지 않아요."
        )


def matches(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def text(value, limit, required=False):
    return (
        isinstance(value, str)
        and len(value) <= limit
        and (not required or bool(value.strip()))
    )


def valid_profile_photo(value):
    if value == "":
        return True
    if not text(value, PROFILE_PHOTO_MAX_LENGTH, True) or not value.startswith(PROFILE_PHOTO_PREFIX):
        return False
    try:
        raw = b64decode(value.removeprefix(PROFILE_PHOTO_PREFIX), validate=True)
        with Image.open(BytesIO(raw)) as image:
            if image.format != "JPEG" or max(image.size) > 256:
                return False
            image.load()
            return True
    except (Base64Error, OSError, ValueError, Image.DecompressionBombError):
        return False


def signup_profile(fields):
    if not isinstance(fields, dict) or not {"displayName", "area"} <= set(fields) <= {"displayName", "area", "photo"}:
        raise ValueError("가입할 때 사용할 이름과 거주 지역을 확인해 주세요.")
    name, area, photo = fields["displayName"], fields["area"], fields.get("photo", "")
    if not text(name, PROFILE_NAME_MAX_LENGTH) or not isinstance(area, str) or area not in AREAS:
        raise ValueError("가입할 때 사용할 이름과 거주 지역을 확인해 주세요.")
    if not valid_profile_photo(photo):
        raise ValueError("프로필 사진을 다시 선택해 주세요.")
    return {"displayName": name.strip(), "area": area, "photo": photo}


def integer(value, maximum):
    return type(value) is int and 0 <= value <= maximum


def day(value):
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}", value
    ):
        raise ValueError("날짜 형식을 확인해 주세요.")

    return date.fromisoformat(value)


def query(root, name, field, op, value, transaction):
    return root.collection(name).where(
        filter=FieldFilter(field, op, value)
    ).stream(transaction=transaction)


# 로그인 사용자 데이터 조회
def account_documents(root, uid, transaction):
    rentals = {}

    for field in ("renterId", "lenderId"):
        for doc in query(
            root, "rentals", field, "==", uid, transaction
        ):
            rentals[doc.id] = doc.to_dict()

    inquiries = {
        doc.id: doc.to_dict()
        for doc in query(
            root,
            "inquiries",
            "participants",
            "array_contains",
            uid,
            transaction,
        )
    }

    profile = root.collection("profiles").document(uid).get(
        transaction=transaction
    ).to_dict()

    membership = root.collection("memberships").document(uid).get(
        transaction=transaction
    ).to_dict()

    summaries = reputation(
        doc.to_dict()
        for doc in query(
            root, "rentals", "status", "==", "complete", transaction
        )
    )

    for r in rentals.values():
        side = "renter" if r["renterId"] == uid else "lender"
        visible = dict(public_reviews(r, now_ms()))

        if side in feedback(r):
            visible[side] = feedback(r)[side]

        if "feedback" in r:
            r["feedback"] = visible

    linked_items = {rental["itemId"] for rental in rentals.values()}
    listings = []
    public_ids = set()
    for doc in root.collection("listings").stream(transaction=transaction):
        item = doc.to_dict()
        if public_listing(item):
            listings.append(item)
            public_ids.add(doc.id)
        elif doc.id in linked_items or (item.get("visibility") == "private" and item.get("owner") == uid):
            listings.append(item)

    photo_owners = {uid, *(item["owner"] for item in listings if public_listing(item))}
    for rental in rentals.values():
        photo_owners.update((rental["renterId"], rental["lenderId"]))
    for room in inquiries.values():
        photo_owners.update(room["participants"])
    named_profiles = (
        root.collection("profiles")
        .select(["displayName", "photo"])
    )
    display_names, profile_photos = {}, {}
    for doc in named_profiles.stream(transaction=transaction):
        info = doc.to_dict()
        if text(info.get("displayName"), PROFILE_NAME_MAX_LENGTH, True):
            display_names[doc.id] = info["displayName"]
        photo = info.get("photo")
        if doc.id in photo_owners and text(photo, PROFILE_PHOTO_MAX_LENGTH, True) and photo.startswith(PROFILE_PHOTO_PREFIX):
            profile_photos[doc.id] = photo

    blocked_periods = []
    now = now_ms()
    for doc in query(root, "rentals", "status", "in", list(BUSY_STATUSES), transaction):
        rental = doc.to_dict()
        if rental["itemId"] not in public_ids and rental["itemId"] not in linked_items:
            continue
        extension_end = held_extension(rental, now)
        blocked_periods.append({
            "id": rental["id"],
            "itemId": rental["itemId"],
            "status": rental["status"],
            "start": rental["start"],
            "end": calendar_date(extension_end, rental["timeZone"]).isoformat() if extension_end else rental["end"],
            "paymentDueAt": rental.get("paymentDueAt"),
            "after": bool(rental.get("after")),
        })

    return {
        "blockedPeriods": blocked_periods,
        "displayNames": display_names,
        "profilePhotos": profile_photos,
        "inquiries": list(inquiries.values()),

        "memberships": [membership] if membership else [],

        "publicReputation": summaries,

        "listings": listings,

        "rentals": list(rentals.values()),

        "messages": [
            doc.to_dict()
            for doc in query(
                root,
                "messages",
                "participantIds",
                "array_contains",
                uid,
                transaction,
            )
            if doc.get("rentalId") in rentals
            or doc.get("rentalId") in inquiries
        ],

        "notices": [
            doc.to_dict()
            for doc in query(
                root, "notices", "role", "==", uid, transaction
            )
        ],

        "profiles": [profile] if profile else [],
    }


def validate_listing_details(record, fields):
    for key, limit in (("title", 48), ("description", 600)):
        if key in fields:
            require(text(record.get(key), limit, True))
    if "category" in fields:
        require(record.get("category") in CATEGORIES)
    if "neighborhood" in fields:
        require(record.get("neighborhood") in AREAS)
    if "price" in fields:
        require(integer(record.get("price"), 10_000_000))


def listing_period(record):
    start, end = record.get("availableFrom"), record.get("availableTo")
    if start or end:
        start, end = day(start), day(end)
        if start > end:
            raise ValueError("대여 가능 기간의 시작일과 종료일을 확인해 주세요.")
        return start, end
    return None


def validate_listing_schedule(root, transaction, record, current):
    require(all(isinstance(record.get(key, ""), str) for key in LISTING_DATE_FIELDS))
    period = listing_period(record)
    if not period:
        return

    today = datetime.now(ZoneInfo("Asia/Seoul")).date()
    start, end = period
    if end < today or (record.get("availableFrom") != current.get("availableFrom") and start < today):
        raise ValueError("새 대여 가능 기간은 오늘 이후 날짜로 설정해 주세요.")

    now = now_ms()
    for snapshot in query(root, "rentals", "itemId", "==", record["id"], transaction):
        rental = snapshot.to_dict()
        if rental["status"] not in ("pending", *BUSY_STATUSES):
            continue
        if rental.get("lifecycleVersion") == 1 and (
            (rental["status"] == "pending" and rental["requestExpiresAt"] <= now)
            or (rental["status"] == "payment_pending" and rental["paymentDueAt"] <= now)
        ):
            continue
        extension_end = held_extension(rental, now)
        reserved_end = calendar_date(extension_end, rental["timeZone"]) if extension_end else day(rental["end"])
        if reserved_end >= today and (start > max(today, day(rental["start"])) or end < reserved_end):
            raise ValueError("대여 가능 기간에 이미 신청되었거나 진행 중인 거래 날짜를 포함해 주세요.")


def validate_listing(record, uid, current, policy, *, root=None, transaction=None):
    require(record.get("owner") == uid)
    if current:
        require(current.get("owner") == uid and current.get("visibility") != "deleted")
        before = current.get("visibility", "public")
        after = record.get("visibility", "public")
        if before != after:
            require(after in LISTING_VISIBILITIES)
            updated = {**current, "visibility": after}
            require(record == updated)
            return updated

        edits = {key: record[key] for key in LISTING_EDIT_FIELDS
                 if key in record and record[key] != current.get(key)}
        if edits:
            updated = {**current, **edits}
            require(record == updated)
            validate_listing_details(updated, edits)
            if LISTING_DATE_FIELDS.intersection(edits):
                validate_listing_schedule(root, transaction, updated, current)
            return updated

    value = record.get("itemValue")
    require(valid_item_value(value))
    expected_deposit = deposit_for_value(value, policy)
    require("deposit" in record and record["deposit"] == expected_deposit
            and (expected_deposit is None or type(record["deposit"]) is int))

    if current:
        require(current.get("itemValue") is None)
        updated = {**current, "itemValue": value, "deposit": expected_deposit}
        require(record == updated)
        return updated

    require(set(record) <= {"id", "title", "description", "category", "neighborhood", "price", "deposit",
                            "image", "availableFrom", "availableTo", "owner", "createdAt",
                            "photos", "presentationPhotos", "coverPhotoId", "inspectionPlan", "itemValue", "pricingContext"})
    validate_listing_details(record, LISTING_EDIT_FIELDS)
    current_month = datetime.now(ZoneInfo("Asia/Seoul")).strftime("%Y-%m")
    require(valid_pricing_context(record.get("pricingContext"), value["amountWon"], current_month))
    require(integer(record.get("createdAt"), 2**53 - 1))

    image = record.get("image")
    require(image == "" or matches(IMAGE, image))

    validate_listing_photos(record)

    listing_period(record)
    return record


# 대여 가능 날짜 검증
def check_availability(root, transaction, record, item, *, confirming):
    start = day(record.get("start"))
    end = day(record.get("end"))

    today = datetime.now(ZoneInfo("Asia/Seoul")).date()

    require(today <= start <= end)

    if item.get("availableFrom"):
        require(
            day(item["availableFrom"])
            <= start
            <= end
            <= day(item["availableTo"])
        )

    for snapshot in query(
        root,
        "rentals",
        "itemId",
        "==",
        record["itemId"],
        transaction,
    ):
        other = snapshot.to_dict()

        if other["id"] == record["id"]:
            continue

        overlap = (
            record["start"] <= other["end"]
            and other["start"] <= record["end"]
        )

        if (
            other["status"] in ("handover", "active", "checking")
            or (
                other["status"] == "disputed"
                and not other.get("after")
            )
        ):
            raise ValueError("물품이 이미 대여 중이에요.")

        if overlap and (
            other["status"] in ("confirmed", "disputed")
            or (
                not confirming
                and other["status"] == "pending"
                and other["renterId"] == record["renterId"]
            )
        ):
            raise ValueError("이미 예약되었거나 신청한 날짜예요.")

    return (end - start).days + 1


# 물품 검사 계획 검증
def validate_plan(plan):
    require(
        isinstance(plan, dict)
        and isinstance(plan.get("views"), list)
        and 1 <= len(plan["views"]) <= 4
    )

    require(
        isinstance(plan.get("checks"), list)
        and len(plan["checks"]) <= 8
    )

    require(
        all(
            isinstance(view, dict)
            and matches(IDS, view.get("id"))
            and text(view.get("label"), 100, True)
            and text(view.get("instruction"), 250, True)
            and type(view.get("compare")) is bool
            for view in plan["views"]
        )
    )

    require(
        all(
            isinstance(check, dict)
            and matches(IDS, check.get("id"))
            and text(check.get("label"), 200, True)
            for check in plan["checks"]
        )
    )


# 물품 등록 사진 검증
def validate_listing_photos(record):
    plan = record.get("inspectionPlan")
    validate_plan(plan)

    photos = record.get("photos")

    require(
        isinstance(photos, list)
        and 1 <= len(photos) <= 8
    )

    required_views = {
        view["id"]
        for view in plan["views"]
    }

    photos_by_id = {}
    assigned_views = []

    for photo in photos:
        require(
            isinstance(photo, dict)
            and matches(IDS, photo.get("id"))
        )

        require(
            photo.get("origin") in ("camera", "file")
            and text(photo.get("label"), 100, True)
        )

        source = photo.get("source")

        require(
            matches(IMAGE, source)
            and len(source) <= 95_000
        )

        view = photo.get("viewId")

        require(
            isinstance(view, str)
            and (not view or view in required_views)
        )

        if view:
            assigned_views.append(view)

        photos_by_id[photo["id"]] = source

    require(
        len(photos_by_id) == len(photos)
        and len(assigned_views) == len(required_views)
        and set(assigned_views) == required_views
    )

    presentation = record.get('presentationPhotos')
    if presentation is not None:
        require(isinstance(presentation, list) and 1 <= len(presentation) <= 8)
        public = {}
        for photo in presentation:
            require(isinstance(photo, dict) and matches(IDS, photo.get('id')) and photo['id'] not in public)
            if 'photoId' in photo:
                require(set(photo) == {'id', 'photoId'} and photo['id'] == photo['photoId'] and photo['photoId'] in photos_by_id)
                public[photo['id']] = photos_by_id[photo['photoId']]
            else:
                require(set(photo) == {'id','source','origin','label'} and photo.get('origin') == 'album'
                        and photo['id'] not in photos_by_id and matches(IMAGE, photo.get('source'))
                        and len(photo['source']) <= 95_000 and text(photo.get('label'),100,True))
                public[photo['id']] = photo['source']
        require(sum(len(value) for value in photos_by_id.values()) + sum(len(p['source']) for p in presentation if 'source' in p) + len(record['image']) < 900_000)
        photos_by_id = public

    cover_id = record.get("coverPhotoId")

    require(
        matches(IDS, cover_id)
        and photos_by_id.get(cover_id) == record["image"]
    )


# 물품 손상 검사 검증
def validate_inspection(record, field):
    inspection = record.get("inspection")

    require(isinstance(inspection, dict))

    plan = inspection.get("plan")
    validate_plan(plan)

    for phase in ("before", "after"):
        photos = inspection.get(phase)

        require(
            isinstance(photos, dict)
            and len(photos) <= 4
        )

        if phase == field or photos:
            require(
                set(photos)
                == {view["id"] for view in plan["views"]}
            )

            require(
                all(
                    isinstance(photo, dict)
                    and (matches(CAPTURE, photo.get("source"))
                         or (phase == 'before' and record.get('lifecycleVersion') == 1
                             and inspection.get('handoffReview') and photo.get('sourceKind') == 'listing'
                             and matches(IMAGE, photo.get('source'))))
                    for photo in photos.values()
                )
            )

            require(
                record.get(phase)
                in {
                    photo["source"]
                    for photo in photos.values()
                }
            )

        require(
            text(inspection.get(phase + "Note", ""), 500)
        )

        checks = inspection.get(phase + "Checks", [])

        require(
            isinstance(checks, list)
            and all(matches(IDS, check) for check in checks)
        )

    results = inspection.get("results", {})

    require(
        isinstance(results, dict)
        and len(results) <= 4
    )

    for result in results.values():
        require(
            isinstance(result, dict)
            and result.get("status")
            in ("clear", "changes", "retake")
        )

        regions = result.get("regions", [])

        require(
            isinstance(regions, list)
            and len(regions) <= 100
        )

        require(
            all(
                isinstance(region, list)
                and len(region) == 4
                and all(
                    type(n) in (int, float)
                    and 0 <= n <= 1
                    for n in region
                )
                for region in regions
            )
        )

        if result["status"] == "changes":
            require(bool(regions))


# 예약 및 대여 상태 검증
def validate_rental(root, transaction, uid, record, current, policy):
    if current and current.get("lifecycleVersion") == 1:
        # Command-only state machine: never accept a client-provided payment/state change.
        allowed = {"inspection", "photoAnalysis", "review", "feedback"}
        require(all(record.get(k) == current.get(k) for k in record.keys() | current.keys() if k not in allowed))
    require(matches(IDS, record.get("itemId")))

    if not current:
        require(record.get("status") == "pending" and record.get("renterId") == uid)
        item = root.collection("listings").document(record["itemId"]).get(transaction=transaction).to_dict()
        require(item and record.get("lenderId") == item["owner"] and item["owner"] != uid)
        require(public_listing(item))
        value = item.get("itemValue")
        if not valid_item_value(value):
            raise ValueError("공급자가 중고 가액과 근거를 추가해야 대여를 신청할 수 있어요.")
        if policy is None:
            raise ValueError("보증금 정책이 정해지면 대여를 신청할 수 있어요.")
        require(set(record) == RENTAL_KEYS | VALUE_SNAPSHOT_KEYS | {"status"})
        require(record["itemValue"] == value and record["depositPolicy"] == policy)
        expected_deposit = deposit_for_value(value, policy)
        days = check_availability(root, transaction, record, item, confirming=False)
        require(type(record["total"]) is int and type(record["deposit"]) is int
                and record["total"] == item["price"] * days and record["deposit"] == expected_deposit)
        require(integer(record["createdAt"], 2**53 - 1))

        return

    require(uid in (current["renterId"], current["lenderId"]))
    require(all(record.get(key) == current.get(key) for key in RENTAL_KEYS | VALUE_SNAPSHOT_KEYS))
    previous, status = current["status"], record.get("status")
    require(isinstance(status, str))

    allowed = {"status"}

    if status != previous:
        actor = TRANSITIONS.get((previous, status))

        require(
            actor
            and (
                actor == "party"
                or current[actor] == uid
            )
        )

        if status == "confirmed":
            if not valid_item_value(current.get("itemValue")) or not current.get("depositPolicy"):
                raise ValueError("중고 가액과 보증금 기준이 저장된 대여 신청만 승인할 수 있어요.")
            item = root.collection("listings").document(
                record["itemId"]
            ).get(transaction=transaction).to_dict()

            require(item)

            check_availability(
                root,
                transaction,
                record,
                item,
                confirming=True,
            )

        if status == "handover":
            validate_inspection(record, "before")
            allowed.update(("inspection", "before"))

        elif status == "checking":
            validate_inspection(record, "after")
            allowed.update(("inspection", "after"))

        elif status == "disputed":
            require(
                text(record.get("dispute"), 500, True)
                and record.get("resolution", "") == ""
            )

            allowed.update(("dispute", "resolution"))

        if status == "complete":
            require(
                integer(
                    record.get("completedAt"),
                    2**53 - 1,
                )
            )

            record["completedAt"] = now_ms()
            allowed.add("completedAt")

    elif status == "complete":
        side = (
            "renter"
            if current["renterId"] == uid
            else "lender"
        )

        require(can_submit(current, side, now_ms()))

        entries = record.get("feedback")

        require(
            isinstance(entries, dict)
            and set(entries) <= {side, "renter", "lender"}
        )

        entry = entries.get(side)

        require(
            isinstance(entry, dict)
            and set(entry) == {"rating", "text"}
            and integer(entry["rating"], 5)
            and entry["rating"] >= 1
            and text(entry["text"], 500, True)
        )

        record["feedback"] = {
            **current.get("feedback", {}),
            side: entry,
        }

        record["completedAt"] = current["completedAt"]

        allowed.add("feedback")

    elif status == "checking":
        validate_inspection(record, "after")

        if uid == current["lenderId"]:
            require(
                {
                    k: v
                    for k, v in record["inspection"].items()
                    if k != "results"
                }
                ==
                {
                    k: v
                    for k, v in current["inspection"].items()
                    if k != "results"
                }
            )

        else:
            allowed.add("after")

        allowed.add("inspection")

    require(
        all(
            record.get(key) == current.get(key)
            for key in record.keys() | current.keys()
            if key not in allowed
        )
    )

    if "inspection" in allowed and current.get("inspection"):
        require(
            all(
                record["inspection"].get(key)
                == current["inspection"].get(key)
                for key in (
                    "plan",
                    "before",
                    "beforeNote",
                    "beforeChecks",
                    "handoffReview",
                )
            )
        )


def authorize_updates(root, transaction, uid, updates, policy=None):
    from rental_database import app_fields

    changes = {
        (name, record["id"]): record
        for name, record in updates
    }

    require(len(changes) == len(updates))

    existing = {
        key: root.collection(key[0]).document(key[1]).get(
            transaction=transaction
        ).to_dict()
        for key in changes
    }

    result = []
    inquiry_pairs = set()

    for (name, record_id), record in changes.items():
        current = existing[(name, record_id)]

        if current and name == "rentals":
            current = app_fields(current)

        # 사용자 프로필
        if name == "profiles":
            favorites = record.get("favorites")
            required = {"id", "area", "favorites"}
            require(record_id == uid and required <= set(record) <= required | {"displayName", "photo", "chatDeletedThrough"}
                    and isinstance(record["area"], str) and record["area"] in AREAS)
            require(isinstance(favorites, list) and len(favorites) <= 500
                    and all(matches(IDS, item) for item in favorites))
            if "chatDeletedThrough" in record:
                deleted = record["chatDeletedThrough"]
                require(isinstance(deleted, dict) and all(
                    matches(IDS, room_id) and (message_id is None or matches(IDS, message_id))
                    for room_id, message_id in deleted.items()
                ))
            if "displayName" in record:
                require(text(record["displayName"], PROFILE_NAME_MAX_LENGTH))
                record["displayName"] = record["displayName"].strip()
            if "photo" in record and record["photo"] != (current or {}).get("photo"):
                require(valid_profile_photo(record["photo"]))
            record = {**(current or {}), **record}

        # 구독 및 혜택
        elif name == "memberships":
            require(
                valid_use(
                    current,
                    record,
                    uid,
                    root,
                    transaction,
                )
            )

        # 물품 등록
        elif name == "listings":
            record = validate_listing(record, uid, current, policy, root=root, transaction=transaction)

        # 예약 및 대여
        elif name == "rentals":
            validate_rental(
                root,
                transaction,
                uid,
                record,
                current,
                policy,
            )

        # 사전 문의 채팅방
        elif name == "inquiries":
            participants = record.get("participants")

            require(
                set(record) == {
                    "id",
                    "participants",
                    "createdAt",
                }
                and isinstance(participants, list)
                and len(participants) == 2
                and all(
                    matches(IDS, p)
                    for p in participants
                )
                and participants[0] != participants[1]
                and uid in participants
                and record_id.startswith("inquiry_")
                and integer(
                    record.get("createdAt"),
                    2**53 - 1,
                )
            )

            if current:
                require(record == current)

            else:
                partner = next(
                    p
                    for p in participants
                    if p != uid
                )

                partner_items = list(
                    query(
                        root,
                        "listings",
                        "owner",
                        "==",
                        partner,
                        transaction,
                    )
                )

                require(any(public_listing(item.to_dict()) for item in partner_items))

                pair = tuple(sorted(participants))

                require(pair not in inquiry_pairs)
                inquiry_pairs.add(pair)

                # 동일한 사용자 간 중복 채팅방 방지
                for doc in query(
                    root,
                    "inquiries",
                    "participants",
                    "array_contains",
                    uid,
                    transaction,
                ):
                    require(
                        set(doc.get("participants"))
                        != set(participants)
                    )

                record["createdAt"] = now_ms()

        # 기존 거래 채팅 및 사전 문의 채팅
        elif name == "messages":
            thread_id = record["rentalId"]

            if thread_id.startswith("inquiry_"):
                room = root.collection(
                    "inquiries"
                ).document(thread_id).get(
                    transaction=transaction
                ).to_dict()

                require(
                    room
                    and uid in room["participants"]
                )

                participants = room["participants"]

            else:
                rental = root.collection(
                    "rentals"
                ).document(thread_id).get(
                    transaction=transaction
                ).to_dict()

                require(
                    rental
                    and uid in (
                        rental["renterId"],
                        rental["lenderId"],
                    )
                    and rental["status"] in CHAT_STATUSES
                )

                participants = [
                    rental["renterId"],
                    rental["lenderId"],
                ]

            # 받은 메시지 읽음 처리
            if current:
                require(
                    current["sender"] != uid
                    and not current.get("read")
                    and record == {
                        **current,
                        "read": True,
                    }
                )

                result.append((name, record))
                continue

            # 새 메시지 전송
            require(
                record.get("sender") == uid
                and text(
                    record.get("text"),
                    350,
                    True,
                )
            )

            require(
                integer(
                    record.get("sentAt"),
                    2**53 - 1,
                )
            )

            record = {
                key: record[key]
                for key in (
                    "id",
                    "rentalId",
                    "sender",
                    "text",
                    "sentAt",
                )
            }

            record["participantIds"] = participants

        # 기존 알림 읽음 처리
        elif name == "notices" and current:
            require(
                current["role"] == uid
                and (
                    record == {**current, "read": True}
                    or record == {**current, "read": True, "dismissed": True}
                )
            )

        # 새 거래 알림
        elif name == "notices":
            rental = changes.get(
                ("rentals", record["rentalId"])
            )

            require(
                rental
                and uid in (
                    rental.get("renterId"),
                    rental.get("lenderId"),
                )
                and record.get("role") in (
                    rental.get("renterId"),
                    rental.get("lenderId"),
                )
                and record["role"] != uid
            )

            require(
                set(record) == {
                    "id",
                    "rentalId",
                    "role",
                    "message",
                    "createdAt",
                    "read",
                }
            )

            require(
                text(
                    record.get("message"),
                    160,
                    True,
                )
                and record.get("read") is False
                and integer(
                    record.get("createdAt"),
                    2**53 - 1,
                )
            )

        else:
            require(False)

        result.append((name, record))

    return result