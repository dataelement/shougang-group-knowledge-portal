"""Refresh the file_count for each knowledge space in the portal SQLite config.

Usage (inside the shougang-portal-backend container):
    python3 scripts/refresh_space_file_counts.py

The script:
  1. Reads the admin API token stored in portal.sqlite3
  2. Calls bisheng /spaces/info to get live file counts
  3. Writes the updated counts back to portal.sqlite3
"""
import asyncio
import sys
from pathlib import Path

# Allow running from any working directory inside the container
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.clients.bisheng import BishengClient
from app.schemas.portal_config import SpacesConfigUpdate
from app.services.config_store import SQLiteConfigStore
from app.services.portal_config_service import PortalConfigService
from app.settings import get_settings


async def main() -> None:
    settings = get_settings()
    config_json_path = Path(settings.portal_config_path)
    db_path = config_json_path.parent / "portal.sqlite3"

    # Read the saved admin token from SQLite (set up via the admin UI)
    store = SQLiteConfigStore(db_path)
    runtime = store.get_document("bisheng_runtime_config")
    if not runtime or not runtime.get("api_token"):
        print("ERROR: No bisheng runtime token found in portal.sqlite3.")
        print("Please configure the bisheng connection in the admin page first.")
        sys.exit(1)

    api_token: str = runtime["api_token"]
    base_url: str = runtime["base_url"]

    # Load portal config to get space list
    svc = PortalConfigService(config_path=config_json_path, database_path=db_path)
    config = svc.get_config()
    space_ids = [sp.id for sp in config.spaces]

    if not space_ids:
        print("No spaces configured in portal config. Nothing to refresh.")
        return

    print(f"Refreshing file counts for {len(space_ids)} spaces: {space_ids}")

    # Fetch live file counts from bisheng
    timeout_seconds: float = float(runtime.get("timeout_seconds") or 30)
    client = BishengClient(base_url=base_url, timeout_seconds=timeout_seconds, api_token=api_token)
    try:
        resp = await client.post_json(
            "/api/v1/knowledge/shougang-portal/spaces/info",
            json={"space_ids": space_ids},
        )
    finally:
        await client.aclose()

    raw_spaces = (resp.get("data") or {}).get("spaces") or []
    count_map: dict[int, int] = {}
    for item in raw_spaces:
        sid = item.get("id")
        file_num = (item.get("data") or {}).get("file_num", 0)
        if sid is not None:
            count_map[int(sid)] = int(file_num or 0)

    print(f"Received live counts for {len(count_map)} spaces.")

    # Update and write back
    updated = []
    for sp in config.spaces:
        old = sp.file_count
        new = count_map.get(sp.id, old)
        status = "changed" if new != old else "unchanged"
        print(f"  [{sp.id}] {sp.name}: {old} -> {new}  ({status})")
        updated.append({**sp.model_dump(), "file_count": new})

    svc.update_spaces(SpacesConfigUpdate(spaces=updated))
    print("\nDone. portal.sqlite3 updated successfully.")
    print("Refresh the admin page to see the new counts.")


if __name__ == "__main__":
    asyncio.run(main())
