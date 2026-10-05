"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isActive } from "./cinema/chat-model";
import { GenerationMessage } from "./cinema/generation-message";
import { Icon } from "./cinema/icons";
import { PromptComposer, type ComposerEditDraft } from "./cinema/prompt-composer";
import { Sidebar } from "./cinema/sidebar";
import { useConversations } from "./cinema/use-conversations";

export default function CinemaStudio() {
  const { conversations, activeId, active, ready, notice, retryHistory, newChat, openChat, deleteConversation, stopGeneration, submit } = useConversations();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<ComposerEditDraft | null>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const busy = active?.turns.some((turn) => isActive(turn.status)) || false;
  const chatMode = Boolean(active?.turns.length);
  const turnCount = active?.turns.length || 0;
  const statuses = active?.turns.map((turn) => turn.status).join(",");

  useEffect(() => {
    nearBottom.current = true;
    conversationEnd.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [activeId, turnCount]);

  useEffect(() => {
    if (nearBottom.current) conversationEnd.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "end" });
  }, [statuses]);

  function startNew() { setEditDraft(null); newChat(); closeDrawer(); }
  function selectChat(id: string) { setEditDraft(null); openChat(id); closeDrawer(); }
  function stopCurrentGeneration() {
    if (!active) return;
    const activeTurn = active.turns.find((turn) => isActive(turn.status));
    if (activeTurn) void stopGeneration(active.id, activeTurn.id);
  }
  function editTurn(turn: NonNullable<typeof active>["turns"][number]) {
  setEditDraft({
    id: turn.id,
    prompt: turn.prompt,
    settings: turn.settings,
  });
}

  return <div className={`studioShell ${collapsed ? "sidebarCollapsed" : ""}`}>
    <Sidebar conversations={conversations} activeId={activeId} collapsed={collapsed} drawerOpen={drawerOpen} onCollapse={() => setCollapsed((value) => !value)} onClose={closeDrawer} onNew={startNew} onOpen={selectChat} onDelete={deleteConversation} />
    <main className="studioMain" inert={drawerOpen}>
      <header className="topBar"><div className="topBarLeft"><button className="iconButton mobileMenu" onClick={() => setDrawerOpen(true)} aria-label="Open sidebar" aria-controls="chat-sidebar" aria-expanded={drawerOpen}><Icon name="menu" /></button><span className="topTitle">{active?.title || "Triven Cinema"}</span></div><div className="topBarRight"><span className="topStatus">{process.env.NEXT_PUBLIC_MOCK_MODE === "true" ? "Preview mode" : "Your imagination, in motion"}</span><button className="iconButton" onClick={startNew} aria-label="New chat" title="New chat"><Icon name="plus" /></button></div></header>
      {notice && <div className="historyNotice" role="status">{notice}<button onClick={retryHistory}>Retry</button></div>}
      <div className={`workspaceBody ${chatMode ? "chatMode" : "emptyMode"}`}>
        <div className="conversationScroll" ref={scrollArea} onScroll={() => { const element = scrollArea.current; if (element) nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 140; }}>
          {chatMode ? <div className="conversationColumn" aria-label="Conversation">
            {active?.turns.map((turn) => <section className="conversationTurn" key={turn.id} aria-label="Video request"><div className="userMessage"><span className="srOnly">You: </span>{turn.prompt}</div><GenerationMessage turn={turn} busy={busy} onRegenerate={() => submit(turn.prompt, turn)} onEdit={() => editTurn(turn)} /></section>)}
            <div ref={conversationEnd} />
          </div> : <section className="welcomeState"><div className="welcomeEmblem" aria-hidden="true">T</div><div className="welcomeBadge">TRIVEN CINEMA</div><h1>What do you want<br className="mobileBreak" /> to create?</h1><p>Describe a scene, story, ad or idea.<br />Triven turns it into a finished video.</p></section>}
        </div>
        <PromptComposer
          key={activeId || "new-chat"}
          chatMode={chatMode}
          busy={busy}
          ready={ready}
          onSubmit={(prompt, settings, plan) => submit(prompt, undefined, settings, plan)}
          onStop={stopCurrentGeneration}
          editDraft={editDraft}
          onEditDraftApplied={() => setEditDraft(null)}
        />
        {!chatMode && <div className="emptyFootnote"><span /> One prompt. Endless possibilities.</div>}
      </div>
    </main>
  </div>;
}
