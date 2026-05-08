Keep the following info in mind *when working in the ./src directory only*

After making any changes, run `npm run check-types` to ensure types pass.

# Springboard Development Guide

This application is built with the **Springboard framework**.

## Getting Started

**Before writing any actual source code in `./src`, run:**
```bash
npx sb docs context
```

This outputs comprehensive framework information including available documentation
sections, key concepts, and workflow guidance.

## Recommended Workflow

1. **Run `sb docs context`** at the start of your session
2. **Write code** using your knowledge + the context from step 1
3. **Fetch specific docs** only when needed: `sb docs get <section>`
4. **View examples** for reference code: `sb docs examples show <name>`

## Other Useful Commands

- `sb docs --help` - See all available commands
- `sb docs types` - Get TypeScript type definitions
- `sb docs examples list` - See available example modules

## Additional Notes

- Springboard code is isomorphic by default.
- If importing a node-only module inside an action, use conditional compilation.
- This app is deployed as a server-driven SPA, so actions run on the server here.
