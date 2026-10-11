# WittWeek — family trip app (wittenauer.family)

Jimmy Davis's family app for the Wittenauer family ("the Witts"). Hilton Head trip, Oct 11–17, 2026.
Live: https://wittenauer.family/hiltonhead/ (GitHub Pages, repo jaydi317/wittenauer-family, branch main).

## Who uses it
12 people, ages 11 to 70s, on phones, often outdoors in bright sun. Every screen must be obvious to a
grandparent and fun for a teenager. If something needs explaining, simplify it instead.

## Files
- `hiltonhead/index.html`: the whole app, a single file. `const API_URL` at the top points to the Google Apps Script backend.
- `index.html`: the family landing page.
- `backend/`: Apps Script source and tests (Codex owns the backend; don't redeploy it from here).

## Rules (each one exists because something broke)
1. Every page must start with `<!doctype html>` and include
   `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`.
   Without it, phones render the page at desktop width and everything looks tiny.
2. Test only in TRUE phone emulation: Playwright `devices["iPhone 13"]` and `devices["iPhone SE"]`, never a resized
   desktop window. Check `innerWidth` is 390 or 320, there's no horizontal overflow, the smallest text is 13px or larger, and tap targets are 44px or larger.
   Look at the screenshots yourself before calling anything done.
3. Tests must never write to the real family data. In Playwright, intercept POSTs to script.google.com and fake the reply.
4. The first screen must paint instantly. The backend can take 6–18s, so render the cached state first and refresh in the background.
5. Write plain, friendly copy. Kid-friendly. No jargon, no AI-sounding phrases.
6. Never put the house address, door codes, wifi, API keys or the BOT_KEY in the page. It's public.
7. After pushing, open the live URL in phone emulation once and confirm the change shipped.

## Data contract
The backend actions (state, rollcall, picks, profile, vote, chat, challenge, match, undoMatch, photo, heart)
are documented in `backend/`. Don't change field names without updating the backend too.
