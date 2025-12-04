import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { ImageIcon, Pencil, X, RefreshCw } from "lucide-react";
const DB_NAME = "BackgroundDB";
const DB_STORE = "backgroundStore";
import defaultUrl from "../../assets/wallpaper.jpg";

type FillType = "cover" | "contain" | "fill" | "none";

interface BackgroundPickerProps {
  onBackgroundChange: (
    imageUrl: string | null,
    fillType: FillType,
    blur: number
  ) => void;
}

export interface BackgroundPickerRef {
  setStep: (step: number) => void;
}

export const BackgroundPicker = forwardRef<
  BackgroundPickerRef,
  BackgroundPickerProps
>(({ onBackgroundChange }, ref) => {
  const [disableBlur, setDisableBlur] = useState(false);

  useImperativeHandle(ref, () => ({
    setStep(step: number) {
      console.log("Step 2 reached, disabling btn", step);
      setDisableBlur(step === 2); // for example, disable blur in step 2
    },
  }));

  const wrapperRef = useRef<HTMLDivElement>(null);

  const applyBodyBackground = (
    imageUrl: string | null,
    fillType: "cover" | "contain" | "fill" | "none",
    blur: number
  ) => {
    if (imageUrl) {
      document.body.style.backgroundImage = `url(${imageUrl})`;
      document.body.style.backgroundPosition = "center";
      document.body.style.backgroundRepeat = "no-repeat";
      document.body.style.backgroundAttachment = "fixed";
      document.body.style.backgroundSize = fillType;
      document.body.style.overflow = "hidden";
      onBackgroundChange(imageUrl, currentFillType, blur);
    } else {
      // remove background
      document.body.style.backgroundImage = "";
      document.body.style.filter = "";
    }
  };

  const handleBlurChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newBlur = parseInt(e.target.value);
    setBlurAmount(newBlur);

    // apply with the new value
    applyBodyBackground(currentImageUrl, currentFillType, newBlur);

    // 🔥 notify parent
    onBackgroundChange(currentImageUrl, currentFillType, newBlur);

    // persist in IndexedDB
    saveBackground(currentImageUrl, currentFillType, newBlur);
  };

  useEffect(() => {
    setCurrentImageUrl(defaultUrl);
    setBlurAmount(5);
    setHasBackground(true);
    setCurrentFillType("cover");
    applyBodyBackground(defaultUrl, "cover", 5);
    setShowActionButtons(true);

    // ⬇️ call here too so Index picks up the initial values
    onBackgroundChange(defaultUrl, "cover", 5);

    (async () => {
      const { imageUrl, fillType, blur } = await loadBackground();
      if (imageUrl) {
        setCurrentImageUrl(imageUrl);
        setHasBackground(true);
        setCurrentFillType(fillType);
        setBlurAmount(blur ?? 5);
        applyBodyBackground(imageUrl, fillType, blur ?? 5);
        setShowActionButtons(true);

        // ⬇️ and here when loading saved values
        onBackgroundChange(imageUrl, fillType, blur ?? 5);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isExpanded, setIsExpanded] = useState(false);
  const [hasBackground, setHasBackground] = useState(false);
  const [showActionButtons, setShowActionButtons] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [currentFillType, setCurrentFillType] = useState<FillType>("cover");
  const [blurAmount, setBlurAmount] = useState(0);
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleBodyClick = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        // Clicked outside, hide the action buttons
        setShowActionButtons(false);
      }
    };

    document.addEventListener("click", handleBodyClick);

    return () => {
      document.removeEventListener("click", handleBodyClick);
    };
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setCurrentImageUrl(imageUrl);
      setHasBackground(true);
      setIsExpanded(false);
      setShowActionButtons(true);
      applyBodyBackground(imageUrl, currentFillType, blurAmount);

      saveBackground(file, currentFillType, blurAmount);
    }
  };

  const handleMainIconClick = () => {
    if (hasBackground) {
      setShowActionButtons(!showActionButtons);
      if (showActionButtons) {
        setShowOptions(false);
      }
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  const handleRemoveBackground = () => {
    setHasBackground(false);
    setShowActionButtons(false);
    setShowOptions(false);
    setIsExpanded(false);
    setCurrentImageUrl(null);
    applyBodyBackground(null, currentFillType, blurAmount);
    setBlurAmount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Save to DB with null image
    saveBackground(null, currentFillType, 0);
  };

  return (
    <div
      ref={wrapperRef}
      className="fixed top-6 left-6 z-50 flex items-center gap-2"
    >
      {/* Main Icon Button */}
      <button
        onClick={handleMainIconClick}
        title="Change background / adjust blur"
        className="w-12 h-12 rounded-full bg-background/80 backdrop-blur-md border border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center hover:scale-110 active:scale-95"
      >
        <ImageIcon className="w-5 h-5 text-foreground transition-transform duration-300" />
      </button>

      {/* Choose Background Button (Expanded) */}
      {isExpanded && !hasBackground && (
        <div className="transition-all duration-300 ease-in-out animate-in fade-in slide-in-from-left-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.gif"
            onChange={handleFileSelect}
            className="hidden"
            id="bg-file-input"
          />
          <label
            htmlFor="bg-file-input"
            className="px-4 py-2 rounded-full bg-background/80 backdrop-blur-md border border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer flex items-center gap-2 hover:scale-105 active:scale-95 text-sm font-medium"
          >
            Choose Background
          </label>
        </div>
      )}

      {/* Action Buttons (When Background is Set) */}
      {hasBackground && showActionButtons && (
        <div className="flex items-center gap-2 transition-all duration-300 ease-in-out animate-in fade-in slide-in-from-left-2">
          {/* Pencil Icon - Fill Type & Blur Options */}
          <div className="relative">
            <button
              onClick={() => setShowOptions(!showOptions)}
              className="w-10 h-10 rounded-full bg-background/80 backdrop-blur-md border border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center hover:scale-110 active:scale-95"
              title="Adjust blur"
            >
              <Pencil className="w-4 h-4 text-foreground" />
            </button>

            {/* Options Panel */}
            {showOptions && (
              <div className="absolute top-12 left-0 bg-background/95 opacity-70 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-4 min-w-[200px] transition-all duration-300 ease-in-out animate-in fade-in zoom-in-95">
                {/* Blur Slider */}
                <div>
                  <p className="text-xs font-semibold mb-2 text-muted-foreground">
                    Blur Amount: {blurAmount}px
                  </p>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    step="0.001" // smaller steps = smoother movement
                    value={blurAmount}
                    onChange={handleBlurChange}
                    className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider-thumb"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Change Background Button */}
          <label
            className={`w-10 h-10 rounded-full bg-background/80 backdrop-blur-md border border-white/20 shadow-lg flex hover:scale-110 active:scale-95 cursor-pointer items-center justify-center`}
            title={`Change background`}
          >
            <RefreshCw className="w-4 h-4 text-foreground" />
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif"
              onChange={handleFileSelect} // This will get the ChangeEvent<HTMLInputElement>
              className="hidden"
            />
          </label>

          {/* Remove Background Button */}
          <button
            onClick={handleRemoveBackground}
            className="w-10 h-10 rounded-full bg-background/80 backdrop-blur-md border border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center hover:scale-110 active:scale-95 hover:bg-destructive/80"
            title="Remove background"
          >
            <X className="w-4 h-4 text-foreground" />
          </button>
        </div>
      )}
    </div>
  );

  function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveBackground(
    image: File | string | null,
    fillType: FillType,
    blur: number
  ) {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);

    if (image) {
      if (typeof image === "string") {
        store.put(image, "image"); // store URL directly
      } else {
        store.put(image, "image"); // store File object
      }
    } else {
      store.delete("image");
    }

    store.put(fillType, "fillType");
    store.put(blur, "blur");

    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function loadBackground(): Promise<{
    imageUrl: string | null;
    fillType: FillType;
    blur: number;
  }> {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, "readonly");
    const store = tx.objectStore(DB_STORE);

    const imageData: File | Blob | string | undefined = await new Promise(
      (res) => {
        const req = store.get("image");
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(undefined);
      }
    );

    const fillType: FillType = await new Promise((res) => {
      const req = store.get("fillType");
      req.onsuccess = () => res(req.result ?? "cover");
    });

    const blur: number = await new Promise((res) => {
      const req = store.get("blur");
      req.onsuccess = () => res(req.result ?? 0);
    });

    let imageUrl: string | null = null;
    if (imageData) {
      if (typeof imageData === "string") {
        imageUrl = imageData; // Already a string URL
      } else {
        imageUrl = URL.createObjectURL(imageData as Blob); // File/Blob
      }
    }

    return {
      imageUrl,
      fillType,
      blur,
    };
  }
});
