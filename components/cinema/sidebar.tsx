"use client";

import { useEffect, useRef } from "react";
import type { Conversation } from "./chat-model";
import { isActive } from "./chat-model";
import { Icon } from "./icons";

export function Sidebar({ conversations, activeId, collapsed, drawerOpen, onCollapse, onClose, onNew, onOpen, onDelete }: {
  conversations: Conversation[]; activeId: string | null; collapsed: boolean; drawerOpen: boolean;
  onCollapse: () => void; onClose: () => void; onNew: () => void; onOpen: (id: string) => void; onDelete: (id: string) => void;
}) {
  const sidebar = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const elements = [...(sidebar.current?.querySelectorAll<HTMLElement>("button, a[href]") || [])].filter((element) => element.offsetParent !== null);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => { document.removeEventListener("keydown", keyboard); previous?.focus(); };
  }, [drawerOpen, onClose]);

  return <>
    {drawerOpen && <div className="drawerBackdrop" onClick={onClose} aria-hidden="true" />}
    <aside id="chat-sidebar" ref={sidebar} className={`historySidebar ${drawerOpen ? "drawerOpen" : ""}`} aria-label="Chat history" role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen || undefined}>
      <div className="sidebarTop">
        <div className="sidebarBrand"><button className="brandButton" onClick={onNew} title="Triven Cinema — new chat"><span className="brandMark">T</span><span className="sidebarText">Triven Cinema</span></button><button className="iconButton collapseButton" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={onCollapse}><Icon name="panel" size={18} /></button><button ref={closeButton} className="iconButton closeDrawer" aria-label="Close sidebar" onClick={onClose}><Icon name="close" /></button></div>
        <button className="newChatButton" onClick={onNew} title="New chat"><Icon name="plus" size={19} /><span className="sidebarText">New chat</span></button>
      </div>
      <div className="historySection"><div className="historyLabel sidebarText">Your conversations</div><nav className="historyItems" aria-label="Conversations">
        {conversations.map((chat) => {
          const activeGeneration = chat.turns.some((turn) => isActive(turn.status));
          return <div className="historyEntry" key={chat.id}>
            <button className={`historyRow ${activeId === chat.id ? "selected" : ""}`} onClick={() => onOpen(chat.id)} title={chat.title} aria-label={chat.title} aria-current={activeId === chat.id ? "page" : undefined}>
              <Icon name="chat" size={17} />
              <span className="historyPrompt sidebarText">{chat.title}</span>
              {activeGeneration && <span className="historyActivity" aria-label="Generation in progress" />}
            </button>
            <button
              type="button"
              className="historyDelete"
              aria-label={`Delete ${chat.title}`}
              title={activeGeneration ? "Wait for the generation to finish before deleting" : "Delete conversation"}
              disabled={activeGeneration}
              onClick={(event) => {
                event.stopPropagation();
                if (window.confirm("Delete this conversation from your history?")) onDelete(chat.id);
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </div>;
        })}
        {!conversations.length && <p className="historyEmpty sidebarText">A space for your next idea.<br />Your chats will appear here.</p>}
      </nav></div>
      <div className="sidebarFooter"><span className="engineIcon"><Icon name="film" size={18} /></span><div className="sidebarText"><strong>LTX-2.5</strong><span>{process.env.NEXT_PUBLIC_MOCK_MODE === "true" ? "Preview mode" : "Video generation"}</span></div></div>
    </aside>
  </>;
}
