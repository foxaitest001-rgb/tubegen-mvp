// ═══════════════════════════════════════════════════════════════
// Session Manager — Cookie-Based Account Authentication
// Stores cookie sessions exported from Cookie-Editor extension
// Injects them into Puppeteer before page.goto() calls
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');

// In-memory store (loaded from disk on init)
let accounts = {
    meta: { cookies: null, verified: false, verifiedAt: null, stats: null },
    grok: { cookies: null, verified: false, verifiedAt: null, stats: null },
    whisk: { cookies: null, verified: false, verifiedAt: null, stats: null }
};

// ─── Service → Domain mapping ───
const SERVICE_DOMAINS = {
    meta: ['.facebook.com', '.meta.ai', '.fbcdn.net', '.instagram.com'],
    grok: ['.x.com', '.twitter.com', '.grok.com'],
    whisk: ['.labs.google', 'labs.google']
};

// ─── Init: Load from disk ───
function init() {
    try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
            const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
            // Restore but mark as unverified (sessions may have expired)
            if (data.meta && data.meta.cookies) {
                accounts.meta = { ...data.meta, verified: false };
            }
            if (data.grok && data.grok.cookies) {
                accounts.grok = { ...data.grok, verified: false };
            }
            if (data.whisk && data.whisk.cookies) {
                accounts.whisk = { ...data.whisk, verified: false };
            }
            console.log('[SessionMgr] ✅ Loaded saved sessions from accounts.json');
        }
    } catch (err) {
        console.log(`[SessionMgr] ⚠️ Could not load accounts.json: ${err.message}`);
    }
}

// ─── Save to disk ───
function saveToDisk() {
    try {
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
    } catch (err) {
        console.error(`[SessionMgr] ❌ Save failed: ${err.message}`);
    }
}

// ═══════════════════════════════════════════════════════════════
// LOAD SESSION — Parse and store Cookie-Editor JSON
// ═══════════════════════════════════════════════════════════════

function loadSession(service, cookieJson) {
    if (!accounts[service]) {
        return { success: false, error: `Unknown service: ${service}` };
    }

    let cookies;
    try {
        cookies = typeof cookieJson === 'string' ? JSON.parse(cookieJson) : cookieJson;
    } catch (err) {
        return { success: false, error: `Invalid JSON: ${err.message}` };
    }

    if (!Array.isArray(cookies) || cookies.length === 0) {
        return { success: false, error: 'Expected a non-empty array of cookies' };
    }

    // Transform Cookie-Editor format → Puppeteer format
    const puppeteerCookies = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        expires: c.expirationDate || -1,
        httpOnly: c.httpOnly || false,
        secure: c.secure || false,
        sameSite: c.sameSite === 'no_restriction' ? 'None' :
            c.sameSite === 'lax' ? 'Lax' :
                c.sameSite === 'strict' ? 'Strict' : 'Lax'
    })).filter(c => c.name && c.value);

    // Calculate stats
    const totalSize = JSON.stringify(puppeteerCookies).length;
    const keyCookies = puppeteerCookies.slice(0, 5).map(c => ({
        name: c.name,
        size: `${(c.value.length / 1024).toFixed(1)}kb`,
        domain: c.domain
    }));

    accounts[service] = {
        cookies: puppeteerCookies,
        verified: false,
        verifiedAt: null,
        loadedAt: new Date().toISOString(),
        stats: {
            count: puppeteerCookies.length,
            totalSize: `${(totalSize / 1024).toFixed(1)}kb`,
            keyCookies,
            domains: [...new Set(puppeteerCookies.map(c => c.domain))]
        }
    };

    saveToDisk();
    console.log(`[SessionMgr] ✅ ${service} session loaded (${puppeteerCookies.length} cookies, ${accounts[service].stats.totalSize})`);

    return {
        success: true,
        stats: accounts[service].stats
    };
}

// ═══════════════════════════════════════════════════════════════
// VERIFY SESSION — Test cookies by navigating in Puppeteer
// ═══════════════════════════════════════════════════════════════

async function verifySession(service, browser) {
    if (!accounts[service] || !accounts[service].cookies) {
        return { success: false, error: 'No session loaded for this service' };
    }

    const testUrls = {
        meta: 'https://www.meta.ai/',
        grok: 'https://grok.com/',
        whisk: 'https://labs.google/fx/tools/whisk'
    };

    const loginIndicators = {
        meta: {
            loggedIn: async (page) => {
                return await page.evaluate(() => {
                    const body = document.body.innerText || '';
                    const hasLogout = body.includes('Log out') || body.includes('Settings');
                    const hasTextbox = !!document.querySelector('[contenteditable="true"]') ||
                        !!document.querySelector('textarea');
                    const noLoginBtn = !body.includes('Log in with Facebook');
                    return hasTextbox || (hasLogout && noLoginBtn);
                });
            }
        },
        grok: {
            loggedIn: async (page) => {
                return await page.evaluate(() => {
                    const body = document.body.innerText || '';
                    const hasEditor = !!document.querySelector('.tiptap') ||
                        !!document.querySelector('[contenteditable="true"]');
                    const noSignIn = !body.includes('Sign in') && !body.includes('sign in');
                    return hasEditor || noSignIn;
                });
            }
        },
        whisk: {
            loggedIn: async (page) => {
                return await page.evaluate(() => {
                    const body = document.body.innerText || '';
                    // Whisk shows project UI when logged in
                    const hasWhiskUI = !!document.querySelector('textarea') ||
                        !!document.querySelector('[contenteditable="true"]') ||
                        body.includes('Create') || body.includes('Subject');
                    const noSignIn = !body.includes('Sign in') && !body.includes('sign in');
                    return hasWhiskUI && noSignIn;
                });
            }
        }
    };

    let page = null;
    try {
        page = await browser.newPage();

        // Inject cookies BEFORE navigating
        await page.setCookie(...accounts[service].cookies);
        console.log(`[SessionMgr] 🍪 Injected ${accounts[service].cookies.length} cookies for ${service}`);

        // Navigate to the service
        await page.goto(testUrls[service], { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000)); // Wait for page to settle

        // Check if logged in
        const isLoggedIn = await loginIndicators[service].loggedIn(page);

        accounts[service].verified = isLoggedIn;
        accounts[service].verifiedAt = new Date().toISOString();
        saveToDisk();

        // Close test page
        await page.close();

        if (isLoggedIn) {
            console.log(`[SessionMgr] ✅ ${service} session VERIFIED — logged in!`);
            return { success: true, verified: true };
        } else {
            console.log(`[SessionMgr] ⚠️ ${service} session NOT valid — not logged in`);
            return { success: true, verified: false, message: 'Cookies loaded but login not detected. Try re-exporting.' };
        }

    } catch (err) {
        if (page) await page.close().catch(() => { });
        console.error(`[SessionMgr] ❌ Verify failed for ${service}: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// ═══════════════════════════════════════════════════════════════
// INJECT COOKIES — Called by directors before page.goto()
// ═══════════════════════════════════════════════════════════════

async function injectCookies(page, service) {
    if (!accounts[service] || !accounts[service].cookies) {
        console.log(`[SessionMgr] ⚠️ No cookies for ${service}, skipping injection`);
        return false;
    }

    try {
        await page.setCookie(...accounts[service].cookies);
        console.log(`[SessionMgr] 🍪 Injected ${accounts[service].cookies.length} cookies for ${service}`);
        return true;
    } catch (err) {
        console.error(`[SessionMgr] ❌ Cookie injection failed for ${service}: ${err.message}`);
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════
// STATUS + REMOVE
// ═══════════════════════════════════════════════════════════════

function getStatus() {
    const status = {};
    for (const [service, data] of Object.entries(accounts)) {
        status[service] = {
            loaded: !!data.cookies,
            verified: data.verified,
            verifiedAt: data.verifiedAt,
            loadedAt: data.loadedAt || null,
            stats: data.stats || null
        };
    }
    return status;
}

function getServiceStatus(service) {
    if (!accounts[service]) return null;
    const data = accounts[service];
    return {
        loaded: !!data.cookies,
        verified: data.verified,
        verifiedAt: data.verifiedAt,
        loadedAt: data.loadedAt || null,
        stats: data.stats || null
    };
}

function removeSession(service) {
    if (!accounts[service]) {
        return { success: false, error: `Unknown service: ${service}` };
    }
    accounts[service] = { cookies: null, verified: false, verifiedAt: null, stats: null };
    saveToDisk();
    console.log(`[SessionMgr] 🗑️ ${service} session removed`);
    return { success: true };
}

// ─── Initialize on require ───
init();

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
    loadSession,
    verifySession,
    injectCookies,
    getStatus,
    getServiceStatus,
    removeSession
};
