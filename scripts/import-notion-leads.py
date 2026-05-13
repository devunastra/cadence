#!/usr/bin/env python3
"""
AMLS Dashboard — Notion Lead Import Script
==========================================
Reads a Notion CSV export, matches each lead against GoHighLevel contacts
(by email then phone), resolves enum text values to studio_field_options UUIDs,
and upserts every row into Supabase.

Requirements:
    pip install supabase requests python-dotenv

Usage:
    python import-notion-leads.py --csv leads.csv --studio-id <UUID>

    All credentials are read from .env.local in the project root (same file
    the Next.js app uses). You can also pass them as environment variables.

Expected Notion CSV columns (all optional except Name):
    Name, Status, 🏆 Level, Action, Phone, Email,
    Last Contacted, First Lesson, Comments, Source,
    Reason, Available, ✅ Showed, ✅ Bought,
    Partnership, ✅ OLD

Column names are matched case-insensitively and emoji-stripped, so slight
naming variations in the export will still work.

Note: The ✅ (tick) column exists in Notion but is intentionally not present in
the dashboard or Supabase. It is silently skipped during import.
"""

import argparse
import csv
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ── dependency check ──────────────────────────────────────────────────────────
try:
    import requests
    from dotenv import load_dotenv
    from supabase import create_client, Client
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Run:  pip install supabase requests python-dotenv")
    sys.exit(1)

# ── load .env.local from project root ────────────────────────────────────────
script_dir = Path(__file__).resolve().parent
project_root = script_dir.parent
env_file = project_root / ".env.local"
if env_file.exists():
    load_dotenv(env_file)
else:
    load_dotenv()  # fall back to .env in cwd

# ── config ────────────────────────────────────────────────────────────────────
SUPABASE_URL      = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY      = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")   # service role — bypasses RLS
GHL_API_KEY       = os.environ.get("GHL_API_KEY", "")
GHL_BASE_URL      = "https://services.leadconnectorhq.com"
GHL_LOCATION_ID   = os.environ.get("GHL_LOCATION_ID", "")             # optional override

# ── enum fields that map to studio_field_options UUIDs ───────────────────────
ENUM_FIELDS = ["status", "level", "action", "source", "reason", "partnership"]

# ── Notion column → Supabase column name map ─────────────────────────────────
# Keys are normalised (lowercase, no emoji, stripped).
COLUMN_MAP = {
    "name":            "name",
    "status":          "status",
    "level":           "level",
    "action":          "action",
    "phone":           "phone",
    "email":           "email",
    "last contacted":  "last_contacted",
    "first lesson":    "first_lesson",
    "comments":        "comments",
    "source":          "source",
    "reason":          "reason",
    "available":       "available",
    "showed":          "showed",
    "bought":          "bought",
    "partnership":     "partnership",
    "old":             "old",
}


def strip_emoji(text: str) -> str:
    """Remove emoji and other non-ASCII decorations from column headers."""
    result = []
    for char in text:
        cat = unicodedata.category(char)
        if cat.startswith("S") or cat.startswith("C"):  # Symbol or Control
            continue
        result.append(char)
    return "".join(result)


def normalise_col(col: str) -> str:
    cleaned = strip_emoji(col).strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def parse_bool(val: str) -> bool:
    return val.strip().lower() in ("true", "yes", "1", "checked", "✓", "x")


def parse_date(val: str) -> Optional[str]:
    """Parse a Notion date/datetime string to ISO-8601 with timezone."""
    if not val or not val.strip():
        return None
    val = val.strip()
    formats = [
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%d %H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d",
        "%B %d, %Y",
        "%b %d, %Y",
        "%m/%d/%Y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(val, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue
    print(f"  [warn] Could not parse date: {val!r} — leaving as NULL")
    return None


def normalise_phone(phone: str) -> str:
    """Normalise phone to E.164-ish format (+1XXXXXXXXXX for US numbers)."""
    if not phone:
        return phone
    digits = re.sub(r"\D", "", phone)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return phone  # leave international numbers as-is


# ── GHL contact lookup ────────────────────────────────────────────────────────

def ghl_headers() -> dict:
    return {
        "Authorization": f"Bearer {GHL_API_KEY}",
        "Version": "2021-07-28",
        "Content-Type": "application/json",
    }


def search_ghl_contact(location_id: str, email: str = "", phone: str = "") -> Optional[str]:
    """Return the GHL contact ID for a matching email or phone, or None."""
    if not GHL_API_KEY:
        return None

    # Try email first (more reliable)
    if email:
        try:
            r = requests.get(
                f"{GHL_BASE_URL}/contacts/",
                headers=ghl_headers(),
                params={"locationId": location_id, "email": email},
                timeout=10,
            )
            if r.ok:
                contacts = r.json().get("contacts", [])
                if contacts:
                    return contacts[0]["id"]
        except requests.RequestException as exc:
            print(f"  [warn] GHL email search failed: {exc}")

    # Fall back to phone
    if phone:
        try:
            r = requests.get(
                f"{GHL_BASE_URL}/contacts/",
                headers=ghl_headers(),
                params={"locationId": location_id, "phone": phone},
                timeout=10,
            )
            if r.ok:
                contacts = r.json().get("contacts", [])
                if contacts:
                    return contacts[0]["id"]
        except requests.RequestException as exc:
            print(f"  [warn] GHL phone search failed: {exc}")

    return None


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Import Notion leads CSV into AMLS Dashboard")
    parser.add_argument("--csv",       required=True,  help="Path to the Notion CSV export")
    parser.add_argument("--studio-id", required=True,  help="Supabase studio UUID to import into")
    parser.add_argument("--dry-run",   action="store_true", help="Parse and validate without writing to Supabase")
    parser.add_argument("--skip-ghl",  action="store_true", help="Skip GHL contact lookup (faster, no ghl_contact_id)")
    parser.add_argument("--location-id", default="", help="GHL location ID (overrides GHL_LOCATION_ID env var)")
    args = parser.parse_args()

    # ── validate credentials ──────────────────────────────────────────────────
    missing = []
    if not SUPABASE_URL:  missing.append("NEXT_PUBLIC_SUPABASE_URL")
    if not SUPABASE_KEY:  missing.append("SUPABASE_SERVICE_ROLE_KEY")
    if not args.skip_ghl and not GHL_API_KEY:
        print("[warn] GHL_API_KEY not set — skipping GHL contact lookup (--skip-ghl implied)")
        args.skip_ghl = True
    if missing:
        print(f"[error] Missing environment variables: {', '.join(missing)}")
        print(f"        These should be in {env_file}  (or set as env vars)")
        sys.exit(1)

    ghl_location_id = args.location_id or GHL_LOCATION_ID
    if not args.skip_ghl and not ghl_location_id:
        print("[error] GHL location ID required for contact lookup.")
        print("        Pass --location-id <ID>  or set GHL_LOCATION_ID in .env.local")
        sys.exit(1)

    # ── connect to Supabase ───────────────────────────────────────────────────
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    studio_id = args.studio_id

    # ── load studio_field_options for this studio ─────────────────────────────
    print(f"\nLoading field options for studio {studio_id}...")
    resp = supabase.table("studio_field_options") \
        .select("id, field, value") \
        .eq("studio_id", studio_id) \
        .execute()

    if not resp.data:
        print("[error] No field options found for this studio.")
        print("        Make sure the studio exists and the migrations have run.")
        sys.exit(1)

    # Build lookup: field → {lowercase_value: uuid}
    field_options: dict[str, dict[str, str]] = {}
    for row in resp.data:
        f = row["field"]
        field_options.setdefault(f, {})[row["value"].lower()] = row["id"]

    print(f"  Loaded options: { {f: len(v) for f, v in field_options.items()} }")

    # ── read CSV ──────────────────────────────────────────────────────────────
    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"[error] CSV not found: {csv_path}")
        sys.exit(1)

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        raw_rows = list(reader)

    if not raw_rows:
        print("[error] CSV is empty")
        sys.exit(1)

    # Build normalised column name → original column name map
    col_map: dict[str, str] = {}
    for col in raw_rows[0].keys():
        norm = normalise_col(col)
        col_map[norm] = col

    print(f"\nFound {len(raw_rows)} rows in CSV")
    print(f"Columns detected: {list(raw_rows[0].keys())}")

    if "name" not in col_map:
        print("[error] CSV has no 'Name' column — cannot import")
        sys.exit(1)

    # ── process rows ──────────────────────────────────────────────────────────
    inserted = 0
    skipped  = 0
    ghl_matched = 0
    warnings: list[str] = []

    for i, raw in enumerate(raw_rows, 1):
        # Helper to pull a value by normalised column name
        def get(norm_key: str) -> str:
            orig = col_map.get(norm_key)
            return raw.get(orig, "").strip() if orig else ""

        name = get("name")
        if not name:
            print(f"  [row {i}] Skipping — no Name")
            skipped += 1
            continue

        email = get("email").lower() or None
        phone = normalise_phone(get("phone")) or None

        print(f"\n  [{i}/{len(raw_rows)}] {name}", end="")
        if args.dry_run:
            print("  (dry-run)", end="")

        # ── GHL lookup ────────────────────────────────────────────────────────
        ghl_contact_id = None
        if not args.skip_ghl:
            ghl_contact_id = search_ghl_contact(
                ghl_location_id,
                email=email or "",
                phone=phone or "",
            )
            if ghl_contact_id:
                ghl_matched += 1
                print(f"  → GHL:{ghl_contact_id}", end="")
            else:
                print(f"  → GHL:not found", end="")
            # Small delay to avoid hammering the GHL API
            time.sleep(0.15)

        # ── build Supabase row ────────────────────────────────────────────────
        row: dict = {
            "studio_id":        studio_id,
            "name":             name,
            "email":            email,
            "phone":            phone,
            "comments":         get("comments") or None,
            "available":        get("available") or None,
            "last_contacted":   parse_date(get("last contacted")),
            "first_lesson":     parse_date(get("first lesson")),
            "showed":           parse_bool(get("showed")),
            "bought":           parse_bool(get("bought")),
            "old":              parse_bool(get("old")),
            "ghl_contact_id":   ghl_contact_id,
            "created_by_email": "import",
        }

        # ── resolve enum fields to UUIDs ──────────────────────────────────────
        enum_col_map = {
            "status":      "status",
            "level":       "level",
            "action":      "action",
            "source":      "source",
            "reason":      "reason",
            "partnership": "partnership",
        }
        for norm_col, db_col in enum_col_map.items():
            raw_val = get(norm_col)
            if not raw_val:
                row[db_col] = None
                continue
            options = field_options.get(db_col, {})
            uuid = options.get(raw_val.lower())
            if uuid:
                row[db_col] = uuid
            else:
                # Value doesn't exist in studio_field_options — insert it then use its UUID
                print(f"\n    [info] Creating new field option: {db_col}={raw_val!r}")
                if not args.dry_run:
                    ins = supabase.table("studio_field_options").insert({
                        "studio_id": studio_id,
                        "field":     db_col,
                        "value":     raw_val,
                    }).execute()
                    new_id = ins.data[0]["id"]
                    field_options.setdefault(db_col, {})[raw_val.lower()] = new_id
                    row[db_col] = new_id
                else:
                    row[db_col] = None  # dry run — leave null
                warnings.append(f"Row {i} ({name}): created new option {db_col}={raw_val!r}")

        # ── strip None keys so Supabase uses column defaults ──────────────────
        row = {k: v for k, v in row.items() if v is not None}

        if args.dry_run:
            print(f"\n    Would insert: { {k: v for k, v in row.items() if k != 'studio_id'} }")
            inserted += 1
            continue

        # ── upsert by name + studio_id (safe for re-runs) ────────────────────
        # If a ghl_contact_id is found, upsert on that for exact deduplication.
        # Otherwise upsert on name+studio_id (name must be unique within a studio).
        try:
            if ghl_contact_id:
                result = supabase.table("leads").upsert(
                    row, on_conflict="ghl_contact_id"
                ).execute()
            else:
                # Check if a lead with this name already exists
                existing = supabase.table("leads") \
                    .select("id") \
                    .eq("studio_id", studio_id) \
                    .ilike("name", name) \
                    .maybe_single() \
                    .execute()
                if existing.data:
                    # Update existing
                    supabase.table("leads") \
                        .update(row) \
                        .eq("id", existing.data["id"]) \
                        .execute()
                else:
                    supabase.table("leads").insert(row).execute()

            inserted += 1
            print("  ✓", end="")
        except Exception as exc:
            print(f"\n    [error] Failed to insert row {i} ({name}): {exc}")
            skipped += 1

    # ── summary ───────────────────────────────────────────────────────────────
    print(f"\n\n{'='*60}")
    print(f"  Import {'(DRY RUN) ' if args.dry_run else ''}complete")
    print(f"  Total rows:      {len(raw_rows)}")
    print(f"  Inserted/updated:{inserted}")
    print(f"  Skipped:         {skipped}")
    if not args.skip_ghl:
        print(f"  GHL matched:     {ghl_matched} / {inserted}")
    if warnings:
        print(f"\n  Warnings ({len(warnings)}):")
        for w in warnings:
            print(f"    • {w}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
