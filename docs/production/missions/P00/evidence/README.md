# P00 evidence

Certification evidence logs are written here by `scripts/certification/certify.sh`
as `p00-local-<UTC-timestamp>.log`. Each log records the exact command, exit code
and package-level PASS/FAIL for frozen install, lint, typecheck, tests and build.

Live smoke evidence is produced by `scripts/certification/smoke.mjs` and prints
PASS/FAIL per boundary to stdout.
