# CLAUDE.md - calc.nixfred.com

> Design law for this site. Settled by a 30 question interview on 2026-07-02.
> Do not re-ask these questions. New calculators inherit every rule below.
> Changes to this contract require an explicit decision by Fred.

## What this site is

Field calculators for IT infrastructure conversations, live at calc.nixfred.com.
Public repo, MIT licensed, formulas visible on purpose. This is a personal
nixfred.com property. It is used at work but it is not of work.

## The Four Output Rule (non-negotiable)

Every calculator must produce:

1. A customer friendly answer.
2. A whiteboard card.
3. A conversation script.
4. A next action.

A calculator that produces only a number is not done.

## Safety rules (non-negotiable)

1. Rough math is never presented as a quote. Ever.
2. No hardcoded vendor pricing. Users enter their own assumptions.
3. All assumptions visible on the result.
4. No logins, no saved customer data, all calculation client side.
5. Do not invent customer names, dollar values, dates, hardware counts,
   performance numbers, titles, certifications, or partner status.
6. No employer branding anywhere on the site. Zero mention.
7. Nothing personal about Fred beyond "Built by Fred Nix" and links.

## Visual contract

1. Dark only. No light mode, no toggle.
2. Palette: BlueAlly adjacent blues on near black. Tokens live in
   `src/styles/global.css` (`--bg #070b14`, `--accent #4da3ff`, etc).
   Use the tokens, never new hex values.
3. Typography: sans for headers and body, mono for numbers, metadata,
   badges, tags, and terminal flavored elements.
4. Background: soft blue radial glow behind the hero, flat dark elsewhere.
   No textures, no animated backgrounds.
5. Icons: text glyphs only (arrows, brackets, block cursor). No icon
   libraries, no emoji, no image icons.
6. Density: breathing room. Generous spacing, readable from across a
   conference table.
7. Screenshot friendly: every result card must look good in a screenshot
   and a screen share.

## Signature interaction: decode

1. Page and view transitions use the decode/descramble effect: text starts
   as glyph noise and resolves left to right in about 400ms.
2. Calculator titles re-scramble briefly on hover.
3. Inputs are usable immediately. Animation never blocks interaction.
4. `prefers-reduced-motion` disables all of it.
5. Navigation into a calculator must FEEL in place, not like a page change,
   even though each calculator is a real Astro page with a real path.
6. No full Matrix rain. That option was considered and rejected.

## Structure contract

1. Sticky header: `calc.nixfred.com` in mono left, links right
   (nixfred.com and source ONLY, no youtube, Fred removed it 2026-07-03),
   back to list when inside a calculator.
2. Hero: "Math you can whiteboard." plus a two sentence factual pitch.
   No storytelling, no scene setting. Fred's call on 2026-07-02:
   "just the facts, let the calcs do the work."
3. Calculator library: single column stack, flat list, no categories.
4. Each card shows: index, title, ONE LINE description,
   input/output counts in mono, tag chips, LIVE or QUEUED badge.
   No audience lines, no paragraphs. One line means one line.
5. Only the next 2 or 3 unbuilt calculators appear as QUEUED. Never the
   whole roadmap.
6. Three line about block under the list.
7. Footer: disclaimer line, property links, GitHub link, built by credit.
8. URLs: real path per calculator (example: /vmware-renewal-triage).
   Shareable result state goes in query params on top of the real path.

## Writing rules for all site copy

1. No em dashes, no en dashes, no dash punctuation. Periods and commas.
2. Numbered lists, never dash bullets.
3. Plain language first for executives, detail panel for engineers.
4. One sentence answer first, details second, on every result.
5. Direct field architect voice with receipts. No influencer tone.
   Just the facts. Short declarative sentences. Cut every word that
   is not carrying information.
6. Every page answers: what it is, who it helps, why it exists, what to do
   next, and what source supports it.
7. Capital C on Customer when referring to Customers.

## Adding a new calculator (the process)

1. Fred names the calculator and provides or approves the logic.
2. Add an entry to `src/data/calculators.json` (slug, index, title, status,
   oneLiner, audience, inputs, outputs, tags).
3. Create `src/pages/<slug>.astro` using the Base layout.
4. All math client side in plain JS, formulas commented, assumptions
   rendered visibly on the result.
5. Result section produces all four outputs (answer, whiteboard card,
   script, next action) plus a copy button and a print view.
6. Flip status to `live` in calculators.json only when Fred approves.
7. Document the methodology in `docs/<slug>.md` (public receipts).
8. One calculator at a time. Never batch.

## Stack and deploy

1. Astro, installed with bun. No other frameworks. No CDN dependencies.
2. Static output, all calculation client side.
3. Hosting: Cloudflare Pages project `calc-nixfred-com`, custom domain
   calc.nixfred.com.
4. Deploys: auto on push to main. Pushing main is deploying. Treat it
   that way.
5. Analytics: Cloudflare Web Analytics beacon only. Nothing else.
6. `02_calculators_nixfred.md` and `Plans/` are local planning material,
   gitignored, never committed to this public repo.

## Repo hygiene

1. This repo is PUBLIC. Check every commit for anything private.
2. `git remote -v` before every commit. Origin must be
   github.com/nixfred/calc.nixfred.com.
3. Meaningful commit messages with what/why. They are search surface.
