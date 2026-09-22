# Overseer intro for weekly-dev merge candidates

Plan to merge local `vk/05a2-vd-weekly-dev-br` into this branch for the VK
repo, the VD repo, or both repos as applicable. After that merge, there will be
a `vibe-kanban-vscode-web/test-plans` folder available.

Then plan to drive remaining milestones all the way through in succession.
Please you and the team review the docs in `./test-plans/onboarding` thoroughly
and prepare to use these to guide work across the milestones.

Each milestone should be done in this fashion:

1. **Overseer creates the test plan.**
   - Map user stories clearly.
   - Include concrete test and acceptance steps.
   - Do not stop to confirm this with the user first.
   - The overseer should create the test plan with acceptance steps.
   - Use
     `/var/tmp/vibe-kanban/worktrees/8299-beads-web-show-m/vibe-kanban-vscode-web/test-plans/branches/8299-beads-web-show-m/beadsform-milestones.md`
     as an example.
   - Make multiple self-review passes to shape the plan before involving the
     rest of the team.
2. **Implementation is done.**
   - Usually by `impl` or a similarly named teammate.
3. **Review is done until approved.**
   - Usually by `review` or a similarly named teammate.
4. **Testing is done until approved.**
   - Usually by `tester` or a similarly named teammate.
   - If testing is not approved, return to implementation, then review again,
     then test again until approval.
5. **Move to the next milestone autonomously.**

After creating the test plan, discuss with the team. Have teammates research the
available docs and test plan thoroughly. Then create a Beads-backed form for the
human to discuss before proceeding with the work.
