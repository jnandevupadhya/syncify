import { useEffect, useRef } from "react";
import Scrollbar from "smooth-scrollbar";

let scrollbarInstance: Scrollbar | null = null;
export const getScrollbar = () => scrollbarInstance;

interface Props {
  children: React.ReactNode;
}

const SmoothScrollWrapper = ({ children }: Props) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;

    const scrollbar = Scrollbar.init(scrollRef.current, {
      damping: 0.1,
      renderByPixels: true,
      thumbMinSize: 20,
      continuousScrolling: true,
    });

    scrollbarInstance = scrollbar;

    return () => {
      scrollbar.destroy();
      scrollbarInstance = null;
    };
  }, []);

  return (
    <div ref={scrollRef} style={{ height: "100vh", overflow: "hidden" }}>
      {children}
    </div>
  );
};

export default SmoothScrollWrapper;
