# Evaluation data policy

Preflight's free evaluation environment is designed for testing a Chromium
extension release workflow, not as an unlimited archival service.

- A workspace may create two projects and submit ten reviews per calendar month.
- Each artifact may be up to 25 MB.
- Uploaded artifacts are removed after 14 days. The resulting review metadata,
  findings, verdict, sign-off, and audit entries remain so teams can explain a
  release decision.
- Do not upload secrets, private signing keys, customer data, or extension
  artifacts you are not authorized to share.
- A human admin or reviewer must make every `ship`, `hold`, or `reject`
  decision. A CI key cannot sign off a release.

Need higher limits, longer retention, or an organization-specific policy?
Submit an access request in the Console or contact `yusuf@yusufsaka.dev`.
