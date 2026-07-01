"""
OpenNeuro connector — browse datasets, fetch metadata, enumerate NIfTI files
for use as FL training data without centralising raw scans.

Real schema confirmed via introspection against openneuro.org/crn/graphql v5.2.0:
  - datasets(modality, filterBy, first, after, orderBy) — no free-text search arg
  - Dataset.analytics: { downloads, views }  (no 'stars' field)
  - Dataset.latestSnapshot.summary.subjects is a list of subject-ID strings
  - Snapshot.files: { id, filename, size, urls }  (no 'snapshot' sub-query on dataset)
"""
import requests
from typing import Optional

OPENNEURO_GQL = "https://openneuro.org/crn/graphql"

_LIST_GQL = """
query BrowseDatasets($modality: String, $first: Int, $after: String) {
  datasets(
    modality: $modality
    filterBy: { public: true }
    first: $first
    after: $after
  ) {
    edges {
      node {
        id
        name
        analytics { downloads views }
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


def search_datasets(query: str = "", modality: str = "", limit: int = 20) -> list:
    """
    Browse public OpenNeuro datasets, optionally filtered by modality.
    OpenNeuro GQL has no free-text search — 'query' is used for client-side
    name filtering after fetching up to limit*3 results.
    """
    fetch_limit = min(limit * 3, 60) if query else limit
    variables = {
        "modality": modality.upper() if modality else None,
        "first": fetch_limit,
    }
    try:
        r = requests.post(
            OPENNEURO_GQL,
            json={"query": _LIST_GQL, "variables": variables},
            timeout=20,
        )
        r.raise_for_status()
        resp = r.json()
        edges = resp.get("data", {}).get("datasets", {}).get("edges", [])
        results = []
        for e in edges:
            node = e.get("node") or {}
            snap = node.get("latestSnapshot") or {}
            summary = snap.get("summary") or {}
            desc = snap.get("description") or {}
            name = desc.get("Name") or node.get("name") or node["id"]
            # client-side keyword filter
            if query and query.lower() not in name.lower():
                continue
            subjects = summary.get("subjects") or []
            results.append({
                "id": node["id"],
                "name": name,
                "version": snap.get("tag", ""),
                "modalities": summary.get("modalities") or [],
                "subjects": len(subjects) if isinstance(subjects, list) else subjects,
                "sessions": len(summary.get("sessions") or []),
                "size_bytes": snap.get("size") or 0,
                "downloads": (node.get("analytics") or {}).get("downloads") or 0,
                "views": (node.get("analytics") or {}).get("views") or 0,
                "authors": desc.get("Authors") or [],
            })
            if len(results) >= limit:
                break
        return results
    except Exception as exc:
        return [{"error": str(exc)}]


def get_dataset_files(dataset_id: str, version: str = "latest") -> list:
    """List files for a dataset snapshot (uses latestSnapshot when version='latest')."""
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


OPENNEURO_S3 = "https://s3.amazonaws.com/openneuro.org"


def list_subject_nifti_urls(
    dataset_id: str,
    version: str = "latest",
    modality_folder: str = "anat",
    max_subjects: int = 10,
) -> list:
    """
    Return S3 partition descriptors for FL node setup (up to max_subjects).

    OpenNeuro stores data in a public S3 bucket (no auth required).
    Each subject's directory is the natural FL partition unit — the node
    operator syncs their assigned subject(s) before training begins.

    Returns per-subject S3 prefix + ready-to-run `aws s3 sync` command.
    """
    tsv = download_participant_tsv(dataset_id, version)
    if not tsv:
        return []

    rows = [line.split("\t") for line in tsv.strip().split("\n") if line]
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
        s3_prefix = f"s3://openneuro.org/{dataset_id}/sub-{sub_id}/"
        modality_prefix = f"{s3_prefix}{modality_folder}/" if modality_folder else s3_prefix
        results.append({
            "participant_id": f"sub-{sub_id}",
            "metadata": p["meta"],
            "s3_prefix": s3_prefix,
            "modality_prefix": modality_prefix,
            "sync_cmd": (
                f"aws s3 sync {modality_prefix} "
                f"./data/{dataset_id}/sub-{sub_id}/{modality_folder}/ --no-sign-request"
            ),
            "ls_cmd": f"aws s3 ls {modality_prefix} --no-sign-request",
        })
    return results


def _infer_task_name(dataset_id: str) -> Optional[str]:
    """Guess the BOLD task name from the dataset's top-level JSON sidecar filenames."""
    files = get_dataset_files(dataset_id)
    for f in files:
        name = f.get("filename", "")
        if name.startswith("task-") and name.endswith("_bold.json"):
            return name.replace("task-", "").replace("_bold.json", "")
    return None


def _resolve_latest_tag(dataset_id: str) -> Optional[str]:
    """Fetch the latest snapshot tag for a dataset."""
    gql = """
    query($id: ID!) {
      dataset(id: $id) { latestSnapshot { tag } }
    }
    """
    try:
        r = requests.post(OPENNEURO_GQL, json={"query": gql, "variables": {"id": dataset_id}}, timeout=10)
        r.raise_for_status()
        snap = (r.json().get("data", {}).get("dataset") or {}).get("latestSnapshot") or {}
        return snap.get("tag")
    except Exception:
        return None
