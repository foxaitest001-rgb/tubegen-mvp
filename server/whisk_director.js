// ═══════════════════════════════════════════════════════════════
// Whisk Director — Google Labs Whisk Browser Automation
// Generates consistent scene images via Puppeteer
// URL: https://labs.google/fx/tools/whisk
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const SM = require('./session_manager');

// ─── Whisk DOM Selectors (ROBUST — no sc-* hashes, survives Whisk rebuilds) ───
// Styled Components generates random class hashes per-build.
// We use element types, roles, aria-labels, and text content instead.
const WHISK_SELECTORS = {
    // File upload inputs — Whisk has multiple input[type="file"] for Subject/Scene/Style
    fileInput: 'input[type="file"]',

    // Main prompt textarea — find by element type (Whisk usually has few textareas)
    // Will be found dynamically via findPromptTextarea() below
    promptTextarea: 'textarea',

    // Submit/Generate button — aria-label or text-based
    submitButton: 'button[aria-label="Submit prompt"]',

    // Settings/tune button — find by Material icon text "tune"
    // Aspect ratio button — find by Material icon text "aspect_ratio"
    // Both are found via text content in helper functions
};

// ─── Config ───
// VERIFIED via Puppeteer inspection (2026-02-27):
// - textarea placeholder: "Describe your idea or roll the dice for prompt ideas"
// - Submit button: aria-label="Submit prompt" (Material icon: arrow_forward)
// - Add Images: button with text "Add Images"
// - Aspect ratio: button with text "aspect_ratio"
// - Settings: button with text "tune"
const WHISK_URL = 'https://labs.google/fx/tools/whisk/project';
const GENERATION_TIMEOUT = 90000;    // 90s max wait for image generation
const BETWEEN_GENERATIONS_DELAY = 35000; // 35s between generations (rate limit safety)
const PAGE_LOAD_DELAY = 5000;         // 5s for page to fully load

/**
 * Interruptible sleep that checks for cancellation
 */
function interruptibleSleep(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
            });
        }
    });
}

/**
 * Director logging helper — sends logs to SSE connected clients
 */
let _directorLog = null;
function setDirectorLog(logFn) {
    _directorLog = logFn;
}

function log(step, tag, message) {
    if (_directorLog) {
        _directorLog(step, tag, message);
    } else {
        console.log(`[Whisk][${tag}] ${message}`);
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Generate All Scene Images via Whisk
// ═══════════════════════════════════════════════════════════════

/**
 * Generate consistent scene images using Google Labs Whisk.
 * 
 * Flow:
 *   1. Generate subject reference images (text-only, no ref upload)
 *   2. Lock style from first result
 *   3. Generate all scene images with subject + style refs
 * 
 * @param {Array} scenes - Script structure with scene_type, subject_id, image_prompt
 * @param {Array} subjectRegistry - Array of { id, visual_description, is_primary }
 * @param {string} projectDir - Path to project output folder
 * @param {string} visualStyle - Art style (cinematic, anime, etc.)
 * @param {object} styleDNA - Full style DNA object
 * @param {object} browser - Puppeteer browser instance
 * @param {function} directorLogFn - Logging function
 * @param {string} aspectRatio - Target aspect ratio ("16:9", "9:16", "1:1")
 */
async function generateImagesWhisk(scenes, subjectRegistry, projectDir, visualStyle, styleDNA, browser, directorLogFn, aspectRatio = '16:9') {
    setDirectorLog(directorLogFn);

    const imagesDir = path.join(projectDir, 'images');
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    log(0, 'WHISK', '🎨 Whisk Director starting...');
    log(0, 'WHISK', `📁 Output: ${imagesDir}`);
    log(0, 'WHISK', `👥 Subjects: ${subjectRegistry.length} | 🎬 Scenes: ${scenes.length}`);

    // ─── Get or create a Whisk tab ───
    let page = null;
    const pages = await browser.pages();

    // Find existing Whisk tab
    for (const p of pages) {
        const url = p.url();
        if (url.includes('labs.google') && url.includes('whisk')) {
            page = p;
            log(0, 'WHISK', '♻️ Reusing existing Whisk tab');
            break;
        }
    }

    // Open new tab if needed
    if (!page) {
        page = await browser.newPage();
        // Inject Whisk cookies BEFORE navigating (needed for authenticated access)
        await SM.injectCookies(page, 'whisk');
        log(0, 'WHISK', `🌐 Opening Whisk: ${WHISK_URL}`);
        await page.goto(WHISK_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        await interruptibleSleep(PAGE_LOAD_DELAY);
    }

    await page.setViewport({ width: 1400, height: 900 });

    // ─── Dismiss any welcome modals/tooltips ───
    await handleWelcomeModal(page);

    // ─── Set aspect ratio before generating ───
    await setAspectRatio(page, aspectRatio);

    // ═══════════════════════════════════════════════════
    // PHASE 1: Generate Subject Reference Images
    // ═══════════════════════════════════════════════════

    log(0, 'PHASE1', '━━━ Phase 1: Generating Subject References ━━━');

    const subjectRefs = {}; // { subjectId: filePath }
    let styleRefPath = null;

    for (const subject of subjectRegistry) {
        log(0, 'SUBJECT', `🧑 Generating reference for: ${subject.name} (${subject.id})`);

        // Type the subject description as a prompt (no image uploads for first reference)
        const subjectPrompt = `Portrait of ${subject.visual_description}, ${visualStyle} style, detailed, high quality, centered composition`;

        await typePromptAndSubmit(page, subjectPrompt);

        // Wait for generation to complete
        const resultImagePath = await waitForResultAndDownload(page, imagesDir, `subject_${subject.id}_ref`);

        if (resultImagePath) {
            subjectRefs[subject.id] = resultImagePath;
            log(0, 'SUBJECT', `✅ Subject reference saved: ${path.basename(resultImagePath)}`);

            // Lock style from the first generated image
            if (!styleRefPath && subject.is_primary) {
                styleRefPath = resultImagePath;
                log(0, 'STYLE', `🔒 Style reference locked from primary subject`);
            }
        } else {
            log(0, 'SUBJECT', `⚠️ Failed to generate reference for ${subject.name}`);
        }

        // Rate limit pause
        log(0, 'WAIT', `⏳ Waiting ${BETWEEN_GENERATIONS_DELAY / 1000}s (rate limit)...`);
        await interruptibleSleep(BETWEEN_GENERATIONS_DELAY);
    }

    // If no style ref was locked, use the first available subject ref
    if (!styleRefPath) {
        const firstRef = Object.values(subjectRefs)[0];
        if (firstRef) {
            styleRefPath = firstRef;
            log(0, 'STYLE', '🔒 Style reference locked from first available subject');
        }
    }

    // ═══════════════════════════════════════════════════
    // PHASE 2: Generate Scene Images
    // ═══════════════════════════════════════════════════

    log(0, 'PHASE2', '━━━ Phase 2: Generating Scene Images ━━━');

    const sceneImages = []; // { sceneNum, filePath, sceneType }

    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const sceneNum = i + 1;
        const sceneType = scene.scene_type || 'establishing';
        const subjectId = scene.subject_id || null;

        log(sceneNum, 'SCENE', `🎬 Scene ${sceneNum}/${scenes.length} [${sceneType}]`);

        // Open the "Add Images" panel
        await openAddImagesPanel(page);
        await interruptibleSleep(1000);

        // ─── Upload references based on scene type ───
        const fileInputs = await page.$$(WHISK_SELECTORS.fileInput);

        if (sceneType === 'character' || sceneType === 'multi_character') {
            // Upload SUBJECT reference (1st input)
            if (subjectId && subjectRefs[subjectId] && fileInputs.length >= 1) {
                log(sceneNum, 'UPLOAD', `📤 Uploading subject ref: ${subjectId}`);
                await fileInputs[0].uploadFile(subjectRefs[subjectId]);
                await interruptibleSleep(2000);
            }
        }
        // For "establishing" scenes — no subject upload

        // Upload STYLE reference (3rd input) — always if available
        if (styleRefPath && fileInputs.length >= 3) {
            log(sceneNum, 'UPLOAD', `🎨 Uploading style ref`);
            await fileInputs[2].uploadFile(styleRefPath);
            await interruptibleSleep(2000);
        }

        // ─── Build and type the scene prompt ───
        let scenePrompt = scene.image_prompt || scene.visual_cue || '';

        // Enrich the prompt based on scene type
        if (sceneType === 'establishing') {
            scenePrompt = `${scenePrompt}, wide establishing shot, ${visualStyle} style, cinematic composition, no characters`;
        } else if (sceneType === 'multi_character' && scene.secondary_subject_id) {
            // Add secondary subject description to the text prompt
            const secondary = subjectRegistry.find(s => s.id === scene.secondary_subject_id);
            if (secondary) {
                scenePrompt = `${scenePrompt}, also featuring ${secondary.visual_description}`;
            }
        }

        // Append style DNA keywords if available
        if (styleDNA?.visual_identity?.art_style) {
            scenePrompt += `, ${styleDNA.visual_identity.art_style}`;
        }

        await typePromptAndSubmit(page, scenePrompt);

        // Wait for result and download
        const resultPath = await waitForResultAndDownload(page, imagesDir, `scene_${sceneNum}_ref`);

        if (resultPath) {
            sceneImages.push({ sceneNum, filePath: resultPath, sceneType });
            log(sceneNum, 'SCENE', `✅ Scene ${sceneNum} image saved: ${path.basename(resultPath)}`);
        } else {
            log(sceneNum, 'SCENE', `⚠️ Scene ${sceneNum} generation failed — will retry or skip`);
        }

        // Rate limit pause between scenes
        if (i < scenes.length - 1) {
            log(sceneNum, 'WAIT', `⏳ Waiting ${BETWEEN_GENERATIONS_DELAY / 1000}s...`);
            await interruptibleSleep(BETWEEN_GENERATIONS_DELAY);
        }

        // Reset Whisk for next scene (clear inputs AND images)
        await resetWhiskInputs(page);
    }

    log(0, 'DONE', `━━━ Whisk Director Complete: ${sceneImages.length}/${scenes.length} images ━━━`);

    return {
        subjectRefs,
        styleRefPath,
        sceneImages,
        imagesDir
    };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Handle initial welcome modals or Try Flow tooltips that block the UI.
 */
async function handleWelcomeModal(page) {
    try {
        const clicked = await page.evaluate(() => {
            const btns = document.querySelectorAll('button, div[role="button"], span');
            for (const b of btns) {
                const text = (b.textContent || '').trim().toLowerCase();
                if (['try flow', 'got it', 'next', 'done', 'close', 'accept', 'continue'].includes(text)) {
                    b.click();
                    return true;
                }
            }
            return false;
        });
        if (clicked) {
            await interruptibleSleep(1000);
            log(0, 'UI', 'Dismissed welcome modal/tooltip');
        }
    } catch (e) { }
}

/**
 * Open the "Add Images" panel if not already open
 */
async function openAddImagesPanel(page) {
    try {
        // Check if file upload inputs are already visible
        const inputs = await page.$$('input[type="file"]');
        if (inputs.length >= 3) {
            return; // Panel already open
        }

        // Find "Add Images" button by text content
        const clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button, div[role="button"]');
            for (const b of buttons) {
                const text = (b.textContent || '').trim().toLowerCase();
                if (text.includes('add images') || text.includes('add image')) {
                    b.click();
                    return true;
                }
            }
            return false;
        });

        if (clicked) {
            await interruptibleSleep(1500);
            log(0, 'UI', '📂 Opened Add Images panel');
        } else {
            log(0, 'WARN', 'Could not find Add Images button');
        }
    } catch (err) {
        log(0, 'WARN', `Could not open Add Images panel: ${err.message}`);
    }
}

/**
 * Type a prompt into the Whisk textarea and click Submit
 */
async function typePromptAndSubmit(page, prompt) {
    try {
        // Strategy 1: Find textarea by tag (most reliable)
        let textarea = await page.$('textarea');

        // Strategy 2: Find by placeholder text
        if (!textarea) {
            textarea = await page.$('textarea[placeholder*="Describe"]') ||
                await page.$('textarea[placeholder*="describe"]') ||
                await page.$('textarea[placeholder*="idea"]') ||
                await page.$('textarea[placeholder*="prompt"]');
        }

        // Strategy 3: Find contenteditable div
        if (!textarea) {
            textarea = await page.$('[contenteditable="true"]');
        }

        // Strategy 4: Find by evaluating all textareas and picking the biggest visible one
        if (!textarea) {
            textarea = await page.evaluateHandle(() => {
                const all = document.querySelectorAll('textarea');
                let best = null;
                let bestSize = 0;
                for (const ta of all) {
                    const rect = ta.getBoundingClientRect();
                    const size = rect.width * rect.height;
                    if (rect.width > 100 && size > bestSize) {
                        best = ta;
                        bestSize = size;
                    }
                }
                return best;
            });
            if (textarea && !(await textarea.evaluate(el => el !== null))) textarea = null;
        }

        if (!textarea) {
            log(0, 'ERROR', 'Could not find prompt textarea — tried all strategies');
            // Dump page info for debugging
            const debugInfo = await page.evaluate(() => {
                const textareas = document.querySelectorAll('textarea');
                const editables = document.querySelectorAll('[contenteditable]');
                const inputs = document.querySelectorAll('input[type="text"]');
                return {
                    url: window.location.href,
                    textareas: textareas.length,
                    editables: editables.length,
                    textInputs: inputs.length,
                    bodyText: document.body.innerText.substring(0, 200)
                };
            });
            log(0, 'DEBUG', JSON.stringify(debugInfo));
            return;
        }

        // Clear and type prompt
        await textarea.click({ clickCount: 3 });
        await interruptibleSleep(200);
        await page.keyboard.press('Backspace');
        await interruptibleSleep(100);
        await textarea.type(prompt, { delay: 15 });
        log(0, 'TYPE', `📝 Prompt entered (${prompt.length} chars)`);

        await interruptibleSleep(500);

        // Try multiple submit strategies
        // Strategy 1: button[aria-label="Submit prompt"]
        let submitBtn = await page.$('button[aria-label="Submit prompt"]');

        // Strategy 2: button[aria-label="Submit"]
        if (!submitBtn) submitBtn = await page.$('button[aria-label="Submit"]');

        // Strategy 3: Find button by text content
        if (!submitBtn) {
            submitBtn = await page.evaluateHandle(() => {
                const btns = document.querySelectorAll('button');
                for (const b of btns) {
                    const text = (b.textContent || '').trim().toLowerCase();
                    if (text === 'submit' || text === 'generate' || text === 'create' || text.includes('send')) {
                        return b;
                    }
                    // Material icon: "send" or "arrow_forward"
                    if (text === 'send' || text === 'arrow_forward' || text === 'arrow_upward') {
                        return b;
                    }
                }
                return null;
            });
        }

        // Close the Add Images panel if it's open (it blocks the UI)
        await page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const text = (b.textContent || '').trim().toLowerCase();
                // Sometimes there's a "Done" button or just click outside
                if (text === 'done' || text === 'close') {
                    b.click();
                }
            }
        });
        await interruptibleSleep(500);

        if (submitBtn) {
            await submitBtn.click();
            log(0, 'SUBMIT', '🚀 Submitted prompt');
        } else {
            // Fallback: press Enter
            await page.keyboard.press('Enter');
            log(0, 'SUBMIT', '🚀 Submitted via Enter key (fallback)');
        }
    } catch (err) {
        log(0, 'ERROR', `Failed to type/submit prompt: ${err.message}`);
    }
}

/**
 * Wait for Whisk to generate an image, then download it.
 * Strategy: Watch for new images appearing in the results area.
 */
async function waitForResultAndDownload(page, outputDir, fileBaseName) {
    log(0, 'WAIT', '⏳ Waiting for Whisk to generate...');

    try {
        // Wait for a result image to appear
        // Whisk shows results as img elements — wait for a new one
        const startTime = Date.now();
        let resultImageSrc = null;

        while (Date.now() - startTime < GENERATION_TIMEOUT) {
            // Look for generated result images
            resultImageSrc = await page.evaluate(() => {
                // Look for the main generated image in the results area
                // Whisk typically shows results in an img element within results container
                const images = document.querySelectorAll('img');
                for (const img of images) {
                    const src = img.src || '';
                    // Generated images typically have a blob: or data: URL, or a Google storage URL
                    if ((src.includes('blob:') || src.includes('data:image') || src.includes('lh3.googleusercontent') || src.includes('storage.googleapis'))
                        && img.width > 200 && img.height > 200) {
                        // Check if this image is in a results area (not a UI icon)
                        const rect = img.getBoundingClientRect();
                        if (rect.width > 200 && rect.height > 200) {
                            return src;
                        }
                    }
                }
                return null;
            });

            if (resultImageSrc) {
                log(0, 'RESULT', '🖼️ Image generated! Downloading...');
                break;
            }

            // Also check for any loading indicators disappearing
            const isLoading = await page.evaluate(() => {
                const spinners = document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="progress"]');
                return spinners.length > 0;
            });

            if (!isLoading && Date.now() - startTime > 10000) {
                // If no loading indicator and we've waited 10s, check for images again
                await interruptibleSleep(2000);
                continue;
            }

            await interruptibleSleep(3000);
        }

        if (!resultImageSrc) {
            log(0, 'TIMEOUT', '⏰ Generation timed out — trying to capture whatever is on screen');
            // Take a screenshot as fallback
            const screenshotPath = path.join(outputDir, `${fileBaseName}_timeout.png`);
            await page.screenshot({ path: screenshotPath, fullPage: false });
            return screenshotPath;
        }

        // Download the image
        const outputPath = path.join(outputDir, `${fileBaseName}.png`);

        if (resultImageSrc.startsWith('data:image')) {
            // Base64 data URL — decode and save
            const base64Data = resultImageSrc.replace(/^data:image\/\w+;base64,/, '');
            fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
        } else if (resultImageSrc.startsWith('blob:')) {
            // Blob URL — need to fetch from page context
            const base64 = await page.evaluate(async (src) => {
                const response = await fetch(src);
                const blob = await response.blob();
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            }, resultImageSrc);

            const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');
            fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
        } else {
            // Regular URL — download via page
            const viewSource = await page.goto(resultImageSrc);
            const buffer = await viewSource.buffer();
            fs.writeFileSync(outputPath, buffer);
            // Navigate back to Whisk
            await page.goto(WHISK_URL, { waitUntil: 'networkidle2' });
            await interruptibleSleep(PAGE_LOAD_DELAY);
        }

        log(0, 'SAVED', `💾 Saved: ${fileBaseName}.png`);
        return outputPath;

    } catch (err) {
        log(0, 'ERROR', `Download failed: ${err.message}`);
        // Fallback: screenshot
        const screenshotPath = path.join(outputDir, `${fileBaseName}_error.png`);
        try { await page.screenshot({ path: screenshotPath, fullPage: false }); } catch (e) { }
        return screenshotPath;
    }
}

/**
 * Reset Whisk inputs for the next generation.
 * Clear uploaded images and prompt text.
 */
async function resetWhiskInputs(page) {
    try {
        // Try clicking "Done", "Close", or clicking outside to dismiss any open panels
        await page.evaluate(() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const text = (b.textContent || '').trim().toLowerCase();
                if (text === 'done' || text === 'close' || text === '×' || text === 'x') {
                    b.click();
                }
            }
            // Click outside to dismiss focus
            document.body.click();
        });
        await interruptibleSleep(500);

        // Clear the prompt textarea
        const textarea = await page.$('textarea');
        if (textarea) {
            await textarea.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
        }

        // Try to clear uploaded images by clicking remove/X/close buttons
        await page.evaluate(() => {
            // Find close/remove buttons near image upload areas
            const allButtons = document.querySelectorAll('button, [role="button"]');
            for (const btn of allButtons) {
                const text = (btn.textContent || '').trim().toLowerCase();
                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

                // Material icon "close", "cancel" or text-based close buttons
                if (text === 'close' || text === 'clear' || text === 'remove' || text === '×' || text === 'x' || text === 'delete' || text === 'cancel' || text === 'highlight_off' ||
                    ariaLabel.includes('remove') || ariaLabel.includes('delete') || ariaLabel.includes('clear')) {

                    // Only click if it's near an image upload area (small button, often square/circular)
                    const rect = btn.getBoundingClientRect();
                    if (rect.width > 0 && rect.width < 60 && rect.height > 0 && rect.height < 60) {
                        btn.click();
                    }
                }
            }
        });

        await interruptibleSleep(1000);
        log(0, 'RESET', '🔄 Whisk inputs cleared for next scene');
    } catch (err) {
        log(0, 'WARN', `Reset warning: ${err.message}`);
    }
}

/**
 * Set the aspect ratio in Whisk before generating.
 * Clicks the aspect ratio button and selects the matching option.
 * 
 * @param {object} page - Puppeteer page
 * @param {string} ratio - "16:9", "9:16", or "1:1"
 */
async function setAspectRatio(page, ratio = '16:9') {
    try {
        // Map our ratio format to Whisk's label text
        const ratioMap = {
            '16:9': 'Landscape',
            '9:16': 'Portrait',
            '1:1': 'Square'
        };
        const targetLabel = ratioMap[ratio] || 'Landscape';

        // Click the aspect ratio button (find by icon text "aspect_ratio")
        const clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                const iconText = (b.textContent || '').trim();
                if (iconText === 'aspect_ratio') {
                    b.click();
                    return true;
                }
            }
            return false;
        });

        if (!clicked) {
            log(0, 'RATIO', `⚠️ Could not find aspect ratio button, using default`);
            return;
        }

        await interruptibleSleep(1000);

        // Click the matching ratio option in the dropdown
        const selected = await page.evaluate((label) => {
            // Find elements containing the target ratio text
            const all = document.querySelectorAll('*');
            for (const el of all) {
                const t = (el.textContent || '').trim();
                // Look for exact match like "16:9" or label like "Landscape"
                if ((t === label || t.includes(label)) && el.tagName !== 'DIV' ||
                    (el.tagName === 'DIV' && t === label)) {
                    // Only click leaf-level elements
                    if (el.children.length === 0 || el.children.length === 1) {
                        el.click();
                        return t;
                    }
                }
            }
            return null;
        }, targetLabel);

        if (selected) {
            log(0, 'RATIO', `📐 Aspect ratio set to: ${ratio} (${targetLabel})`);
        } else {
            // Fallback: try clicking by ratio string directly
            await page.evaluate((r) => {
                const all = document.querySelectorAll('*');
                for (const el of all) {
                    if ((el.textContent || '').trim() === r && el.children.length <= 1) {
                        el.click();
                        return;
                    }
                }
            }, ratio);
            log(0, 'RATIO', `📐 Aspect ratio set to: ${ratio} (fallback)`);
        }

        await interruptibleSleep(500);

    } catch (err) {
        log(0, 'WARN', `Aspect ratio setting failed: ${err.message} — using default`);
    }
}


// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
    generateImagesWhisk,
    setAspectRatio,
    WHISK_SELECTORS,
    WHISK_URL
};
