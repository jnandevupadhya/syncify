import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx"; // optional, helps with merging classes

interface AccordionItemProps {
  title: string;
  children: React.ReactNode;
  className?: string; // ✅ allow extra classes
}

export default function AccordionItem1({
  title,
  children,
  className,
}: AccordionItemProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={"mb-2"}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center flex-row space-x-2 m-auto justify-start font-medium"
      >
        <span className={clsx(className)}>{title}</span>
        <span
          className={`transition-transform duration-300 ${
            open ? "rotate-180" : ""
          }`}
        >
          <ChevronDown className="w-5 h-5" color="white" />
        </span>
      </button>

      <div
        className={`transition-all duration-500 ease-in-out overflow-hidden ${
          open ? "max-h-[1000px] opacity-100 mt-16" : "max-h-0 opacity-0"
        }`}
      >
        <div className="text-sm text-muted-foreground pl-6">{children}</div>
      </div>
    </div>
  );
}
