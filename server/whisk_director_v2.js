// ═══════════════════════════════════════════════════════════════
// WHISK DIRECTOR v2
// Extension-inspired robust automation for Google Whisk
// Supports: Text→Image generation (Pro mode Phase 1)
// Features: UI config, MutationObserver, direct download
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { DownloadWatcher } = require('./download_watcher');
const SM = require('./session_manager');

// ─── Multi-Selector Fallback System ───
const SELECTORS = {
    // Subject/style input areas
    subjectInput: [
        'textarea[placeholder*="subject"]',
        'textarea[placeholder*="Subject"]',
        'textarea[placeholder*="describe"]',
        '[data-testid="subject-input"]',
        '.subject-input textarea'
    ],

    sceneInput: [
        'textarea[placeholder*="scene"]',
        'textarea[placeholder*="Scene"]',
        'textarea[placeholder*="background"]',
        '[data-testid="scene-input"]',
        '.scene-input textarea'
    ],

    styleInput: [
        'textarea[placeholder*="style"]',
        'textarea[placeholder*="Style"]',
        '[data-testid="style-input"]',
        '.style-input textarea'
    ],

    // Generate button
    generateButton: [
        'button[aria-label*="Generate"]',
        'button[aria-label*="generate"]',
        'button[aria-label*="Create"]',
        'button[data-testid="generate"]',
        'button:has-text("Generate")',
        'button:has-text("Create")'
    ],

    // Upload areas for reference images
    subjectUpload: [
        'input[type="file"][accept*="image"]',
        '.subject-upload input[type="file"]',
        '[data-testid="subject-upload"] input'
    ],

    styleUpload: [
        '.style-upload input[type="file"]',
        '[data-testid="style-upload"] input'
    ],

    // Generated image result
    imageResult: [
        'img[data-testid="generated-image"]',
        '.output-image img',
        '.generated-result img',
        '.result-container img',
        'img[alt*="generated"]'
    ],

    // Download button
    downloadButton: [
        'button[aria-label*="Download"]',
        'a[download]',
        'button[data-testid="download"]',
        'button:has-text("Download")'
    ]
};

// ─── Find element with fallback ───
async function findElement(page, selectorList, description = '') {
    for (const selector of selectorList) {
        try {
            const el = await page.$(selector);
            if (el) {
                console.log(`[WhiskV2] ✅ Found ${description} via: ${selector}`);
                return el;
            }
        } catch { /* try next */ }
    }
    console.log(`[WhiskV2] ⚠️ Could not find ${description}`);
    return null;
}

async function findByText(page, text) {
    return page.evaluateHandle((searchText) => {
        const elements = document.querySelectorAll('button, a, span, div[role="button"]');
        for (const el of elements) {
            if (el.textContent.trim().toLowerCase().includes(searchText.toLowerCase())) {
                return el;
            }
        }
        return null;
    }, text);
}

// ═══════════════════════════════════════════════════════════════
// GENERATE SINGLE IMAGE
// ═══════════════════════════════════════════════════════════════

async function generateImage(page, scene, downloadWatcher) {
    const sceneNum = scene.index + 1;
    console.log(`[WhiskV2] 🖼️ Scene ${sceneNum}: "${scene.prompt.substring(0, 60)}..."`);

    // Step 1: Upload subject reference image (if available)
    if (scene.referenceImage) {
        const uploadInputs = await page.$$('input[type="file"]');
        if (uploadInputs.length > 0) {
            await uploadInputs[0].uploadFile(scene.referenceImage);
            await delay(2000);
            console.log(`[WhiskV2] 📎 Uploaded reference image`);
        }
    }

    // Step 2: Fill in subject description
    const subjectInput = await findElement(page, SELECTORS.subjectInput, 'subject input');
    if (subjectInput) {
        await subjectInput.click({ clickCount: 3 }); // Select all
        await page.keyboard.type(scene.prompt, { delay: 15 });
        await delay(300);
    }

    // Step 3: Fill in scene/background (if provided)
    if (scene.sceneDescription) {
        const sceneInput = await findElement(page, SELECTORS.sceneInput, 'scene input');
        if (sceneInput) {
            await sceneInput.click({ clickCount: 3 });
            await page.keyboard.type(scene.sceneDescription, { delay: 15 });
            await delay(300);
        }
    }

    // Step 4: Fill in style (if provided)
    if (scene.styleDescription) {
        const styleInput = await findElement(page, SELECTORS.styleInput, 'style input');
        if (styleInput) {
            await styleInput.click({ clickCount: 3 });
            await page.keyboard.type(scene.styleDescription, { delay: 15 });
            await delay(300);
        }
    }

    // Step 5: Click Generate
    let genBtn = await findElement(page, SELECTORS.generateButton, 'generate button');
    if (!genBtn) genBtn = await findByText(page, 'Generate');
    if (!genBtn) genBtn = await findByText(page, 'Create');

    if (genBtn) {
        await genBtn.click();
    } else {
        throw new Error('Could not find Generate button');
    }

    console.log(`[WhiskV2] ⏳ Scene ${sceneNum}: Waiting for image generation...`);

    // Step 6: Wait for image via MutationObserver
    const imageUrl = await waitForImage(page, 120000);
    if (!imageUrl) throw new Error(`Scene ${sceneNum}: No image generated within timeout`);

    console.log(`[WhiskV2] 🖼️ Scene ${sceneNum}: Image URL found`);

    // Step 7: Download image
    const result = await downloadWatcher.downloadImage(imageUrl, scene.index);
    if (!result || !result.success) {
        // Fallback: click download button
        const dlBtn = await findElement(page, SELECTORS.downloadButton, 'download button');
        if (dlBtn) {
            await dlBtn.click();
            // Wait for file to appear
            await delay(5000);
            const imageDir = downloadWatcher.downloadDir;
            const images = fs.readdirSync(imageDir).filter(f => /\.(png|jpg|webp)$/i.test(f));
            if (images.length > 0) {
                const latest = images[images.length - 1];
                const src = path.join(imageDir, latest);
                const dest = path.join(imageDir, `scene_${String(sceneNum).padStart(3, '0')}.png`);
                try { fs.renameSync(src, dest); } catch { }
                return { success: true, filePath: fs.existsSync(dest) ? dest : src };
            }
        }
        throw new Error(`Scene ${sceneNum}: Image download failed`);
    }

    console.log(`[WhiskV2] ✅ Scene ${sceneNum}: Downloaded → ${result.filePath}`);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// MUTATION OBSERVER — Wait for image
// ═══════════════════════════════════════════════════════════════

async function waitForImage(page, timeoutMs = 120000) {
    return page.evaluate((timeout, imgSelectors) => {
        return new Promise((resolve) => {
            const existingImgs = new Set();
            document.querySelectorAll('img').forEach(img => {
                if (img.src) existingImgs.add(img.src);
            });

            let resolved = false;

            const observer = new MutationObserver(() => {
                if (resolved) return;

                // Check our specific selectors first
                for (const sel of imgSelectors) {
                    const el = document.querySelector(sel);
                    if (el && el.src && !existingImgs.has(el.src)) {
                        resolved = true;
                        observer.disconnect();
                        resolve(el.src);
                        return;
                    }
                }

                // Check all images for new ones (large ones = generated)
                const allImgs = document.querySelectorAll('img');
                for (const img of allImgs) {
                    if (img.src && !existingImgs.has(img.src) &&
                        img.naturalWidth > 200 && img.naturalHeight > 200) {
                        resolved = true;
                        observer.disconnect();
                        resolve(img.src);
                        return;
                    }
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    observer.disconnect();
                    resolve(null);
                }
            }, timeout);
        });
    }, timeoutMs, SELECTORS.imageResult);
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Batch image generation for Pro mode Phase 1
// ═══════════════════════════════════════════════════════════════

async function generateImagesWhiskV2(browser, scenes, options = {}) {
    const {
        projectDir,
        onProgress = () => { }
    } = options;

    const imageDir = path.join(projectDir, 'images');
    if (!fs.existsSync(imageDir)) fs.mkdirSync(imageDir, { recursive: true });

    const downloadWatcher = new DownloadWatcher(imageDir);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await downloadWatcher.setupCDP(page);

    // Inject Google cookies for Whisk
    await SM.injectCookies(page, 'whisk');

    // Navigate to Whisk
    await page.goto('https://labs.google/fx/tools/whisk', {
        waitUntil: 'networkidle2',
        timeout: 30000
    });
    await delay(3000);

    // Process scenes
    const results = [];
    for (let i = 0; i < scenes.length; i++) {
        const scene = { ...scenes[i], index: i };

        onProgress({
            sceneIndex: i,
            totalScenes: scenes.length,
            status: 'generating',
            pct: Math.round((i / scenes.length) * 100)
        });

        let attempts = 0;
        let success = false;

        while (attempts < 3 && !success) {
            attempts++;
            try {
                const result = await generateImage(page, scene, downloadWatcher);
                results.push({ sceneIndex: i, status: 'done', filePath: result.filePath, attempts });
                success = true;

                onProgress({
                    sceneIndex: i,
                    totalScenes: scenes.length,
                    status: 'done',
                    filePath: result.filePath,
                    pct: Math.round(((i + 1) / scenes.length) * 100)
                });
            } catch (err) {
                console.log(`[WhiskV2] ❌ Scene ${i + 1} attempt ${attempts}/3: ${err.message}`);
                if (attempts >= 3) {
                    results.push({ sceneIndex: i, status: 'failed', error: err.message, attempts });
                    onProgress({ sceneIndex: i, totalScenes: scenes.length, status: 'failed', error: err.message });
                }
                await delay(5000 * attempts);
            }
        }

        if (i < scenes.length - 1) await delay(3000);
    }

    await page.close();
    const doneCount = results.filter(r => r.status === 'done').length;
    console.log(`[WhiskV2] 🏁 Batch complete: ${doneCount}/${scenes.length} images`);
    return results;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { generateImagesWhiskV2, generateImage };
