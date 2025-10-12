import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import favicon from './favicon.ico';

const link = document.createElement('link');
link.rel = 'icon';
link.href = favicon;
document.head.appendChild(link);


createRoot(document.getElementById("root")!).render(<App />);
document.documentElement.classList.toggle("dark");
