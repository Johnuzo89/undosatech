"""
OpenNeuro connector — search datasets by disease/modality, fetch metadata,
enumerate S3 FL partition paths for neuroimaging federated learning.

Real schema (openneuro.org/crn/graphql v5.2.0):
  - No free-text search arg — we do client-side matching against name + dxStatus + studyDomain
  - Sort by downloads descending to surface popular disease datasets early
  - Dataset.metadata.dxStatus is the curated disease/condition tag (e.g. "Alzheimers")
  - Dataset.analytics: { downloads, views }
  - Subjects in summary are a list of string IDs
  - NIfTI binaries live in public S3: s3://openneuro.org/{dataset_id}/sub-{id}/
"""
import threading
import time
import requests
from typing import Optional

OPENNEURO_GQL = "https://openneuro.org/crn/graphql"
OPENNEURO_S3  = "https://s3.amazonaws.com/openneuro.org"

# In-memory catalog cache: { modality_key -> (timestamp, [dataset, ...]) }
# Populated on first search call per modality; valid for 1 hour.
_catalog_cache: dict = {}
_catalog_lock  = threading.Lock()
_CACHE_TTL     = 3600  # seconds

# Tracks which modalities are currently being fetched (to avoid duplicate builds)
_building: set = set()
_building_lock = threading.Lock()

_BROWSE_GQL = """
query BrowseDatasets($modality: String, $first: Int, $after: String) {
  datasets(
    modality: $modality
    filterBy: { public: true }
    orderBy: { downloads: descending }
    first: $first
    after: $after
  ) {
    edges {
      node {
        id
        name
        analytics { downloads views }
        metadata { dxStatus studyDomain modalities }
        latestSnapshot {
          tag
          size
          summary { modalities subjects sessions }
          description { Name BIDSVersion Authors }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

_FILES_GQL = """
query DatasetFiles($id: ID!) {
  dataset(id: $id) {
    latestSnapshot {
      tag
      files { id filename size urls }
    }
  }
}
"""

_SNAPSHOT_FILES_GQL = """
query SnapshotFiles($id: ID!, $tag: String!) {
  dataset(id: $id) {
    snapshot(tag: $tag) {
      tag
      files { id filename size urls }
    }
  }
}
"""


def _fetch_page(modality: Optional[str], after: Optional[str] = None, page_size: int = 50) -> tuple:
    """Fetch one page of the catalog. Returns (edges, next_cursor, has_next)."""
    variables = {
        "modality": modality or None,
        "first": page_size,
        "after": after,
    }
    r = requests.post(OPENNEURO_GQL, json={"query": _BROWSE_GQL, "variables": variables}, timeout=25)
    r.raise_for_status()
    data = r.json().get("data", {}).get("datasets", {})
    pi   = data.get("pageInfo", {})
    return data.get("edges", []), pi.get("endCursor"), pi.get("hasNextPage", False)


def _edge_to_record(node: dict) -> dict:
    snap    = node.get("latestSnapshot") or {}
    summary = snap.get("summary") or {}
    desc    = snap.get("description") or {}
    meta    = node.get("metadata") or {}
    subjects = summary.get("subjects") or []
    name = desc.get("Name") or node.get("name") or node["id"]
    return {
        "id":         node["id"],
        "name":       name,
        "version":    snap.get("tag") or "",
        "modalities": summary.get("modalities") or [],
        "subjects":   len(subjects) if isinstance(subjects, list) else (subjects or 0),
        "sessions":   len(summary.get("sessions") or []),
        "size_bytes": snap.get("size") or 0,
        "downloads":  (node.get("analytics") or {}).get("downloads") or 0,
        "views":      (node.get("analytics") or {}).get("views") or 0,
        "authors":    desc.get("Authors") or [],
        "dx_status":  (meta.get("dxStatus") or "").strip(),
        "domain":     (meta.get("studyDomain") or "").strip(),
    }


def _build_cache(modality_key: Optional[str], max_pages: int = 10) -> list:
    """
    Fetch up to max_pages × 50 datasets sorted by downloads descending.
    Stores result in _catalog_cache[modality_key].
    """
    key = modality_key or ""
    all_records = []
    cursor = None
    for _ in range(max_pages):
        try:
            edges, cursor, has_next = _fetch_page(modality_key, after=cursor)
        except Exception:
            break
        for e in edges:
            node = e.get("node") or {}
            all_records.append(_edge_to_record(node))
        if not has_next or not cursor:
            break

    with _catalog_lock:
        _catalog_cache[key] = (time.time(), all_records)
    with _building_lock:
        _building.discard(key)
    return all_records


def _get_catalog(modality_key: Optional[str]) -> list:
    """
    Return cached catalog, building synchronously only on the very first call.
    Subsequent calls during a build (from a parallel request) wait on the first.
    Stale cache refreshes in background while serving old results.
    """
    key = modality_key or ""
    with _catalog_lock:
        entry = _catalog_cache.get(key)

    if entry:
        ts, records = entry
        if time.time() - ts < _CACHE_TTL:
            return records
        # stale — refresh in background, serve old data now
        with _building_lock:
            if key not in _building:
                _building.add(key)
                threading.Thread(target=_build_cache, args=(modality_key,), daemon=True).start()
        return records

    # cold start — deduplicate: only one thread builds, others wait
    with _building_lock:
        already_building = key in _building
        if not already_building:
            _building.add(key)

    if already_building:
        # wait for the in-progress build (poll up to 30s)
        for _ in range(30):
            time.sleep(1)
            with _catalog_lock:
                entry = _catalog_cache.get(key)
            if entry:
                return entry[1]
        return []

    return _build_cache(modality_key)


def warm_cache_background(*modalities: str) -> None:
    """Pre-warm catalog cache for the given modalities in background threads.
    Call from app lifespan startup so the first user search is instant."""
    for mod in modalities:
        key = mod or ""
        with _catalog_lock:
            entry = _catalog_cache.get(key)
        if entry and time.time() - entry[0] < _CACHE_TTL:
            continue
        with _building_lock:
            if key not in _building:
                _building.add(key)
                threading.Thread(target=_build_cache, args=(mod or None,), daemon=True).start()


def _matches(record: dict, query: str) -> bool:
    """True if record matches the search query across name, dxStatus, and domain."""
    if not query:
        return True
    q = query.lower()
    return (
        q in record["name"].lower()
        or q in record["dx_status"].lower()
        or q in record["domain"].lower()
        or q in record["id"].lower()
    )


def search_datasets(query: str = "", modality: str = "", limit: int = 20) -> list:
    """
    Search public OpenNeuro datasets.

    Searches across: dataset name, dxStatus (disease tag), and studyDomain.
    Results are sorted by download count (most popular first).
    Catalog is cached in memory per modality for 1 hour.
    """
    modality_key = modality.upper() if modality else None
    try:
        catalog = _get_catalog(modality_key)
    except Exception as exc:
        return [{"error": str(exc)}]

    results = []
    for record in catalog:
        if not _matches(record, query):
            continue
        results.append(record)
        if len(results) >= limit:
            break
    return results


def get_dataset_files(dataset_id: str, version: str = "latest") -> list:
    """List top-level files for a dataset snapshot."""
    try:
        if version and version != "latest":
            r = requests.post(
                OPENNEURO_GQL,
                json={"query": _SNAPSHOT_FILES_GQL, "variables": {"id": dataset_id, "tag": version}},
                timeout=20,
            )
            r.raise_for_status()
            snap = (r.json().get("data", {}).get("dataset") or {}).get("snapshot") or {}
        else:
            r = requests.post(
                OPENNEURO_GQL,
                json={"query": _FILES_GQL, "variables": {"id": dataset_id}},
                timeout=20,
            )
            r.raise_for_status()
            snap = (r.json().get("data", {}).get("dataset") or {}).get("latestSnapshot") or {}
        return snap.get("files") or []
    except Exception as exc:
        return [{"error": str(exc)}]


def download_participant_tsv(dataset_id: str, version: str = "latest") -> Optional[str]:
    """Download participants.tsv — subject-level metadata (age, sex, diagnosis). No images."""
    url = (
        f"https://openneuro.org/crn/datasets/{dataset_id}"
        f"/snapshots/{version}/files/participants.tsv"
    )
    try:
        r = requests.get(url, timeout=20)
        r.raise_for_status()
        return r.text
    except Exception:
        return None


def list_subject_nifti_urls(
    dataset_id: str,
    version: str = "latest",
    modality_folder: str = "anat",
    max_subjects: int = 10,
) -> list:
    """
    Return S3 partition descriptors for FL node setup (up to max_subjects).

    OpenNeuro stores NIfTI data in a public S3 bucket (no auth required).
    Each subject directory is the natural FL partition unit — the node
    operator syncs their assigned subjects before training begins.
    """
    tsv = download_participant_tsv(dataset_id, version)
    if not tsv:
        return []

    rows    = [line.split("\t") for line in tsv.strip().split("\n") if line]
    headers = rows[0] if rows else []
    participants = []
    for row in rows[1:max_subjects + 1]:
        rec = dict(zip(headers, row))
        pid = rec.get("participant_id", "").strip()
        if pid:
            participants.append({"id": pid.replace("sub-", ""), "meta": rec})

    results = []
    for p in participants:
        sub_id = p["id"]
        s3_prefix      = f"s3://openneuro.org/{dataset_id}/sub-{sub_id}/"
        modality_prefix = f"{s3_prefix}{modality_folder}/" if modality_folder else s3_prefix
        results.append({
            "participant_id":  f"sub-{sub_id}",
            "metadata":        p["meta"],
            "s3_prefix":       s3_prefix,
            "modality_prefix": modality_prefix,
            "sync_cmd": (
                f"aws s3 sync {modality_prefix} "
                f"./data/{dataset_id}/sub-{sub_id}/{modality_folder}/ --no-sign-request"
            ),
            "ls_cmd": f"aws s3 ls {modality_prefix} --no-sign-request",
        })
    return results


def _resolve_latest_tag(dataset_id: str) -> Optional[str]:
    gql = "query($id: ID!) { dataset(id: $id) { latestSnapshot { tag } } }"
    try:
        r = requests.post(OPENNEURO_GQL, json={"query": gql, "variables": {"id": dataset_id}}, timeout=10)
        r.raise_for_status()
        snap = (r.json().get("data", {}).get("dataset") or {}).get("latestSnapshot") or {}
        return snap.get("tag")
    except Exception:
        return None
