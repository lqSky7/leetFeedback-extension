# Changelog / Changes in this repo

Summary of notable changes from the upstream [leetFeedback-extension](https://github.com/lqSky7/leetFeedback-extension) / Traverse ecosystem.

---

## CodeChef support

- **New content script:** `content-scripts/codechef.js`
  - Full CodeChef integration: run/submit tracking, problem extraction, persistence (`problem_data_<url>`), optional AI (G4F/Gemini) on failed runs, backend push, optional GitHub push.
  - CodeChef-specific selectors, title parsing (e.g. strip ` | CodeChef`), difficulty mapping, solution extraction.
- **Manifest:** Host permission `https://*.codechef.com/*` and content script entry for `*.codechef.com` with the same utils stack + `codechef.js`.
- **Utils:** `utils/common.js` — `DSA_PLATFORMS.CODECHEF` and `getPlatformFromUrl()` handling for `codechef.com`.
- **Sidepanel:** CodeChef icon/link in the platform icons section.

---

## Understand folder (documentation)

- **New folder:** `Understand/`
  - **ARCHITECTURE.md** — Manifest, script load order, background/sidepanel/content roles, storage, diagram.
  - **WORKFLOWS.md** — Page load, run, submit, sidepanel flows; message flows (content ↔ background, Monaco bridge).
  - **LEETCODE.md** — How `leetcode.js` works (entry, LeetCodeExtractor, bridge, persistence, success path).
  - **CONTENT-SCRIPTS-AND-UTILS.md** — Platform scripts and shared utils.
  - **README.md** — Index of the above.

---

## G4F as default AI for mistake analysis

- Mistake analysis uses **G4F** (no API key) by default; **Gemini** is optional when an API key is set.
- **`utils/gemini-api.js`:**
  - `analyzeWithG4F()` — `https://g4f.space/api/pollinations/v1/chat/completions`, model `openai-large`.
  - `analyzeWithGemini()` — unchanged when user chooses Gemini.
  - `initialize()` reads `ai_provider` (default `"g4f"`) and `gemini_api_key`.
- **Manifest:** Host permission `https://g4f.space/*`.
- **Sidepanel:** "Mistake Analysis (AI)" — Provider dropdown (G4F (free) / Gemini (API key)); Gemini key field shown only when Gemini is selected. Storage: `ai_provider`, `gemini_api_key`.
- **Test:** `tests/g4f-api-test.mjs` — Verifies G4F endpoint (run: `node tests/g4f-api-test.mjs`).

---

## GitHub config: repo URL bar + username/repo fields

- **Single "Repository URL" bar** — User can paste e.g. `https://github.com/username/repo` or `https://github.com/username/repo.git`.
- **Parsing:** `parseGitHubRepoUrl()` in the sidepanel extracts **owner** and **repo** and fills the Username (Owner) and Repository fields.
- **Username (Owner) and Repository fields kept** — Shown under the URL bar; auto-filled when a valid GitHub repo URL is pasted; user can still edit them; saved as `github_owner` and `github_repo` in sync storage.
- **Files:** `sidepanel/sidepanel.html`, `sidepanel/sidepanel.js`.

---

## Quick reference

| Area           | Change                                                                 |
|----------------|------------------------------------------------------------------------|
| **CodeChef**   | New `codechef.js`, manifest + host, `DSA_PLATFORMS.CODECHEF`, sidepanel icon. |
| **Docs**       | New `Understand/` (architecture, workflows, leetcode, content-scripts & utils). |
| **AI**         | Default G4F; optional Gemini; sidepanel provider dropdown; `g4f.space` permission; G4F test. |
| **GitHub config** | Repo URL bar; parse URL → fill Owner + Repository; both fields kept.   |

---

For the Android app that uses this extension, see [traverse-android](https://github.com/iamawanishmaurya/traverse-android) and the [usage guide](https://leet-feedback.vercel.app/guide).
