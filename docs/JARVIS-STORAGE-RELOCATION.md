# JARVIS · Storage and memory assessment

Read-only investigation. Nothing was moved, cleaned, resized or reconfigured. Docker was
not relocated; no WSL distro was shut down or unregistered; no volume, database or cache
was deleted.

## Measured

| Item | Value | How |
|---|---|---|
| C: free / total | **6.3 GB / 216 GB (98 % used)** | `df -h /c` |
| D: free / total | **660 GB / 932 GB (30 % used)** | `df -h /d` |
| RAM total / available | **15,974 MB / 1,575 MB** | `systeminfo` |
| Windows pagefile max | 29,056 MB | `systeminfo` |
| Docker root dir | `/var/lib/docker`, driver `overlayfs` | `docker info` |
| Docker data on D: | **121 GB under `D:\Docker\wsl`** | directory measurement |
| Postgres volume | named volume `jarvis-mk43_pgdata` → `/var/lib/postgresql/data` | `docker inspect` |
| Postgres volume throughput | 45.6 MB/s (`dd` 64 MB, `conv=fdatasync`) | measured in container |
| `.wslconfig` | **absent** (WSL defaults) | `ls $USERPROFILE/.wslconfig` |
| Model store | `~/.lmstudio/models` empty; `D:\AI\Models` does not exist | directory listing |

## DOCKER_STORAGE: VERIFIED_ON_D

Evidence, not inference: the compose-defined volumes resolve to Docker-managed named
volumes (`jarvis-mk43_pgdata`), and Docker's WSL data directory occupies 121 GB under
`D:\Docker\wsl`. The disk image is therefore on D:, and JARVIS's PostgreSQL, Redis and NATS
persistence live inside it — i.e. on D:.

`D:\Docker\wsl\DockerDesktopWSL\data` is the storage root reported in Docker Desktop's
settings. No migration required, and none was attempted.

## WSL memory and swap

WSL is running on defaults because no `.wslconfig` exists. That means WSL may claim up to
50 % of RAM and will use a swap VHDX when it needs to — but **the presence and location of
that swap file cannot be established** through the checks available without touching
system state, so this is reported as unknown rather than guessed. The earlier checks you
ran (`.wslconfig`, `$env:TEMP\swap.vhdx`) returning nothing is consistent with defaults and
proves only that those two paths are empty.

A D:-based swap file would be a plausible improvement *if* swapping is confirmed and D: is
faster for this workload than C: — which is not established, since both sit on the same
physical SSD. Any change needs `.wslconfig` plus `wsl --shutdown`, which restarts Docker;
that is your decision, not mine to take.

Proposed `.wslconfig` for later, **not created**:

```ini
[wsl2]
memory=8GB          # leaves ~8GB for Windows with 16GB installed
swap=8GB
swapFile=D:\\WSL\\swap.vhdx
```

Rationale per line: `memory` bounds the VM so Windows and the desktop stay responsive;
`swap` provides headroom without paging Windows itself; `swapFile` moves swap I/O to the
drive with 660 GB free. Rollback: delete the file and `wsl --shutdown`. Verification:
`wsl --shutdown`, restart Docker, then `free -m` inside a distro and re-measure the
Postgres checkpoint timings.

## PostgreSQL checkpoint reassessment

Configuration is default and sane: `checkpoint_timeout=300s`, `max_wal_size=1GB`,
`completion_target=0.9`, `fsync=on`, `full_page_writes=on`, `shared_buffers=16MB`,
database 48 MB.

Observed: 14 checkpoints, 578 s cumulative write and 152 s sync; individual checkpoints
wrote 84–185 buffers in 8–27 s. The 431 s outlier is the tail of that distribution.

**Suspected cause (not proven): memory pressure and host I/O contention, not free space on
C:.** Reasons to prefer this over the earlier "C: is full" explanation: the Docker disk is
on D:, the Postgres volume is a Docker-managed ext4 volume (not a Windows bind mount), and
in-RAM writes of under 2 MB taking 8–21 s is a latency problem rather than a capacity
problem. The 45.6 MB/s fsync measurement points at the physical device or its queue depth.

What would settle it: `pg_stat_io` write/sync timings alongside host CPU/queue metrics
during a checkpoint, and the same `dd` probe on C: for comparison. Both are cheap and
non-destructive; neither was run because they need a quiet window to be meaningful.

Do not shorten `checkpoint_timeout` to "fix" slow writes — that increases checkpoints and
makes it worse. Do not weaken `fsync` or `full_page_writes`.

## Recommended D: conventions (not yet created)

| Purpose | Path | Status |
|---|---|---|
| Local models | `D:\AI\Models` | configured in LM Studio only when a model is actually downloaded |
| JARVIS runtime data | `D:\JarvisData\Runtime` | not created; no consumer needs it yet |
| Logs | `D:\JarvisData\Logs` | `.logs/` already lives in the repo on D: `git`-ignored |
| Backups | `D:\JarvisData\Backups` | not created |
| Dev caches | `D:\DevCache` | not created |
| Future WSL swap | `D:\WSL\swap.vhdx` | not created |

Creating empty directories now would be ceremony. They get created by the tool that first
uses them, with its own documented setting:

- **LM Studio:** Settings → Models directory → `D:\AI\Models`. Verify with `lms ls` after
  a download; nothing is downloaded here.
- **pnpm store:** `pnpm config set store-dir D:\DevCache\pnpm` — note this changes the
  global store and would invalidate hard links for existing `node_modules`, so it needs a
  reinstall to take effect. Not done. The pinned invocation
  `node "C:/Users/rhysl/AppData/Local/node/corepack/v1/pnpm/9.15.9/bin/pnpm.cjs"` is
  untouched and keeps working.
- **npm cache:** `npm config set cache D:\DevCache\npm --global` — global user setting, needs
  approval.

Cache sizes could not be measured reliably (the directory walks exceeded the command
timeout), so no claim is made about which cache is the biggest consumer.

## What actually matters right now

C: at 98 % is the operational risk, not the checkpoint latency. Windows, the pagefile and
Docker Desktop's own binaries all live there, and 6.3 GB is not much headroom for a
16 GB machine under memory pressure. Freeing space on C: is the single safest improvement
available, and it needs no change to JARVIS at all.
