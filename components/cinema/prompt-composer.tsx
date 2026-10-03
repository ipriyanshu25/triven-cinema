"use client";

import { useEffect, useRef, useState } from "react";
import { inferPromptSettings } from "./chat-model";
import { Icon } from "./icons";

export function PromptComposer({ chatMode, busy, ready, onSubmit }: { chatMode: boolean; busy: boolean; ready: boolean; onSubmit: (prompt: string) => boolean }) {
  const [prompt, setPrompt] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const settings = inferPromptSettings(prompt);
  const canSubmit = ready && !busy && prompt.trim().length >= 5 && prompt.trim().length <= 8000;

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(200, Math.max(chatMode ? 60 : 100, element.scrollHeight))}px`;
  }, [prompt, chatMode]);

  function send() {
    if (canSubmit && onSubmit(prompt)) {
      setPrompt("");
      textarea.current?.focus();
    }
  }

  return <div className={`composerDock ${chatMode ? "chatDock" : ""}`}>
    <form className="composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <textarea ref={textarea} aria-label="Describe your video" value={prompt} maxLength={8000} rows={2}
        placeholder={chatMode ? "Describe another video…" : "Describe the video you imagine…"}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (!event.nativeEvent.isComposing && (event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); send(); } }}
      />
      <div className="composerBottom">
        <div className="composerMeta"><Icon name="film" size={16} /><span>LTX-2.5</span><span className="modelDivider" />{prompt.trim() ? <span className="promptSettings">{settings.durationSeconds}s · {settings.aspectRatio} · {settings.quality === "preview" ? "Preview" : "1080p"}</span> : <span className="promptSettings">Video generation</span>}</div>
        <button className="sendButton" type="submit" disabled={!canSubmit} aria-label="Generate video" title={busy ? "Wait for this render to finish" : "Generate video (⌘ / Ctrl + Enter)"}><Icon name="arrow" /></button>
      </div>
    </form>
    <p className="composerHint">{!ready ? "Loading your workspace…" : busy ? "Your video is rendering. You can prepare your next prompt." : prompt.length > 0 && prompt.trim().length < 5 ? "Add a little more detail — at least 5 characters." : "Bring your idea into focus.  ⌘ / Ctrl + Enter to generate."}</p>
  </div>;
}
