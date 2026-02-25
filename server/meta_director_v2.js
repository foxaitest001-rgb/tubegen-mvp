// ═══════════════════════════════════════════════════════════════
// META DIRECTOR v2 — FIXED
// Extension-inspired + v1-proven navigation techniques
// Uses: text-based element search, page.evaluate, browser download
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
        const candidates = document.querySelectorAll('button, a, div[role="button"], span, label, li');
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
        console.log(`[MetaV2] ✅ Clicked "${description || searchText}"`);
    } else {
        console.log(`[MetaV2] ⚠️ Could not find "${description || searchText}"`);
    }
    return clicked;
}

// ═══════════════════════════════════════════════════════════════
// UI CONFIGURATION — Navigate to Imagine Video mode
// ═══════════════════════════════════════════════════════════════

async function configureUI(page, options = {}) {
    const { aspectRatio = '16:9' } = options;
    console.log(`[MetaV2] ⚙️ Configuring UI: mode=video, aspect=${aspectRatio}`);

    // Step 1: Click "Imagine" button
    // Meta.ai has an "Imagine" button/toggle in the main UI
    let clickedImagine = await clickByText(page, 'imagine', 'Imagine button');
    if (clickedImagine) {
        await delay(2000);
    } else {
        // Try navigating directly to imagine endpoint
        console.log('[MetaV2] Trying direct navigation to meta.ai imagine...');
        try {
            await page.goto('https://www.meta.ai/imagine/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(3000);
        } catch {
            // Stay on current page
            console.log('[MetaV2] ⚠️ Direct navigation failed, staying on current page');
        }
    }

    // Step 2: Click "Video" to switch to video mode
    const clickedVideo = await clickByText(page, 'video', 'Video mode');
    if (clickedVideo) await delay(1500);

    // Step 3: Set aspect ratio
    const clickedRatio = await clickByText(page, aspectRatio, `Aspect ${aspectRatio}`);
    if (clickedRatio) await delay(1000);

    // Step 4: Wait for input to be ready
    const inputSelector = 'div[contenteditable="true"], textarea, div[role="textbox"], input[type="text"]';
    try {
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        console.log('[MetaV2] ✅ Input ready');
    } catch {
        console.log('[MetaV2] ⚠️ Input not detected after 10s');
    }

    console.log('[MetaV2] ⚙️ UI configuration complete');
}

// ═══════════════════════════════════════════════════════════════
// TYPE FULL PROMPT
// ═══════════════════════════════════════════════════════════════

async function typePrompt(page, prompt) {
    const inputSelector = 'div[contenteditable="true"], textarea, div[role="textbox"], input[type="text"]';

    let inputEl = await page.$(inputSelector);
    if (!inputEl) {
        await delay(2000);
        inputEl = await page.$(inputSelector);
    }
    if (!inputEl) throw new Error('Could not find prompt input field');

    await inputEl.click();
    await delay(200);

    // Clear: Ctrl+A + Backspace
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await delay(200);

    // Also clear via DOM
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

    // Set value directly (fast, reliable for long prompts)
    await inputEl.click();
    await delay(100);

    await page.evaluate((sel, text) => {
        const el = document.querySelector(sel);
        if (el) {
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } else {
                // contenteditable — need both textContent and input event
                el.textContent = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                // Also trigger React's synthetic event
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }, inputSelector, prompt);

    await delay(300);
    console.log(`[MetaV2] ✅ Typed prompt (${prompt.length} chars): "${prompt.substring(0, 80)}..."`);
}

// ═══════════════════════════════════════════════════════════════
// SUBMIT PROMPT
// ═══════════════════════════════════════════════════════════════

async function submitPrompt(page) {
    const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.textContent || '').trim().toLowerCase();
            if (ariaLabel.includes('send') || ariaLabel.includes('submit') ||
                ariaLabel.includes('generate') || text === 'generate' || text === 'send') {
                btn.click();
                return true;
            }
        }
        return false;
    });

    if (clicked) {
        console.log('[MetaV2] ✅ Submit clicked');
    } else {
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
// DOWNLOAD VIDEO — In-browser fetch with cookies
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
        await page.goto('https://www.meta.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);
    } else {
        console.log('[MetaV2] ✅ Reusing existing Meta.ai tab');
        await page.bringToFront();
    }

    await page.setBypassCSP(true);

    // Configure UI
    await configureUI(page, { aspectRatio });

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
                            await page.goto('https://www.meta.ai/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await page.setBypassCSP(true);
                            await delay(3000);
                            await configureUI(page, { aspectRatio });
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
