import { useEffect, useState } from "react";
import { FaRegCircleXmark } from "react-icons/fa6";
import AccordionItem from "../ui/accordion1";
import ClientSecretInput from "../ui/SecretInput";
import { getScrollbar } from "../ui/Scrollbar";
import AccordionItem1 from "../ui/accordion2";
import img1static from "../../assets/img1static.png";
import img2static from "../../assets/img2static.png";
import img3static from "../../assets/img3static.png";
import img4static from "../../assets/img4static.png";

import gif1 from "../../assets/1.gif";
import gif2 from "../../assets/2.gif";
import gif3 from "../../assets/3.gif";
import gif4 from "../../assets/4.gif";
import { toast } from "@/hooks/use-toast";

// Add MagicZoom to the Window type for TypeScript

interface Step2Props {
  onNext: () => void;
}

export const Step2 = ({ onNext }: Step2Props) => {
  // useEffect(() => {
  //   setTimeout(() => {
  //     onNext();
  //   }, 3000);
  // });
  const width = 600;
  const height = 1000;

  // Calculate center position
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const [hasTokens, setHasTokens] = useState<boolean | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [firstTimeSubmit, setFirstTimeSubmit] = useState(false);
  const [isCredsValid, setIsCredsValid] = useState(false);

  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const inputValid =
    clientId.trim().length === 32 && clientSecret.trim().length === 32;

  useEffect(() => {
    const checkTokens = async () => {
      setSubmissionError(null); // reset any previous submission errors
      try {
        const res = await fetch("/api/token-check/");
        if (!res.ok) {
          throw new Error("Network response was not ok");
        }

        const data = await res.json();
        console.log("data:", data);

        // Update states based on backend response
        setHasTokens(data.valid); // updates hasTokens
        if (!data.valid) return;
        setIsPremium(data.premium || false); // updates premium

        setIsCached(data.valid);

        if (!data.premium) {
          setSubmissionError("cachedNotPremium");
          setClientId("");
          setClientSecret("");
          setIsProcessing(false);
          setHasTokens(false);
          setIsCached(false);
          return;
        }
      } catch (error) {
        console.error("Error checking cached tokens:", error);
        setHasTokens(false);
        setIsPremium(false);
      }
    };

    checkTokens();
  }, []);

  useEffect(() => {
    console.log("hasTokens updated:", hasTokens);
  }, [hasTokens]);

  useEffect(() => {
    console.log("isCached updated:", isCached);
  }, [isCached]);

  useEffect(() => {
    if (submissionError != null && submissionError != "denied")
      setIsCredsValid(false);
  }, [submissionError]);

  useEffect(() => {
    const scrollbar = getScrollbar();
    if (scrollbar) {
      scrollbar.update();
    }
  }, [hasTokens]);

  const handleFilled = async (id: string, secret: string) => {
    //complete this later
    setSubmissionError(null);
    const trimmedId = id.trim() || clientId.trim();
    const trimmedSecret = secret.trim() || clientSecret.trim();

    try {
      setIsProcessing(true);
      // Send PUT request with clientId and clientSecret as query params
      const response = await fetch(
        "/api/get-auth-token/",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: trimmedId,
            client_secret: trimmedSecret,
          }),
        }
      );

      const data = await response.json();
      console.log(data);
      // Backend returned an error immediately
      console.log(data.ok ? "Auth token fetched" : "Failed to fetch data");

      if (data.error && !data.ok) {
        console.log(data.error);
        setSubmissionError(data.error);
        return;
      }

      setIsCredsValid(true);
      //handleSubmit(trimmedId, trimmedSecret);
    } catch (err) {
      console.log(err);
    } finally {
      setIsProcessing(false);
    }
  };

  //to handle clicking
  const handleSubmit = async (
    overrideClientId?: string,
    overrideClientSecret?: string
  ) => {
    const password = localStorage.getItem("pass"); // or however you store it

    const res = await fetch("/api/get-creds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error("Unauthorized");
    const creds = await res.json();
    const id = creds.client_id;
    const secret = creds.client_secret;
    // Reset previous errors
    const rt = localStorage.getItem("rt");
    if (rt) {
      return;
    }
    const popup = window.open(
      "",
      "spotifyAuth",
      `width=${width},height=${height},left=${left},top=${top}`
    );

    // Trim inputs
    const trimmedId = id.trim() ?? clientId.trim();

    popup.location.href =
      "/api/redirect/?client_id=" + trimmedId;

    try {
      setTimeout(() => {
        if (!popup || popup.closed || typeof popup.closed === "undefined") {
          // ❌ Popup was blocked
          return;
        } else {
          // ✅ Popup opened successfully
          popup.focus();
        }
      }, 500);

      // RACE BETWEEN CALLBACK AND WINDOW CLOSE
      let callbackDone = false;

      try {
        while (!callbackDone && popup && !popup.closed) {
          const res = await fetch("/api/callback");
          const data = await res.json();

          if (data.denied) {
            console.log("manually denied");
            popup.close();
          }

          if (data.ok) {
            callbackDone = true;

            // ✅ save the refresh token locally (React/browser)
            if (data.rt) {
              localStorage.setItem("rt", data.rt);
              console.log("Saved refresh token:", data.rt);
            }

            if (popup && !popup.closed) popup.close();
            break;
          }

          if (data.denied || (data.ok && !popup.closed)) popup.close();
          await new Promise((r) => setTimeout(r, 500)); // wait 500ms before next poll
        }
      } catch (err) {
        console.error(err);
      }
    } catch (err) {
      console.error("Error verifying Spotify credentials:", err);
    }
  };

  return (
    <div className="step-card max-w-6xl mx-auto slide-up-enter">
      <div className="text-center">
        <h2 className={`text-3xl font-bold mb-4 text-foreground`}>
          Connect to Spotify
        </h2>
        <p
          className={`transition-all duration-500 ease-in-out text-lg text-muted-foreground overflow-hidden ${
            !hasTokens && hasTokens != null
              ? "max-h-[500px] opacity-100 mb-6 "
              : "opacity-0 max-h-0 mb-0"
          }`}
        >
          Follow these steps to get your Spotify app credentials
        </p>

        <div
          className={`transition-all duration-500 ease-in-out overflow-hidden text-left ${
            !hasTokens && hasTokens != null
              ? "p-4 max-h-[500px] opacity-100 mb-8"
              : "opacity-0 max-h-0 mb-0"
          }`}
        >
          <ol
            className={`text-sm text-muted-foreground space-y-2 max-w-2xl overflow-hidden origin-top mx-auto`}
          >
            <li>
              1. Visit the{" "}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-medium"
              >
                Spotify Developer Dashboard
              </a>
            </li>
            <AccordionItem title="2. Create a new app or select an existing one">
              <ul className="list-disc space-y-1">
                <li className="text-red-600 font-bold">
                  NOTE! Make sure you’re using the same Premium account for both
                  app creation and authorization
                </li>

                <li>
                  Click on "Create App" in the Spotify Developer Dashboard
                  (Check the top right to switch accounts)
                </li>
                <li>Give it a name and description, it may be anything</li>
                <li>
                  Add{" "}
                  <a
                    title="Click to copy"
                    className="text-primary hover:underline font-medium cursor-pointer select-text"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        "http://127.0.0.1:8000/api/callback"
                      );
                      toast({
                        title: "Copied!",
                        description: `http://127.0.0.1:8000/api/callback copied to clipboard.`,
                        duration: 3000, // auto-dismiss after 3 seconds
                      });
                    }}
                  >
                    http://127.0.0.1:8000/api/callback
                  </a>
                  {" to Redirect URIs"}
                </li>
                <li>Select Web API and Web Playback SDK</li>
                <li>Accepts the terms of service and click on Save</li>
              </ul>
            </AccordionItem>{" "}
            <li>
              3. You will land on the Basic Information page, click on "view
              client secret"
            </li>
            <li>
              4. Copy your Client ID and Client Secret and paste them on this
              page
            </li>
          </ol>
        </div>
      </div>

      {hasTokens !== null && (
        <div
          className={`bg-accent/10 rounded-3xl border border-accent/20 transition-all duration-500 ease-in-out overflow-hidden ${
            !hasTokens && hasTokens != null
              ? "p-8 max-h-[2000px] opacity-100"
              : "opacity-0 max-h-0 mb-0"
          } `}
        >
          <AccordionItem1
            title="📋 Visual Guide - Spotify Developer Dashboard"
            className="text-xl font-semibold m-auto text-center flex items-center justify-center"
          >
            <div
              className={`transition-all duration-500 ease-in-out overflow-hidden grid grid-cols-1 md:grid-cols-2 ${
                !hasTokens
                  ? "opacity-100 max-h-[2000px] gap-6 mb-8"
                  : "opacity-0 max-h-0 gap-0 mb-0"
              }`}
            >
              <div
                className={`screenshot-container transition-all duration-300 `}
              >
                <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                  Step 1: App Dashboard
                </h4>
                <div className="screenshot-wrapper">
                  <div className="screenshot-placeholder  bg-gradient-to-br from-green-500/20 to-green-600/20 rounded-lg border-2 border-green-500/30 aspect-video flex items-center justify-center text-green-600">
                    <div
                      className="zoom-container"
                      onMouseEnter={(e) => {
                        const img =
                          e.currentTarget.querySelector<HTMLImageElement>(
                            "img"
                          );
                        if (!img) return;

                        // Play GIF
                        img.src = gif1;

                        // Zoom logic
                        img.style.opacity = "1";
                        // const { left, top, width, height } =
                        //   e.currentTarget.getBoundingClientRect();
                        // const x = ((e.clientX - left) / width) * 100;
                        // const y = ((e.clientY - top) / height) * 100;
                        // img.style.transformOrigin = `${x}% ${y}%`;
                        img.style.transform = "scale(1.5)";
                      }}
                      onMouseLeave={(e) => {
                        const img =
                          e.currentTarget.querySelector<HTMLImageElement>(
                            "img"
                          );
                        if (!img) return;

                        // Stop GIF by replacing with static frame
                        img.src = img1static; // you need a static version of your gif

                        // Reset zoom
                        img.style.opacity = "0.7";
                        img.style.transformOrigin = "center center";
                        img.style.transform = "scale(1)";
                      }}
                    >
                      <img
                        src={img1static}
                        alt="Zoom Example"
                        className="zoom-image"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="screenshot-container">
                <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                  Step 2: Fill basic Information
                </h4>
                <div className="screenshot-wrapper">
                  <div className="screenshot-placeholder bg-gradient-to-br from-blue-500/20 to-blue-600/20 rounded-lg border-2 border-blue-500/30 aspect-video flex items-center justify-center text-blue-600">
                    <div
                      className="zoom-container"
                      onMouseEnter={(e) => {
                        const img =
                          e.currentTarget.querySelector<HTMLImageElement>(
                            "img"
                          );
                        if (!img) return;

                        // Play GIF
                        img.src = gif2;

                        // Zoom logic
                        img.style.opacity = "1";
                        // const { left, top, width, height } =
                        //   e.currentTarget.getBoundingClientRect();
                        // const x = ((e.clientX - left) / width) * 100;
                        // const y = ((e.clientY - top) / height) * 100;
                        // img.style.transformOrigin = `${x}% ${y}%`;
                        img.style.transformOrigin = `30% 50%`;

                        img.style.transform = "scale(1.5)";
                      }}
                      onMouseLeave={(e) => {
                        const img =
                          e.currentTarget.querySelector<HTMLImageElement>(
                            "img"
                          );
                        if (!img) return;

                        // Stop GIF by replacing with static frame
                        img.src = img2static; // you need a static version of your gif

                        // Reset zoom
                        img.style.opacity = "0.7";
                        img.style.transformOrigin = "center center";
                        img.style.transform = "scale(1)";
                      }}
                    >
                      <img
                        src={img2static}
                        alt="Zoom Example"
                        className="zoom-image"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="screenshot-container">
                <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                  Step 3: Copy ID and Secret
                </h4>
                <div className="screenshot-wrapper">
                  <div className="screenshot-placeholder bg-gradient-to-br from-purple-500/20 to-purple-600/20 rounded-lg border- border-purple-500/30 aspect-video flex items-center justify-center text-purple-600">
                    <div
                      className="zoom-container"
                      onMouseEnter={(e) => {
                        const img =
                          e.currentTarget.querySelector<HTMLImageElement>(
                            "img"
                          );
                        if (!img) return;

                        // Play GIF
                        img.src = gif3;

                        // Zoom logic
                        img.style.opacity = "1";
                        // const { left, top, width, height } =
                        //   e.currentTarget.getBoundingClientRect();
                        // const x = ((e.clientX - left) / width) * 100;
                        // const y = ((e.clientY - top) / height) * 100;
                        // img.style.transformOrigin = `${x}% ${y}%`;
                        img.style.transformOrigin = `10% 50%`;

                        img.style.transform = "scale(1.5)";
                      }}
                      onMouseLeave={(e) => {
                        const img =
                          e.currentTarget.querySelector<HTMLImageElement>(
                            "img"
                          );
                        if (!img) return;

                        // Stop GIF by replacing with static frame
                        img.src = img3static; // you need a static version of your gif

                        // Reset zoom
                        img.style.opacity = "0.7";
                        img.style.transformOrigin = "center center";
                        img.style.transform = "scale(1)";
                      }}
                    >
                      <img
                        src={img3static}
                        alt="Zoom Example"
                        className="zoom-image"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="screenshot-container">
                <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                  Step 4: Paste both of them in the fields below
                </h4>
                <div className="screenshot-wrapper">
                  <div className="screenshot-placeholder bg-gradient-to-br from-red-500/20 to-red-600/20 rounded-lg border-2 border-red-800/10 aspect-video flex items-center justify-center text-red-600">
                    <div
                      className="zoom-container"
                      onMouseEnter={(e) => {
                        const img =
                          e.currentTarget.querySelector<HTMLImageElement>(
                            "img"
                          );
                        if (!img) return;

                        // Play GIF
                        img.src = gif4;

                        // Zoom logic
                        img.style.opacity = "1";
                        // const { left, top, width, height } =
                        //   e.currentTarget.getBoundingClientRect();
                        // const x = ((e.clientX - left) / width) * 100;
                        // const y = ((e.clientY - top) / height) * 100;
                        // img.style.transformOrigin = `${x}% ${y}%`;
                        img.style.transform = "scale(1.5)";
                      }}
                      onMouseLeave={(e) => {
                        const img =
                          e.currentTarget.querySelector<HTMLImageElement>(
                            "img"
                          );
                        if (!img) return;

                        // Stop GIF by replacing with static frame
                        img.src = img4static; // you need a static version of your gif

                        // Reset zoom
                        img.style.opacity = "0.7";
                        img.style.transformOrigin = "center center";
                        img.style.transform = "scale(1)";
                      }}
                    >
                      <img
                        src={img4static}
                        alt="Zoom Example"
                        className="zoom-image"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </AccordionItem1>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        {/* Loader while checking cached tokens */}

        <div
          className={`transition-all duration-300 overflow-hidden ${
            hasTokens == null ? "max-h-[1000px] mb-4" : "max-h-0 mb-0"
          }`}
        >
          <div
            className={`text-lg text-muted-foreground transition-opacity duration-300 text-center ${
              hasTokens != null ? "opacity-0" : "opacity-100"
            }`}
          >
            <span className="inline-flex items-center justify-center mr-5">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/90 border-t-transparent mt-[22px] mr-2"></div>

              <span className="mt-5 text-2xl">
                Checking cached credentials...
              </span>
            </span>
          </div>
        </div>

        {submissionError === "invalidLength" && (
          <p className="errors text-4sm text-red-600 mb-2 text-center">
            ⚠️ Enter valid credentials (both should be 32 characters)
          </p>
        )}
        {/* Show form if no tokens or user wants to change credentials */}
        <div
          className={`transition-opacity duration-1000 ${
            hasTokens
              ? "max-h-0 opacity-0 mb-0 pb-0"
              : "mt-12 max-h-[1000px] opacity-100"
          }`}
        >
          {hasTokens === false && (
            <>
              <h3
                className={`!fade text-xl font-semibold text-center space-y-4 mb-4 duration-500 origin-top  ${
                  isProcessing ? "opacity-0" : "opacity-100 max-h-[1000px] "
                }`}
              >
                Enter Your Credentials
              </h3>

              <div
                className={`!fade duration-100 origin-top space-y-8 mb-4 p-2 overflow-hidden ${
                  isProcessing ? "opacity-0" : "opacity-100 max-h-[1000px] "
                }`}
              >
                <div>
                  <label className="block text-sm font-medium mb-2">
                    🔑 Client ID
                  </label>
                  <input
                    type="text"
                    name="spotifyClientId"
                    autoComplete="new-password"
                    spellCheck="true"
                    autoCorrect="on"
                    autoCapitalize="off"
                    value={clientId}
                    onChange={(e) => {
                      setSubmissionError(null);
                      setIsCredsValid(false);
                      const value = e.target.value;
                      setClientId(value);

                      // Auto-submit if both lengths are 32
                      if (
                        value.trim().length === 32 &&
                        clientSecret.trim().length === 32
                      ) {
                        handleFilled(value, clientSecret); // pass the new value directly
                      }
                    }}
                    placeholder="Your Spotify Client ID"
                    disabled={isProcessing}
                    className={
                      "w-full px-4 py-3 rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring transition-all"
                    }
                    style={{
                      backgroundColor: isProcessing
                        ? "hsl(var(0%,0%,20%)" // a light gray overlay, for example
                        : "", // your original bg-background variable
                      color: isProcessing ? "#9ca3af" : "", // gray text when processing
                    }}
                  />
                </div>

                <div
                  className={`transition-all duration-300 ${
                    isProcessing ? "opacity-0" : ""
                  }`}
                >
                  <label className="block text-sm font-medium mb-2">
                    🔐 Client Secret
                  </label>
                  <ClientSecretInput
                    value={clientSecret}
                    onChange={(value: string) => {
                      setSubmissionError(null);
                      setClientSecret(value);
                      setIsCredsValid(false);

                      if (
                        value.trim().length === 32 &&
                        clientId.trim().length === 32
                      ) {
                        handleFilled(clientId, value);
                      }
                    }}
                    disabled={isProcessing}
                    placeholder="Your Spotify Client Secret"
                  />
                </div>
              </div>

              {/* Submission error messages */}
              {
                <div
                  className={`relative flex items-center transition-all m-10 justify-center ${
                    [
                      "denied",
                      "invalid",
                      "invalid_creds",
                      "notPremium",
                      "cachedNotPremium",
                    ].includes(submissionError) || isCredsValid
                      ? "opacity-100"
                      : "opacity-0"
                  }`}
                >
                  <p
                    className={`absolute errors transition-opacity duration-500 ${
                      isCredsValid && submissionError == null
                        ? "opacity-100"
                        : "opacity-0"
                    } text-lg text-lime-400`}
                  >
                    <svg
                      className="w-12 h-12 text-lime-600 "
                      viewBox="0 0 52 52"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path className="checkmark" d="M14 27l7 7 17-17" />
                    </svg>
                    <span
                      className="font-bold align-middle flex-row pl-2 space-x-2"
                      style={{
                        color: "#1DB954",
                        animation: "pulseY 1s infinite alternate",
                        lineHeight: 0, // makes the X baseline align better
                      }}
                    >
                      Yay, valid credentials ٩(^ᗜ^ )و -
                    </span>
                  </p>

                  <p
                    className={`absolute errors transition-opacity duration-500 ${
                      submissionError === "denied" ? "opacity-100" : "opacity-0"
                    } text-lg text-red-600`}
                  >
                    <FaRegCircleXmark color="red" />
                    <span
                      className="font-bold align-middle flex-row pl-2 space-x-2"
                      style={{
                        color: "#8b0000",
                        animation: "pulseX 1s infinite alternate",
                        lineHeight: -2, // makes the X baseline align better
                      }}
                    >
                      Wat??? You don wanna authorize?? ( ╥ ᴗ ╥)
                    </span>
                  </p>

                  <p
                    className={`absolute flex items-center errors transition-opacity space-x-2 duration-500 text-lg text-red-600 ${
                      submissionError === "invalid"
                        ? "opacity-100"
                        : "opacity-0"
                    }`}
                  >
                    <FaRegCircleXmark color="red" />
                    <span
                      className="font-bold align-middle flex-row "
                      style={{
                        color: "#8b0000",
                        animation: "pulseX 1s infinite alternate",
                        lineHeight: -2, // makes the X baseline align better
                      }}
                    >
                      Opps, something went wrong, idk where lmao ( ╥ ᴗ ╥)
                    </span>
                  </p>

                  <p
                    className={`errors absolute transition-opacity space-x-2 duration-500 ${
                      submissionError === "invalid_creds"
                        ? "opacity-100"
                        : "opacity-0"
                    } text-lg text-red-600 font-medium text-muted-foreground`}
                    style={{ fontFamily: '"Quicksand", sans-serif' }}
                  >
                    <FaRegCircleXmark color="red" />
                    <span
                      className="font-bold align-middle flex-row space-x-2"
                      style={{
                        color: "#8b0000",
                        animation: "pulseX 1s infinite alternate",
                        lineHeight: -2, // makes the X baseline align better
                      }}
                    >
                      Invalid ID / Secret vro ( ╥ ᴗ ╥)
                    </span>
                  </p>

                  <p
                    className={`errors absolute transition-opacity duration-500 space-x-2 ${
                      ["notPremium", "cachedNotPremium"].includes(
                        submissionError
                      )
                        ? "opacity-100"
                        : "opacity-0"
                    } text-lg text-red-600`}
                  >
                    <FaRegCircleXmark color="red" />
                    <span
                      className="font-bold align-middle flex-row"
                      style={{
                        color: "#8b0000",
                        animation: "pulseX 1s infinite alternate",
                        lineHeight: -2, // makes the X baseline align better
                      }}
                    >
                      {submissionError == "notPremium"
                        ? "Bruh this ain't a premium account "
                        : "Cached account ain't premium "}
                      ( ╥ ᴗ ╥)
                    </span>
                  </p>
                </div>
              }
              {/* authorize button */}
              <div className="text-center flex items-center justify-center">
                {!hasTokens && (
                  <button
                    onClick={() => {
                      setSubmissionError(null);
                      handleSubmit();
                    }}
                    disabled={isProcessing || !inputValid || !isCredsValid}
                    className={`installer-button transition-all duration-300 ${
                      isProcessing || !inputValid || !isCredsValid
                        ? "cursor-not-allowed opacity-50 scale-100 hover:scale-100 hover:opacity-50 active:scale-100"
                        : "cursor-pointer opacity-80 hover:opacity-100 hover:scale-105 active:scale-95"
                    }`}
                  >
                    {isProcessing && !isCredsValid ? (
                      <span className="flex items-center justify-center pl-0">
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent mr-2"></div>
                        Validating
                      </span>
                    ) : isProcessing ? (
                      <span className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent mr-2"></div>
                        Connecting to Spotify...
                      </span>
                    ) : (
                      "> Authorize"
                    )}
                  </button>
                )}
              </div>

              <p className="text-sm text-muted-foreground mt-4 text-center">
                We'll securely store your refresh token
              </p>
            </>
          )}
        </div>

        {/* Cached tokens exist */}
        {
          <div
            className={`transition-all duration-300 flex flex-col items-center justify-center ${
              !hasTokens || !isCached
                ? "opacity-0 pointer-events-none mb-0 max-h-0 "
                : "opacity-100  max-h-[1000px]"
            }`}
          >
            <p
              className={`text-lg text-muted-foreground mb-2 leading-relaxed `}
            >
              {!firstTimeSubmit ? "Cached credentials found" : "Tokens saved"}
              {isPremium ? " (Premium user)" : " (Not Premium)"}
            </p>

            <svg
              className="w-12 h-12 text-lime-600 mb-4"
              viewBox="0 0 52 52"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path className="checkmark" d="M14 27l7 7 17-17" />
            </svg>

            <div className="text-center flex items-center justify-center space-x-4">
              {/* Continue button */}

              {hasTokens && isPremium && (
                <button
                  onClick={onNext}
                  disabled={!hasTokens}
                  className={`installer-button transition-opacity duration-300 opacity-90 hover:opacity-100 hover:scale-105 active:scale-95 hover:cursor-pointer`}
                >
                  Continue
                </button>
              )}

              {/* Change Credentials button */}
              {hasTokens && isCached && (
                <button
                  onClick={() => {
                    setHasTokens(false);
                    setClientId("");
                    setClientSecret("");
                    setIsCached(false);
                    setSubmissionError(null);
                    setIsPremium(false);
                    setFirstTimeSubmit(false);
                  }}
                  className="installer-button  hover:!bg-red-600 cursor-pointer opacity-60 hover:opacity-100 hover:scale-105 active:scale-95 text-white"
                  style={{ background: "#CF0000" }}
                >
                  {"<!>"} Change Credentials
                </button>
              )}
            </div>
          </div>
        }
      </div>
    </div>
  );
};

//on load, show loader while you fetch tokens, if tokens doesn't exist, show text fields, after entering, clicks continue, when clicked, check if the tokens are
//valid by calling api, and if not valid, show not valid, and if not premium, show not premium, both with cross marks
//case 2: cache available: server returns true, say cached available, and show continue button + change creds button
