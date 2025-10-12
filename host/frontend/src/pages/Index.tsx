import { SpotifyInstaller } from "@/components/SpotifyInstaller";
import {
  BackgroundPicker,
  BackgroundPickerRef,
} from "@/components/ui/BackgroundPicker";
import { useEffect, useRef, useState } from "react";

const Index = () => {
  //localStorage.setItem("warningClicked", "false");

  const [clicked, setClicked] = useState(
    localStorage.getItem("warningClicked") === "true"
  );
  const [showSplash, setShowSplash] = useState(false);

  const [showInstaller, setShowInstaller] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

  const [backgroundBlur, setBackgroundBlur] = useState(0);
  const bgRef = useRef<HTMLImageElement | null>(null);
  const bgPickerRef = useRef<BackgroundPickerRef>(null);
  const [socialUrl, setSocialUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchSocial = async () => {
      try {
        const res = await fetch(
          "https://spotisyncrooms-default-rtdb.asia-southeast1.firebasedatabase.app/social.json"
        );
        if (!res.ok) throw new Error("Failed to fetch social URL");

        const data = await res.json();
        setSocialUrl(data); // should be your URL string
      } catch (err) {
        console.error("Error fetching social URL:", err);
      }
    };

    fetchSocial();
  }, []);
  useEffect(() => {
    if (showSplash != true) return;
    setTimeout(() => {
      setShowSplash(false);
    }, 2000);
    setTimeout(() => {
      setShowInstaller(true); // now render SpotifyInstaller
    }, 3000);
  }, [showSplash]);

  useEffect(() => {
    if (localStorage.getItem("warningClicked") === "true") {
      setShowSplash(true);
      // setShowInstaller(true);
    }
  }, [clicked]);
  const handleClick = () => {
    setClicked(true);

    localStorage.setItem("warningClicked", "true");
  };

  const handleBackgroundChange = (
    imageUrl: string | null,
    fillType: "cover" | "contain" | "fill" | "none",
    blur: number
  ) => {
    setBackgroundImage(imageUrl);

    setBackgroundBlur(blur);
  };

  // Render either warning or main page
  return (
    <div className="h-full w-full relative">
      {/* Splash here */}
      <div
        className={`fixed inset-0 z-[9999] flex items-center transition-all duration-500 justify-center ${
          showSplash
            ? "opacity-100 bg-black/10 blur-30px"
            : "opacity-0 pointer-events-none"
        }`}
      >
        <p className="jersey text-white text-2xl md:text-4xl text-center">
          by{" "}
          <a
            href={socialUrl || "https://example.com"}
            target="_blank"
            rel="noopener noreferrer"
            className="jersey hover:text-pink-300 text-blue-300 transition-colors"
          >
            dev
          </a>
        </p>
      </div>
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
        {showInstaller ? (
          <SpotifyInstaller bgRef={bgRef} bgPickerRef={bgPickerRef} />
        ) : (
          <div className={`flex items-center justify-center h-screen w-full `}>
            <div
              className={`flex flex-col items-center justify-center h-[100%] transition-all duration-1000 gap-y-7 ${
                clicked ? "opacity-0 h-0" : "opacity-100 max-h-[100vh]"
              }`}
            >
              <span className="errors text-center text-2xl text-[#DBB2B9]">
                Please note, you can only host a room if you are a premium
                user..
                <br /> This will only be showed once, click OK to proceed
              </span>
              <button
                onClick={handleClick}
                className={`installer-button transition-opacity bg-[#DBB2B9] opacity-70 hover:opacity-100 hover:scale-105 active:scale-95 hover:cursor-pointer ${
                  clicked ? "opacity-0" : "opacity-100"
                }`}
                style={{ background: "#DBB2B9" }}
              >
                OK
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
