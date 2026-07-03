# calc.nixfred.com

Field calculators for IT infrastructure conversations. Live at
[calc.nixfred.com](https://calc.nixfred.com).

## What this is

Interactive decision tools built for live customer meetings, not for
spreadsheets. Renewal triage, POC readiness, rough sizing, AI application
readiness, and whatever the field demands next.

Live now: **[TokenOps](https://calc.nixfred.com/tokenops)**, an AI workload
placement and token economics calculator. Transparent math throughout: every
number shows its formula, variables, live substitution, assumptions, and
sources. Methodology in [docs/tokenops.md](docs/tokenops.md), completion audit
in [docs/tokenops-audit.md](docs/tokenops-audit.md), regression harness in
`tests/`.

Every calculator returns four things:

1. A customer friendly answer.
2. A whiteboard card.
3. A conversation script.
4. A next action.

## The rules these tools follow

1. Rough math is never presented as a quote.
2. No vendor pricing is hardcoded. You enter your own assumptions.
3. Every assumption is visible on the result.
4. No logins. No saved data. Everything calculates in your browser.

## Why open source

The formulas are the product. Anyone using a calculator in a meeting should
be able to open the source and check the math, and anyone who finds better
math is welcome to send a pull request. Each live calculator gets a
methodology document in `docs/` explaining its logic and its limits.

## Run it yourself

```bash
git clone https://github.com/nixfred/calc.nixfred.com.git
cd calc.nixfred.com
bun install
bun run dev
```

Static Astro site, no backend, no accounts, no tracking beyond a cookieless
Cloudflare Web Analytics beacon on the live site.

## License

MIT. See [LICENSE](LICENSE).

Built by [Fred Nix](https://nixfred.com).
