#!/usr/bin/env bash
# Register this repo's release workflow (.github/workflows/release.yml) as the npm
# trusted publisher of every public @refkit package, so CI publishes through OIDC
# with no npm token.
#
# Run it yourself, once per package, from the repo root:
#   npm login                         # an interactive session with 2FA
#   bash scripts/trust-publishers.sh  # or pass package names to limit the run
#
# Requirements and rules (npm docs, 2026-10):
# - npm >= 11.15 locally (`npm trust`), 2FA enabled on the account. Tokens that
#   bypass 2FA cannot change trusted publishing settings.
# - Each package must already exist on npm. A brand-new package is published once by
#   hand first, then added here.
# - The first request asks for 2FA. Tick "skip 2FA for the next 5 minutes" so the
#   loop finishes unattended.
# - npm allows one trusted publisher per package here; an existing one is reported
#   and skipped. `npm trust list <pkg>` / `npm trust revoke <pkg> --id <id>` manage it.
# - A new configuration must be used for a successful publish within 2 days or npm
#   expires it, so run this right before merging the Version Packages PR.
set -uo pipefail
cd "$(dirname "$0")/.."

if [ "$#" -gt 0 ]; then
  names=("$@")
else
  names=()
  for manifest in packages/*/package.json; do
    name=$(node -p "const j = require('./$manifest'); j.private ? '' : j.name")
    [ -n "$name" ] && names+=("$name")
  done
fi

failed=()
for name in "${names[@]}"; do
  echo "== $name"
  if ! npm trust github "$name" --repo refkitjs/refkit --file release.yml --allow-publish --yes; then
    failed+=("$name")
  fi
  sleep 2
done

echo
if [ "${#failed[@]}" -eq 0 ]; then
  echo "Configured ${#names[@]} package(s)."
else
  echo "Failed for ${#failed[@]} of ${#names[@]}: ${failed[*]}"
  echo "Check with: npm trust list <package>"
  exit 1
fi
