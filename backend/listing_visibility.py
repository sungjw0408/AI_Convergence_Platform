"""Visibility of listings created before and after listing management."""

LISTING_VISIBILITIES = ("public", "private", "deleted")


def public_listing(item):
    return item.get("visibility", "public") == "public"
