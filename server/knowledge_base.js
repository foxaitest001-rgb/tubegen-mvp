/**
 * FoxTubeGen V5 — Knowledge Base Module
 * ─────────────────────────────────────────
 * Loads structured creative intelligence from JSON knowledge files
 * (converted from the structure/ reference data) and provides
 * query functions for the Consultant and Director.
 *
 * This module extracts METHODOLOGY only — the creative approach,
 * script structures, visual styles, camera/lighting keywords —
 * and maps everything to FoxTubeGen's own tools:
 *   Script → Gemini  |  Images → Whisk  |  Video → Meta.ai/Grok I2V
 *   Voice → Piper TTS  |  Assembly → FFmpeg
 */

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');

// ─── Load Knowledge Files ───────────────────────────────────────────

function loadJSON(filename) {
    try {
        const filePath = path.join(KNOWLEDGE_DIR, filename);
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
        console.warn(`[KnowledgeBase] ⚠️ Could not load ${filename}: ${err.message}`);
        return [];
    }
}

const CAMERA_SHOTS = loadJSON('camera_shots.json');
const LIGHTING_STYLES = loadJSON('lighting_styles.json');
const VISUAL_STYLES = loadJSON('visual_styles.json');
const CHANNEL_WORKFLOWS = loadJSON('channel_workflows.json');
const CINEMATIC_FRAMEWORK = loadJSON('cinematic_framework.json');
const SHOT_LIST_EXAMPLES = loadJSON('shot_list_examples.json');
const THUMBNAIL_RULES = loadJSON('thumbnail_rules.json');
const PLATFORMS = loadJSON('platforms.json');

// ─── Index Maps ─────────────────────────────────────────────────────

// Camera shots indexed by type (lowercase)
const cameraIndex = {};
for (const shot of CAMERA_SHOTS) {
    cameraIndex[shot.shot_type.toLowerCase()] = shot;
}

// Lighting styles indexed by name (lowercase)
const lightingIndex = {};
for (const light of LIGHTING_STYLES) {
    lightingIndex[light.style.toLowerCase()] = light;
}

// Visual styles indexed by name and aliases (lowercase)
const styleIndex = {};
for (const style of VISUAL_STYLES) {
    styleIndex[style.name.toLowerCase()] = style;
    if (style.id) styleIndex[style.id.toLowerCase()] = style;
    if (style.aliases) {
        for (const alias of style.aliases.split(/[;,]\s*/)) {
            if (alias.trim()) styleIndex[alias.trim().toLowerCase()] = style;
        }
    }
}

// Channel workflows indexed by key and name (lowercase)
const channelIndex = {};
for (const [key, workflow] of Object.entries(CHANNEL_WORKFLOWS)) {
    channelIndex[key.toLowerCase()] = workflow;
    channelIndex[workflow.name.toLowerCase()] = workflow;
    // Also index by short name
    const shortName = workflow.name.replace(/\s*style$/i, '').toLowerCase();
    channelIndex[shortName] = workflow;
}

// Cinematic framework indexed by element name (lowercase)
const frameworkIndex = {};
for (const el of CINEMATIC_FRAMEWORK) {
    frameworkIndex[el.element.toLowerCase()] = el;
}

// ─── Query Functions ────────────────────────────────────────────────

/**
 * Get camera shot info by type name.
 * @param {string} type - e.g. "close-up", "wide establishing shot"
 * @returns {object|null} { shot_type, keywords[], narrative_impact }
 */
function getCameraShot(type) {
    if (!type) return null;
    const key = type.toLowerCase().trim();
    // Exact match
    if (cameraIndex[key]) return cameraIndex[key];
    // Partial match
    for (const [k, v] of Object.entries(cameraIndex)) {
        if (k.includes(key) || key.includes(k)) return v;
    }
    return null;
}

/**
 * Get all camera shots.
 * @returns {object[]}
 */
function getAllCameraShots() {
    return CAMERA_SHOTS;
}

/**
 * Get lighting style info by name.
 * @param {string} style - e.g. "golden hour", "film noir"
 * @returns {object|null} { style, keywords[], visual_effect }
 */
function getLighting(style) {
    if (!style) return null;
    const key = style.toLowerCase().trim();
    if (lightingIndex[key]) return lightingIndex[key];
    for (const [k, v] of Object.entries(lightingIndex)) {
        if (k.includes(key) || key.includes(k)) return v;
    }
    return null;
}

/**
 * Get all lighting styles.
 * @returns {object[]}
 */
function getAllLightingStyles() {
    return LIGHTING_STYLES;
}

/**
 * Get visual style by name, alias, or ID.
 * @param {string} name - e.g. "cyberpunk", "noir", "hollywood"
 * @returns {object|null} Full style object with prompts, modifiers, etc.
 */
function getVisualStyle(name) {
    if (!name) return null;
    const key = name.toLowerCase().trim();
    if (styleIndex[key]) return styleIndex[key];
    for (const [k, v] of Object.entries(styleIndex)) {
        if (k.includes(key) || key.includes(k)) return v;
    }
    return null;
}

/**
 * Get visual styles by category.
 * @param {string} category - e.g. "Cinematic", "Digital Art"
 * @returns {object[]}
 */
function getStylesByCategory(category) {
    if (!category) return VISUAL_STYLES;
    const cat = category.toLowerCase();
    return VISUAL_STYLES.filter(s =>
        s.category.toLowerCase().includes(cat)
    );
}

/**
 * Get all visual styles (names + descriptions for listing).
 * @returns {object[]}
 */
function getAllVisualStyles() {
    return VISUAL_STYLES.map(s => ({
        name: s.name,
        category: s.category,
        description: s.description,
        use_cases: s.use_cases
    }));
}

/**
 * Get channel workflow by archetype name.
 * @param {string} name - e.g. "zinny studio", "kurzgesagt", "llama arts"
 * @returns {object|null} Full workflow with methodology + steps
 */
function getChannelWorkflow(name) {
    if (!name) return null;
    const key = name.toLowerCase().trim();
    if (channelIndex[key]) return channelIndex[key];
    for (const [k, v] of Object.entries(channelIndex)) {
        if (k.includes(key) || key.includes(k)) return v;
    }
    return null;
}

/**
 * Get all channel workflow names for listing.
 * @returns {object[]}
 */
function getAllChannelWorkflows() {
    return Object.entries(CHANNEL_WORKFLOWS).map(([id, wf]) => ({
        id,
        name: wf.name,
        niche: wf.niche,
        character_type: wf.character_type
    }));
}

/**
 * Get thumbnail optimization rules.
 * @returns {object[]}
 */
function getThumbnailRules() {
    return THUMBNAIL_RULES;
}

/**
 * Get cinematic framework element by name.
 * @param {string} element - e.g. "Act I", "Focal Length", "Motivated Realism"
 * @returns {object|null}
 */
function getFrameworkElement(element) {
    if (!element) return null;
    const key = element.toLowerCase().trim();
    if (frameworkIndex[key]) return frameworkIndex[key];
    for (const [k, v] of Object.entries(frameworkIndex)) {
        if (k.includes(key) || key.includes(k)) return v;
    }
    return null;
}

// ─── Prompt Enrichment Functions ────────────────────────────────────

/**
 * Build an enriched consultant system prompt section based on channel style.
 * This is injected into the Gemini system prompt when the user selects
 * a channel archetype so the consultant asks the right questions and
 * writes scripts in the right format.
 *
 * @param {string} channelStyle - Channel archetype name
 * @returns {string} System prompt section to inject
 */
function buildConsultantContext(channelStyle) {
    const workflow = getChannelWorkflow(channelStyle);
    if (!workflow) {
        return ''; // No specific channel knowledge
    }

    const lines = [
        `\n=== CHANNEL STYLE INTELLIGENCE: ${workflow.name} ===`,
        `Niche: ${workflow.niche}`,
        `Visual Style: ${workflow.visual_style}`,
        ``,
        `SCRIPT STRUCTURE (follow this format):`,
        `${workflow.script_structure}`,
        ``,
        `NARRATION TONE:`,
        `${workflow.narration_tone}`,
        ``,
        `CHARACTER TYPE:`,
        `${workflow.character_type}`,
        ``,
        `QUESTIONS TO ASK THE USER:`,
        ...workflow.workflow_questions.map((q, i) => `  ${i + 1}. ${q}`),
        ``,
        `VISUAL KEYWORDS (use in image prompts):`,
        `  ${workflow.style_keywords.join(', ')}`,
        ``,
        `DEFAULT CAMERA: ${workflow.camera_defaults.join(', ')}`,
        `DEFAULT LIGHTING: ${workflow.lighting_defaults.join(', ')}`,
        `=== END CHANNEL INTELLIGENCE ===\n`
    ];

    return lines.join('\n');
}

/**
 * Build a complete style guide section for the consultant prompt.
 * Lists all available channel styles so the consultant can suggest options.
 *
 * @returns {string} System prompt section listing all styles
 */
function buildStyleMenu() {
    const workflows = getAllChannelWorkflows();
    const lines = [
        `\n=== AVAILABLE CHANNEL STYLES ===`,
        `You can suggest these proven channel archetypes to the user:`,
        ``
    ];
    for (const wf of workflows) {
        lines.push(`• ${wf.name} — ${wf.niche} (${wf.character_type})`);
    }
    lines.push(`\nWhen the user picks a style, use its specific methodology for script structure, tone, and visual keywords.`);
    lines.push(`=== END STYLE MENU ===\n`);
    return lines.join('\n');
}

/**
 * Enrich a scene image prompt with camera/lighting/style knowledge.
 * Used by the Whisk Director to generate better scene images.
 *
 * @param {object} scene - Scene object from narrative generator
 * @param {string} scene.scene_type - e.g. "establishing", "action", "emotional"
 * @param {string} scene.mood - e.g. "tense", "hopeful", "dark"
 * @param {string} scene.image_prompt - Original image prompt from Gemini
 * @param {string} [visualStyle] - Optional visual style name
 * @param {string} [channelStyle] - Optional channel archetype name
 * @returns {object} { enrichedPrompt, negativePrompt, cameraKeywords, lightingKeywords }
 */
function enrichScenePrompt(scene, visualStyle, channelStyle) {
    const parts = [];
    const cameraKeywords = [];
    const lightingKeywords = [];
    let negativePrompt = '';

    // Start with original prompt
    if (scene.image_prompt) {
        parts.push(scene.image_prompt);
    }

    // Add visual style intelligence
    const style = getVisualStyle(visualStyle);
    if (style) {
        // Add style modifiers
        if (style.style_modifiers) {
            parts.push(style.style_modifiers);
        }
        // Add key visual features
        if (style.key_features) {
            parts.push(style.key_features);
        }
        // Set negative prompt
        if (style.negative_prompt && style.negative_prompt !== 'Not in source') {
            negativePrompt = style.negative_prompt;
        }
    }

    // Add channel style defaults
    const workflow = getChannelWorkflow(channelStyle);
    if (workflow) {
        cameraKeywords.push(...workflow.camera_defaults);
        lightingKeywords.push(...workflow.lighting_defaults);
        // Add style keywords
        parts.push(workflow.style_keywords.join(', '));
    }

    // Map scene type to camera shot
    const sceneTypeToCamera = {
        'establishing': 'wide establishing shot',
        'action': 'medium shot',
        'emotional': 'close-up',
        'climax': 'extreme close-up',
        'transition': 'bird\'s-eye view',
        'dialogue': 'over-the-shoulder shot',
        'reveal': 'low-angle shot',
        'tension': 'dutch angle',
        'conclusion': 'full shot'
    };

    const cameraType = sceneTypeToCamera[scene.scene_type?.toLowerCase()] || 'medium shot';
    const cameraInfo = getCameraShot(cameraType);
    if (cameraInfo) {
        cameraKeywords.push(...cameraInfo.keywords);
    }

    // Map mood to lighting
    const moodToLighting = {
        'tense': 'low key',
        'dark': 'film noir',
        'hopeful': 'golden hour',
        'dramatic': 'rim lighting',
        'professional': 'soft box',
        'bright': 'high key',
        'mysterious': 'film noir',
        'eerie': 'low key',
        'warm': 'golden hour',
        'cosmic': 'high key',
        'scary': 'low key'
    };

    const lightingType = moodToLighting[scene.mood?.toLowerCase()] || 'high key';
    const lightingInfo = getLighting(lightingType);
    if (lightingInfo) {
        lightingKeywords.push(...lightingInfo.keywords);
    }

    // Add camera and lighting keywords to prompt
    if (cameraKeywords.length > 0) {
        parts.push(cameraKeywords.join(', '));
    }
    if (lightingKeywords.length > 0) {
        parts.push(lightingKeywords.join(', '));
    }

    return {
        enrichedPrompt: parts.join(', '),
        negativePrompt,
        cameraKeywords,
        lightingKeywords
    };
}

/**
 * Enrich a motion prompt for I2V generation with cinematic movement knowledge.
 * Used by Meta.ai and Grok I2V Directors.
 *
 * @param {object} scene - Scene object
 * @param {string} [visualStyle] - Visual style name
 * @returns {string} Enriched motion prompt
 */
function enrichMotionPrompt(scene, visualStyle) {
    const parts = [];

    // Add base motion from scene
    if (scene.motion_prompt) {
        parts.push(scene.motion_prompt);
    }

    // Add style-specific motion characteristics
    const style = getVisualStyle(visualStyle);
    if (style && style.motion && style.motion !== 'Not in source') {
        parts.push(style.motion);
    }

    // Add rendering quality
    if (style && style.rendering && style.rendering !== 'Not in source') {
        parts.push(style.rendering);
    }

    return parts.join(', ');
}

/**
 * Get a summary of all loaded knowledge for diagnostic/logging purposes.
 * @returns {object}
 */
function getKnowledgeSummary() {
    return {
        camera_shots: CAMERA_SHOTS.length,
        lighting_styles: LIGHTING_STYLES.length,
        visual_styles: VISUAL_STYLES.length,
        channel_workflows: Object.keys(CHANNEL_WORKFLOWS).length,
        cinematic_framework: CINEMATIC_FRAMEWORK.length,
        shot_list_examples: SHOT_LIST_EXAMPLES.length,
        thumbnail_rules: THUMBNAIL_RULES.length,
        platforms: PLATFORMS.length
    };
}

// ─── Startup Log ────────────────────────────────────────────────────
const summary = getKnowledgeSummary();
console.log(`[KnowledgeBase] ✅ Loaded: ${summary.camera_shots} camera shots, ${summary.lighting_styles} lighting styles, ${summary.visual_styles} visual styles, ${Object.keys(CHANNEL_WORKFLOWS).length} channel workflows, ${summary.cinematic_framework} cinematic elements`);

// ─── Exports ────────────────────────────────────────────────────────
module.exports = {
    // Query functions
    getCameraShot,
    getAllCameraShots,
    getLighting,
    getAllLightingStyles,
    getVisualStyle,
    getStylesByCategory,
    getAllVisualStyles,
    getChannelWorkflow,
    getAllChannelWorkflows,
    getThumbnailRules,
    getFrameworkElement,

    // Enrichment functions
    buildConsultantContext,
    buildStyleMenu,
    enrichScenePrompt,
    enrichMotionPrompt,

    // Diagnostics
    getKnowledgeSummary
};
