# UndosaTech FL Node — Deployment Guide

*For institutional IT and information-governance reviewers.*
*Web version: https://undosatech.com/node-deployment · Questions: security@undosatech.com*

The FL node is a single Docker container an institution runs on its own
infrastructure, next to its data. It lets the institution participate in
federated studies without any patient-level data leaving its network.

## Network posture: outbound-only

The node **opens no inbound ports**. All connections are initiated by the node,
outbound. It registers with the UndosaTech orchestrator, sends a heartbeat,
polls for training assignments, and — when your institution has accepted a
study invitation — connects out to that study's aggregation endpoint for the
duration of training. It can sit behind NAT and standard institutional
firewalls with no changes to inbound rules.

### Egress allow-list

| Destination | Port / protocol | Purpose | When |
|---|---|---|---|
| `undosatech-production.up.railway.app` | 443 / HTTPS | Registration, heartbeat (60 s), assignment polling, deregistration | Continuous |
| `undosatech-production.up.railway.app` | 8001 / gRPC (TLS) | Flower federated-training session (model weights in, updates out) | Only while a study your institution accepted is training |
| Docker Hub (`registry-1.docker.io`, `auth.docker.io`) | 443 / HTTPS | Image pull | Install and updates only |

The training endpoint is never hard-coded on the node: the orchestrator returns
it at study start, and it is always within the allow-list above.

**Proxies:** the node honours standard `HTTPS_PROXY` / `HTTP_PROXY` /
`NO_PROXY` environment variables — add them to `.env.node` if your institution
routes egress through a proxy.

## What crosses the boundary

**Leaves the institution:**
- Registration metadata you configure: institution name, domain, contact email, declared capabilities (GPU, sample budget, supported models, tags)
- Heartbeats: node status, latency, whether training is active
- During an accepted study only: model weight updates and aggregate training metrics (loss, accuracy, per-class accuracy, sample counts) per round

**Never leaves the institution:**
- Patient-level data, images, or files. The data directory is mounted read-only into the container and is read only by the local training loop.
- Optionally, weight updates can carry differential-privacy noise (configured per study by the researcher, visible to you in the study invitation).

Every governance-relevant event (registration, study invitation, acceptance,
round completion) is recorded in a hash-chained, tamper-evident audit trail on
the platform; the node's own actions are also visible locally via `docker logs`.

## Requirements

- Linux server or VM with Docker Engine ≥ 20.10 and Docker Compose ≥ 2.0
- 4 GB+ RAM (CPU training works; a CUDA GPU is used automatically if present and `GPU_AVAILABLE=true`)
- Outbound access per the allow-list above
- Local data prepared as `local_dataset.npz` (arrays `images`, `labels`) in the mounted data directory — the study invitation specifies the expected shape

## Install

```bash
curl -O https://app.undosatech.com/docker-compose.node.yml
# create .env.node from the template at the bottom of that file
docker compose -f docker-compose.node.yml up -d
docker compose -f docker-compose.node.yml logs -f   # watch registration
```

The node appears in the platform's **Nodes** tab within ~30 seconds.
Institutional domains (`.ac.uk`, `.nhs.uk`, `.edu`, …) are auto-approved;
others are reviewed manually.

## Supply-chain verification

Images are built by GitHub Actions from the public repository, tagged by commit
(`sha-<short>`), and signed with Sigstore cosign (keyless, GitHub OIDC
identity). A CycloneDX SBOM is generated for every build and attached as a
signed attestation. To verify before running:

```bash
cosign verify undosatech/fl-node:latest \
  --certificate-identity-regexp "^https://github.com/Johnuzo89/undosatech" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

cosign verify-attestation --type cyclonedx undosatech/fl-node:latest \
  --certificate-identity-regexp "^https://github.com/Johnuzo89/undosatech" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Pin a digest rather than `latest` in production:
`image: undosatech/fl-node@sha256:<digest>`.

## Operations

- **Logs:** `docker compose -f docker-compose.node.yml logs -f` (JSON logs, rotated at 3 × 50 MB)
- **Update:** `docker compose pull && docker compose up -d`
- **Pause participation:** `docker compose stop` — the node deregisters gracefully and shows as offline in the portal

## Offboarding

1. `docker compose -f docker-compose.node.yml down` — the node sends a deregistration on shutdown
2. `docker volume rm <project>_node_credentials` — destroys the node's API credential locally
3. Email support@undosatech.com (or ask your admin contact) to remove the node record; its API key is invalidated server-side
4. Your data directory was never copied anywhere, so there is nothing remote to delete beyond the registration metadata above, which is removed with the node record

## Security contact

Vulnerabilities: security@undosatech.com — see https://undosatech.com/trust
for the disclosure policy.
