#!/usr/bin/env bash
set -euo pipefail
# Exercise the real production entrypoint with a mounted volume and existing data.
image="claw-release-check:${GITHUB_SHA:-local}"
volume="claw-release-check-${GITHUB_RUN_ID:-$$}"
container="$volume"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker build --build-arg "BUILD_COMMIT=${GITHUB_SHA:-$(git rev-parse HEAD)}" --build-arg BUILD_BRANCH=main --build-arg BUILD_DIRTY=false -t "$image" .
docker volume create "$volume" >/dev/null
docker run --rm -v "$volume:/data" "$image" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/data/pilot.sqlite'); db.exec('CREATE TABLE release_probe(value INTEGER); INSERT INTO release_probe VALUES(73)'); db.close();"
docker run -d --name "$container" -v "$volume:/data" -e DATA_DIR=/data -e RAILWAY_VOLUME_MOUNT_PATH=/data -e RAILWAY_DEPLOYMENT_ID=container-smoke -e PUBLIC_ORIGIN=https://example.invalid -e STAFF_CODE=synthetic-staff-code -e HOST_CODE=synthetic-host-code "$image" >/dev/null
for attempt in {1..30}; do
  if docker exec "$container" node -e "fetch('http://127.0.0.1:4200/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then break; fi
  if [ "$attempt" = 30 ]; then docker logs "$container"; exit 1; fi
  sleep 1
done
docker exec "$container" node --input-type=module -e "import assert from 'node:assert/strict'; import {readdirSync} from 'node:fs'; import {DatabaseSync} from 'node:sqlite'; const files = readdirSync('/data/release-backups'); assert.equal(files.length, 1); const saved = new DatabaseSync('/data/release-backups/' + files[0], {readOnly:true}); assert.equal(saved.prepare('SELECT value FROM release_probe').get().value, 73); assert.equal(saved.prepare(\"SELECT count(*) AS n FROM sqlite_master WHERE type='table'\").get().n, 1); saved.close();"
# A bad snapshot must stop startup before opening/migrating the live database.
docker stop "$container" >/dev/null
docker rm "$container" >/dev/null
docker run --rm -v "$volume:/data" "$image" node --input-type=module -e "import {readdirSync,writeFileSync} from 'node:fs'; writeFileSync('/data/release-backups/' + readdirSync('/data/release-backups')[0], 'corrupt');"
if docker run --rm -v "$volume:/data" -e DATA_DIR=/data -e RAILWAY_VOLUME_MOUNT_PATH=/data -e RAILWAY_DEPLOYMENT_ID=container-smoke -e PUBLIC_ORIGIN=https://example.invalid -e STAFF_CODE=synthetic-staff-code -e HOST_CODE=synthetic-host-code "$image"; then
  echo 'Corrupt snapshot unexpectedly allowed production startup.' >&2
  exit 1
fi
echo 'Production container startup and backup ordering passed.'
