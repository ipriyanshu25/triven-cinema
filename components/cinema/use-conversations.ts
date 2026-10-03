"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScenePlanItem } from "@/lib/types";
import { conversationTitle, inferPromptSettings, isActive, turnFromJob, type Conversation, type Generation, type Turn } from "./chat-model";

const STORAGE_KEY = "triven.conversations.v1";

function readConversations(): Conversation[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    // Validate browser storage before using it as UI state.
    return parsed.filter((item): item is Conversation => Boolean(item && typeof item.id === "string" && typeof item.title === "string" && typeof item.createdAt === "string" && Array.isArray(item.turns) && item.turns.every((turn: Turn) => turn && typeof turn.id === "string" && typeof turn.prompt === "string" && typeof turn.status === "string" && turn.settings && ["16:9", "9:16", "1:1"].includes(turn.settings.aspectRatio) && (!turn.job || typeof turn.job.id === "string")))).map((chat) => ({
      ...chat,
      turns: chat.turns.map((turn) => !turn.job && isActive(turn.status) ? { ...turn, status: "FAILED" } : turn),
    }));
  } catch { return []; }
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const submitting = useRef(new Set<string>());
  const controllers = useRef(new Set<AbortController>());
  const initialized = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      const saved = readConversations();
      try {
        const response = await fetch("/api/generations?limit=20", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("history");
        const jobs: Generation[] = await response.json();
        if (controller.signal.aborted) return;
        const firstLoad = !initialized.current;
        setConversations((current) => {
          const chats = firstLoad ? saved : current;
          const known = new Set(chats.flatMap((chat) => chat.turns.flatMap((turn) => turn.job ? [turn.job.id] : [])));
          const byId = new Map(jobs.map((job) => [job.id, job]));
          return [
            ...chats.map((chat) => ({ ...chat, turns: chat.turns.map((turn) => {
              const job = turn.job && byId.get(turn.job.id);
              return job ? { ...turn, job, status: job.status } : turn;
            }) })),
            ...jobs.filter((job) => !known.has(job.id)).map((job) => ({ id: `job:${job.id}`, title: conversationTitle(job.prompt), createdAt: job.createdAt, turns: [turnFromJob(job)] })),
          ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        });
        setNotice("");
      } catch {
        if (controller.signal.aborted) return;
        if (!initialized.current) setConversations(saved);
        setNotice("Couldn’t load saved history. You can retry or start a new chat.");
      }
      initialized.current = true;
      setReady(true);
    }
    void initialize();
    return () => controller.abort();
  }, [historyAttempt]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)); } catch { /* Server history remains available when browser storage is unavailable. */ }
  }, [conversations, ready]);

  useEffect(() => {
    const pending = controllers.current;
    return () => { pending.forEach((controller) => controller.abort()); };
  }, []);

  const updateTurn = useCallback((chatId: string, turnId: string, update: Partial<Turn>) => {
    setConversations((chats) => chats.map((chat) => chat.id === chatId ? { ...chat, turns: chat.turns.map((turn) => turn.id === turnId ? { ...turn, ...update } : turn) } : chat));
  }, []);

  // One polling loop, keyed by stable job IDs. Requests never depend on the open chat.
  const pendingJobs = JSON.stringify(conversations.flatMap((chat) => chat.turns.filter((turn) => turn.job && isActive(turn.status)).map((turn) => ({ chatId: chat.id, turnId: turn.id, jobId: turn.job!.id }))));
  useEffect(() => {
    const jobs: { chatId: string; turnId: string; jobId: string }[] = JSON.parse(pendingJobs);
    if (!jobs.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await Promise.all(jobs.map(async ({ chatId, turnId, jobId }) => {
        try {
          const response = await fetch(`/api/generations/${encodeURIComponent(jobId)}`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("status");
          const job: Generation = await response.json();
          if (!controller.signal.aborted) updateTurn(chatId, turnId, { job, status: job.status, connectionLost: false });
        } catch {
          if (!controller.signal.aborted) updateTurn(chatId, turnId, { connectionLost: true });
        }
      }));
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pendingJobs, updateTurn]);

  const newChat = () => setActiveId(null);
  const openChat = (id: string) => setActiveId(id);

  const deleteConversation = useCallback(async (chatId: string) => {
    const chat = conversations.find((conversation) => conversation.id === chatId);
    if (!chat) return false;

    if (chat.turns.some((turn) => isActive(turn.status))) {
      setNotice("Wait for the active generation to finish before deleting this conversation.");
      return false;
    }

    const generationIds = [...new Set(chat.turns.map((turn) => turn.job?.id).filter((id): id is string => Boolean(id)))];

    try {
      for (const generationId of generationIds) {
        const response = await fetch(`/api/generations/${encodeURIComponent(generationId)}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error("delete");
      }

      setConversations((current) => current.filter((conversation) => conversation.id !== chatId));
      setActiveId((current) => current === chatId ? null : current);
      setNotice("");
      return true;
    } catch {
      setNotice("Couldn’t delete this conversation. Please try again.");
      return false;
    }
  }, [conversations]);

  function submit(rawPrompt: string, original?: Turn): boolean {
    const prompt = rawPrompt.trim();
    if (!ready || prompt.length < 5 || prompt.length > 8000) return false;
    const chatId = activeId || crypto.randomUUID();
    if (submitting.current.has(chatId) || conversations.find((chat) => chat.id === chatId)?.turns.some((turn) => isActive(turn.status))) return false;
    submitting.current.add(chatId);
    const settings = original?.settings || inferPromptSettings(prompt);
    const turn: Turn = { id: crypto.randomUUID(), prompt, settings, status: settings.mode === "SCENES" ? "PLANNING" : "STARTING" };
    setConversations((chats) => {
      if (chats.some((chat) => chat.id === chatId)) return chats.map((chat) => chat.id === chatId ? { ...chat, turns: [...chat.turns, turn] } : chat);
      return [{ id: chatId, title: conversationTitle(prompt), createdAt: new Date().toISOString(), turns: [turn] }, ...chats];
    });
    setActiveId(chatId);
    const controller = new AbortController();
    controllers.current.add(controller);

    void (async () => {
      try {
        let scenes: ScenePlanItem[] | undefined = original?.job?.scenes;
        let continuityContext = original?.job?.metadata?.continuityContext || "";
        if (settings.mode === "SCENES" && !scenes?.length) {
          const response = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal, body: JSON.stringify({ prompt, durationSeconds: settings.durationSeconds, aspectRatio: settings.aspectRatio }) });
          if (!response.ok) throw new Error("planning");
          const plan = await response.json();
          scenes = plan.scenes;
          continuityContext = plan.continuityContext || "";
        }
        if (controller.signal.aborted) return;
        updateTurn(chatId, turn.id, { status: "STARTING" });
        const response = await fetch("/api/generations", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ prompt, mode: settings.mode, aspectRatio: settings.aspectRatio, quality: settings.quality, durationSeconds: settings.durationSeconds, model: "ltx-2.5", nativeAudio: original?.job?.nativeAudio ?? true, enhancePrompt: original?.job?.enhancePrompt ?? false, seed: Math.floor(Math.random() * 2_147_483_647), continuityContext, scenes }),
        });
        const job: Generation = await response.json();
        // The API can return a persisted failed job with HTTP 502; retain its ID.
        if (job.id && job.status) updateTurn(chatId, turn.id, { job, status: job.status });
        else throw new Error("submission");
      } catch {
        if (!controller.signal.aborted) updateTurn(chatId, turn.id, { status: "FAILED" });
      } finally {
        submitting.current.delete(chatId);
        controllers.current.delete(controller);
      }
    })();
    return true;
  }

  return { conversations, activeId, active: conversations.find((chat) => chat.id === activeId), ready, notice, retryHistory: () => setHistoryAttempt((value) => value + 1), newChat, openChat, deleteConversation, submit };
}
