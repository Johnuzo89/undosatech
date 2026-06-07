# UndosaTech — Priority 4: Persistent Study Storage

## What Changed

| Before | After |
|---|---|
| `studies = {}` dict in Railway memory | `studies` table in Supabase |
| Lost on every redeploy | Permanent |
| All users share the same dict | Each user sees only their own studies |
| Logs stored in memory list | `study_logs` table, pollable by id cursor |
| Round metrics lost | `study_rounds` table, used for charting |
| No crash recovery | Interrupted studies marked failed on startup |

---

## Deployment Steps

### Step 1 — Supabase migration

1. Open https://supabase.com/dashboard → your project → **SQL Editor**
2. Run `supabase_migration_studies.sql`
3. Confirm you see three new tables: `studies`, `study_logs`, `study_rounds`

> Note: This migration calls `update_updated_at()` which was created in the
> fl_nodes migration. If you haven't run that yet, uncomment the function
> definition at the top of the SQL file.

### Step 2 — Add study_store.py to your backend

```bash
cp study_store.py ~/undosatech/orchestrator/study_store.py
```

Add `supabase>=2.0.0` to `requirements.txt` if not already there (from node registry work).

### Step 3 — Update api.py

**3a. Remove the in-memory dict:**
```python
# DELETE this line:
studies = {}
# And this if it exists:
stop_events = {}  # keep this one — it's still used for thread signalling
```

**3b. Add imports and initialise store (near the top, after FastAPI app creation):**
```python
from study_store import StudyStore
store = StudyStore()
```

**3c. Add startup event for crash recovery:**
```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup
    recover_interrupted_studies()
    _node_monitor_loop()  # if you've added node registry
    yield
    # On shutdown (nothing needed)

app = FastAPI(lifespan=lifespan)
```

**3d. Replace your 5 study endpoints** with the versions in `api_studies_rewrite.py`.
Copy the endpoint functions verbatim — they're drop-in replacements.

**3e. Update your training thread function.**
Find your existing function (likely called `run_training` or similar) and
replace the dict mutations with store calls as shown in the comments at the
bottom of `api_studies_rewrite.py`.

The key substitutions:
```python
# OLD                                   NEW
studies[sid]["status"] = "running"   → store.set_running(sid)
studies[sid]["logs"].append(msg)     → store.append_log(sid, msg)
studies[sid]["round"] = r            → store.set_round(sid, r)
# At end of each round:
                                     → store.record_round(sid, r, acc, loss)
# On completion:
studies[sid]["status"] = "complete"  → store.set_completed(sid, acc, loss, per_class)
# On failure:
studies[sid]["status"] = "failed"    → store.set_failed(sid, str(e))
```

### Step 4 — Deploy frontend

```bash
cp MyStudies.jsx ~/undosatech/portal/src/components/MyStudies.jsx
```

In `App.jsx`, update the import:
```jsx
// Change:
import MyStudies from "./MyStudies"   // or wherever it currently is
// To:
import MyStudies from "./components/MyStudies"

// The component props stay the same — just pass session:
<MyStudies session={session} />
```

### Step 5 — Deploy

```bash
cd ~/undosatech
git add .
git commit -m "feat: persistent study storage via Supabase (priority 4)"
git push
```

Railway auto-deploys the backend. Vercel auto-deploys the frontend.

---

## Verifying It Works

1. Launch a study in the portal
2. Redeploy Railway (push an empty commit)
3. The study should still appear in My Studies after redeploy
4. Launch another study — confirm it only shows for the logged-in user

---

## What the Frontend Gained

- **Persisted history** — all past studies visible after redeploy or browser refresh
- **Expandable cards** — click any study to see live logs, accuracy sparkline, per-class breakdown
- **Status filter tabs** — filter by running/completed/failed/stopped
- **Log cursor polling** — same 2s polling pattern, now asks for `since_id` to only fetch new lines
- **Delete completed studies** — with confirmation
- **Download model** — link appears when study completes

---

## What Stays In-Memory (Intentional)

`stop_events = {}` — the dict used to signal the training thread to stop.
This is correct: it's a threading primitive, not persistent data. If Railway
restarts mid-training, the study gets marked failed by `recover_interrupted_studies()`
and the user re-launches. There's no value in persisting a stop signal.

---

## Ready for Priority 3 (Study Invitations)

The `studies` table has `nodes TEXT[]` which will map directly to node_ids
from the `fl_nodes` table. The invitation system (P3) will add:
- `study_invitations` table (study_id → node_id → accepted/rejected)
- Training only starts when all invited nodes have accepted
- The `nodes` column already exists — no migration needed for that part
