// ═══════════════════════════════════════════════════════════════
// META DIRECTOR v2.1 — REWRITTEN FOR REAL /media UI
// Verified UI (Feb 2026): meta.ai/media (Create page)
//
// FLOW:
//  1. Navigate to meta.ai → click "Create" sidebar → lands on /media
//  2. Click "Image ˅" dropdown → select "Video"
//     - Placeholder changes: "Describe your image..." → "Describe your animation..."
//     - "Animate" button appears (replaces send arrow)
//     - Aspect ratio selector DISAPPEARS in Video mode
//  3. Type prompt into div[role="textbox"]
//  4. Click "Animate" button to submit
//  5. Wait for video via MutationObserver
//  6. Download via in-browser fetch / download button / blob extraction
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const SM = require('./session_manager');

// Helper
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// TEXT-BASED ELEMENT SEARCH (proven reliable)
// ═══════════════════════════════════════════════════════════════

async function clickByText(page, searchText, description = '') {
    const clicked = await page.evaluate((text) => {
        const candidates = document.querySelectorAll('button, a, div[role="button"], span, label, li, div[role="option"]');
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
        console.log(`[MetaV2] ✅ Clicked "${description || searchText}"`);
    } else {
        console.log(`[MetaV2] ⚠️ Could not find "${description || searchText}"`);
    }
    return clicked;
}

// ═══════════════════════════════════════════════════════════════
// UI CONFIGURATION — Navigate to /media → Video mode
// ═══════════════════════════════════════════════════════════════

async function configureUI(page, options = {}) {
    const { aspectRatio = '16:9', mode = 'video' } = options;
    console.log(`[MetaV2] ⚙️ Configuring UI: mode=${mode}, aspect=${aspectRatio}`);

    // Step 1: Navigate directly to /media (don't rely on sidebar click — it's unreliable)
    const currentUrl = page.url();
    if (!currentUrl.includes('/media')) {
        console.log('[MetaV2] Navigating directly to /media...');
        await page.goto('https://www.meta.ai/media', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(4000);

        // Verify we landed on /media (not redirected to login or elsewhere)
        const newUrl = page.url();
        console.log(`[MetaV2] Navigated to: ${newUrl}`);
        if (!newUrl.includes('/media') && !newUrl.includes('meta.ai')) {
            console.log('[MetaV2] ⚠️ Unexpected redirect, retrying...');
            await page.goto('https://www.meta.ai/media', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(4000);
        }
    } else {
        console.log('[MetaV2] ✅ Already on /media');
    }

    // Step 2: Switch to Video mode
    // The UI shows: [+] [Create] [Video v]
    if (mode === 'video') {
        const switched = await page.evaluate(() => {
            // First check if we are already in Video mode by looking at the placeholder
            const placeholderEl = document.querySelector('div[data-placeholder="Describe your animation..."], textarea[placeholder="Describe your animation..."]');
            if (placeholderEl) return true;

            // Otherwise, look for the Video button and click it
            const buttons = document.querySelectorAll('button, div[role="button"], span');

            // Try explicit "Video" buttons first
            for (const b of buttons) {
                const text = (b.textContent || '').trim().toLowerCase();
                if (text === 'video' || text.includes('video')) {
                    b.click();
                    // If it was a dropdown trigger, we might need to click the Video option inside it now
                    setTimeout(() => {
                        const options = document.querySelectorAll('[role="menuitem"], [role="option"], li');
                        for (const opt of options) {
                            if ((opt.textContent || '').trim().toLowerCase() === 'video') {
                                opt.click();
                            }
                        }
                    }, 500);
                    return true;
                }
            }
            return false;
        });

        if (switched) {
            console.log('[MetaV2] ✅ Switched to Video mode via UI click');
            await delay(1500);
        } else {
            console.log('[MetaV2] ⚠️ Could not find Video button, typing /video shortcut or relying on initial_image upload... ');
        }
    }

    // Step 3: Verify input is ready
    // In Video mode: placeholder changes to "Describe your animation..."
    // The input is div[role="textbox"] or textarea
    const inputSelector = 'div[role="textbox"], textarea, div[contenteditable="true"], input[type="text"]';
    try {
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        console.log('[MetaV2] ✅ Input ready');
    } catch {
        console.log('[MetaV2] ⚠️ Input not detected after 10s');
        // Debug: log what we see
        const debugInfo = await page.evaluate(() => {
            return {
                url: window.location.href,
                inputs: Array.from(document.querySelectorAll('textarea, div[contenteditable], input, div[role="textbox"]')).map(el => ({
                    tag: el.tagName, role: el.getAttribute('role'),
                    placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
                    classes: (el.className || '').substring(0, 50)
                }))
            };
        });
        console.log('[MetaV2] DEBUG:', JSON.stringify(debugInfo));
    }

    // NOTE: In Video mode, aspect ratio selector DISAPPEARS.
    // Meta.ai Video mode does not show an aspect ratio dropdown.
    // The video is generated at a fixed ratio by Meta.
    if (mode !== 'video' && aspectRatio) {
        // Only set aspect ratio in Image mode
        const openedRatio = await page.evaluate(() => {
            const comboboxes = document.querySelectorAll('button[role="combobox"]');
            for (const cb of comboboxes) {
                const text = cb.textContent.trim();
                if (['1:1', '9:16', '16:9', '4:5'].includes(text)) {
                    cb.click();
                    return true;
                }
            }
            return false;
        });

        if (openedRatio) {
            await delay(500);
            await clickByText(page, aspectRatio, `Ratio ${aspectRatio}`);
            await delay(1000);
        }
    }

    console.log('[MetaV2] ⚙️ UI configuration complete');
}

// ═══════════════════════════════════════════════════════════════
// TYPE PROMPT — Into div[role="textbox"] or textarea
// ═══════════════════════════════════════════════════════════════

async function typePrompt(page, prompt) {
    const inputSelector = 'div[role="textbox"], textarea, div[contenteditable="true"], input[type="text"]';

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

    // Also clear via DOM (belt-and-suspenders)
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

    // Re-click and type the prompt via keyboard (works with React/Lexical editors)
    await inputEl.click();
    await delay(100);
    await page.keyboard.type(prompt, { delay: 15 });

    await delay(300);
    console.log(`[MetaV2] ✅ Typed prompt (${prompt.length} chars): "${prompt.substring(0, 80)}..."`);
}

// ═══════════════════════════════════════════════════════════════
// UPLOAD IMAGE (For I2V)
// ═══════════════════════════════════════════════════════════════

async function uploadImage(page, filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    console.log(`[MetaV2] 📤 Uploading image...`);

    // Click the file upload icon (usually an image icon next to the prompt input)
    const clickedUpload = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button[aria-label*="image" i], div[role="button"][aria-label*="image" i]');
        for (const btn of buttons) {
            btn.click();
            return true;
        }

        // Fallback: look for the SVG path that looks like a picture icon
        const svgs = document.querySelectorAll('svg');
        for (const svg of svgs) {
            const parentBtn = svg.closest('button, div[role="button"]');
            if (parentBtn && !parentBtn.disabled) {
                // Heuristic: upload buttons are usually small squares near the input
                const rect = parentBtn.getBoundingClientRect();
                if (rect.width < 50 && rect.height < 50) {
                    parentBtn.click();
                    return true;
                }
            }
        }
        return false;
    });

    if (clickedUpload) {
        await delay(1000);
    } else {
        console.log(`[MetaV2] ⚠️ Could not find upload button, trying to find file input directly...`);
    }

    // Find the hidden file input
    const fileInput = await page.$('input[type="file"][accept*="image"]');
    if (!fileInput) {
        throw new Error('File input not found');
    }

    await fileInput.uploadFile(filePath);
    console.log(`[MetaV2] ✅ File attached: ${path.basename(filePath)}`);

    // Wait for upload visually (e.g. preview appears)
    await delay(3000);
}

// ═══════════════════════════════════════════════════════════════
// SUBMIT PROMPT — Click "Animate" button (Video mode)
// ═══════════════════════════════════════════════════════════════

async function submitPrompt(page) {
    // In Video mode, the submit button says "Animate" (blue button, right side)
    const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const text = (btn.textContent || '').trim().toLowerCase();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            // Priority order: Animate (Video mode) → Create → Send → Generate
            if (text === 'animate' || ariaLabel === 'animate') {
                btn.click();
                return 'animate';
            }
        }
        // Fallback: look for variations
        for (const btn of buttons) {
            const text = (b.textContent || '').trim().toLowerCase();
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (text.includes('animate') || ariaLabel.includes('animate') ||
                text === 'create' || ariaLabel.includes('send') || ariaLabel.includes('submit') || text === 'generate') {
                btn.click();
                return text || ariaLabel;
            }
        }
        return null;
    });

    if (clicked) {
        console.log(`[MetaV2] ✅ Submit clicked (${clicked})`);
    } else {
        // Last resort: press Enter
        await page.keyboard.press('Enter');
        console.log('[MetaV2] ✅ Submitted via Enter');
    }
    await delay(1000);
}

// ═══════════════════════════════════════════════════════════════
// WAIT FOR VIDEO — MutationObserver (tracks NEW vs existing)
// ═══════════════════════════════════════════════════════════════

async function waitForVideo(page, timeoutMs = 180000) {
    console.log('[MetaV2] ⏳ Waiting for video...');

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
// DOWNLOAD VIDEO — 3-tier: in-browser fetch → download button → blob
// ═══════════════════════════════════════════════════════════════

async function downloadVideo(page, videoUrl, outputDir, sceneNum) {
    const filename = `scene_${String(sceneNum).padStart(3, '0')}.mp4`;
    const filePath = path.join(outputDir, filename);

    // Method 1: In-browser fetch (uses page's cookies/session)
    if (videoUrl && !videoUrl.startsWith('blob:')) {
        console.log(`[MetaV2] 📥 Downloading via in-browser fetch...`);
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
            console.log(`[MetaV2] ✅ Downloaded: ${filename} (${buffer.length} bytes)`);
            return { success: true, filePath };
        }
    }

    // Method 2: Click download button
    console.log('[MetaV2] Trying download button...');
    const clickedDownload = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, a, div[role="button"]');
        for (const el of buttons) {
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const text = (el.textContent || '').trim().toLowerCase();
            if (ariaLabel.includes('download') || title.includes('download') || text === 'download') {
                el.click();
                return true;
            }
        }
        return false;
    });

    if (clickedDownload) {
        console.log('[MetaV2] ✅ Download button clicked, waiting for file...');
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
                console.log(`[MetaV2] ✅ Renamed to ${filename}`);
                return { success: true, filePath };
            }
        } catch (err) {
            console.log(`[MetaV2] ⚠️ File handling error: ${err.message}`);
        }
    }

    // Method 3: Extract blob URL via page and save
    if (videoUrl && videoUrl.startsWith('blob:')) {
        console.log('[MetaV2] Trying blob extraction...');
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
            console.log(`[MetaV2] ✅ Downloaded blob: ${filename} (${buffer.length} bytes)`);
            return { success: true, filePath };
        }
    }

    return { success: false, error: 'All download methods failed' };
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Full batch generation
// ═══════════════════════════════════════════════════════════════

async function generateVideosMetaV2(browser, scenes, options = {}) {
    const {
        projectDir,
        aspectRatio = '16:9',
        onProgress = () => { }
    } = options;

    const videoDir = path.join(projectDir, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

    // Find or open Meta tab (reuse existing)
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('meta.ai'));

    if (!page) {
        console.log('[MetaV2] Opening new Meta.ai tab...');
        page = await browser.newPage();
        await SM.injectCookies(page, 'meta');
        // Navigate directly to /media (the Create page)
        await page.goto('https://www.meta.ai/media', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);
    } else {
        console.log('[MetaV2] ✅ Reusing existing Meta.ai tab');
        await page.bringToFront();
        // Make sure we're on the /media page
        if (!page.url().includes('/media')) {
            await page.goto('https://www.meta.ai/media', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(3000);
        }
    }

    await page.setBypassCSP(true);

    // Configure UI: switch to Video mode
    await configureUI(page, { aspectRatio, mode: 'video' });

    // Process scenes
    const results = [];
    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneNum = i + 1;
        const prompt = scene.prompt;

        if (!prompt || prompt.length < 5) {
            console.log(`[MetaV2] ⚠️ Scene ${sceneNum}: Empty/short prompt, skipping`);
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
            console.log(`[MetaV2] 🎬 Scene ${sceneNum} (attempt ${attempts}/3): "${prompt.substring(0, 80)}..."`);

            try {
                // I2V Phase: Upload image first if present
                if (scene.initial_image) {
                    await uploadImage(page, scene.initial_image);
                }

                await typePrompt(page, prompt);
                await submitPrompt(page);

                const videoUrl = await waitForVideo(page, 180000);
                if (!videoUrl) throw new Error('No video within 3 minutes');

                console.log(`[MetaV2] 🎥 Scene ${sceneNum}: Video detected`);

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
                console.log(`[MetaV2] ❌ Scene ${sceneNum} attempt ${attempts}/3: ${err.message}`);

                // Recovery on page crash
                if (err.message.includes('destroyed') || err.message.includes('Target closed') || err.message.includes('timed out')) {
                    console.log('[MetaV2] 🔄 Recovering...');
                    try {
                        const currentPages = await browser.pages();
                        page = currentPages.find(p => p.url().includes('meta.ai'));
                        if (!page) {
                            page = await browser.newPage();
                            await SM.injectCookies(page, 'meta');
                            await page.goto('https://www.meta.ai/media', { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await page.setBypassCSP(true);
                            await delay(3000);
                            await configureUI(page, { aspectRatio, mode: 'video' });
                        }
                    } catch (recoveryErr) {
                        console.log(`[MetaV2] ❌ Recovery failed: ${recoveryErr.message}`);
                    }
                }

                if (attempts >= 3) {
                    results.push({ sceneIndex: i, status: 'failed', error: err.message, attempts });
                    onProgress({ sceneIndex: i, totalScenes: scenes.length, status: 'failed', error: err.message });
                }
                await delay(5000 * attempts);
            }
        }

        if (i < scenes.length - 1) await delay(5000);
    }

    const doneCount = results.filter(r => r.status === 'done').length;
    console.log(`[MetaV2] 🏁 Batch complete: ${doneCount}/${scenes.length} scenes`);
    return results;
}

module.exports = { generateVideosMetaV2, configureUI };
