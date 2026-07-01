"""
OpenNeuro connector — search datasets, stream metadata, download partitioned samples
for use as FL training data without centralising raw scans.
"""
import requests
from typing import Optional

OPENNEURO_GQL = "https://openneuro.org/crn/graphql"


def search_datasets(query: str = "", modality: str = "", limit: int = 20) -> list:
    """Search OpenNeuro datasets via GraphQL."""
    gql = """
    query SearchDatasets($query: String, $modality: String, $first: Int) {
      datasets(query: $query, filterBy: {modality: $modality}, first: $first) {
        edges {
          node {
            id
            description { Name BIDSVersion }
            analytics { downloads views stars }
            latestSnapshot {
              tag
              summary { modalities sessions subjects tasks size }
            }
          }
        }
      }
    }
    """
    variables = {"query": query, "modality": modality or None, "first": limit}
    try:
        r = requests.post(
            OPENNEURO_GQL,
            json={"query": gql, "variables": variables},
            timeout=15,
        )
        r.raise_for_status()
        edges = r.json().get("data", {}).get("datasets", {}).get("edges", [])
        results = []
        for e in edges:
            node = e["node"]
            snap = node.get("latestSnapshot") or {}
            summary = snap.get("summary") or {}
            desc = node.get("description") or {}
            results.append({
                "id": node["id"],
                "name": desc.get("Name", node["id"]),
                "version": snap.get("tag", "latest"),
                "modalities": summary.get("modalities", []),
                "subjects": summary.get("subjects", 0),
                "sessions": summary.get("sessions", 0),
                "size_bytes": summary.get("size", 0),
                "downloads": (node.get("analytics") or {}).get("downloads", 0),
            })
        return results
    except Exception:
        return []


def get_dataset_files(dataset_id: str, version: str = "latest") -> list:
    """List files in a dataset snapshot."""
    gql = """
    query DatasetFiles($id: ID!, $tag: String!) {
      dataset(id: $id) {
        snapshot(tag: $tag) {
          files { id filename size urls }
        }
      }
    }
    """
    try:
        r = requests.post(
            OPENNEURO_GQL,
            json={"query": gql, "variables": {"id": dataset_id, "tag": version}},
            timeout=15,
        )
        data = r.json().get("data", {}).get("dataset", {})
        snap = data.get("snapshot") or {}
        return snap.get("files", [])
    except Exception:
        return []


def download_participant_tsv(dataset_id: str, version: str = "latest") -> Optional[str]:
    """Download participants.tsv for metadata (age, diagnosis, sex) — no images."""
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
    Return download URLs for NIfTI files for up to max_subjects subjects.
    Used to simulate partitioned FL data (each subject = one local sample).
    """
    files = get_dataset_files(dataset_id, version)
    nifti_files = [
        f for f in files
        if modality_folder in f.get("filename", "") and f["filename"].endswith(".nii.gz")
    ][:max_subjects]
    return [
        {
            "filename": f["filename"],
            "url": (f.get("urls") or [None])[0],
            "size": f.get("size", 0),
        }
        for f in nifti_files
    ]
