# Browser tests

```
make e2e-browser     # once: download Chromium
make test-e2e        # builds the binary, then runs the suite
```

Or directly, against a binary you already built:

```
cd e2e && npx playwright test
DIALOGMAPPER_BIN=/path/to/dialogmapper npx playwright test
npx playwright test --headed groups     # watch one file run
```

## Why this exists

Three bugs reached a working build with the entire Go suite green:

| Bug | What the Go tests saw | Spec that now catches it |
|-----|----------------------|--------------------------|
| Blank page — user media was mounted at `/assets/`, shadowing the frontend bundle | `GET /` returned 200 HTML, which was true | `boot.spec.ts` |
| Empty minimap — React Flow's dimension changes were discarded | nothing; purely client-side | `boot.spec.ts` |
| Group rubber band drawn in screen space while its coordinates were flow space | nothing; purely client-side | `groups.spec.ts` |

The pattern is the same each time: the server was correct and the browser was
not. These tests close that gap by running the real binary with the real
embedded frontend.

## How a test gets a server

`fixtures.ts` gives every test its own `dialogmapper` process against a fresh
temp project, seeded through the CLI. That matters beyond isolation:

- **`--port 0`** lets the kernel choose, so parallel workers never collide. The
  real port is read back from the startup banner rather than guessed.
- **Seeding via the CLI** puts the map in the state a user actually arrives at
  — built by something other than this browser tab. Undo attribution and
  first-placement auto-layout both broke in exactly that situation.
- **Loopback by default**, so tests are deterministic and exempt from the LAN
  access key. The QR group overrides it with `test.use({ dmHost: "0.0.0.0" })`
  because being network-reachable is the feature under test.

Server stdout is attached to any failure, since a browser symptom is often
explained by something the Go side printed.

## Conventions

- Assert on **behaviour a user could describe**, not implementation detail.
  `groups.spec.ts` measures the rubber band against the committed group in
  screen pixels, because "it's offset while I draw" is the actual complaint.
- Prefer `expect(locator)` over manual waits — it retries, so tests are not
  timing races.
- When a spec exists because of a specific bug, say so in a comment. The next
  person needs to know what the assertion is defending.
