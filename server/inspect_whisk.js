const puppeteer = require('puppeteer');

const COOKIES = [
    { name: "EMAIL", value: "%22foxaitest001%40gmail.com%22", domain: "labs.google", path: "/", expires: 1774626119, httpOnly: false, secure: false, sameSite: "Lax" },
    { name: "__Host-next-auth.csrf-token", value: "da1fb1f395f6a9c3e58755d22ee17a9d4d3b42d0e29a80086012f69584f2b664%7Cb92f166812e113f759a4bc1ea72472ca6e5eb8f26b31be5810b89177e8f2ff09", domain: "labs.google", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    { name: "__Secure-next-auth.callback-url", value: "https%3A%2F%2Flabs.google%2Ffx%2Ftools%2Fwhisk%2Fproject%2F6175e526-fb6d-4ff3-881d-e35ed90cfff0", domain: "labs.google", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" },
    { name: "__Secure-next-auth.session-token", value: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..4Y24xSS_nGIJgwNx.JoVmT7OlpxqdQv4tc0axBqunNxIG_iJjaI8dseXmnlPabyeIY_76R-1u_fXBHMZu6QnEh7qAtM8LOnskascc825E2A46RhOw96Kbyvi5f130RniX1cyuZyMvYGJ1Cx03k2PTysXswwnlIYOXlGox4vua3ci2fzsgg9YxpgBGFqH7ZQ0-9Lf0MdJTnWS9LxTs_6bQl69XF3VDuGP54D6x_TQ4kmFbkcQN-79hWrOFDaukKP3cuT4P8N3wcVW7DET3A8izh0Kt96kSqgpOMo0QA5Xp2PLKyEbYjNrf31bxV8ifOsTeqq2MJZ5xXE_dhM0pkhK2l4n8aYOMLpt8RWp2uEyIOKw8dKJ79GfUOwKXJttjK4tMFRfF-1OUKsVopCXTaoyQaSdr7Uy9x0emd5hOe7EBpmlVOw5oSNCWLLG1rGWWfXrUydODh5D-2TqGxVzu55-ReQVYs8oZGCtaF2UxAC3obnTwrRzl68g5sU77D_6D7HkxBIua-5CCBTtX3Lqe7uYfYY-95B0AA6a4rddvGnDAsd7c7qAL4A792L29YHLJ6TJqVmOULhCPjCshB2hAdXfjC5Rue4m9btkpCxcWInRM_nrW1wcHE4RhRcPeXr0cvJAFWPRG9S05DUfey4EAYWE7RM_YuGdO7n4WWTp9p_qG9wI5-_x34SDGGuV8XW459BYAtaiJYjGY2XasICZ2aqQ8T3cvwDX5q_lgrjMk8ASw3oxcZ-h4gk_sFBnoTKAoBMoXBUBZv8Ch4OMNxT_3E10e5H1T8VWFHWC7CvR0WnjNRfiZMPCmC9xRjNQEP0QNQmrzKsJxw7CEoXemQL7h-pg6hQQ95A3ZetmJ3VACuZHu2-CjfJ14ByYnRQ0VrmUJ_lIyw9f6axrtRkIG4TwTAFQN1Go2-GBQbvoPJQh0WvOW33selWAcP7HyL9UGl1g6dzEEkC7-A_QkeOwru9LzpQQ33oMdpJgW8Qj32YwGDpSv3mtDVn4pYQxs.q4oxjpvz1_NCM33Mk61V1A", domain: "labs.google", path: "/", expires: 1774815596.594214, httpOnly: true, secure: true, sameSite: "Lax" },
    { name: "_ga", value: "GA1.1.307442317.1758196293", domain: ".labs.google", path: "/", expires: 1806783074.318486, httpOnly: false, secure: false, sameSite: "Lax" },
    { name: "_ga_5K7X2T4V16", value: "GS2.1.s1762470230$o1$g0$t1762470232$j58$l0$h0", domain: ".labs.google", path: "/", expires: 1797030232.901953, httpOnly: false, secure: false, sameSite: "Lax" },
    { name: "_ga_X2GNH8R5NS", value: "GS2.1.s1772223067$o82$g1$t1772223075$j52$l0$h1177905443", domain: ".labs.google", path: "/", expires: 1806783075.835924, httpOnly: false, secure: false, sameSite: "Lax" },
    { name: "email", value: "foxaitest001%40gmail.com", domain: "labs.google", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }
];

(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1400, height: 900 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    console.log('Injecting cookies...');
    await page.setCookie(...COOKIES);

    console.log('Navigating to Whisk...');
    await page.goto('https://labs.google/fx/tools/whisk', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 5000));

    console.log('Current URL:', page.url());

    // Step 1: Click "Enter tool" button to get into the creation UI
    console.log('Looking for "Enter tool" button...');
    const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {
            const text = (b.textContent || '').trim().toLowerCase();
            if (text.includes('enter tool') || text.includes('enter')) {
                b.click();
                return b.textContent.trim();
            }
        }
        return null;
    });
    console.log('Clicked:', clicked);

    // Wait for the tool to load
    await new Promise(r => setTimeout(r, 8000));
    console.log('After click URL:', page.url());

    // Take screenshot of the creation UI
    await page.screenshot({ path: 'whisk_ui_2.png', fullPage: false });
    console.log('Screenshot saved: whisk_ui_2.png');

    // Dump all interactive elements in the actual creation UI
    const elements = await page.evaluate(() => {
        const result = { url: window.location.href, elements: {} };

        // Textareas
        result.elements.textareas = [...document.querySelectorAll('textarea')].map(el => ({
            placeholder: el.placeholder,
            className: el.className.substring(0, 80),
            id: el.id,
            name: el.name,
            rows: el.rows,
            visible: el.getBoundingClientRect().width > 0,
            rect: { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) },
            ariaLabel: el.getAttribute('aria-label'),
            parentTag: el.parentElement?.tagName,
            parentClass: (el.parentElement?.className || '').substring(0, 60)
        }));

        // Contenteditable
        result.elements.contenteditables = [...document.querySelectorAll('[contenteditable="true"]')].map(el => ({
            tag: el.tagName,
            className: el.className.substring(0, 60),
            text: el.textContent.substring(0, 80),
            visible: el.getBoundingClientRect().width > 0,
            rect: { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }
        }));

        // Visible buttons
        result.elements.buttons = [...document.querySelectorAll('button')].map(el => ({
            text: el.textContent.trim().substring(0, 80),
            ariaLabel: el.getAttribute('aria-label'),
            visible: el.getBoundingClientRect().width > 0,
            rect: { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }
        })).filter(b => b.visible && b.rect.w > 10);

        // File inputs
        result.elements.fileInputs = [...document.querySelectorAll('input[type="file"]')].map(el => ({
            accept: el.accept,
            className: el.className.substring(0, 50),
            multiple: el.multiple,
            id: el.id
        }));

        // Text inputs
        result.elements.textInputs = [...document.querySelectorAll('input[type="text"], input:not([type])')].map(el => ({
            placeholder: el.placeholder,
            className: el.className.substring(0, 50),
            type: el.type,
            visible: el.getBoundingClientRect().width > 0
        })).filter(i => i.visible);

        // H4 headers
        result.elements.h4s = [...document.querySelectorAll('h4')].map(el => ({
            text: el.textContent.trim(),
            visible: el.getBoundingClientRect().width > 0
        })).filter(h => h.visible);

        // H3 headers
        result.elements.h3s = [...document.querySelectorAll('h3')].map(el => ({
            text: el.textContent.trim(),
            visible: el.getBoundingClientRect().width > 0
        })).filter(h => h.visible);

        // Labels
        result.elements.labels = [...document.querySelectorAll('label')].map(el => ({
            text: el.textContent.trim(),
            htmlFor: el.htmlFor,
            visible: el.getBoundingClientRect().width > 0
        })).filter(l => l.visible);

        // Body text preview
        result.bodyPreview = document.body.innerText.substring(0, 1000);

        return result;
    });

    console.log('\n======= WHISK CREATION UI ELEMENTS =======');
    console.log(JSON.stringify(elements, null, 2));

    await new Promise(r => setTimeout(r, 3000));
    await browser.close();
    console.log('\nDone!');
})();
