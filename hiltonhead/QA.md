# WittWeek phone QA

- Confirm the source and public HTTPS response have a viewport meta tag with `width=device-width,initial-scale=1`.
- Run `viewport.test.cjs` using an installed Playwright package. It uses `devices['iPhone 13']` (mobile, touch, 390px width, pixel ratio 3), in Chromium and WebKit. A resized desktop window cannot prove phone sizing.
- Require `innerWidth === 390`, no horizontal overflow, and the onboarding grid spanning 358px within its 16px side padding.
- Inspect both saved onboarding screenshots. Do not select a person or submit production data during this read-only layout check.
- After publishing, rerun against `https://wittenauer.family/hiltonhead/` and confirm the Pages build corresponds to the published commit.

Example with Playwright on the Node module path:

```sh
node hiltonhead/viewport.test.cjs https://wittenauer.family/hiltonhead/
node hiltonhead/refresh.test.cjs
```
