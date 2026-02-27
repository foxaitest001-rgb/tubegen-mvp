// ═══════════════════════════════════════════════════════════════
// DOM Selectors Reference — Discovered via Console Inspection
// Last Updated: 2026-02-16
// Used by: whisk_director.js, meta_i2v_director.js, grok_i2v_director.js
// ═══════════════════════════════════════════════════════════════

// ─── Google Labs Whisk (labs.google/fx/tools/whisk) ───
const WHISK = {
    url: 'https://labs.google/fx/tools/whisk',

    // File upload inputs (3 in order: Subject, Scene, Style)
    fileInput: 'input.sc-cd7e4875-0',
    slotLabel: 'h4.sc-10ad0ca3-3',
    slotContainer: '.sc-52570d98-0',

    // Prompt
    promptTextarea: 'textarea.sc-18deeb1d-8',

    // Submit
    submitButton: 'button[aria-label="Submit prompt"]',

    // Add Images panel
    addImagesButton: '.sc-63569c0e-0',

    // Bottom bar buttons (differentiate by inner icon text)
    // Aspect ratio: icon text "aspect_ratio", class "sc-8b6c1c1e-1 gyhlCg"
    // Settings:     icon text "tune",         class "sc-8b6c1c1e-1 gyhlCg"
    // IFL (random): class "sc-18b71c06-0"
    aspectRatioDropdown: '.sc-8b6c1c1e-0',     // dropdown container
    // Options inside dropdown: "1:1 Square", "9:16 Portrait", "16:9 Landscape"
};


// ─── Meta.ai Create (/media page) ───
// Verified Feb 2026 via browser inspection
const META = {
    url: 'https://www.meta.ai/media',

    // Sidebar navigation
    createButton: { text: 'Create' },       // Navigates to /media

    // Mode toggle: Image ↔ Video (dropdown via combobox)
    modeDropdown: 'button[role="combobox"]',  // Shows "Image" or "Video"
    // Options when dropdown open: "Image", "Video"
    // In Video mode: placeholder changes to "Describe your animation..."
    //                submit button changes to "Animate"
    //                aspect ratio selector DISAPPEARS

    // Aspect ratio (dropdown via combobox, Image mode only)
    ratioDropdown: 'button[role="combobox"]', // Shows "1:1", "9:16", "16:9"
    // Note: 2nd combobox in toolbar (after mode dropdown)

    // Image upload
    fileInput: 'input[type="file"]',

    // Prompt input
    promptInput: 'div[role="textbox"]',      // placeholder: "Describe your image/animation..."

    // Submit buttons
    animateButton: { text: 'Animate' },      // Video mode (blue button)
    sendButton: 'button[aria-label="Send"]', // Image mode (blue circle)

    // Video results
    videoElement: 'video',                   // src: https://video-*.fbcdn.net/...

    // Download
    downloadButton: 'button[aria-label="Download"]',
};


// ─── Grok Imagine (grok.com) ───
const GROK = {
    url: 'https://grok.com',

    // Navigation: sidebar tabs
    imagineTab: { text: 'Imagine', tag: 'A', dataState: 'closed' },

    // Settings dropdown (opened by a button)
    settingsToggle: 'button[aria-label="Options"]',    // opens the dropdown
    settingsDropdown: '[data-state="open"]',            // the open dropdown container

    // Inside settings dropdown:
    // Video Duration
    duration6s: 'button[aria-label="6s"]',             // free tier
    duration10s: 'button[aria-label="10s"]',            // premium

    // Video Resolution
    resolution480p: 'button[aria-label="480p"]',        // free tier
    resolution720p: 'button[aria-label="720p"]',        // premium

    // Aspect Ratio (inside dropdown)
    ratio_2_3: 'button[aria-label="2:3"]',
    ratio_3_2: 'button[aria-label="3:2"]',
    ratio_1_1: 'button[aria-label="1:1"]',
    ratio_9_16: 'button[aria-label="9:16"]',
    ratio_16_9: 'button[aria-label="16:9"]',

    // Video / Image mode toggle (inside dropdown)
    videoMode: { text: 'Video', description: 'Generate a video', selector: 'span.font-semibold' },
    imageMode: { text: 'Image', description: 'Generate multiple images', selector: 'span.font-semibold' },

    // Image upload
    uploadButton: 'button[aria-label="Upload image"]',
    fileInput: 'input[type="file"].hidden',             // accept: image/*

    // Prompt (TipTap / ProseMirror contenteditable)
    promptEditor: 'div.tiptap.ProseMirror',

    // Submit
    submitButton: 'button[aria-label="Submit"]',        // round submit button

    // Video results
    videoElement: 'video',                              // class: "col-start-1 row-start-1 w-full h-full object-cover"
    // src pattern: https://assets.grok.com/users/.../generated/.../genera...

    // 3-dots menu on video result
    videoOptionsButton: 'button[aria-label="Video Options"]',
    // Menu items (role="menuitem"):
    upscaleItem: { role: 'menuitem', text: 'Upscale' },

    // Download
    downloadButton: 'button[aria-label="Download"]',   // text: "Download image"
};


module.exports = { WHISK, META, GROK };
