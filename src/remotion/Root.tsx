import { Composition } from 'remotion';
import { MyComposition, myCompSchema } from './Composition';
import './style.css'; // Optional global styles

export const RemotionRoot: React.FC = () => {
    return (
        <>
            <Composition
                id="MyComp"
                component={MyComposition}
                durationInFrames={150}
                fps={30}
                width={1920}
                height={1080}
                schema={myCompSchema}
                defaultProps={{
                    titleText: 'Welcome to FoxTube',
                    subtitleText: 'Edit src/remotion/Root.tsx to change this',
                }}
            />
        </>
    );
};
