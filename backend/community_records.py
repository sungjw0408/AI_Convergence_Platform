"""Public rental reputation and per-account subscription usage."""
from datetime import datetime, timezone, timedelta
from time import time

from listing_visibility import public_listing

WEEK = 7 * 86400000


def now_ms():
    return int(time() * 1000)


def feedback(rental):
    legacy = {"renter": rental["review"]} if rental.get("review") else {}
    return {**legacy, **rental.get("feedback", {})}


def public_reviews(rental, now):
    entries = feedback(rental)
    completed = rental.get("completedAt")
    if rental.get("status") != "complete":
        return {}
    if len(entries) == 2 or (completed and now >= completed + WEEK):
        return entries
    return {"renter": rental["review"]} if not completed and rental.get("review") else {}


def can_submit(rental, side, now):
    completed = rental.get("completedAt")
    return (rental.get("status") == "complete" and completed and completed <= now < completed + WEEK
            and side not in feedback(rental))


def reputation(records):
    result = {}
    now = now_ms()
    for rental in records:
        public = public_reviews(rental, now)
        for party, writer in (("renterId", "lender"), ("lenderId", "renter")):
            stats = result.setdefault(rental[party], {"completed": 0, "reviews": []})
            stats["completed"] += 1
            if writer in public:
                stats["reviews"].append(public[writer])
    return result


def valid_use(current, record, uid, root, transaction):
    if not current or current.get("active") is not True or record.get("id") != uid:
        return False
    previous = current.get("actions", [])
    actions = record.get("actions")
    if not isinstance(actions, list) or len(actions) != len(previous) + 1 or actions[:-1] != previous:
        return False
    if record != {**current, "actions": actions}:
        return False
    action = actions[-1]
    if not isinstance(action, dict) or set(action) != {"type", "target", "month"}:
        return False
    target = action["target"]
    if not isinstance(target, str) or not target or "/" in target:
        return False
    month = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m")
    if action["month"] != month or action in previous:
        return False
    if action["type"] == "promote":
        item = root.collection("listings").document(target).get(transaction=transaction).to_dict()
        used = sum(a["type"] == "promote" and a["month"] == month for a in previous)
        return (item and public_listing(item) and item.get("owner") == uid
                and used < current.get("grants", {}).get(month, 0))
    if action["type"] == "pickup":
        rental = root.collection("rentals").document(target).get(transaction=transaction).to_dict()
        return (rental and rental.get("renterId") == uid and rental.get("status") == "active"
                and not any(a["type"] == "pickup" and a["target"] == target for a in previous))
    return False
