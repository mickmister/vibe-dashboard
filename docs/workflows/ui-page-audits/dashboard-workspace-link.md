# `/dashboard/workspaces/:workspaceId` — shared workspace opener

## Current role

A lightweight interstitial that validates a VD workspace id, finds or creates a saved dashboard session for the VK workspace, then redirects to the canonical dashboard URL.

## UX issues

- **The page is mostly a spinner-with-message.** It does not show which workspace id is being opened, which workspace name was found, or what step is happening.
- **Errors are broad.** The messages distinguish invalid id, missing factory, details load failure, missing workspace, and open failure, but do not offer targeted next steps beyond “Go to dashboard”.
- **No retry path.** Transient API failures require leaving and re-opening the link.
- **No permission/account guidance.** “Could not be found or is archived” could also mean wrong environment, wrong user, or stale shared link.
- **The interstitial design is visually isolated.** It uses a neutral card, not the richer dashboard/workflow language, so it feels like a system error rather than part of VD.

## Potential improvements

- Show a stepper: “Validate link → Load workspace → Create dashboard view → Open”.
- Include the workspace id in a copyable diagnostic row for support.
- Add “Try again”, “Open workspace list”, and “Copy error details”.
- If workspace metadata loads, show workspace name/branch before redirect so users build confidence.
- Add guidance for archived/missing cases: “Check that the workspace still exists in VK and that this VD instance is connected to the same repos root.”
