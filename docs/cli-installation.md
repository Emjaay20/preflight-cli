# CLI installation and release verification

Preflight is a Rust command-line tool. It is useful in two places: on a
developer workstation for a fast local review, and in CI as the same
deterministic scanner that powers the hosted worker.

## Install from reviewed source

```bash
cargo install --git https://github.com/Emjaay20/preflight-cli --locked
preflight --help
```

For a specific release, replace the moving default branch with a reviewed tag:

```bash
cargo install --git https://github.com/Emjaay20/preflight-cli --tag v0.2.0 --locked
```

## Install a release binary

GitHub Release assets contain a platform archive and a `SHA256SUMS.txt` file.
Download both from the same signed/reviewed release, then verify before placing
the executable on your `PATH`:

```bash
shasum -a 256 -c SHA256SUMS.txt
tar -xzf preflight-<target>.tar.gz
./preflight --help
```

Never download a CLI binary from a pull-request artifact, an issue attachment,
or a link sent outside the repository release page.

## CI

Most teams should use the repository's reusable GitHub Action rather than
installing a CLI binary in every workflow. It uploads the build to Preflight,
waits for the verdict, and can fail the release check. Follow the
[GitHub Actions integration](github-actions.md) guide and pin the action to a
reviewed commit SHA for production repositories.
