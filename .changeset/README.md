# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).
To record a change for the next release, run `pnpm changeset` and follow the
prompts — pick the affected packages and a semver bump, and write a short summary.
On push to `main`, CI opens a "Version Packages" PR; merging it publishes to npm.
