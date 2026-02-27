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


// ─── Grok Imagine (grok.com/imagine) ───
// Verified Feb 2026 via browser inspection
const GROK = {
    url: 'https://grok.com/imagine',

    // Navigation: sidebar "Imagine" tab or direct /imagine URL
    imagineTab: { text: 'Imagine', tag: 'A' },

    // Settings popover (opened by button in bottom toolbar)
    settingsToggle: 'button[aria-label="Settings"]',    // Shows "Video ˄" or "Image ˄"
    // Popover contains: Video Duration, Resolution, Aspect Ratio, Image/Video mode

    // Inside settings popover:
    // Video Duration
    duration6s: { text: '6s' },                         // free tier
    duration10s: { text: '10s' },                       // premium

    // Video Resolution
    resolution480p: { text: '480p' },                   // free tier
    resolution720p: { text: '720p' },                   // premium

    // Aspect Ratio (5 options with visual rectangles)
    ratios: ['2:3', '3:2', '1:1', '9:16', '16:9'],

    // Video / Image mode toggle (pill buttons at bottom of popover)
    videoMode: { text: 'Video' },
    imageMode: { text: 'Image' },

    // Image upload
    uploadButton: 'button[aria-label="Upload image"]',
    fileInput: 'input[type="file"]',

    // Prompt (TipTap / ProseMirror contenteditable)
    promptEditor: 'div.tiptap.ProseMirror',             // placeholder: "Type to imagine"

    // Submit (↑ arrow button, right of input bar)
    submitButton: 'button[aria-label="Submit"]',

    // Video results
    videoElement: 'video',                              // src: https://assets.grok.com/users/...

    // 3-dots menu on video result
    videoOptionsButton: 'button[aria-label="Video Options"]',
    upscaleItem: { role: 'menuitem', text: 'Upscale' },

    // Download
    downloadButton: 'button[aria-label="Download"]',
};


module.exports = { WHISK, META, GROK };
