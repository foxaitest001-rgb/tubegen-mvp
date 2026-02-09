// Style DNA Architecture - TypeScript Types
// These types define the immutable style identity passed from Consultant to Director

export interface VisualIdentity {
    art_style: string;           // e.g., "Anime Cel-Shaded with vibrant saturation"
    color_palette: string;       // e.g., "Cool Blue 9000K with Neon accents"
    lighting_setup: string;      // e.g., "Dramatic backlit silhouettes, rim lighting"
    texture_quality: string;     // e.g., "2D hand-painted with film grain overlay"
}

export interface Cinematography {
    default_lens: string;        // e.g., "35mm anamorphic"
    default_angle: string;       // e.g., "Low angle hero shots"
    motion_style: string;        // e.g., "Slow tracking, dynamic whip pans on action"
}

export interface Constraints {
    forbidden_keywords: string[];  // Keywords that should NEVER appear in prompts
    required_keywords: string[];   // Keywords that MUST appear in every prompt
}

export interface StyleDNA {
    visual_identity: VisualIdentity;
    cinematography: Cinematography;
    constraints: Constraints;
}

export interface Scene {
    scene_description: string;
    voiceover_text: string;
    video_prompts: string[];
}

export interface StructuredShot {
    sceneNum: number;
    shotNum: number;
    prompt: string;
    camera?: string;
    subject?: string;
    action?: string;
    context?: string;
    style?: string;
}

export interface ConsultantOutput {
    ready: boolean;
    topic: string;
    niche: string;
    videoLength: string;
    voiceStyle: string;
    visualStyle: string;
    aspectRatio: string;
    platform: string;
    mood: string;
    style_dna?: StyleDNA;
    structure?: Scene[];
}
