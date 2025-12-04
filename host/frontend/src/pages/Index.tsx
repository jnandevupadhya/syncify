import { SpotifyInstaller } from "@/components/ControlPanel";
import {
  BackgroundPicker,
  BackgroundPickerRef,
} from "@/components/ui/BackgroundPicker";
import { PasswordProtection } from "@/components/PasswordProtection";
import { useState, useRef, useEffect } from "react";

const Index = () => {
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

  const [backgroundBlur, setBackgroundBlur] = useState(0);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const bgPickerRef = useRef<BackgroundPickerRef>(null);

  const handleBackgroundChange = (
    imageUrl: string | null,
    fillType: "cover" | "contain" | "fill" | "none",
    blur: number
  ) => {
    setBackgroundImage(imageUrl);

    setBackgroundBlur(blur);
  };


  return (
    <div className="h-full w-full relative">
      

      {/* Background Image Layer */}

      <div
        id="blur-overlay"
        className="fixed transition-all duration-300 ease-in-out overflow-hidden"
        style={{
          top: 15,
          left: 15,
          right: 20,
          bottom: 10,
          borderRadius: 12,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundAttachment: "fixed",
          opacity: backgroundImage ? 1 : 0,
          border: `1px solid rgba(255, 255, 255, ${Math.min(
            backgroundBlur / 10,
            0.1
          )})`,
          zIndex: -1,
          pointerEvents: "none",
        }}
      >
        {backgroundImage && (
          <img
            ref={bgRef}
            src={backgroundImage}
            className="absolute w-full -translate-y-[6px] h-full object-none transition-opacity duration-500 ease-in-out"
            style={{
              objectPosition: "center",
              filter: `blur(${backgroundBlur}px)`, // <-- use your state here
            }}
          />
        )}
      </div>

      <div className="min-h-screen w-full relative" style={{ zIndex: 20 }}>
        <BackgroundPicker
          ref={bgPickerRef}
          onBackgroundChange={handleBackgroundChange}
        />
        
        <SpotifyInstaller bgRef={bgRef} bgPickerRef={bgPickerRef} />
      </div>
    </div>
  );
};

export default Index;
