"""
fl_nodes/client.py
==================
UndosaTech Federated Learning Node Client

Run this on-premise at your institution via Docker.
It registers with the UndosaTech orchestrator, sends heartbeats
to stay visible in the portal, then waits for training assignments.

Required environment variables (set in docker-compose.node.yml):
  NODE_ID                   Unique identifier, e.g. "nhs-kings-001"
  INSTITUTION_NAME          Full name, e.g. "King's College Hospital NHS Foundation Trust"
  INSTITUTION_DOMAIN        e.g. "kch.nhs.uk"   (nhs.uk / ac.uk = auto-approved)
  CONTACT_EMAIL             IT/research contact email
  NODE_HOST                 Public IP or hostname reachable from internet, e.g. "203.0.113.10"
  NODE_REGISTRATION_SECRET  Must match RAILWAY env var NODE_REGISTRATION_SECRET
  NODE_PORT                 Flower gRPC port (default 8080)
  GPU_AVAILABLE             auto | true | false  (default: auto)
  MAX_SAMPLES               Max local samples to share per round (default: no limit)
  SUPPORTED_MODELS          Comma-separated, e.g. "ResNet-18,ResNet-50,ViT-B/16"
  TAGS                      Comma-separated tags, e.g. "ophthalmology,retinal"
  ARCHIVE_PATH              Local archive directory to profile (default /data)
  ARCHIVE_PROFILE           auto | off — allow automatic archive profiling for
                            the Reactivation Index (aggregate counts only;
                            no filenames, paths, or pixel data ever leave)
"""

import os, sys, time, json, signal, logging, threading, pathlib
import requests

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("undosatech-node")

# ── Config ────────────────────────────────────────────────────────────────────
ORCHESTRATOR_URL        = os.environ.get("ORCHESTRATOR_URL", "https://undosatech-production.up.railway.app").rstrip("/")
NODE_ID                 = os.environ.get("NODE_ID", "").strip()
INSTITUTION_NAME        = os.environ.get("INSTITUTION_NAME", "").strip()
INSTITUTION_DOMAIN      = os.environ.get("INSTITUTION_DOMAIN", "").strip()
CONTACT_EMAIL           = os.environ.get("CONTACT_EMAIL", "").strip()
AUTHORISER_NAME         = os.environ.get("AUTHORISER_NAME", "").strip()
AUTHORISER_ROLE         = os.environ.get("AUTHORISER_ROLE", "").strip()
AUTHORISER_EMAIL        = os.environ.get("AUTHORISER_EMAIL", "").strip()
NODE_HOST               = os.environ.get("NODE_HOST", "").strip()
NODE_PORT               = int(os.environ.get("NODE_PORT", "8080"))
NODE_REGISTRATION_SECRET = os.environ.get("NODE_REGISTRATION_SECRET", "").strip()
GPU_AVAILABLE_ENV       = os.environ.get("GPU_AVAILABLE", "auto").strip().lower()
MAX_SAMPLES_ENV         = os.environ.get("MAX_SAMPLES", "").strip()
TAGS_ENV                = os.environ.get("TAGS", "").strip()
SUPPORTED_MODELS_ENV    = os.environ.get("SUPPORTED_MODELS", "").strip()
ARCHIVE_PATH            = os.environ.get("ARCHIVE_PATH", "/data").strip()
ARCHIVE_PROFILE         = os.environ.get("ARCHIVE_PROFILE", "auto").strip().lower()

# Persisted credentials (survive container restarts without re-registering)
CREDS_FILE = pathlib.Path("/app/.node_credentials.json")

# ── State ─────────────────────────────────────────────────────────────────────
_api_key: str = ""
_shutdown = threading.Event()
_training_active: bool = False
_current_study_id: str | None = None


# ── Config validation ─────────────────────────────────────────────────────────
def _validate_config():
    required = {
        "NODE_ID": NODE_ID,
        "INSTITUTION_NAME": INSTITUTION_NAME,
        "INSTITUTION_DOMAIN": INSTITUTION_DOMAIN,
        "CONTACT_EMAIL": CONTACT_EMAIL,
        "NODE_HOST": NODE_HOST,
        "NODE_REGISTRATION_SECRET": NODE_REGISTRATION_SECRET,
    }
    missing = [k for k, v in required.items() if not v]
    if missing:
        log.error("Missing required environment variables: %s", ", ".join(missing))
        log.error("Copy docker-compose.node.yml, fill in .env, and run: docker compose up -d")
        sys.exit(1)


# ── GPU detection ─────────────────────────────────────────────────────────────
def _detect_gpu() -> bool:
    if GPU_AVAILABLE_ENV == "true":
        return True
    if GPU_AVAILABLE_ENV == "false":
        return False
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


# ── Capabilities ──────────────────────────────────────────────────────────────
def _build_capabilities() -> dict:
    default_models = [
        "ResNet-18", "ResNet-50", "ResNet-101",
        "EfficientNet-B0", "EfficientNet-B4",
        "ViT-B/16", "Lightweight CNN",
    ]
    models = (
        [m.strip() for m in SUPPORTED_MODELS_ENV.split(",") if m.strip()]
        if SUPPORTED_MODELS_ENV else default_models
    )
    tags = (
        [t.strip() for t in TAGS_ENV.split(",") if t.strip()]
        if TAGS_ENV else []
    )
    max_samples = int(MAX_SAMPLES_ENV) if MAX_SAMPLES_ENV.isdigit() else None
    return {
        "supported_models": models,
        "tags": tags,
        "max_samples": max_samples,
        "gpu_available": _detect_gpu(),
    }


# ── Credentials persistence ───────────────────────────────────────────────────
def _load_saved_credentials() -> str:
    """Return api_key if saved from a previous registration, else empty string."""
    try:
        if CREDS_FILE.exists():
            data = json.loads(CREDS_FILE.read_text())
            if data.get("node_id") == NODE_ID and data.get("api_key"):
                log.info("Loaded saved credentials (node already registered)")
                return data["api_key"]
    except Exception as e:
        log.warning("Could not load saved credentials: %s", e)
    return ""


def _save_credentials(api_key: str):
    try:
        CREDS_FILE.parent.mkdir(parents=True, exist_ok=True)
        CREDS_FILE.write_text(json.dumps({"node_id": NODE_ID, "api_key": api_key}))
        log.info("Credentials saved to %s", CREDS_FILE)
    except Exception as e:
        log.warning("Could not save credentials: %s  (node will re-register on restart)", e)


# ── Registration ───────────────────────────────────────────────────────────────
def register() -> str:
    """
    Register this node with the orchestrator.
    - If credentials are already saved, skip registration (use saved api_key).
    - On 409 Conflict (already registered), try to re-use saved credentials.
    - Retries every 30 s on network errors.
    Returns the api_key string.
    """
    global _api_key

    saved_key = _load_saved_credentials()
    if saved_key:
        _api_key = saved_key
        return _api_key

    caps = _build_capabilities()

    log.info("=" * 55)
    log.info("UndosaTech Federated Learning Node")
    log.info("Node ID   : %s", NODE_ID)
    log.info("Institution: %s", INSTITUTION_NAME)
    log.info("Domain    : %s", INSTITUTION_DOMAIN)
    log.info("Host      : %s:%d", NODE_HOST, NODE_PORT)
    log.info("GPU       : %s", caps["gpu_available"])
    log.info("Registering with %s …", ORCHESTRATOR_URL)
    log.info("=" * 55)

    payload = {
        "node_id": NODE_ID,
        "institution_name": INSTITUTION_NAME,
        "institution_domain": INSTITUTION_DOMAIN,
        "contact_email": CONTACT_EMAIL,
        "host": NODE_HOST,
        "port": NODE_PORT,
        "gpu_available": caps["gpu_available"],
        "max_samples": caps["max_samples"],
        "supported_models": caps["supported_models"],
        "tags": caps["tags"],
        "registration_secret": NODE_REGISTRATION_SECRET,
        "authoriser_name": AUTHORISER_NAME,
        "authoriser_role": AUTHORISER_ROLE,
        "authoriser_email": AUTHORISER_EMAIL,
    }

    while not _shutdown.is_set():
        try:
            resp = requests.post(
                f"{ORCHESTRATOR_URL}/nodes/register",
                json=payload,
                timeout=15,
            )

            if resp.status_code == 200:
                data = resp.json()
                _api_key = data["api_key"]
                status   = data["status"]
                _save_credentials(_api_key)
                log.info("✓ Registered. Status: %s", status)
                if status == "pending":
                    log.info(
                        "  Activation is a two-step process:\n"
                        "  1. Your institutional authoriser (%s) confirms the emailed request.\n"
                        "  2. UndosaTech approves the node.\n"
                        "  The node will keep sending heartbeats and appear as 'Pending' until then.",
                        AUTHORISER_EMAIL or "PI / data custodian / IT security",
                    )
                return _api_key

            elif resp.status_code == 409:
                # Already registered — must have lost credentials file
                log.warning(
                    "Node '%s' is already registered but no local credentials were found.\n"
                    "  Options:\n"
                    "  1. Ask a researcher to deregister the node in the portal, then restart.\n"
                    "  2. If you have the api_key, set it as NODE_API_KEY env var.",
                    NODE_ID,
                )
                # Check for manually supplied api_key fallback
                manual_key = os.environ.get("NODE_API_KEY", "").strip()
                if manual_key:
                    log.info("Using NODE_API_KEY from environment.")
                    _api_key = manual_key
                    _save_credentials(manual_key)
                    return _api_key
                sys.exit(1)

            elif resp.status_code == 403:
                log.error(
                    "Registration secret rejected (HTTP 403).\n"
                    "  NODE_REGISTRATION_SECRET must match the value set in Railway.\n"
                    "  Contact the UndosaTech team to confirm the correct secret."
                )
                sys.exit(1)

            else:
                log.warning("Registration failed (%d): %s — retrying in 30 s", resp.status_code, resp.text)

        except requests.exceptions.ConnectionError:
            log.warning("Cannot reach %s — retrying in 30 s", ORCHESTRATOR_URL)
        except Exception as e:
            log.warning("Registration error: %s — retrying in 30 s", e)

        _shutdown.wait(30)

    return ""


# ── Heartbeat ──────────────────────────────────────────────────────────────────
def _heartbeat_loop():
    """Send a heartbeat every 30 s. Marks the node online in the portal."""
    while not _shutdown.is_set():
        _shutdown.wait(30)
        if _shutdown.is_set() or not _api_key:
            break

        start = time.monotonic()
        try:
            resp = requests.post(
                f"{ORCHESTRATOR_URL}/nodes/heartbeat",
                json={
                    "node_id": NODE_ID,
                    "api_key": _api_key,
                    "training_active": _training_active,
                    "current_study_id": _current_study_id,
                    "latency_ms": int((time.monotonic() - start) * 1000),
                },
                timeout=8,
            )
            if resp.status_code == 401:
                log.error("Heartbeat rejected (401) — api_key invalid. Deleting saved credentials and exiting.")
                CREDS_FILE.unlink(missing_ok=True)
                sys.exit(1)
            elif resp.status_code != 200:
                log.warning("Heartbeat returned %d", resp.status_code)
        except Exception as e:
            log.warning("Heartbeat failed: %s", e)


def start_heartbeat():
    t = threading.Thread(target=_heartbeat_loop, daemon=True, name="heartbeat")
    t.start()
    log.info("Heartbeat thread started (every 30 s)")
    return t


# ── Graceful shutdown ──────────────────────────────────────────────────────────
def _shutdown_handler(signum, frame):
    log.info("Shutdown signal received — deregistering …")
    _shutdown.set()

    if _api_key:
        try:
            requests.post(
                f"{ORCHESTRATOR_URL}/nodes/{NODE_ID}/deregister",
                json={"api_key": _api_key},
                timeout=6,
            )
            log.info("Node deregistered (marked offline in portal)")
        except Exception:
            pass

    sys.exit(0)

signal.signal(signal.SIGTERM, _shutdown_handler)
signal.signal(signal.SIGINT,  _shutdown_handler)


# ── FL Training client (Flower) ────────────────────────────────────────────────
# The orchestrator will pass the Flower server address when a study is assigned.
# Replace the placeholder `fit` and `evaluate` methods with your institution's
# local data pipeline. Raw patient data never leaves this node.

def run_flower_client(server_address: str):
    """
    Connect to the orchestrator's Flower gRPC server and participate in training.
    Called when the orchestrator assigns this node to a study.
    """
    global _training_active, _current_study_id

    try:
        import flwr as fl
        import torch, torch.nn as nn
        from torchvision import models

        class InstitutionFLClient(fl.client.NumPyClient):
            """
            Replace the load_data, train, and evaluate methods with
            your institution's actual data pipeline.

            IMPORTANT: Raw data never leaves this container.
            Only model weight updates are sent to the orchestrator.
            """

            def __init__(self):
                self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                # ── Replace with your model of choice ──────────────────────
                self.model = models.resnet18(weights=None)
                self.model.to(self.device)
                self.train_loader, self.val_loader = self._load_data()

            def _load_data(self):
                """
                ── REPLACE THIS ──────────────────────────────────────────────
                Load your institution's local dataset.
                Return (train_loader, val_loader).

                Example with a local NPZ file:
                    import numpy as np
                    from torch.utils.data import TensorDataset, DataLoader, random_split
                    data = np.load("/data/local_dataset.npz")
                    X = torch.FloatTensor(data["images"])
                    y = torch.LongTensor(data["labels"])
                    ds = TensorDataset(X, y)
                    n_train = int(len(ds) * 0.8)
                    train_ds, val_ds = random_split(ds, [n_train, len(ds) - n_train])
                    return DataLoader(train_ds, 32, shuffle=True), DataLoader(val_ds, 32)
                """
                import os, pathlib
                import torch
                from torch.utils.data import TensorDataset, DataLoader, random_split

                data_dir = pathlib.Path(os.environ.get("DATA_DIR", "/data"))

                if (data_dir / "local_dataset.npz").exists():
                    import numpy as np
                    raw = np.load(str(data_dir / "local_dataset.npz"))
                    keys = list(raw.keys())
                    X = torch.FloatTensor(raw[keys[0]])
                    y = torch.LongTensor(raw[keys[1]].flatten())
                elif (data_dir / "local_dataset.csv").exists():
                    import pandas as pd
                    df = pd.read_csv(str(data_dir / "local_dataset.csv"))
                    y_raw = df.iloc[:, -1]
                    classes = sorted(y_raw.unique())
                    y = torch.LongTensor(y_raw.map({c: i for i, c in enumerate(classes)}).values.astype("int64"))
                    X = torch.FloatTensor(df.iloc[:, :-1].values.astype("float32")).unsqueeze(1).unsqueeze(-1)
                elif (data_dir / "images").exists():
                    from torchvision import transforms, datasets
                    tf = transforms.Compose([
                        transforms.Resize((28, 28)),
                        transforms.Grayscale(1),
                        transforms.ToTensor(),
                        transforms.Normalize([0.5], [0.5]),
                    ])
                    img_ds = datasets.ImageFolder(str(data_dir / "images"), transform=tf)
                    X = torch.stack([img_ds[i][0] for i in range(len(img_ds))])
                    y = torch.LongTensor([img_ds[i][1] for i in range(len(img_ds))])
                else:
                    raise RuntimeError(
                        f"No dataset found in {data_dir}. Mount one of: "
                        f"{data_dir}/local_dataset.npz, "
                        f"{data_dir}/local_dataset.csv, or "
                        f"{data_dir}/images/<class_name>/*.png"
                    )

                if X.dim() == 3:
                    X = X.unsqueeze(1)
                if X.shape[1] not in [1, 3]:
                    X = X.permute(0, 3, 1, 2)
                X = X / 255.0 if X.max() > 1.0 else X
                ds = TensorDataset(X, y)
                n_train = int(len(ds) * 0.8)
                train_ds, val_ds = random_split(ds, [n_train, len(ds) - n_train])
                return DataLoader(train_ds, 32, shuffle=True), DataLoader(val_ds, 32)

            def get_parameters(self, config):
                return [val.cpu().numpy() for _, val in self.model.state_dict().items()]

            def set_parameters(self, parameters):
                from collections import OrderedDict
                import numpy as np
                state_dict = OrderedDict(
                    {k: torch.tensor(v) for k, v in zip(self.model.state_dict().keys(), parameters)}
                )
                self.model.load_state_dict(state_dict, strict=True)

            def fit(self, parameters, config):
                self.set_parameters(parameters)
                self.model.train()
                optimizer = torch.optim.Adam(self.model.parameters(), lr=config.get("lr", 1e-3))
                criterion = nn.CrossEntropyLoss()
                total, correct = 0, 0

                for _ in range(int(config.get("local_epochs", 1))):
                    for X, y in self.train_loader:
                        X, y = X.to(self.device), y.to(self.device)
                        optimizer.zero_grad()
                        out = self.model(X)
                        loss = criterion(out, y)
                        loss.backward()
                        optimizer.step()
                        correct += out.argmax(1).eq(y).sum().item()
                        total   += X.size(0)

                return self.get_parameters(config={}), total, {"accuracy": correct / max(total, 1)}

            def evaluate(self, parameters, config):
                self.set_parameters(parameters)
                self.model.eval()
                criterion = nn.CrossEntropyLoss()
                total, correct, total_loss = 0, 0, 0.0

                with torch.no_grad():
                    for X, y in self.val_loader:
                        X, y = X.to(self.device), y.to(self.device)
                        out   = self.model(X)
                        total_loss += criterion(out, y).item() * X.size(0)
                        correct    += out.argmax(1).eq(y).sum().item()
                        total      += X.size(0)

                return total_loss / max(total, 1), total, {"accuracy": correct / max(total, 1)}

        _training_active = True
        log.info("Connecting to Flower server at %s …", server_address)
        fl.client.start_numpy_client(server_address=server_address, client=InstitutionFLClient())

    except ImportError:
        log.error("flwr is not installed — run: pip install flwr")
    except Exception as e:
        log.error("Flower client error: %s", e)
    finally:
        _training_active = False
        _current_study_id = None


# ── Archive profiling (Reactivation Index) ────────────────────────────────────
# Scans ARCHIVE_PATH locally and reports AGGREGATES ONLY: counts per modality,
# year range from file mtimes, total volume. No filename, path, or pixel ever
# leaves the institution. Runs only when the orchestrator assigns it and
# ARCHIVE_PROFILE != "off".

_MODALITY_EXTENSIONS = {
    ".dcm": "DICOM", ".dicom": "DICOM",
    ".nii": "NIfTI", ".gz": "NIfTI",          # .nii.gz handled below
    ".e2e": "OCT (Heidelberg)", ".fds": "OCT (Topcon)", ".fda": "OCT (Topcon)",
    ".oct": "OCT", ".img": "Fundus/raw",
    ".png": "2D image", ".jpg": "2D image", ".jpeg": "2D image",
    ".tif": "2D image", ".tiff": "2D image", ".bmp": "2D image",
    ".edf": "EEG/physiology", ".bdf": "EEG/physiology",
    ".mha": "Volume (MetaImage)", ".mhd": "Volume (MetaImage)", ".nrrd": "Volume (NRRD)",
}
_MAX_PROFILE_FILES = 2_000_000


def _classify_file(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".nii.gz"):
        return "NIfTI"
    ext = pathlib.Path(lower).suffix
    if ext == ".gz":
        return None
    return _MODALITY_EXTENSIONS.get(ext)


def _profile_archive() -> dict | None:
    root = pathlib.Path(ARCHIVE_PATH)
    if not root.is_dir():
        log.warning("ARCHIVE_PATH %s does not exist — skipping profile", ARCHIVE_PATH)
        return None
    log.info("Profiling archive at %s (aggregates only, nothing leaves this machine) …", root)
    modalities: dict = {}
    total_files = total_bytes = dirs_scanned = 0
    earliest = latest = None
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        dirs_scanned += 1
        for fname in filenames:
            modality = _classify_file(fname)
            if not modality:
                continue
            total_files += 1
            modalities[modality] = modalities.get(modality, 0) + 1
            try:
                st = os.stat(os.path.join(dirpath, fname))
                total_bytes += st.st_size
                yr = time.gmtime(st.st_mtime).tm_year
                earliest = yr if earliest is None else min(earliest, yr)
                latest = yr if latest is None else max(latest, yr)
            except OSError:
                continue
            if total_files >= _MAX_PROFILE_FILES:
                log.warning("Profile capped at %d files", _MAX_PROFILE_FILES)
                break
        else:
            continue
        break
    log.info("Archive profile: %d files across %d modalities (%.1f GB)",
             total_files, len(modalities), total_bytes / 1e9)
    return {
        "node_id":            NODE_ID,
        "scanned_files":      total_files,
        "modalities":         modalities,
        "year_range":         [earliest, latest] if earliest else None,
        "total_bytes":        total_bytes,
        "dirs_scanned":       dirs_scanned,
        "archive_path_label": os.environ.get("ARCHIVE_LABEL", "primary-archive"),
    }


def _handle_node_tasks():
    """Poll orchestrator-assigned tasks; auto-run archive profiling on request."""
    if ARCHIVE_PROFILE == "off" or not _api_key:
        return
    resp = requests.get(
        f"{ORCHESTRATOR_URL}/nodes/{NODE_ID}/tasks",
        headers={"Authorization": f"Bearer {_api_key}", "X-Node-Id": NODE_ID},
        timeout=8,
    )
    if resp.status_code != 200:
        return
    for task in resp.json():
        if task.get("task_type") == "profile_archive":
            profile = _profile_archive()
            if profile:
                r = requests.post(
                    f"{ORCHESTRATOR_URL}/index/profile", json=profile,
                    headers={"Authorization": f"Bearer {_api_key}", "X-Node-Id": NODE_ID},
                    timeout=15,
                )
                if r.status_code == 200:
                    log.info("Archive profile indexed ✓ (%s)", r.json().get("jurisdiction"))
                else:
                    log.warning("Profile submission failed: %s %s", r.status_code, r.text[:200])


# ── Main ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    _validate_config()

    # Register (or load saved credentials)
    register()

    # Start heartbeat — node now shows "Online" in the UndosaTech portal
    start_heartbeat()

    log.info("Node is live. Visible in portal at app.undosatech.com → Nodes tab.")
    log.info("Waiting for training assignments …")

    while not _shutdown.is_set():
        _shutdown.wait(60)
        try:
            _handle_node_tasks()
        except Exception as e:
            log.warning("Node task poll failed: %s", e)
        try:
            if _api_key:
                resp = requests.get(
                    f"{ORCHESTRATOR_URL}/nodes/{NODE_ID}/invitations",
                    params={"status": "accepted"},
                    headers={"Authorization": f"Bearer {_api_key}", "X-Node-Id": NODE_ID},
                    timeout=8,
                )
                if resp.status_code == 200:
                    invitations = resp.json()
                    for inv in invitations:
                        study_id = inv.get("study_id")
                        if study_id and not _training_active:
                            addr_resp = requests.get(
                                f"{ORCHESTRATOR_URL}/studies/{study_id}/flower-address",
                                headers={"Authorization": f"Bearer {_api_key}", "X-Node-Id": NODE_ID},
                                timeout=8,
                            )
                            if addr_resp.status_code == 200:
                                addr_data = addr_resp.json()
                                if addr_data.get("active"):
                                    server_addr = addr_data["server_address"]
                                    _current_study_id = study_id
                                    log.info("Study %s assigned — connecting to Flower at %s", study_id[:8], server_addr)
                                    run_flower_client(server_addr)
        except Exception as e:
            log.warning("Assignment poll failed: %s", e)
