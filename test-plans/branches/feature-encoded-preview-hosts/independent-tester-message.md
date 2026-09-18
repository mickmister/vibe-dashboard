# Independent tester message — PreviewServer VD spec

Run an independent tester pass.

Use the tester onboarding file:

- `test-plans/onboarding/independent-tester-prompt.md`

Feature/test-plan bead:

- `vkvw-b2f5 — Create Preview URLs tester specs`

Approved test-plan document:

- `test-plans/branches/feature-encoded-preview-hosts/previewserver-vd-spec.md`

Important runtime instruction:

- Start VD with global `vk dev-server`.
- Do **not** use `npm run dev:vk-mocked-sandbox`.
- This pass validates the VD/local PreviewServer path, not the Cloudflare Worker
  path.

Record results on a fresh tester bead as JSON keyed by the test plan's
`SETUP_*` and `TEST_CASE_*` IDs.
