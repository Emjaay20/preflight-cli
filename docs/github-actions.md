# GitHub Actions integration

Preflight becomes a release gate when it runs in the same workflow that creates
your extension ZIP. The action submits the build, waits for the asynchronous
review, writes a job summary, and fails the GitHub check when the policy
requires a block or a human review.

## One-time setup

1. Create an organization and project in Preflight.
2. Add your stable product claims to the project. These are the domains,
   permissions, disclosures, and release promises the extension is allowed to
   make.
3. Mint a **CI** API key. CI keys can submit reviews but cannot sign a release
   off or change claims.
4. Add three GitHub Actions secrets to the extension repository:
   `PREFLIGHT_URL`, `PREFLIGHT_API_KEY`, and `PREFLIGHT_PROJECT_ID`.

Use a repository or environment secret for the CI key. Do not place it in the
workflow file, pull-request text, or extension source.

## Claims as code

Keep release-specific claims alongside the extension source when they change
with a feature. For example, place a file at `.preflight/claims.json`:

```json
{
  "allowed_hosts": ["relay.example.com"],
  "privacy": { "disclosed": true },
  "consent": { "required": true }
}
```

When the file is omitted, Preflight uses the project’s approved default claims.
That is useful when the policy should remain stable across all releases.

## Workflow

Create `.github/workflows/preflight.yml` in the extension repository. Change
the build command and ZIP path to match that repository.

```yaml
name: Release clearance

on:
  pull_request:
  push:
    branches: [main]

jobs:
  preflight:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Build extension
        run: npm ci && npm run build

      - name: Package extension
        run: cd dist && zip -r ../extension.zip .

      - name: Review release artifact
        uses: Emjaay20/preflight-cli/.github/actions/preflight@main
        with:
          preflight-url: ${{ secrets.PREFLIGHT_URL }}
          api-key: ${{ secrets.PREFLIGHT_API_KEY }}
          project-id: ${{ secrets.PREFLIGHT_PROJECT_ID }}
          artifact: extension.zip
          claims: .preflight/claims.json
          # The default blocks both `block` and `needs_human` verdicts.
          fail-on: block,needs_human
```

The job itself is the GitHub check. Require the **Release clearance** check in
your branch-protection rule to prevent an unreviewed build being merged.

## Human approval

`ship_with_conditions` does not automatically publish anything. A reviewer
uses an admin or reviewer key to sign the Preflight review off. That signed
review becomes the trusted baseline for the next release comparison.

For a production repository, pin the action to a reviewed commit SHA instead
of `@main`.
