# `/dashboard/teams` — Agent Teams

## Current role

A dense operations console for manual teams, declarative durable workflow launch, session mapping, guardrail nudges, workflow templates, activity/attention, and run/event inspection.

## UX issues

- **The page mixes setup, launch, monitoring, debugging, and templates.** A first-time user has no obvious primary path. The durable workflow panel competes with legacy/manual team controls and run logs.
- **Terminology is internal.** “Durable workflow launch”, “role/name reuse”, “refs-only”, “webhook wakeup”, and “guardrail nudges” need contextual explanation or progressive disclosure.
- **Session mapping is high-risk but visually routine.** Choosing source/reviewer sessions can cause same-session or wrong-workspace problems; the controls look like ordinary form fields rather than a critical routing step.
- **The selected durable instance is browser-local.** The status panel says existing instances remain in APIs, but users need a visible way to find them.
- **Manual refresh dominates monitoring.** Activity auto-refreshes every 5 seconds, but run details and instance status feel manually polled.
- **Error messages are raw.** Validation and launch failures likely expose API/internal text without recovery recommendations.
- **Information density is too high for a route named “Teams”.** The actual page is closer to “Workflow lab / ops console”.

## Potential improvements

- Split into focused tabs or pages: **Teams**, **Launch workflow**, **Monitor**, **Templates**, **Diagnostics**.
- Make durable workflow launch a guided card: choose workflow → choose workspace → resolve roles → review queue plan → launch.
- Add a role/session resolution preview showing exact sessions that will receive prompts before launch.
- Promote “Open clean page” and persisted runs into a visible “Recent workflow instances” list.
- Use inline help chips for advanced concepts and hide refs-only/webhook diagnostics behind an expandable “Advanced” section.
- Add specific recovery CTAs: reload definitions, restore built-ins, create missing sessions, open VK session, retry failed run.
