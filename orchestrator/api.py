"""
UndosaTech Orchestrator v6 — Persistent Supabase storage + Node Registry
"""
import json, logging, uuid, shutil, threading, os, hashlib, hmac, secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Optional, List

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("undosatech")

WEIGHTS_DIR = Path("weights")
UPLOADS_DIR = Path("uploads")
AUDIT_PATH  = Path("audit_log.jsonl")
WEIGHTS_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL             = os.getenv("SUPABASE_URL", "https://hpfuacpmocnsxdgbnidm.supabase.co")
SUPABASE_SERVICE_KEY     = os.getenv("SUPABASE_SERVICE_KEY", "")
NODE_REGISTRATION_SECRET = os.getenv("NODE_REGISTRATION_SECRET", "change-me")

supabase_admin = None
store = None

if SUPABASE_SERVICE_KEY:
    try:
        from supabase import create_client
        supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        from orchestrator.study_store import StudyStore
        store = StudyStore()
        logger.info("Supabase connected ✓")
    except Exception as e:
        logger.warning(f"Supabase init failed: {e} — falling back to in-memory")

# In-memory fallback (used if Supabase not configured)
jobs: Dict[str, dict] = {}
stop_events: Dict[str, bool] = {}


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app):
    if store:
        try:
            interrupted = store.list_running()
            for s in interrupted:
                store.set_failed(s["id"], "Server restarted while training was running. Please re-launch.")
                store.append_log(s["id"], "⚠️ Training interrupted by server restart.", level="warning")
            if interrupted:
                logger.info(f"Marked {len(interrupted)} interrupted studies as failed")
        except Exception as e:
            logger.warning(f"Crash recovery failed: {e}")
    _node_monitor_loop()
    yield

app = FastAPI(title="UndosaTech API", version="6.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ── Audit ─────────────────────────────────────────────────────────────────────
def audit(study_id, event_type, data):
    row = {"event_id": str(uuid.uuid4()), "study_id": study_id,
           "timestamp": datetime.now(timezone.utc).isoformat(),
           "event_type": event_type, **data}
    with open(AUDIT_PATH, "a") as f:
        f.write(json.dumps(row) + "\n")


# ── Auth helper ───────────────────────────────────────────────────────────────
def _require_user(authorization: Optional[str]):
    if not supabase_admin:
        return type("User", (), {"id": "local", "email": "local@dev"})()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.split(" ", 1)[1]
    try:
        result = supabase_admin.auth.get_user(token)
        if not result or not result.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return result.user
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token validation failed")


# ── Universal data loader ─────────────────────────────────────────────────────
def detect_and_load(upload_path: Optional[Path], dataset_name: str, partition_id: int, num_partitions: int):
    import torch
    from torch.utils.data import DataLoader, TensorDataset, Subset, random_split
    import numpy as np

    medmnist_map = {
        "octmnist":      ("OCTMNIST",     1, 4,  ["CNV","DME","DRUSEN","NORMAL"]),
        "pathmnist":     ("PathMNIST",    3, 9,  ["ADI","BACK","DEB","LYM","MUC","MUS","NORM","STR","TUM"]),
        "chestmnist":    ("ChestMNIST",   1, 14, ["Atelectasis","Cardiomegaly","Effusion","Infiltration","Mass","Nodule","Pneumonia","Pneumothorax","Consolidation","Edema","Emphysema","Fibrosis","Pleural","Hernia"]),
        "dermamnist":    ("DermaMNIST",   3, 7,  ["MEL","NV","BCC","AK","BKL","DF","VASC"]),
        "breastmnist":   ("BreastMNIST",  1, 2,  ["Benign","Malignant"]),
        "bloodmnist":    ("BloodMNIST",   3, 8,  ["Basophil","Eosinophil","Erythroblast","Ig","Lymphocyte","Monocyte","Neutrophil","Platelet"]),
        "tissuemnist":   ("TissueMNIST",  1, 8,  ["Adipose","Background","Debris","Lymphocytes","Mucus","Smooth muscle","Normal colon mucosa","Cancer-associated stroma","Colorectal adenocarcinoma epithelium"]),
        "retinamnist":   ("RetinaMNIST",  3, 5,  ["Grade 0","Grade 1","Grade 2","Grade 3","Grade 4"]),
        "pneumoniamnist":("PneumoniaMNIST",1,2,  ["Normal","Pneumonia"]),
        "organamnist":   ("OrganAMNIST",  1, 11, ["Bladder","Femur-L","Femur-R","Heart","Kidney-L","Kidney-R","Liver","Lung-L","Lung-R","Pancreas","Spleen"]),
    }

    if dataset_name.lower() in medmnist_map:
        cls_name, in_ch, n_cls, class_names = medmnist_map[dataset_name.lower()]
        try:
            import medmnist
            from torchvision import transforms
            DataClass = getattr(medmnist, cls_name)
            tf = transforms.Compose([transforms.ToTensor(), transforms.Normalize([0.5]*in_ch, [0.5]*in_ch)])
            train_ds = DataClass(split="train", transform=tf, download=True, root=str(UPLOADS_DIR))
            test_ds  = DataClass(split="test",  transform=tf, download=True, root=str(UPLOADS_DIR))
            n = min(len(train_ds) // num_partitions, 5000)
            train_ds = Subset(train_ds, list(range(partition_id*n, min((partition_id+1)*n, len(train_ds)))))
            desc = f"{cls_name}: {len(train_ds)} train / {len(test_ds)} test · {n_cls} classes"
            return (DataLoader(train_ds,32,shuffle=True,num_workers=0),
                    DataLoader(test_ds,32,shuffle=False,num_workers=0),
                    n_cls, in_ch, desc, class_names)
        except Exception as e:
            logger.warning(f"MedMNIST {cls_name} failed: {e}")

    if upload_path and upload_path.exists():
        suffix = upload_path.suffix.lower()

        if suffix == ".npz":
            try:
                data = np.load(str(upload_path), allow_pickle=True)
                keys = list(data.keys())
                X = torch.FloatTensor(data[keys[0]])
                y = torch.LongTensor(data[keys[1]].flatten())
                if X.dim()==3: X=X.unsqueeze(1)
                if X.shape[1] not in [1,3]: X=X.permute(0,3,1,2)
                X = X/255.0 if X.max()>1 else X
                n_cls = int(y.max().item())+1; in_ch = X.shape[1]
                ds = TensorDataset(X,y); n_train=int(len(ds)*0.8)
                train_ds,test_ds=random_split(ds,[n_train,len(ds)-n_train])
                return (DataLoader(train_ds,32,shuffle=True,num_workers=0),
                        DataLoader(test_ds,32,shuffle=False,num_workers=0),
                        n_cls,in_ch,f"NPZ: {len(X)} samples",[f"Class {i}" for i in range(n_cls)])
            except Exception as e:
                logger.warning(f"NPZ failed: {e}")

        if suffix == ".csv":
            try:
                import pandas as pd
                df = pd.read_csv(str(upload_path))
                y_raw = df.iloc[:,-1]; X_raw = df.iloc[:,:-1].values.astype("float32")
                classes = sorted(y_raw.unique())
                y_enc = y_raw.map({c:i for i,c in enumerate(classes)}).values.astype("int64")
                side = max(1, int(X_raw.shape[1]**0.5)); pad = side*side - X_raw.shape[1]
                if pad > 0: X_raw = np.pad(X_raw, ((0,0),(0,pad)))
                X_t = torch.FloatTensor(X_raw).reshape(-1,1,side,side)
                y_t = torch.LongTensor(y_enc); n_cls=len(classes); in_ch=1
                ds=TensorDataset(X_t,y_t); n_train=int(len(ds)*0.8)
                train_ds,test_ds=random_split(ds,[n_train,len(ds)-n_train])
                return (DataLoader(train_ds,32,shuffle=True,num_workers=0),
                        DataLoader(test_ds,32,shuffle=False,num_workers=0),
                        n_cls,in_ch,f"CSV: {len(X_t)} rows",[str(c) for c in classes])
            except Exception as e:
                logger.warning(f"CSV failed: {e}")

        if suffix == ".zip":
            try:
                import zipfile
                from torchvision import transforms, datasets
                extract_dir = UPLOADS_DIR / upload_path.stem
                extract_dir.mkdir(exist_ok=True)
                with zipfile.ZipFile(str(upload_path),'r') as z:
                    z.extractall(str(extract_dir))
                tf = transforms.Compose([transforms.Resize((28,28)), transforms.Grayscale(1),
                                         transforms.ToTensor(), transforms.Normalize([0.5],[0.5])])
                ds = datasets.ImageFolder(str(extract_dir), transform=tf)
                n_cls=len(ds.classes); in_ch=1; class_names=ds.classes
                n_train=int(len(ds)*0.8); train_ds,test_ds=random_split(ds,[n_train,len(ds)-n_train])
                return (DataLoader(train_ds,32,shuffle=True,num_workers=0),
                        DataLoader(test_ds,32,shuffle=False,num_workers=0),
                        n_cls,in_ch,f"ZIP: {len(ds)} samples",class_names)
            except Exception as e:
                logger.warning(f"ZIP failed: {e}")

        if suffix in [".dcm",".dicom"]:
            try:
                import pydicom
                ds_dcm = pydicom.dcmread(str(upload_path))
                arr = ds_dcm.pixel_array.astype("float32")
                arr = (arr - arr.min()) / (arr.max() - arr.min() + 1e-8)
                X = torch.FloatTensor(arr).unsqueeze(0).unsqueeze(0).repeat(100,1,1,1)
                y = torch.randint(0,2,(100,)); ds=TensorDataset(X,y)
                train_ds,test_ds=random_split(ds,[80,20])
                return (DataLoader(train_ds,32,shuffle=True,num_workers=0),
                        DataLoader(test_ds,32,shuffle=False,num_workers=0),
                        2,1,"DICOM demo",["Class 0","Class 1"])
            except Exception as e:
                logger.warning(f"DICOM failed: {e}")

    # Synthetic fallback
    import torch
    torch.manual_seed(42)
    X=torch.randn(2000,1,28,28); y=torch.randint(0,4,(2000,))
    ds=TensorDataset(X,y); train_ds,test_ds=random_split(ds,[1600,400])
    return (DataLoader(train_ds,32,shuffle=True,num_workers=0),
            DataLoader(test_ds,32,shuffle=False,num_workers=0),
            4,1,"Synthetic demo: 2000 samples · 4 classes",["Class A","Class B","Class C","Class D"])


# ── Model builder ─────────────────────────────────────────────────────────────
def build_model(num_classes, in_channels, arch="resnet18"):
    import torch.nn as nn
    from torchvision import models
    logger.info(f"Building {arch} · {in_channels}ch → {num_classes} classes")

    def adapt_first_conv(m, in_ch):
        if in_ch != 3:
            m.conv1 = nn.Conv2d(in_ch, 64, kernel_size=7, stride=2, padding=3, bias=False)
        return m

    if arch == "resnet18":
        m = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
        m = adapt_first_conv(m, in_channels); m.fc = nn.Linear(m.fc.in_features, num_classes); return m
    if arch == "resnet50":
        m = models.resnet50(weights=models.ResNet50_Weights.IMAGENET1K_V1)
        m = adapt_first_conv(m, in_channels); m.fc = nn.Linear(m.fc.in_features, num_classes); return m
    if arch == "resnet101":
        m = models.resnet101(weights=models.ResNet101_Weights.IMAGENET1K_V1)
        m = adapt_first_conv(m, in_channels); m.fc = nn.Linear(m.fc.in_features, num_classes); return m
    if arch == "efficientnet_b0":
        m = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
        if in_channels != 3:
            m.features[0][0] = nn.Conv2d(in_channels, 32, kernel_size=3, stride=2, padding=1, bias=False)
        m.classifier[1] = nn.Linear(m.classifier[1].in_features, num_classes); return m
    if arch == "efficientnet_b4":
        m = models.efficientnet_b4(weights=models.EfficientNet_B4_Weights.IMAGENET1K_V1)
        if in_channels != 3:
            m.features[0][0] = nn.Conv2d(in_channels, 48, kernel_size=3, stride=2, padding=1, bias=False)
        m.classifier[1] = nn.Linear(m.classifier[1].in_features, num_classes); return m
    if arch == "vit_b16":
        try:
            m = models.vit_b_16(weights=models.ViT_B_16_Weights.IMAGENET1K_V1)
            m.heads.head = nn.Linear(m.heads.head.in_features, num_classes); return m
        except Exception:
            logger.warning("ViT failed, falling back to ResNet18")
            m = models.resnet18(weights=models.ResNet18_Weights.IMAGENET1K_V1)
            m = adapt_first_conv(m, in_channels); m.fc = nn.Linear(m.fc.in_features, num_classes); return m

    return __import__('torch').nn.Sequential(
        __import__('torch').nn.Conv2d(in_channels,32,3,padding=1),__import__('torch').nn.BatchNorm2d(32),__import__('torch').nn.ReLU(),__import__('torch').nn.MaxPool2d(2),
        __import__('torch').nn.Conv2d(32,64,3,padding=1),__import__('torch').nn.BatchNorm2d(64),__import__('torch').nn.ReLU(),__import__('torch').nn.AdaptiveAvgPool2d((4,4)),
        __import__('torch').nn.Flatten(),__import__('torch').nn.Dropout(0.4),__import__('torch').nn.Linear(64*16,256),__import__('torch').nn.ReLU(),__import__('torch').nn.Linear(256,num_classes),
    )



def _add_dp_noise(model, noise_multiplier: float, max_grad_norm: float = 1.0):
    """Gaussian mechanism DP: clip weights then add calibrated noise before FedAvg."""
    import torch
    with torch.no_grad():
        for param in model.parameters():
            clip_coef = min(1.0, max_grad_norm / (param.data.norm(2) + 1e-6))
            param.data.mul_(clip_coef)
            param.data.add_(torch.randn_like(param.data) * noise_multiplier * max_grad_norm)

# ── Training thread ───────────────────────────────────────────────────────────
def train_thread(study_id, upload_path, dataset_name, num_rounds, local_epochs, arch, nodes_config, dp_noise_multiplier=None):
    import torch, torch.nn as nn, torch.optim as optim

    logger.info(f"[{study_id[:8]}] Thread started — {arch} on {dataset_name}")

    def log(msg, level="info", round_number=None, metrics=None):
        logger.info(f"[{study_id[:8]}] {msg}")
        if store:
            store.append_log(study_id, msg, level=level, round_number=round_number, metrics=metrics)
        else:
            jobs[study_id].setdefault("logs", []).append(msg)

    def update_job(**kwargs):
        if store:
            store.update(study_id, **kwargs)
        else:
            jobs[study_id].update(kwargs)

    try:
        if store:
            store.set_running(study_id)
        else:
            jobs[study_id]["status"] = "running"
            jobs[study_id]["started_at"] = datetime.now(timezone.utc).isoformat()

        node_names = [n.get("institution_name", n) if isinstance(n, dict) else str(n)
                      for n in nodes_config] if nodes_config else [
            "NHS Moorfields Eye Hospital", "University of Edinburgh Medical School"
        ]
        num_nodes = len(node_names)
        device = torch.device("cpu")

        node_loaders = []
        for i in range(num_nodes):
            tl, vl, num_classes, in_ch, desc, class_names = detect_and_load(
                upload_path, dataset_name, i, num_nodes)
            node_loaders.append((tl, vl))
            if i == 0:
                log(f"Dataset: {desc}")

        audit(study_id, "study_started", {"dataset": dataset_name, "arch": arch, "nodes": node_names})

        node_models = [build_model(num_classes, in_ch, arch).to(device) for _ in range(num_nodes)]
        node_optims = [optim.Adam(m.parameters(), lr=0.001, weight_decay=1e-4) for m in node_models]
        schedulers  = [optim.lr_scheduler.CosineAnnealingLR(o, T_max=num_rounds) for o in node_optims]
        # ChestMNIST is multi-label - needs BCE loss
        multilabel_datasets = ['chestmnist']
        is_multilabel = dataset_name.lower() in multilabel_datasets
        criterion = nn.BCEWithLogitsLoss() if is_multilabel else nn.CrossEntropyLoss()
        round_results = []

        for rnd in range(1, num_rounds+1):
            # Check stop signal
            if stop_events.get(study_id):
                log("Training stopped by user", level="warning")
                if store: store.set_stopped(study_id)
                else: jobs[study_id]["status"] = "cancelled"
                return

            log(f"Round {rnd}/{num_rounds} — starting")
            if store: store.set_round(study_id, rnd)
            else: jobs[study_id]["current_round"] = rnd

            node_states, node_metrics = [], []

            for i, (model, opt, sched) in enumerate(zip(node_models, node_optims, schedulers)):
                model.train()
                tot_loss = correct = total = 0
                tl, _ = node_loaders[i]
                log(f"Node {i+1}/{num_nodes}: {node_names[i][:30]} — training...")

                for epoch in range(local_epochs):
                    for b_idx, batch in enumerate(tl):
                        if stop_events.get(study_id): break
                        X, y = batch[0].to(device), batch[1].to(device)
                        if y.dim()>1: y=y.squeeze(1) if y.shape[1]==1 else y.argmax(1)
                        opt.zero_grad()
                        try:
                            out = model(X)
                        except Exception as e:
                            logger.warning(f"Forward pass error: {e}")
                            continue
                        if is_multilabel:
                            y_f = y.float().squeeze()
                            if y_f.dim() == 1: y_f = y_f.unsqueeze(0)
                            if y_f.shape[-1] != out.shape[-1]: y_f = y_f.view(out.shape[0], -1)
                            loss = criterion(out, y_f)
                        else:
                            loss = criterion(out, y.long())
                        loss.backward(); opt.step()
                        tot_loss += loss.item()*X.size(0)
                        correct  += out.argmax(1).eq(y).sum().item()
                        total    += X.size(0)
                        if b_idx % 10 == 0:
                            pct = int((b_idx+1)/max(len(tl),1)*100)
                            acc_so_far = round(correct/max(total,1)*100,1)
                            live_msg = f"R{rnd} · Node {i+1}/{num_nodes} · Batch {b_idx+1}/{len(tl)} ({pct}%) · acc {acc_so_far}%"
                            logger.info(f"[{study_id[:8]}] {live_msg}")
                            if store: store.update(study_id, live_status=live_msg)
