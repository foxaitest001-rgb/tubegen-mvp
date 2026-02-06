# FoxTubeGen Development Status Handoff (v2.6 PATCHED)
**Date:** 2026-02-06
**Version:** v2.6 (AUDIO PATCHED)

## ✅ CRITICAL FIXES DEPLOYED
The following features are now STABLE and MUST NOT be removed or broken in future updates:

### 1. Audio Generation (Server-Side)
-   **Voice Models:** Piper TTS `en_US-ryan-medium.onnx` (and others) are **automatically downloaded** during GitHub Actions workflow startup.
    -   *Location:* `public/piper/` (Project Root)
-   **Path Resolution:** Server checks `../public/piper`, `server/public/piper`, and CWD.
-   **Graceful Fallback:** If models are missing, audio is **skipped** (not crashed).

### 2. Video Downloading
-   **Static File Serving:** Server now serves `/output/` directory as static files.
    -   `app.use('/output', express.static(...))`
-   **URL Sanitization:** Project folders are sanitized (e.g., `dark_magicians_secret` instead of `dark_magician's`).
-   **Manual Download:** "Manual DL" button allows downloading via folder name if auto-detection fails.

### 3. AI Reliability (Gemini)
-   **Model Selection:** Uses only `gemini-3-flash-preview` and `gemini-2.0-flash`.
-   **Retries:** 30s wait time on 429 Quota Errors.
-   **Fallback:** Added `gemini-1.5-pro` as last resort.

---

## 🚀 STARTUP INSTRUCTIONS
To run this project correctly after a break:

1.  **Start NEW GitHub Actions Workflow:**
    -   Do **NOT** reuse old runners (they lack audio models).
    -   Start a fresh "Remote Video Generation" workflow.
    -   Wait for Cloudflare URL.

2.  **Update Frontend Config:**
    -   Paste new Cloudflare URL into "Director Server URL".
    -   Or use `localhost:3001` if running locally.

3.  **Local Dev:**
    -   `npm run dev` (Frontend)
    -   `node index.js` (Backend - server folder)

---

## ⚠️ KNOWN "GOTCHAS"
-   **Audio:** Only works on **NEW** GitHub runners (because `wget` step runs at startup). Old runners will skip audio.
-   **Quotas:** Google API free tier is strict. Expect `429` errors occasionally; just wait 30s.

**DO NOT REVERT THESE CHANGES.**
