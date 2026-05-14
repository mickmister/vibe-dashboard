// Temporary CI sentinel: intentionally fails `npm run check-types`.
// Remove after verifying GitHub workflow_run failure delivery.
const githubCiWebhookSentinel: string = 123;

export { githubCiWebhookSentinel };
