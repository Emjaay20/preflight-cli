# GitHub Actions — Preflight review

Fail the job when the zip would be blocked.

```yaml
name: preflight
on: [push]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Review extension zip
        env:
          PREFLIGHT_URL: ${{ secrets.PREFLIGHT_URL }}
          PREFLIGHT_API_KEY: ${{ secrets.PREFLIGHT_API_KEY }}
          PREFLIGHT_PROJECT_ID: ${{ secrets.PREFLIGHT_PROJECT_ID }}
        run: |
          id=$(curl -sS -X POST \
            -H "Authorization: Bearer $PREFLIGHT_API_KEY" \
            -F artifact=@dist/extension.zip \
            -F claims=@claims.json \
            "$PREFLIGHT_URL/v1/projects/$PREFLIGHT_PROJECT_ID/reviews" | jq -r .id)
          for i in $(seq 1 30); do
            body=$(curl -sS -H "Authorization: Bearer $PREFLIGHT_API_KEY" \
              "$PREFLIGHT_URL/v1/reviews/$id")
            status=$(echo "$body" | jq -r .status)
            verdict=$(echo "$body" | jq -r .verdict)
            echo "$status $verdict"
            if [ "$status" = "completed" ]; then
              [ "$verdict" = "block" ] && exit 2
              exit 0
            fi
            if [ "$status" = "failed" ]; then
              echo "$body"
              exit 1
            fi
            sleep 2
          done
          exit 1
```

Mint the key in the dashboard (**Mint API key**), save it as `PREFLIGHT_API_KEY`. Never commit it.
