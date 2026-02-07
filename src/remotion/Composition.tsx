import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import { z } from 'zod';

// Define the schema for our video properties
export const myCompSchema = z.object({
    titleText: z.string(),
    subtitleText: z.string(),
    backgroundImage: z.string().optional(),
});

export const MyComposition: React.FC<z.infer<typeof myCompSchema>> = ({
    titleText,
    subtitleText,
    backgroundImage,
}) => {
    const { fps, durationInFrames, width, height } = useVideoConfig();

    return (
        <AbsoluteFill style={{ backgroundColor: 'black', color: 'white' }}>
            {backgroundImage && (
                <AbsoluteFill>
                    <img
                        src={backgroundImage}
                        alt="bg"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.6 }}
                    />
                </AbsoluteFill>
            )}

            <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
                <h1 style={{
                    fontFamily: 'sans-serif',
                    fontSize: 80,
                    textShadow: '0 0 10px rgba(0,0,0,0.8)',
                    textAlign: 'center',
                    maxWidth: '80%'
                }}>
                    {titleText}
                </h1>
                <h2 style={{
                    fontFamily: 'sans-serif',
                    fontSize: 40,
                    opacity: 0.8,
                    textShadow: '0 0 10px rgba(0,0,0,0.8)',
                    marginTop: 20
                }}>
                    {subtitleText}
                </h2>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};
