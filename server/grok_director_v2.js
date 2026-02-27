// ═══════════════════════════════════════════════════════════════
// GROK DIRECTOR v2.1 — REWRITTEN FOR REAL /imagine UI
// Verified UI (Feb 2026): grok.com/imagine
//
// FLOW:
//  1. Navigate to grok.com/imagine
//  2. Click "Video ˄" settings toggle → opens popover with:
//     - Video Duration: 6s / 10s
//     - Resolution: 480p / 720p
//     - Aspect Ratio: 2:3, 3:2, 1:1, 9:16, 16:9
//     - Image / Video mode switch
//  3. Select "Video" mode, set aspect ratio "16:9"
//  4. Type prompt into TipTap ProseMirror editor ("Type to imagine")
//  5. Click submit button (↑ arrow) to generate
//  6. Wait for video via MutationObserver
//  7. Download via in-browser fetch / download button
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const SM = require('./session_manager');

// Helper
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// TEXT-BASED ELEMENT SEARCH
// ═══════════════════════════════════════════════════════════════

async function clickByText(page, searchText, description = '') {
    const clicked = await page.evaluate((text) => {
        const candidates = document.querySelectorAll('button, a, div[role="button"], span, label, li, div[role="option"], div[role="menuitem"], div[role="menuitemradio"]');
        for (const el of candidates) {
            const txt = (el.textContent || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            if (txt === text.toLowerCase() || ariaLabel.includes(text.toLowerCase()) || title.includes(text.toLowerCase())) {
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

// Click the exact text match (not partial) — avoids clicking "Image" when looking for "Video"
async function clickExactText(page, searchText, description = '') {
    const clicked = await page.evaluate((text) => {
        const candidates = document.querySelectorAll('button, a, div[role="button"], span, label, li, div[role="option"], div[role="menuitem"], div[role="menuitemradio"]');
        for (const el of candidates) {
            const txt = (el.textContent || '').trim().toLowerCase();
            if (txt === text.toLowerCase() && el.offsetParent !== null) {
                el.click();
                return true;
            }
        }
        return false;
    }, searchText);

    if (clicked) {
        console.log(`[GrokV2] ✅ Clicked "${description || searchText}" (exact)`);
    } else {
        console.log(`[GrokV2] ⚠️ Could not find "${description || searchText}" (exact)`);
    }
    return clicked;
}

// ═══════════════════════════════════════════════════════════════
// UI CONFIGURATION — Navigate to /imagine, open settings, set Video mode
// ═══════════════════════════════════════════════════════════════

async function configureUI(page, options = {}) {
    const { aspectRatio = '16:9', duration = '6s', resolution = '480p' } = options;
    console.log(`[GrokV2] ⚙️ Configuring UI: mode=video, aspect=${aspectRatio}, duration=${duration}, res=${resolution}`);

    // Step 1: Ensure we're on /imagine
    const currentUrl = page.url();
    if (!currentUrl.includes('/imagine')) {
        console.log('[GrokV2] Navigating to /imagine...');
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);
    }

    // Step 2: Open the settings popover
    // The settings toggle is a button showing "Image ˄" or "Video ˄" near the bottom bar
    // It has aria-label="Settings" or contains the current mode text
    let popoverOpened = false;

    // Try aria-label="Settings" first
    popoverOpened = await page.evaluate(() => {
        const settingsBtn = document.querySelector('button[aria-label="Settings"]');
        if (settingsBtn) {
            settingsBtn.click();
            return true;
        }
        return false;
    });

    if (!popoverOpened) {
        // Fallback: click the button that shows "Video" or "Image" text near the input bar
        popoverOpened = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const text = (btn.textContent || '').trim().toLowerCase();
                if ((text.includes('video') || text.includes('image')) &&
                    btn.querySelector('svg') && !text.includes('sign')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
    }

    if (popoverOpened) {
        console.log('[GrokV2] ✅ Settings popover opened');
        await delay(800);
    } else {
        console.log('[GrokV2] ⚠️ Could not open settings popover');
    }

    // Step 3: Select Video mode (at the bottom of the popover)
    // The popover has "Image" and "Video" as clickable mode switches
    const isAlreadyVideo = await page.evaluate(() => {
        // Check if "Video" button in the popover is already selected (active/highlighted)
        const buttons = document.querySelectorAll('button, div[role="menuitemradio"], div[role="option"]');
        for (const btn of buttons) {
            const text = (btn.textContent || '').trim().toLowerCase();
            if (text === 'video') {
                const isActive = btn.getAttribute('data-state') === 'active' ||
                    btn.getAttribute('aria-checked') === 'true' ||
                    btn.classList.contains('active') ||
                    btn.classList.contains('bg-black') ||
                    btn.classList.contains('bg-foreground') ||
                    getComputedStyle(btn).backgroundColor !== 'rgba(0, 0, 0, 0)';
                return isActive;
            }
        }
        return false;
    });

    if (isAlreadyVideo) {
        console.log('[GrokV2] ✅ Already in Video mode');
    } else {
        const clickedVideo = await clickExactText(page, 'video', 'Video mode');
        if (clickedVideo) {
            await delay(1000);
            // Popover might close and reopen — reopen if needed for further settings
            const stillOpen = await page.evaluate(() => {
                return !!document.querySelector('[data-state="open"], [role="dialog"], [class*="popover"]');
            });
            if (!stillOpen) {
                // Reopen settings to set duration/resolution/ratio
                await page.evaluate(() => {
                    const settingsBtn = document.querySelector('button[aria-label="Settings"]');
                    if (settingsBtn) settingsBtn.click();
                });
                await delay(800);
            }
        }
    }

    // Step 4: Set aspect ratio
    // The ratio buttons show text like "2:3", "3:2", "1:1", "9:16", "16:9"
    const clickedRatio = await clickExactText(page, aspectRatio, `Ratio ${aspectRatio}`);
    if (clickedRatio) await delay(500);

    // Step 5: Set video duration (6s or 10s)
    if (duration) {
        const clickedDuration = await clickExactText(page, duration, `Duration ${duration}`);
        if (clickedDuration) await delay(500);
    }

    // Step 6: Set resolution (480p or 720p)
    if (resolution) {
        const clickedRes = await clickExactText(page, resolution, `Resolution ${resolution}`);
        if (clickedRes) await delay(500);
    }

    // Step 7: Close the popover (click outside or press Escape)
    await page.keyboard.press('Escape');
    await delay(300);

    // Step 8: Wait for input to be ready
    // Input is a TipTap/ProseMirror editor: div.tiptap.ProseMirror
    const inputSelector = 'div.tiptap.ProseMirror, div[contenteditable="true"], textarea, div[role="textbox"]';
    try {
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        console.log('[GrokV2] ✅ Input ready ("Type to imagine")');
    } catch {
        console.log('[GrokV2] ⚠️ Input not detected after 10s');
        const debugInfo = await page.evaluate(() => ({
            url: window.location.href,
            inputs: Array.from(document.querySelectorAll('div[contenteditable], textarea, input')).map(el => ({
                tag: el.tagName, role: el.getAttribute('role'),
                classes: (el.className || '').substring(0, 80),
                contentEditable: el.contentEditable
            }))
        }));
        console.log('[GrokV2] DEBUG:', JSON.stringify(debugInfo));
    }

    console.log('[GrokV2] ⚙️ UI configuration complete');
}

// ═══════════════════════════════════════════════════════════════
// TYPE PROMPT — Into TipTap/ProseMirror editor
// ═══════════════════════════════════════════════════════════════

async function typePrompt(page, prompt) {
    const inputSelector = 'div.tiptap.ProseMirror, div[contenteditable="true"], textarea, div[role="textbox"]';

    let inputEl = await page.$(inputSelector);
    if (!inputEl) {
        await delay(2000);
        inputEl = await page.$(inputSelector);
    }
    if (!inputEl) throw new Error('Could not find prompt input field');

    // Click to focus
    await inputEl.click();
    await delay(300);

    // Clear existing text: Ctrl+A + Backspace
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await delay(200);

    // Also clear via DOM (for TipTap editors)
    await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = '';
            } else {
                // TipTap/ProseMirror: clear innerHTML
                el.innerHTML = '<p></p>';
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, inputSelector);
    await delay(200);

    // Re-focus and type via keyboard (works with TipTap)
    await inputEl.click();
    await delay(100);
    await page.keyboard.type(prompt, { delay: 15 });

    await delay(300);
    console.log(`[GrokV2] ✅ Typed prompt (${prompt.length} chars): "${prompt.substring(0, 80)}..."`);
}

// ═══════════════════════════════════════════════════════════════
// SUBMIT PROMPT — Click the ↑ submit arrow button
// ═══════════════════════════════════════════════════════════════

async function submitPrompt(page) {
    const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').trim().toLowerCase();
            // Grok's submit button: aria-label "Submit" or send arrow
            if (ariaLabel.includes('submit') || ariaLabel.includes('send') ||
                ariaLabel.includes('generate') || text === 'generate') {
                btn.click();
                return ariaLabel || text;
            }
        }
        return null;
    });

    if (clicked) {
        console.log(`[GrokV2] ✅ Submit clicked (${clicked})`);
    } else {
        // Fallback: press Enter
        await page.keyboard.press('Enter');
        console.log('[GrokV2] ✅ Submitted via Enter key');
    }
    await delay(1000);
}

// ═══════════════════════════════════════════════════════════════
// WAIT FOR VIDEO — MutationObserver (tracks NEW vs existing)
// ═══════════════════════════════════════════════════════════════

async function waitForVideo(page, timeoutMs = 180000) {
    console.log('[GrokV2] ⏳ Waiting for video...');

    return page.evaluate((timeout) => {
        return new Promise((resolve) => {
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
                        clearInterval(pollInterval);
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
// DOWNLOAD VIDEO — 3 methods: in-browser fetch, download button, blob
// ═══════════════════════════════════════════════════════════════

async function downloadVideo(page, videoUrl, outputDir, sceneNum) {
    const filename = `scene_${String(sceneNum).padStart(3, '0')}.mp4`;
    const filePath = path.join(outputDir, filename);

    // Method 1: In-browser fetch (uses page's cookies)
    // Grok video URLs: https://assets.grok.com/users/.../generated/...
    if (videoUrl && !videoUrl.startsWith('blob:')) {
        console.log(`[GrokV2] 📥 Downloading via in-browser fetch...`);
        const videoData = await page.evaluate(async (url) => {
            try {
                const resp = await fetch(url);
                if (!resp.ok) return null;
                const blob = await resp.blob();
                const reader = new FileReader();
                return new Promise(resolve => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
            } catch { return null; }
        }, videoUrl);

        if (videoData) {
            const base64Data = videoData.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filePath, buffer);
            console.log(`[GrokV2] ✅ Downloaded: ${filename} (${buffer.length} bytes)`);
            return { success: true, filePath };
        }
    }

    // Method 2: Click download button
    // Grok has download button on video cards or via "..." options menu
    console.log('[GrokV2] Trying download button...');

    // First try clicking on the video to open detail view
    await page.evaluate(() => {
        const videos = document.querySelectorAll('video');
        const newest = videos[videos.length - 1];
        if (newest) {
            const parent = newest.closest('a, div[role="button"], [class*="card"]') || newest;
            parent.click();
        }
    });
    await delay(2000);

    // Look for download button or "..." menu
    const clickedDownload = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, a, div[role="button"]');
        for (const el of buttons) {
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const text = (el.textContent || '').trim().toLowerCase();
            if (ariaLabel.includes('download') || title.includes('download') || text === 'download' || text === 'download image') {
                el.click();
                return true;
            }
        }
        return false;
    });

    if (clickedDownload) {
        console.log('[GrokV2] ✅ Download button clicked');
        await delay(10000);

        // Find newest file
        try {
            const files = fs.readdirSync(outputDir);
            const newest = files
                .filter(f => /\.(mp4|webm|mov)$/i.test(f) && !f.startsWith('scene_'))
                .map(f => ({ name: f, time: fs.statSync(path.join(outputDir, f)).mtime.getTime() }))
                .sort((a, b) => b.time - a.time);

            if (newest.length > 0 && Date.now() - newest[0].time < 60000) {
                const oldPath = path.join(outputDir, newest[0].name);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                fs.renameSync(oldPath, filePath);
                console.log(`[GrokV2] ✅ Renamed to ${filename}`);
                return { success: true, filePath };
            }
        } catch (err) {
            console.log(`[GrokV2] ⚠️ File handling error: ${err.message}`);
        }
    } else {
        // Try "..." menu → Download
        console.log('[GrokV2] Trying options menu...');
        const clickedMenu = await page.evaluate(() => {
            const candidates = document.querySelectorAll('button');
            for (const btn of candidates) {
                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                const text = (btn.textContent || '').trim();
                if (ariaLabel.includes('option') || ariaLabel.includes('more') || ariaLabel.includes('video option') ||
                    text === '...' || text === '•••' || text === '⋯') {
                    btn.click();
                    return true;
                }
            }
            return false;
        });

        if (clickedMenu) {
            await delay(1000);
            await clickByText(page, 'download', 'Download in menu');
            await delay(10000);
        }
    }

    // Method 3: Blob extraction
    if (videoUrl && videoUrl.startsWith('blob:')) {
        console.log('[GrokV2] Trying blob extraction...');
        const blobData = await page.evaluate(async (blobUrl) => {
            try {
                const resp = await fetch(blobUrl);
                const blob = await resp.blob();
                const reader = new FileReader();
                return new Promise(resolve => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
            } catch { return null; }
        }, videoUrl);

        if (blobData) {
            const base64Data = blobData.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filePath, buffer);
            console.log(`[GrokV2] ✅ Downloaded blob: ${filename} (${buffer.length} bytes)`);
            return { success: true, filePath };
        }
    }

    return { success: false, error: 'All download methods failed' };
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Full batch generation
// ═══════════════════════════════════════════════════════════════

async function generateVideosGrokV2(browser, scenes, options = {}) {
    const {
        projectDir,
        aspectRatio = '16:9',
        duration = '6s',
        resolution = '480p',
        onProgress = () => { }
    } = options;

    const videoDir = path.join(projectDir, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

    // Find or open Grok tab (reuse existing)
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('grok.com'));

    if (!page) {
        console.log('[GrokV2] Opening new Grok tab...');
        page = await browser.newPage();
        await SM.injectCookies(page, 'grok');
        // Navigate directly to /imagine
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);
    } else {
        console.log('[GrokV2] ✅ Reusing existing Grok tab');
        await page.bringToFront();
        if (!page.url().includes('/imagine')) {
            await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(3000);
        }
    }

    await page.setBypassCSP(true);

    // Configure UI: Video mode, aspect ratio, duration, resolution
    await configureUI(page, { aspectRatio, duration, resolution });

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
                await typePrompt(page, prompt);
                await submitPrompt(page);

                const videoUrl = await waitForVideo(page, 180000);
                if (!videoUrl) throw new Error('No video within 3 minutes');

                console.log(`[GrokV2] 🎥 Scene ${sceneNum}: Video detected`);

                const result = await downloadVideo(page, videoUrl, videoDir, sceneNum);

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

            } catch (err) {
                console.log(`[GrokV2] ❌ Scene ${sceneNum} attempt ${attempts}/3: ${err.message}`);

                // Recovery on page crash
                if (err.message.includes('destroyed') || err.message.includes('Target closed') || err.message.includes('timed out')) {
                    console.log('[GrokV2] 🔄 Recovering...');
                    try {
                        const currentPages = await browser.pages();
                        page = currentPages.find(p => p.url().includes('grok.com'));
                        if (!page) {
                            page = await browser.newPage();
                            await SM.injectCookies(page, 'grok');
                            await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await page.setBypassCSP(true);
                            await delay(3000);
                            await configureUI(page, { aspectRatio, duration, resolution });
                        }
                    } catch (recoveryErr) {
                        console.log(`[GrokV2] ❌ Recovery failed: ${recoveryErr.message}`);
                    }
                }

                if (attempts >= 3) {
                    results.push({ sceneIndex: i, status: 'failed', error: err.message, attempts });
                    onProgress({ sceneIndex: i, totalScenes: scenes.length, status: 'failed', error: err.message });
                }
                await delay(5000 * attempts);
            }
        }

        // Cooldown between scenes
        if (i < scenes.length - 1) await delay(5000);
    }

    const doneCount = results.filter(r => r.status === 'done').length;
    console.log(`[GrokV2] 🏁 Batch complete: ${doneCount}/${scenes.length} scenes generated`);
    return results;
}

module.exports = { generateVideosGrokV2, configureUI };
