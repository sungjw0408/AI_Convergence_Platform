"""Apply approved benefits to an account in the configured Firestore space."""
import argparse
import os
import re

from google.cloud import firestore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("uid")
    parser.add_argument("--space", default="accounts")
    command = parser.add_subparsers(dest="action", required=True)
    command.add_parser("activate")
    command.add_parser("deactivate")
    grant = command.add_parser("grant", help="set the total authorized allocation for a month")
    grant.add_argument("month")
    grant.add_argument("quantity", type=int)
    pickup = command.add_parser("pickup", help="update the status shown for an existing request")
    pickup.add_argument("rental_id")
    pickup.add_argument("status", choices=["접수 확인", "수거 예정", "수거 완료", "취소"])
    args = parser.parse_args()
    db = firestore.Client(project=os.environ["RENTO_FIREBASE_PROJECT"])
    root = db.collection("rentoSpaces").document(args.space)
    ref = root.collection("memberships").document(args.uid)

    @firestore.transactional
    def update(tx):
        plan = ref.get(transaction=tx).to_dict() or {"id": args.uid, "active": False, "actions": [], "grants": {}}
        if args.action in ("activate", "deactivate"):
            plan["active"] = args.action == "activate"
        elif args.action == "grant":
            used = sum(a["type"] == "promote" and a["month"] == args.month for a in plan.get("actions", []))
            if not plan["active"] or not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", args.month) or args.quantity < used:
                parser.error("활성 구독, 유효한 지급 월과 사용량 이상의 지급 수량이 필요합니다.")
            plan.setdefault("grants", {})[args.month] = args.quantity
        else:
            if not any(a["type"] == "pickup" and a["target"] == args.rental_id for a in plan.get("actions", [])):
                parser.error("해당 픽업 신청을 찾을 수 없습니다.")
            plan.setdefault("pickupStatus", {})[args.rental_id] = args.status
        tx.set(ref, plan)
        tx.set(root, {"revision": firestore.Increment(1)}, merge=True)
    update(db.transaction())


if __name__ == "__main__":
    main()
