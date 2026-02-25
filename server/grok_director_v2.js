// ═══════════════════════════════════════════════════════════════
// GROK DIRECTOR v2 — FIXED
// Extension-inspired + v1-proven navigation techniques
// Uses: text-based element search, page.evaluate, browser download
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const SM = require('./session_manager');

// Helper
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// TEXT-BASED ELEMENT SEARCH (proven in v1)
// Searches by visible text, aria-label, or title — NOT CSS selectors
// ═══════════════════════════════════════════════════════════════

async function clickByText(page, searchText, description = '') {
    const clicked = await page.evaluate((text) => {
        const candidates = document.querySelectorAll('button, a, div[role="button"], span, label');
        for (const el of candidates) {
            const txt = (el.textContent || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            if (txt === text.toLowerCase() || txt.includes(text.toLowerCase()) ||
                ariaLabel.includes(text.toLowerCase()) || title.includes(text.toLowerCase())) {
                el.click();
                return true;
            }
        }
        return false;
    }, searchText);

    if (clicked) {
        console.log(`[GrokV2] ✅ Clicked "${description || searchText}"`);
    } else {
        console.log(`[GrokV2] ⚠️ Could not find "${description || searchText}"`);
    }
    return clicked;
}

// ═══════════════════════════════════════════════════════════════
// UI CONFIGURATION — Navigate to Imagine, select Video mode
// ═══════════════════════════════════════════════════════════════

async function configureUI(page, options = {}) {
    const { aspectRatio = '16:9' } = options;
    console.log(`[GrokV2] ⚙️ Configuring UI: mode=video, aspect=${aspectRatio}`);

    // Step 1: Navigate to Imagine mode
    // Try clicking "Imagine" in sidebar first
    const clickedImagine = await clickByText(page, 'imagine', 'Imagine sidebar');

    if (clickedImagine) {
        await delay(3000);
    } else {
        // Fallback: navigate directly
        console.log('[GrokV2] Navigating directly to grok.com/imagine...');
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);
    }

    // Step 2: Select Video mode
    const clickedVideo = await clickByText(page, 'video', 'Video mode');
    if (clickedVideo) await delay(1500);

    // Step 3: Set aspect ratio by clicking text
    const clickedRatio = await clickByText(page, aspectRatio, `Aspect ${aspectRatio}`);
    if (clickedRatio) await delay(1000);

    // Step 4: Wait for input to appear
    const inputSelector = 'textarea, input[type="text"], div[contenteditable="true"], div[role="textbox"]';
    try {
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        console.log('[GrokV2] ✅ Input box detected — Imagine ready');
    } catch {
        console.log('[GrokV2] ⚠️ Input box not detected after 10s');
    }

    console.log('[GrokV2] ⚙️ UI configuration complete');
}

// ═══════════════════════════════════════════════════════════════
// TYPE FULL PROMPT — Uses v1's proven clear+type technique
// ═══════════════════════════════════════════════════════════════

async function typePrompt(page, prompt) {
    const inputSelector = 'textarea, input[type="text"], div[contenteditable="true"], div[role="textbox"]';

    // Focus the input
    let inputEl = await page.$(inputSelector);
    if (!inputEl) {
        // Retry after short wait
        await delay(2000);
        inputEl = await page.$(inputSelector);
    }
    if (!inputEl) throw new Error('Could not find prompt input field');

    await inputEl.click();
    await delay(200);

    // Clear existing content (triple-click selects all + delete)
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await delay(200);

    // Also clear via DOM in case keyboard didn't work
    await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = '';
            } else {
                el.textContent = '';
                el.innerHTML = '';
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, inputSelector);
    await delay(200);

    // Re-focus and type the FULL prompt
    await inputEl.click();
    await delay(100);

    // Use page.evaluate to set value directly for long prompts
    // (keyboard.type can be slow/truncated for long text)
    await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        if (el) {
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                // contenteditable div
                el.textContent = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }, inputSelector, prompt);

    await delay(300);

    console.log(`[GrokV2] ✅ Typed prompt (${prompt.length} chars): "${prompt.substring(0, 80)}..."`);
}

// ═══════════════════════════════════════════════════════════════
// SUBMIT PROMPT — Click send or press Enter
// ═══════════════════════════════════════════════════════════════

async function submitPrompt(page) {
    // Try clicking submit/send button
    const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').trim().toLowerCase();
            if (ariaLabel.includes('submit') || ariaLabel.includes('send') ||
                ariaLabel.includes('generate') || text === 'generate' || text === 'create') {
                btn.click();
                return true;
            }
        }
        return false;
    });

    if (clicked) {
        console.log('[GrokV2] ✅ Submit button clicked');
    } else {
        // Fallback: press Enter
        await page.keyboard.press('Enter');
        console.log('[GrokV2] ✅ Submitted via Enter key');
    }
    await delay(1000);
}

// ═══════════════════════════════════════════════════════════════
// WAIT FOR VIDEO — MutationObserver-based
// ═══════════════════════════════════════════════════════════════

async function waitForVideo(page, timeoutMs = 180000) {
    console.log('[GrokV2] ⏳ Waiting for video to appear...');

    return page.evaluate((timeout) => {
        return new Promise((resolve) => {
            // Track existing videos
            const existingVideoSrcs = new Set();
            document.querySelectorAll('video').forEach(v => {
                if (v.src) existingVideoSrcs.add(v.src);
                const source = v.querySelector('source');
                if (source && source.src) existingVideoSrcs.add(source.src);
            });

            let resolved = false;

            const checkForNewVideo = () => {
                if (resolved) return;
                const videos = document.querySelectorAll('video');
                for (const video of videos) {
                    const src = video.src || video.querySelector('source')?.src;
                    if (src && !existingVideoSrcs.has(src)) {
                        resolved = true;
                        observer.disconnect();
                        resolve(src);
                        return;
                    }
                }
            };

            const observer = new MutationObserver(checkForNewVideo);
            observer.observe(document.body, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['src']
            });

            // Also poll periodically (some mutations might be missed)
            const pollInterval = setInterval(() => {
                checkForNewVideo();
                if (resolved) clearInterval(pollInterval);
            }, 3000);

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    observer.disconnect();
                    clearInterval(pollInterval);
                    resolve(null);
                }
            }, timeout);
        });
    }, timeoutMs);
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD VIDEO — Click button + wait for file (v1 approach)
// ═══════════════════════════════════════════════════════════════

async function downloadVideo(page, outputDir, sceneNum, shotNum) {
    console.log(`[GrokV2] 📥 Scene ${sceneNum}: Attempting download...`);

    // Step 1: Click on the video to open detail view
    await page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) {
            const parent = video.closest('a, div[role="button"], [class*="card"]') || video;
            parent.click();
        }
    });
    await delay(2000);

    // Step 2: Look for download button
    const clickedDownload = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, a, div[role="button"]');
        for (const el of buttons) {
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const text = (el.textContent || '').trim().toLowerCase();

            if (ariaLabel.includes('download') || title.includes('download') || text === 'download') {
                el.click();
                return 'label';
            }

            // Check for SVG download icon
            const svg = el.querySelector('svg');
            if (svg) {
                const paths = svg.querySelectorAll('path');
                const hasDownloadIcon = Array.from(paths).some(p => {
                    const d = p.getAttribute('d') || '';
                    return d.includes('M12') && (d.includes('19') || d.includes('download'));
                });
                if (hasDownloadIcon && el.closest('[class*="action"], [class*="download"], [class*="toolbar"]')) {
                    el.click();
                    return 'icon';
                }
            }
        }
        return false;
    });

    if (!clickedDownload) {
        // Fallback: Try the "..." menu → download approach
        console.log('[GrokV2] ⚠️ No download button, trying menu...');
        const clickedDots = await page.evaluate(() => {
            const candidates = document.querySelectorAll('button, div[role="button"]');
            for (const el of candidates) {
                const text = (el.textContent || '').trim();
                const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                if (text === '...' || text === '•••' || text === '⋯' ||
                    ariaLabel.includes('more') || ariaLabel.includes('option') || ariaLabel.includes('menu')) {
                    el.click();
                    return true;
                }
            }
            return false;
        });

        if (clickedDots) {
            await delay(1000);
            await clickByText(page, 'download', 'Download in menu');
            await delay(1000);
        }
    } else {
        console.log(`[GrokV2] ✅ Download clicked via ${clickedDownload}`);
    }

    // Step 3: Wait for downloaded file to appear
    await delay(10000); // Wait for download to complete

    // Find the newest file in the output directory
    const filename = `scene_${sceneNum}_shot_${shotNum}`;
    try {
        const files = fs.readdirSync(outputDir);
        const sortedFiles = files
            .filter(f => !f.startsWith('scene_')) // Non-renamed files only
            .map(f => ({ name: f, time: fs.statSync(path.join(outputDir, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time);

        if (sortedFiles.length > 0 && Date.now() - sortedFiles[0].time < 60000) {
            const newestFile = sortedFiles[0];
            const ext = path.extname(newestFile.name);
            const newName = `${filename}${ext}`;
            const oldPath = path.join(outputDir, newestFile.name);
            const newPath = path.join(outputDir, newName);

            if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
            fs.renameSync(oldPath, newPath);

            console.log(`[GrokV2] ✅ Downloaded and renamed: ${newName}`);
            return { success: true, filePath: newPath };
        }
    } catch (err) {
        console.log(`[GrokV2] ⚠️ File rename error: ${err.message}`);
    }

    // Alternative: try extracting video src and downloading via page fetch
    console.log('[GrokV2] Trying in-browser fetch fallback...');
    const videoData = await page.evaluate(async () => {
        const video = document.querySelector('video');
        if (!video) return null;
        const src = video.src || video.querySelector('source')?.src;
        if (!src || src.startsWith('blob:')) return null;
        try {
            const resp = await fetch(src);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            const reader = new FileReader();
            return new Promise(resolve => {
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
            });
        } catch { return null; }
    });

    if (videoData) {
        const base64Data = videoData.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        const filePath = path.join(outputDir, `${filename}.mp4`);
        fs.writeFileSync(filePath, buffer);
        console.log(`[GrokV2] ✅ Downloaded via in-browser fetch: ${filename}.mp4`);
        return { success: true, filePath };
    }

    return { success: false, error: 'Download failed' };
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Full batch generation flow
// ═══════════════════════════════════════════════════════════════

async function generateVideosGrokV2(browser, scenes, options = {}) {
    const {
        projectDir,
        aspectRatio = '16:9',
        onProgress = () => { }
    } = options;

    const videoDir = path.join(projectDir, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

    // Find or open Grok tab (reuse existing, don't open new)
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('grok.com'));

    if (!page) {
        console.log('[GrokV2] Opening new Grok tab...');
        page = await browser.newPage();
        await SM.injectCookies(page, 'grok');
        await page.goto('https://grok.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);
    } else {
        console.log('[GrokV2] ✅ Reusing existing Grok tab');
        await page.bringToFront();
    }

    await page.setBypassCSP(true);

    // Configure UI (navigate to Imagine, Video mode, aspect ratio)
    await configureUI(page, { aspectRatio });

    // Process scenes
    const results = [];
    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneNum = i + 1;
        const prompt = scene.prompt;

        if (!prompt || prompt.length < 5) {
            console.log(`[GrokV2] ⚠️ Scene ${sceneNum}: Empty/short prompt, skipping`);
            results.push({ sceneIndex: i, status: 'failed', error: 'Empty prompt', attempts: 0 });
            continue;
        }

        onProgress({
            sceneIndex: i, totalScenes: scenes.length,
            status: 'generating', pct: Math.round((i / scenes.length) * 100)
        });

        let success = false;
        let attempts = 0;

        while (attempts < 3 && !success) {
            attempts++;
            console.log(`[GrokV2] 🎬 Scene ${sceneNum} (attempt ${attempts}/3): "${prompt.substring(0, 80)}..."`);

            try {
                // Type the full prompt
                await typePrompt(page, prompt);

                // Submit
                await submitPrompt(page);

                // Wait for video
                const videoUrl = await waitForVideo(page, 180000);
                if (!videoUrl) {
                    throw new Error(`No video generated within 3 minutes`);
                }

                console.log(`[GrokV2] 🎥 Scene ${sceneNum}: Video detected`);

                // Download
                const result = await downloadVideo(page, videoDir, sceneNum, 1);

                if (result.success) {
                    results.push({ sceneIndex: i, status: 'done', filePath: result.filePath, attempts });
                    success = true;

                    onProgress({
                        sceneIndex: i, totalScenes: scenes.length,
                        status: 'done', filePath: result.filePath,
                        pct: Math.round(((i + 1) / scenes.length) * 100)
                    });
                } else {
                    throw new Error(result.error || 'Download failed');
                }

                // Navigate back for next prompt
                await page.evaluate(() => {
                    const backBtn = document.querySelector('button[aria-label="Back"], a[aria-label="Back"], button[aria-label="Go back"]');
                    if (backBtn) backBtn.click();
                });
                await delay(2000);

            } catch (err) {
                console.log(`[GrokV2] ❌ Scene ${sceneNum} attempt ${attempts}/3: ${err.message}`);

                // If page crashed, try to recover
                if (err.message.includes('destroyed') || err.message.includes('Target closed') || err.message.includes('timed out')) {
                    console.log('[GrokV2] 🔄 Page crashed — recovering...');
                    try {
                        // Try to find the page again or create new
                        const currentPages = await browser.pages();
                        page = currentPages.find(p => p.url().includes('grok.com'));
                        if (!page) {
                            page = await browser.newPage();
                            await SM.injectCookies(page, 'grok');
                            await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await page.setBypassCSP(true);
                            await delay(3000);
                            await configureUI(page, { aspectRatio });
                        }
                    } catch (recoveryErr) {
                        console.log(`[GrokV2] ❌ Recovery failed: ${recoveryErr.message}`);
                    }
                }

                if (attempts >= 3) {
                    results.push({ sceneIndex: i, status: 'failed', error: err.message, attempts });
                    onProgress({
                        sceneIndex: i, totalScenes: scenes.length,
                        status: 'failed', error: err.message
                    });
                }
                await delay(5000 * attempts);
            }
        }

        // Cooldown between scenes
        if (i < scenes.length - 1) await delay(5000);
    }

    // DON'T close the page — leave it for future use
    const doneCount = results.filter(r => r.status === 'done').length;
    console.log(`[GrokV2] 🏁 Batch complete: ${doneCount}/${scenes.length} scenes generated`);
    return results;
}

module.exports = { generateVideosGrokV2, configureUI };
