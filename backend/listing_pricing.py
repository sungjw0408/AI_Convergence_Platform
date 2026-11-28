"""Approved deposit policy and immutable money inputs for rental creation."""
import json
import re

MAX_VALUE_WON = 100_000_000
CONDITIONS = {"새것에 가까움", "사용감 있음", "수리 이력 있음"}
DEFAULT_DEPOSIT_POLICY = {
    "version": "rento-demo-v2",
    "rateBps": 3000,
    "minWon": None,
    "maxWon": 200_000,
}


def amount(value, minimum=0, maximum=MAX_VALUE_WON):
    return type(value) is int and minimum <= value <= maximum


def text(value, length, required=False):
    return isinstance(value, str) and len(value) <= length and (not required or bool(value.strip()))


def load_deposit_policy(raw):
    policy = json.loads(raw) if raw else DEFAULT_DEPOSIT_POLICY.copy()
    if not isinstance(policy, dict) or set(policy) != {"version", "rateBps", "minWon", "maxWon"}:
        raise ValueError("RENTO_DEPOSIT_POLICY must specify version, rateBps, minWon and maxWon.")
    minimum, maximum = policy["minWon"], policy["maxWon"]
    if (not text(policy["version"], 48, required=True) or not amount(policy["rateBps"], maximum=10_000)
            or (minimum is not None and not amount(minimum))
            or (maximum is not None and not amount(maximum, minimum or 0))):
        raise ValueError("Invalid RENTO_DEPOSIT_POLICY.")
    return policy


def valid_item_value(value):
    return (isinstance(value, dict) and set(value) == {"amountWon", "evidence", "verification"}
            and amount(value["amountWon"], 1) and text(value["evidence"], 500, required=True)
            and value["verification"] == "pending")


def deposit_for_value(value, policy):
    if policy is None:
        return None
    calculated = (value["amountWon"] * policy["rateBps"] + 5000) // 10_000
    maximum = policy["maxWon"]
    if maximum is not None:
        calculated = min(calculated, maximum)
    return max(policy["minWon"] or 0, calculated)


def valid_pricing_context(context, value_won, current_month):
    if not isinstance(context, dict) or set(context) - {
        "modelName", "condition", "usageHistory", "purchaseMonth",
        "expectedRentalDays", "residualValueWon", "maintenanceCostWon",
    } or not {"condition", "usageHistory", "purchaseMonth"} <= set(context):
        return False
    month = context["purchaseMonth"]
    condition = context["condition"]
    residual = context.get("residualValueWon")
    maintenance = context.get("maintenanceCostWon")
    expected_days = context.get("expectedRentalDays")
    return (text(context.get("modelName", ""), 80)
            and isinstance(condition, str) and condition in CONDITIONS | {""}
            and text(context["usageHistory"], 250)
            and isinstance(month, str)
            and (not month or (month <= current_month and re.fullmatch(r"\d{4}-(?:0[1-9]|1[0-2])", month)))
            and (expected_days is None or amount(expected_days, 1, 3650))
            and (residual is None or amount(residual, maximum=value_won))
            and (maintenance is None or amount(maintenance)))
