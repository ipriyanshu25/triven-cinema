import type { CSSProperties } from "react";

export function Icon({ name, size = 20, style }: { name: "plus" | "panel" | "arrow" | "chat" | "download" | "retry" | "menu" | "close" | "film"; size?: number; style?: CSSProperties }) {
  const paths = {
    plus: <path d="M12 5v14M5 12h14" />,
    panel: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>,
    arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
    chat: <path d="M20 11.5a8 8 0 0 1-8 8H4l1.2-4.1A8 8 0 1 1 20 11.5Z" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    retry: <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    film: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m10 8 6 4-6 4Z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
