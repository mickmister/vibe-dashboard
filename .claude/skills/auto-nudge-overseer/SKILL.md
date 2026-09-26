---
name: auto-nudge-overseer
description: Use when a user asks an overseer agent to complete all milestones, keep going until done, or coordinate a multi-agent milestone workflow that should be monitored for dropped turns.
---

# Auto-nudge overseer

When the user asks you to complete all milestones, keep going until done, or otherwise act as the coordinating overseer for a workspace:

1. Run:
   ```bash
   vibe-agent auto-nudge enable
   ```
   This registers the current workspace for auto-nudge overseer coordination and makes your current session the overseer.

2. Coordinate teammates with `vibe-agent send ...`. Response routing is the default; use `--fire-and-forget` only when no response is needed.

3. If the workflow is complete, reply exactly:
   ```text
   DONE
   ```

4. If the next milestone-completion step needs a user decision or approval, create a beads-form for the user, then end your response with:
   ```text
   CREATED FORM
   ```

5. If auto-nudge coordination should stop for this workspace, run:
   ```bash
   vibe-agent auto-nudge disable
   ```

Notes:
- The auto-nudge daemon can still recover agents that stopped mid-turn even when overseer coordination is not enabled for the workspace.
- `vibe-agent auto-nudge status` shows the current workspace registration.
- The default runtime config is `/home/vkuser/.local/share/vibe-dashboard-runtime/data/config/nudge_config.json`. It can customize the overseer checkpoint prompt and end-condition markers.
- End-condition markers are case-sensitive and must appear at the end of your final message. They may be on the final line, for example `All done.\nDONE` or `Please fill out the form.\nCREATED FORM`.
