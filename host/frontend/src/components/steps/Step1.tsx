import { useState } from "react";
import { useEffect } from "react";

interface Step1Props {
  onNext: () => void;
}

export const Step1 = ({ onNext }: Step1Props) => {
  const [isRunning, setIsRunning] = useState(false);
  // useEffect(() => {setTimeout(() => {
  //   onNext();
  // }, 3000);});
  useEffect(() => {
    setIsRunning(false);
    const handleRunSetup = async () => {
      const checkBackend = async () => {
        try {
          const res = await fetch("http://127.0.0.1:8000/api/check");
          if (res.ok) {
            const data = await res.json();

            // ✅ stop only when response has something useful
            if (data && Object.keys(data).length > 0 && data.detail !== null) {
              clearInterval(intervalId);
              setTimeout(() => {
                setIsRunning(true);
              }, 2000);

              // Show 2s animation before moving on
              setTimeout(() => {
                onNext();
              }, 5000);
            }
          }
        } catch (err) {
          // backend not ready yet → ignore & retry
        }
      };

      const intervalId = setInterval(checkBackend, 2000);
      checkBackend(); // run immediately once
    };

    handleRunSetup();
  }, [onNext]);

  return (
    <div className="step-card text-center max-w-md mx-auto slide-up-enter">
      <h2
        className={`text-3xl font-bold text-foreground transition-all duration-500 ease-in-out overflow-hidden ${
          !isRunning ? "opacity-100 max-h-[500px] mb-8" : "opacity-0 max-h-0 mb-0"
        }`}
      >
        Welcome to Syncify Setup!
      </h2>
      <p
        className={`text-lg text-muted-foreground leading-relaxed transition-all duration-500 ease-in-out overflow-hidden ${
          !isRunning ? "opacity-100 max-h-[500px] mb-8" : "opacity-0 max-h-0 mb-0"
        }`}
      >
        Let's get your Syncify room up and running. First, we need to set up
        the basic environment. Run the setup.bat file, and click yes if prompted
        for admin privileges.
      </p>

      <div className={`transition-all duration-500 ease-in-out overflow-hidden ${
        !isRunning ? "opacity-100 max-h-[500px]" : "opacity-0 max-h-0"
      }`}>
        <span className="flex items-center justify-center mr-8">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-white/90 border-t-transparent mr-2"></div>
          Stalking setup.bat
        </span>
        <p className="text-sm text-muted-foreground mt-4">
          This will prepare your local environment
        </p>
      </div>

      <div className={`flex flex-col items-center justify-center transition-all duration-500 ease-in-out overflow-hidden ${
        isRunning ? "opacity-100 max-h-[500px]" : "opacity-0 max-h-0"
      }`}>
        <p className="text-lg text-muted-foreground mb-2 leading-relaxed">
          Your server is up and running!
        </p>
        <svg
          className="w-12 h-12 text-lime-600"
          viewBox="0 0 52 52"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path className="checkmark" d="M14 27l7 7 17-17" />
        </svg>
        <p className="text-sm text-muted-foreground mt-4">
          {"Well done, just another step :)"}
        </p>
      </div>
    </div>
  );
};
