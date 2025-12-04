import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function ClientSecretInput({
  value,
  onChange,
  disabled,
  placeholder,
  autoSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoSubmit?: () => void;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative w-full transition-all duration-300">
      <input
        type={show ? "text" : "password"}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
          if (autoSubmit && e.target.value.trim().length === 32) autoSubmit();
        }}
        placeholder={placeholder}
        className={`w-full px-4 py-3 pr-12 rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring transition-all ${
          disabled ? "cursor-not-allowed bg-gray-200 text-gray-400" : ""
        }`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        disabled={disabled}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 flex items-center justify-center text-muted-foreground transition-all duration-300"
      >
        {show ? (
          <EyeOff className="w-5 h-5 opacity-50" />
        ) : (
          <Eye className="w-5 h-5 opacity-100" />
        )}
      </button>
    </div>
  );
}
