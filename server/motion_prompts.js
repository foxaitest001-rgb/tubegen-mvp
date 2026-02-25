// ═══════════════════════════════════════════════════════════════
// Motion Prompts Module — Camera Movement Library for I2V
// Maps scene_type + mood → cinematic camera movements
// Used by both Meta.ai and Grok I2V Directors
// ═══════════════════════════════════════════════════════════════

/**
 * Camera movement library organized by scene type.
 * Each category contains an array of motion descriptions
 * that will be appended to the scene image when sent to I2V.
 */
const MOTION_LIBRARY = {

    // ─── Establishing / Landscape Shots ───
    establishing: {
        default: [
            "slow aerial pan across the landscape, cinematic and sweeping",
            "wide dolly shot revealing the full environment, smooth and steady",
            "gentle crane shot ascending to reveal the panorama, golden hour light",
            "slow lateral tracking shot across the scenery, shallow depth of field",
            "smooth drone flyover, gradually descending toward the subject"
        ],
        epic: [
            "dramatic sweeping aerial pan with clouds, epic scale, Hans Zimmer vibes",
            "slow-motion crane reveal from ground level to vast vista, golden light",
            "wide orbiting shot around the landscape, majestic and grand"
        ],
        mysterious: [
            "slow creeping dolly through fog-covered terrain, eerie atmosphere",
            "subtle push-in through mist, shadows shifting, tension building",
            "lateral drift through a dimly lit environment, unsettling stillness"
        ],
        dark: [
            "slow descending crane into darkness, shadows consuming the frame",
            "ominous lateral tracking through storm-lit landscape, low rumble",
            "distant wide shot, subtle zoom through rain and haze"
        ],
        uplifting: [
            "soaring ascending crane shot, golden sunlight breaking through",
            "wide sweeping pan catching lens flare, hopeful and warm",
            "gentle rise from ground level to reveal sunrise over landscape"
        ]
    },

    // ─── Character Close-Ups & Medium Shots ───
    character: {
        default: [
            "subtle push-in on the character, shallow depth of field, intimate",
            "slow zoom into the character's face, eyes in sharp focus",
            "gentle dolly-in with bokeh background, character fills the frame",
            "static medium shot with subtle breathing motion, cinematic"
        ],
        epic: [
            "dramatic low-angle push-in, hero shot with wind in hair/clothing",
            "slow-motion zoom into determined eyes, power and resolve",
            "orbiting close-up, character silhouetted against dramatic sky"
        ],
        mysterious: [
            "slow reveal push-in from shadows, face half-lit, suspense building",
            "subtle focus pull from background to character, tension",
            "creeping lateral slide revealing the character's profile, dim light"
        ],
        dark: [
            "jarring slow zoom into haunted expression, desaturated tones",
            "slight dutch-angle push-in, unease and discomfort",
            "close-up with flickering light casting shadows across the face"
        ],
        comedic: [
            "quick snap zoom to surprised expression, punchy and fun",
            "playful dolly-in with head tilt, bright lighting, energetic",
            "slow-motion reaction shot for comedic timing"
        ],
        emotional: [
            "very slow push-in to glistening eyes, soft warm lighting, intimate",
            "gentle pull-back revealing isolation, melancholy atmosphere",
            "handheld subtle sway, raw and personal, shallow depth of field"
        ]
    },

    // ─── Action & Movement Scenes ───
    action: {
        default: [
            "dynamic tracking shot following rapid movement, handheld energy",
            "fast lateral tracking with motion blur, adrenaline rush",
            "whip pan between elements of action, intense pacing"
        ],
        epic: [
            "high-speed tracking with Dutch angle, explosive energy",
            "slow-motion impact moment, debris floating, time frozen",
            "sweeping crane shot following a charge, orchestral energy"
        ],
        dark: [
            "shaky handheld chase through narrow space, claustrophobic",
            "quick cuts with strobe lighting, disorienting and intense",
            "POV shot rushing through darkness, heart-pounding"
        ]
    },

    // ─── Dialogue & Conversation Scenes ───
    dialogue: {
        default: [
            "gentle lateral sway, soft focus shift, conversational intimacy",
            "static medium shot with subtle natural movement, warm tones",
            "slow alternating focus pull between near and far elements"
        ],
        emotional: [
            "very slow push-in during key emotional beat, tears or revelation",
            "pull-back from intense close-up, isolating the character",
            "handheld gentle sway conveying vulnerability"
        ],
        mysterious: [
            "slow orbit around conversation, shadows shifting on faces",
            "low-angle static shot, power dynamics visible in framing",
            "subtle creep-in as tension in dialogue escalates"
        ]
    },

    // ─── Transition / Bridge Scenes ───
    transition: {
        default: [
            "smooth crane shot ascending above the scene, time passing",
            "lateral dolly transitioning between environments, seamless",
            "slow fade-through with gentle camera drift, dreamlike"
        ],
        epic: [
            "dramatic crane rising into clouds, sweeping orchestral energy",
            "fast-moving aerial shot bridging two locations, momentum"
        ],
        dark: [
            "slow descent into darkness, scene dissolving into shadows",
            "ominous lateral drift as scene transitions, dread building"
        ]
    },

    // ─── Multi-Character Scenes ───
    multi_character: {
        default: [
            "tracking shot from one character to the other, tension or connection",
            "slow orbit around the group, revealing relationships",
            "alternating focus pull between characters, dialogue rhythm"
        ],
        epic: [
            "sweeping crane revealing all characters in formation, unity",
            "slow-motion group moment, each face catching light in turn"
        ],
        confrontation: [
            "slow push-in on the space between characters, growing tension",
            "low-angle alternating between faces, power struggle visible",
            "orbiting shot tightening around the confrontation"
        ]
    }
};

/**
 * Get a motion prompt for a scene based on its type and mood.
 * 
 * @param {string} sceneType - "establishing" | "character" | "action" | "dialogue" | "transition" | "multi_character"
 * @param {string} mood - "epic" | "mysterious" | "dark" | "uplifting" | "comedic" | "emotional" | etc.
 * @param {string|null} existingMotionPrompt - If the script already has a motion prompt, use it
 * @returns {string} A motion prompt for I2V generation
 */
function getMotionPrompt(sceneType = 'establishing', mood = 'default', existingMotionPrompt = null) {
    // If the script generator already provided a motion prompt, prefer it
    if (existingMotionPrompt && existingMotionPrompt.length > 10) {
        return existingMotionPrompt;
    }

    const category = MOTION_LIBRARY[sceneType] || MOTION_LIBRARY.establishing;
    const moodKey = mood.toLowerCase();

    // Try mood-specific, fall back to default
    const options = category[moodKey] || category.default || MOTION_LIBRARY.establishing.default;

    // Pick a random one from the options
    return options[Math.floor(Math.random() * options.length)];
}

/**
 * Generate motion prompts for all scenes in a script structure.
 * Assigns cinematic camera movements based on scene_type and mood.
 * 
 * @param {Array} scenes - Script structure array with scene_type, subject_id, etc.
 * @param {string} globalMood - Overall video mood (from consultant config)
 * @returns {Array} Scenes with motion_prompt populated
 */
function enrichScenesWithMotion(scenes, globalMood = 'cinematic') {
    return scenes.map((scene, index) => {
        const sceneType = scene.scene_type || 'establishing';
        const mood = scene.mood || globalMood;

        // Enhance the motion prompt
        const motionPrompt = getMotionPrompt(sceneType, mood, scene.motion_prompt);

        return {
            ...scene,
            motion_prompt: motionPrompt,
            _motion_source: scene.motion_prompt ? 'script' : 'auto_generated'
        };
    });
}

/**
 * Build a complete I2V prompt by combining the scene image description
 * with a cinematic motion instruction.
 * 
 * @param {string} sceneDescription - What the scene depicts
 * @param {string} motionPrompt - Camera movement
 * @param {string} visualStyle - Art style (cinematic, anime, etc.)
 * @returns {string} A complete prompt for Meta.ai/Grok I2V
 */
function buildI2VPrompt(sceneDescription, motionPrompt, visualStyle = 'cinematic') {
    return `${sceneDescription}, ${motionPrompt}, ${visualStyle} style, high quality, smooth motion, 24fps`;
}

module.exports = {
    MOTION_LIBRARY,
    getMotionPrompt,
    enrichScenesWithMotion,
    buildI2VPrompt
};
