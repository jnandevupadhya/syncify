import { useEffect, useState } from "react";
import { ProgressIndicator } from "./ProgressIndicator";
import { Step1 } from "./steps/Step1";
import { Step2 } from "./steps/Step2";
import { Step4 } from "./steps/Step4";
import { BackgroundPickerRef } from "./ui/BackgroundPicker";

type Props = {
  bgRef: React.RefObject<HTMLImageElement>;
  bgPickerRef: React.RefObject<BackgroundPickerRef>;
};

export const SpotifyInstaller = ({ bgRef, bgPickerRef }: Props) => {
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };
  useEffect(() => {
    if (!bgRef.current) return;
    bgPickerRef.current?.setStep(currentStep);

    if (currentStep === 2) {
      bgRef.current.classList.add("opacity-0");
      bgRef.current.classList.remove("opacity-100");
      bgRef.current.style.pointerEvents = "none";
    } else {
      bgRef.current.classList.remove("opacity-0");
      bgRef.current.classList.add("opacity-100");
      bgRef.current.style.pointerEvents = "auto";
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1:
        return <Step1 onNext={nextStep} />;
      case 2:
        return <Step2 onNext={nextStep} />;
      case 3:
        return <Step4 />;
      default:
        return <Step1 onNext={nextStep} />;
    }
  };

  return (
    <section data-scrollbar>
      <div
        className={`min-h-screen transition-all px-4 ${
          currentStep != 3 ? "py-12 " : ""
        }`}
      >
        <div
          className={`${currentStep === 3 ? "w-full" : "max-w-4xl mx-auto"}`}
        >
          <div className="mb-4 overflow-hidden transition-all duration-1000">
            <header
              className={`text-center transition-all ${
                currentStep != 3 ? "mb-[2.1vh]" : "mb-[1.5vh]"
              }`}
            >
              <h1
                className={`text-5xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent transition-all duration-1000 leading-snug
        ${currentStep != 3 ? "opacity-100 max-h-[100px]" : "opacity-0 max-h-1"}
      `}
              >
                Syncify Room Setup
              </h1>

              <div className="overflow-hidden transition-all duration-1000">
                <p
                  className={`text-xl text-muted-foreground transition-all duration-1000
          ${
            currentStep == 3 ? "opacity-0 max-h-0" : "opacity-100 max-h-[200px] mt-3"
          }`}
                >
                  Start listening with your friends in just a step :)
                </p>
              </div>
            </header>
          </div>

          <ProgressIndicator
            currentStep={currentStep}
            totalSteps={totalSteps}
          />

          <main className="transition-all duration-400">
            {currentStep === 3 ? (
              <div className="w-full">{renderCurrentStep()}</div>
            ) : (
              renderCurrentStep()
            )}
          </main>

          <footer
            className={`text-center text-sm z-0 text-muted-foreground transition-all duration-300 origin-bottom ${
              currentStep != 3
                ? "mt-16 max-h-[100px] opacity-100 pointer-events-auto"
                : "h-0 opacity-0 mt-100 pointer-events-none"
            }`}
          >
            <p
              className={`transition-transform duration-300 ${
                currentStep == 3 ? "opacity-0 h-0" : "opacity-100 max-h-[200px]"
              }`}
            >
              Step {currentStep} of {totalSteps} • Spotify Listen-Along
              Extension
            </p>
          </footer>
        </div>
      </div>
    </section>
  );
};
