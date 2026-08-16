"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Loader2,
  Send,
  Bot,
  MessagesSquare,
  Users,
  ArrowRight,
  Plus,
  ChevronDown,
  CalendarRange,
  Check,
  Square,
  Trash2,
  Folder,
} from "lucide-react";
import { EMPLOYEE_PERSONAS } from "@/lib/ai/employee-personas";
import { EmployeeAvatar } from "@/components/EmployeeAvatar";
import {
  getChats,
  getMessages,
  getOrCreateEmployeeChat,
  getOrCreateTeamChat,
  moveChatToWorkspace,
  getTenantWorkspaces,
  createChatRoom,
  cancelTeamTask,
  inviteEmployeeToChat,
  deleteChat as deleteChatAction,
  setChatFolder,
  type TeamChat,
  type TeamChatSummary,
  type TeamMessage,
} from "@/lib/ai-team-chat";
import { EMPLOYEE_KEYS } from "@/lib/ai/employee-keys";

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-lime-600",
  "bg-orange-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function colorFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function employeeName(key: string | null): string {
  if (!key) return "You";
  return EMPLOYEE_PERSONAS[key]?.name ?? key;
}

function employeeRole(key: string | null): string {
  if (!key) return "";
  return EMPLOYEE_PERSONAS[key]?.role ?? "";
}

/**
 * Unread indicator light for a chat. Green = routine replies, orange =
 * important (a draft/plan landed), red = urgent (a failure). Hidden when
 * there's nothing unread.
 */
function UnreadDot({
  chat,
}: {
  chat: { unreadCount?: number; unreadPriority?: string };
}) {
  const count = chat.unreadCount ?? 0;
  if (count === 0) return null;
  const color =
    chat.unreadPriority === "urgent"
      ? "bg-red-500"
      : chat.unreadPriority === "important"
        ? "bg-orange-500"
        : "bg-emerald-500";
  return (
    <span
      className="ml-auto inline-flex items-center gap-1 shrink-0"
      title={`${count} new message${count === 1 ? "" : "s"}`}
    >
      <span className={`size-2 rounded-full ${color}`} />
      <span className="text-[10px] font-semibold text-muted-foreground">
        {count}
      </span>
    </span>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Merge two message lists by id (newest server copy wins) and sort by time. */
function mergeMessages(
  prev: TeamMessage[],
  incoming: TeamMessage[]
): TeamMessage[] {
  const byId = new Map<string, TeamMessage>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
}

export default function AiTeamChatPage() {
  const [chats, setChats] = useState<TeamChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [input, setInput] = useState("");
  // Task ids in flight — the send endpoint enqueues work (Inngest background
  // tasks in prod, inline fire-and-forget in dev) and returns instantly, so a
  // task is "pending" until its final message (metadata.taskId) lands via
  // polling. Multiple agents can work at once: you can message Cyril while
  // Cheryl is still generating content, and both replies stream into the same
  // thread.
  const [pendingTasks, setPendingTasks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
    []
  );
  const [moving, setMoving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  // Chat history expand/collapse — keep the section compact so the employee
  // list stays visible; persisted locally.
  const [historyOpen, setHistoryOpen] = useState(() => {
    try {
      return window.localStorage.getItem("chat-history-open") !== "0";
    } catch {
      return true;
    }
  });
  const toggleHistory = () => {
    setHistoryOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("chat-history-open", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };
  const threadRef = useRef<HTMLDivElement>(null);

  // Per-chat last-read timestamps (localStorage) — drives the unread
  // indicator lights. Marked read when a chat is opened and while the user
  // is watching it during polling.
  const [lastReadAt, setLastReadAt] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(
        window.localStorage.getItem("chat-last-read") ?? "{}"
      ) as Record<string, string>;
    } catch {
      return {};
    }
  });
  const persistLastRead = (next: Record<string, string>) => {
    try {
      window.localStorage.setItem("chat-last-read", JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  // Live mirror of lastReadAt for the unread-count poll below (avoids stale
  // closure over state in the interval callback). Kept in sync inside
  // markRead — writing refs during render is disallowed.
  const lastReadRef = useRef(lastReadAt);
  const markRead = useCallback((chatId: string | null) => {
    if (!chatId) return;
    setLastReadAt((prev) => {
      // Throttle so constant polling doesn't rewrite storage every 4s.
      const prevAt = prev[chatId];
      if (prevAt && Date.now() - new Date(prevAt).getTime() < 15000) {
        return prev;
      }
      const next = { ...prev, [chatId]: new Date().toISOString() };
      persistLastRead(next);
      lastReadRef.current = next;
      return next;
    });
  }, []);

  // Staleness clock for status chips — refreshed every 30s so a dead task
  // resolves to the "didn't complete — Retry" state without needing a new
  // message poll. (Date.now in state, not render.)
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);

  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

  // Load chats on mount, create the Team Room, honor ?employee= deep link.
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        let list: TeamChatSummary[] = [];
        const lastRead: Record<string, string> = (() => {
          try {
            return JSON.parse(
              window.localStorage.getItem("chat-last-read") ?? "{}"
            ) as Record<string, string>;
          } catch {
            return {};
          }
        })();
        const existing = await getChats(lastRead);
        if (existing.success && existing.data) list = existing.data;

        const team = await getOrCreateTeamChat();
        if (team.success && team.data) {
          if (!list.some((c) => c.id === team.data!.id)) {
            list = [...list, team.data];
          }
        }

        // Deep link: open a DM for the requested employee.
        const params = new URLSearchParams(window.location.search);
        const employeeKey = params.get("employee");
        if (employeeKey && (EMPLOYEE_KEYS as readonly string[]).includes(employeeKey)) {
          const dm = await getOrCreateEmployeeChat(employeeKey);
          if (dm.success && dm.data) {
            if (!list.some((c) => c.id === dm.data!.id)) {
              list = [...list, dm.data];
            }
            setActiveChatId(dm.data.id);
          } else {
            setActiveChatId(team.success && team.data ? team.data.id : null);
          }
        } else {
          setActiveChatId(team.success && team.data ? team.data.id : null);
        }

        setChats(list.sort((a, b) => a.created_at.localeCompare(b.created_at)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load chats");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load the tenant's workspaces once (for the Move-to-workspace control).
  useEffect(() => {
    (async () => {
      const res = await getTenantWorkspaces();
      if (res.success && res.data) setWorkspaces(res.data);
    })();
  }, []);

  const moveToWorkspace = async (targetWorkspaceId: string) => {
    if (!activeChatId || !targetWorkspaceId || moving) return;
    setMoving(true);
    setError(null);
    try {
      const res = await moveChatToWorkspace(activeChatId, targetWorkspaceId);
      if (!res.success || !res.data) {
        setError(res.error ?? "Failed to move chat.");
        return;
      }
      // The chat now lives in another workspace — this workspace's list is
      // per-workspace, so refresh to reflect the isolation.
      window.location.reload();
    } catch {
      setError("Failed to move chat.");
    } finally {
      setMoving(false);
    }
  };

  // Load messages whenever the active chat changes.
  useEffect(() => {
    if (!activeChatId) return;
    markRead(activeChatId);
    let cancelled = false;
    (async () => {
      const res = await getMessages(activeChatId);
      if (!cancelled) {
        if (res.success && res.data) setMessages(res.data);
        else if (res.error) setError(res.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  // While any task is in flight, poll for the messages the worker inserts as
  // it goes ("Malory is reviewing…" → handoff → "Cheryl is writing the post…"
  // → final reply), so the user sees live progress instead of a bare spinner.
  // A task resolves when its final message (metadata.taskId === taskId) lands.
  useEffect(() => {
    if (!activeChatId || pendingTasks.length === 0) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const res = await getMessages(activeChatId);
      if (stopped || !res.success || !res.data) return;
      const msgs = res.data;
      setMessages((prev) => mergeMessages(prev, msgs));
      // The owner is watching this chat — keep its light off while replies
      // stream in.
      markRead(activeChatId);
      // A task only counts as landed when its FINAL message arrives — an
      // employee reply (the handoff and intermediate checklists like
      // Woodhouse's connection checklist don't count) or a terminal failure/
      // cancellation status. The "reviewing"/"working" status lines carry
      // the same taskId, so counting any message with it would clear the poll
      // on the first tick and the real replies would never be fetched.
      const isFinal = (m: (typeof msgs)[number]) => {
        if (typeof m.metadata?.taskId !== "string") return false;
        const meta = m.metadata as Record<string, unknown>;
        if (m.role === "system") {
          return meta.stage === "failed" || meta.stage === "cancelled";
        }
        return (
          m.role === "employee" &&
          !meta.dispatch &&
          meta.action !== "connections_checklist"
        );
      };
      const landed = new Set(
        msgs.filter(isFinal).map((m) => m.metadata?.taskId as string)
      );
      setPendingTasks((prev) => {
        const next = prev.filter((t) => !landed.has(t));
        return next.length === prev.length ? prev : next;
      });
    };
    void tick();
    const iv = setInterval(tick, 4000);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [activeChatId, pendingTasks.length]);

  // Keep the sidebar unread lights fresh without a full page refresh: every
  // 10s re-pull the chat list with unread counts. The active chat is excluded
  // (it's already marked read + watched), so lights tick down/up live as
  // messages land in other chats and as this one is read.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const res = await getChats(lastReadRef.current);
      if (stopped || !res.success || !res.data) return;
      const fresh = res.data;
      setChats((prev) => {
        const freshById = new Map(fresh.map((c) => [c.id, c]));
        const merged = prev.map((c) => {
          const n = freshById.get(c.id);
          return n
            ? { ...c, unreadCount: n.unreadCount, unreadPriority: n.unreadPriority }
            : c;
        });
        for (const n of fresh) {
          if (!merged.some((c) => c.id === n.id)) merged.push(n);
        }
        return merged.sort((a, b) =>
          a.created_at.localeCompare(b.created_at)
        );
      });
    };
    void tick();
    const iv = setInterval(tick, 10000);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, pendingTasks.length]);

  const sendContent = useCallback(
    async (content: string) => {
      if (!content || !activeChatId) return;
      setError(null);
      try {
        const res = await fetch("/api/ai-team/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId: activeChatId, content }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to send message");
        } else {
          if (Array.isArray(data.messages)) {
            setMessages((prev) => mergeMessages(prev, data.messages));
          }
          // The endpoint returns fast — the work runs in the background, so
          // track the task id until its final message arrives via polling.
          if (typeof data.taskId === "string" && data.taskId) {
            setPendingTasks((prev) => [...prev, data.taskId]);
          }
        }
      } catch {
        setError("Network error — check your connection and try again.");
      }
    },
    [activeChatId]
  );

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content) return;
    setInput("");
    await sendContent(content);
  }, [input, sendContent]);

  // A status chip with a taskId spins until the task's final message lands.
  // If the task died before posting anything else (old builds that round-
  // tripped through the cloud worker lost runs silently), the chip would spin
  // forever — so the Retry button re-sends the original request that preceded
  // that stuck status, giving the owner a way out of a dead task.
  const retryStuck = useCallback(
    async (msg: TeamMessage) => {
      const priorUser = [...messages]
        .filter(
          (m) => m.role === "user" && m.created_at <= msg.created_at
        )
        .pop();
      if (!priorUser) {
        setError("Couldn't find the original request to retry.");
        return;
      }
      await sendContent(priorUser.content);
    },
    [messages, sendContent]
  );

  const removeChat = useCallback(
    async (chatId: string, title: string) => {
      if (
        !window.confirm(
          `Delete "${title}" and its entire message history? This can't be undone.`
        )
      )
        return;
      const res = await deleteChatAction(chatId);
      if (!res.success) {
        setError(res.error ?? "Failed to delete chat.");
        return;
      }
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        const team = chats.find((c) => c.kind === "team");
        setActiveChatId(team ? team.id : null);
        setMessages([]);
        setPendingTasks([]);
      }
    },
    [activeChatId, chats]
  );

  const [folderDraft, setFolderDraft] = useState("");
  // Set when Enter commits the folder so the immediate onBlur (caused by the
  // commit clearing the input) doesn't overwrite the folder with an empty
  // value. Reset on the next blur.
  const suppressBlur = useRef(false);

  const applyFolder = useCallback(async () => {
    if (!activeChatId || activeChat?.kind === "team") return;
    const value = folderDraft.trim();
    const folder = value ? value.replace(/\s+/g, " ").slice(0, 60) : null;
    const res = await setChatFolder(activeChatId, folder);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to set folder.");
      return;
    }
    setChats((prev) =>
      prev.map((c) => (c.id === res.data!.id ? res.data! : c))
    );
    setFolderDraft("");
  }, [activeChatId, activeChat?.kind, folderDraft]);

  const createRoom = async (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setCreating(false);
    setNewTitle("");
    const res = await createChatRoom(title);
    if (res.success && res.data) {
      setChats((prev) =>
        prev.some((c) => c.id === res.data!.id) ? prev : [...prev, res.data!]
      );
      setActiveChatId(res.data.id);
    } else {
      setError(res.error ?? "Failed to create chat.");
    }
  };

  const teamRoom = chats.find((c) => c.kind === "team");
  const rooms = chats.filter((c) => c.kind === "room");
  const dms = chats.filter((c) => c.kind === "employee");
  // Rooms grouped by folder (unfiled last), plus the distinct folder names
  // for the folder picker in the chat header.
  const folderGroups = useMemo(() => {
    const map = new Map<string | null, TeamChatSummary[]>();
    for (const r of rooms) {
      const f = r.folder?.trim() || null;
      if (!map.has(f)) map.set(f, []);
      map.get(f)!.push(r);
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return a[0]!.localeCompare(b[0]!);
    });
  }, [rooms]);
  const allFolders = useMemo(
    () =>
      [...new Set(chats.map((c) => c.folder?.trim() || "").filter(Boolean))].sort(),
    [chats]
  );

  // Employees currently in the active chat (a DM has one; a group room has N).
  const activeParticipants: string[] = activeChat
    ? activeChat.kind === "employee" && activeChat.employee_key
      ? [activeChat.employee_key]
      : Array.isArray(activeChat.participants)
        ? (activeChat.participants as string[])
        : []
    : [];

  const stopTasks = useCallback(async () => {
    if (!activeChatId) return;
    const ids = [...pendingTasks];
    setPendingTasks([]);
    for (const taskId of ids) {
      await cancelTeamTask(activeChatId, taskId);
    }
    const res = await getMessages(activeChatId);
    if (res.success && res.data) setMessages(res.data);
  }, [activeChatId, pendingTasks]);

  const inviteToChat = async (employeeKey: string) => {
    if (!activeChatId) return;
    setError(null);
    const res = await inviteEmployeeToChat(activeChatId, employeeKey);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to invite employee.");
      return;
    }
    setChats((prev) =>
      prev.map((c) => (c.id === res.data!.id ? res.data! : c))
    );
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-10">
        <Loader2 className="size-4 animate-spin" /> Loading your team chat…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessagesSquare className="size-6 text-primary" /> AI Team Chat
        </h1>
        <p className="text-muted-foreground">
          Talk to your team. Malory dispatches work in the Team Room — ask for a blog and watch
          her hand it to Cheryl, who writes it, generates the images, and saves the draft.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md text-sm bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4 items-start">
        {/* Sidebar */}
        <aside className="rounded-lg border bg-card overflow-hidden">
          <div className="p-3 border-b">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Rooms
            </p>
          </div>
          <button
            onClick={() => teamRoom && setActiveChatId(teamRoom.id)}
            className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/50 transition-colors ${
              activeChat?.kind === "team" ? "bg-muted/70 font-semibold" : ""
            }`}
          >
            <Users className="size-4 text-primary shrink-0" />
            <span className="truncate">Team Room</span>
            {teamRoom && <UnreadDot chat={teamRoom} />}
          </button>

          {/* Start a new chat — rooms are named, unlimited per workspace, and
              their full history stays in the sidebar for revisiting. */}
          <div className="px-3 py-2 border-t">
            <button
              onClick={() => setCreating((v) => !v)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
            >
              <Plus className="size-4 shrink-0" />
              <span>{creating ? "Cancel" : "New chat"}</span>
            </button>
            {creating && (
              <form onSubmit={(e) => void createRoom(e)} className="mt-2 space-y-2">
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Chat title (e.g. Coal Creek launch)"
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="w-full rounded-md bg-primary text-primary-foreground px-2 py-1.5 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  Create chat
                </button>
              </form>
            )}
          </div>

          {rooms.length > 0 && (
            <>
              <div className="p-3 border-b border-t">
                <button
                  onClick={toggleHistory}
                  className="w-full flex items-center gap-1.5 text-left"
                  aria-expanded={historyOpen}
                >
                  <ChevronDown
                    className={`size-3.5 text-muted-foreground transition-transform ${
                      historyOpen ? "rotate-0" : "-rotate-90"
                    }`}
                  />
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Chats
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground/70 bg-muted rounded-full px-1.5 py-0.5">
                    {rooms.length}
                  </span>
                </button>
              </div>
              {historyOpen && (
                <div className="max-h-40 overflow-y-auto">
                  {folderGroups.map(([folder, items]) => (
                    <div key={folder ?? "__unfiled"}>
                      <p className="px-3 pt-2 pb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                        {folder ? (
                          <>
                            <Folder className="size-3" /> {folder}
                          </>
                        ) : (
                          "Unfiled"
                        )}
                      </p>
                      {items.map((room) => (
                        <div key={room.id} className="group flex items-center">
                          <button
                            onClick={() => setActiveChatId(room.id)}
                            className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors ${
                              activeChat?.id === room.id
                                ? "bg-muted/70 font-semibold"
                                : ""
                            }`}
                          >
                            <MessagesSquare className="size-4 text-muted-foreground shrink-0" />
                            <span className="truncate">{room.title}</span>
                            <UnreadDot chat={room} />
                          </button>
                          <button
                            onClick={() => void removeChat(room.id, room.title)}
                            title="Delete chat"
                            className="mr-1 p-1 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="p-3 border-b border-t">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Direct messages
            </p>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {EMPLOYEE_KEYS.map((key) => {
              const dm = dms.find((d) => d.employee_key === key);
              const persona = EMPLOYEE_PERSONAS[key];
              return (
                <div key={key} className="group flex items-center">
                  <button
                    onClick={async () => {
                      if (dm) {
                        setActiveChatId(dm.id);
                        return;
                      }
                      const res = await getOrCreateEmployeeChat(key);
                      if (res.success && res.data) {
                        setChats((prev) =>
                          prev.some((c) => c.id === res.data!.id)
                            ? prev
                            : [...prev, res.data!]
                        );
                        setActiveChatId(res.data.id);
                      }
                    }}
                    className={`flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors ${
                      activeChat?.employee_key === key
                        ? "bg-muted/70 font-semibold"
                        : ""
                    }`}
                  >
                    <EmployeeAvatar employeeKey={key} name={persona?.name ?? key} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate">{persona?.name ?? key}</span>
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {persona?.role ?? "AI Employee"}
                      </span>
                    </span>
                    {dm && <UnreadDot chat={dm} />}
                  </button>
                  {dm && (
                    <button
                      onClick={() => void removeChat(dm.id, persona?.name ?? key)}
                      title="Delete chat"
                      className="mr-1 p-1 rounded-md text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Thread */}
        <section className="rounded-lg border bg-card flex flex-col h-[65vh] md:h-[70vh]">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            {/* Folder control — file this chat into a folder/project. Enter
                or blur commits; a blurred Enter is suppressed so the commit
                isn't immediately undone by the empty blur. */}
            {activeChat && activeChat.kind !== "team" && (
              <div className="ml-auto flex items-center gap-1">
                <Folder className="size-3.5 text-muted-foreground" />
                <input
                  list="chat-folder-list"
                  value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      suppressBlur.current = true;
                      void applyFolder();
                    }
                  }}
                  onBlur={() => {
                    if (suppressBlur.current) {
                      suppressBlur.current = false;
                      return;
                    }
                    void applyFolder();
                  }}
                  placeholder={
                    activeChat.folder?.trim() || "Folder…"
                  }
                  title="File this chat into a folder/project"
                  className="w-28 rounded-md border border-input bg-background px-2 py-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <datalist id="chat-folder-list">
                  {allFolders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
            )}
            {/* Workspace label + move control — chats are isolated per
                workspace; moving relocates a chat for per-client campaigns. */}
            {activeChat && workspaces.length > 1 && (
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground max-w-28 truncate" title={workspaces.find((w) => w.id === activeChat.workspace_id)?.name}>
                  {workspaces.find((w) => w.id === activeChat.workspace_id)?.name ?? ""}
                </span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) void moveToWorkspace(e.target.value);
                  }}
                  disabled={moving}
                  aria-label="Move chat to workspace"
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs text-muted-foreground disabled:opacity-50"
                >
                  <option value="" disabled>
                    {moving ? "Moving…" : "Move to workspace…"}
                  </option>
                  {workspaces
                    .filter((w) => w.id !== activeChat.workspace_id)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {activeChat?.kind === "employee" ? (
              <>
                <EmployeeAvatar
                  employeeKey={activeChat.employee_key ?? ""}
                  name={employeeName(activeChat.employee_key)}
                  size={28}
                />
                <div>
                  <p className="text-sm font-semibold leading-tight">
                    {employeeName(activeChat.employee_key)}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {employeeRole(activeChat.employee_key)}
                  </p>
                </div>
              </>
            ) : activeChat?.kind === "room" ? (
              <>
                <MessagesSquare className="size-5 text-primary" />
                <div>
                  <p className="text-sm font-semibold leading-tight">
                    {activeChat.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {activeParticipants.length > 0
                      ? `Group chat: ${activeParticipants
                          .map((k) => EMPLOYEE_PERSONAS[k]?.name ?? k)
                          .join(", ")}`
                      : "Team chat — Malory dispatches here too"}
                  </p>
                </div>
              </>
            ) : (
              <>
                <Bot className="size-5 text-primary" />
                <div>
                  <p className="text-sm font-semibold leading-tight">Team Room</p>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Malory dispatches the team here
                  </p>
                </div>
              </>
            )}
          </div>

          <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm py-10">
                <Bot className="size-8 mx-auto mb-2 opacity-30" />
                {activeChat?.kind === "employee" ? (
                  <>
                    Say hello to <span className="font-medium">{employeeName(activeChat.employee_key)}</span>.
                    <br />
                    {activeChat.employee_key === "penny" ? (
                      <>Try: &ldquo;write a blog post about small business SEO&rdquo; to get a draft generated.</>
                    ) : activeChat.employee_key === "nina" ? (
                      <>Try: &ldquo;plan a campaign for our spring launch&rdquo; to get a dated content plan.</>
                    ) : (
                      <>Ask me anything about {employeeRole(activeChat.employee_key)} — I&apos;ll point you to the right teammate if it&apos;s outside my lane.</>
                    )}
                  </>
                ) : (
                  <>
                    Ask the whole team for anything.
                    <br />
                    Try: &ldquo;write a launch blog for Coal Creek with images&rdquo; — Malory dispatches, Cheryl writes.
                  </>
                )}
              </div>
            )}

            {messages.map((msg, idx) => {
              const prev = messages[idx - 1];
              const isUser = msg.role === "user";
              const isSystem = msg.role === "system";
              const meta = msg.metadata ?? {};
              const isHandoff =
                msg.employee_key === "nina" && meta.dispatch === true;
              const senderChanged =
                !isUser && !isSystem && prev && prev.employee_key !== msg.employee_key;

              // System status lines (progress): centered, no avatar. They spin
              // only while their task is in flight — once the task's final
              // message (same metadata.taskId) lands, they resolve to a check.
              if (isSystem) {
                const statusTaskId = meta.taskId as string | undefined;
                const failed = meta.stage === "failed";
                const resolved = failed
                  ? true
                  : statusTaskId
                    ? messages.some(
                        (m) =>
                          m.id !== msg.id &&
                          m.metadata?.taskId === statusTaskId
                      )
                    : true; // legacy rows without a taskId — never spin
                // A status older than 4 minutes with no resolving message is
                // a dead task (the old builds lost runs silently) — stop
                // spinning and offer a Retry instead of loading forever.
                const ageMs =
                  nowTick - new Date(msg.created_at).getTime();
                const stuck =
                  !resolved && !!statusTaskId && ageMs > 4 * 60 * 1000;
                return (
                  <div key={msg.id} className="flex justify-center py-0.5">
                    <div
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] ${
                        stuck
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-muted/50 border-transparent text-muted-foreground"
                      }`}
                    >
                      {stuck ? (
                        <>
                          <span className="font-bold" aria-hidden>
                            !
                          </span>
                          <span className="whitespace-pre-wrap break-words">
                            This request didn&apos;t complete — the task was
                            lost.{" "}
                          </span>
                          <button
                            onClick={() => void retryStuck(msg)}
                            className="font-semibold underline underline-offset-2 hover:text-amber-900"
                          >
                            Retry
                          </button>
                        </>
                      ) : resolved ? (
                        <Check className="size-3 text-emerald-500" />
                      ) : (
                        <Loader2 className="size-3 animate-spin" />
                      )}
                      {!stuck && (
                        <span className="whitespace-pre-wrap break-words">
                          {msg.content}
                        </span>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div key={msg.id} className="space-y-1">
                  {/* Handoff chip: Malory → {employee} */}
                  {isHandoff && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                        <span className="font-semibold">Malory</span>
                        <ArrowRight className="size-3" />
                        <span className="font-semibold">
                          {employeeName(meta.dispatchTo as string)}
                        </span>
                      </span>
                      <span>handing off</span>
                    </div>
                  )}
                  {senderChanged && !isHandoff && (
                    <div className="text-[11px] text-muted-foreground pt-1">
                      — {employeeName(prev?.employee_key)} → {employeeName(msg.employee_key)} —
                    </div>
                  )}
                  <div
                    className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    {!isUser && (
                      <EmployeeAvatar
                        employeeKey={msg.employee_key ?? ""}
                        name={employeeName(msg.employee_key)}
                        size={28}
                        className="mt-1"
                      />
                    )}
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        {!isUser && (
                          <span className="text-[11px] font-semibold text-primary">
                            {employeeName(msg.employee_key)}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap break-words mt-0.5">
                        {msg.content}
                      </p>
                      {meta.action === "content_generated" && !!meta.postUrl && (
                        <a
                          href={meta.postUrl as string}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Bot className="size-3.5" />
                          View draft: {String(meta.postTitle ?? "Blog post")}
                        </a>
                      )}
                      {meta.action === "campaign_planned" && !!meta.planUrl && (
                        <a
                          href={meta.planUrl as string}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                        >
                          <CalendarRange className="size-3.5" />
                          Open campaign on the calendar: {String(meta.planTitle ?? "Campaign")}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {pendingTasks.length > 0 && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <EmployeeAvatar
                  employeeKey={activeChat?.employee_key ?? "nina"}
                  name={employeeName(activeChat?.employee_key ?? "nina")}
                  size={28}
                />
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="size-3.5 animate-spin" />
                  {pendingTasks.length > 1
                    ? `${pendingTasks.length} agents working…`
                    : "Working…"}
                </span>
              </div>
            )}
          </div>

          <div className="p-3 border-t">
            {(pendingTasks.length > 0 ||
              activeChat?.kind === "employee" ||
              (activeChat?.kind === "room" && activeParticipants.length > 0)) && (
              <div className="flex items-center gap-2 mb-2">
                {pendingTasks.length > 0 && (
                  <button
                    onClick={() => void stopTasks()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
                  >
                    <Square className="size-3" />
                    Stop {pendingTasks.length > 1 ? `(${pendingTasks.length})` : ""}
                  </button>
                )}
                {(activeChat?.kind === "employee" ||
                  (activeChat?.kind === "room" && activeParticipants.length > 0)) && (
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) void inviteToChat(e.target.value);
                    }}
                    className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-muted-foreground"
                    aria-label="Invite an employee"
                  >
                    <option value="" disabled>
                      Invite an employee…
                    </option>
                    {EMPLOYEE_KEYS.filter((k) => !activeParticipants.includes(k)).map((k) => (
                      <option key={k} value={k}>
                        {EMPLOYEE_PERSONAS[k]?.name ?? k}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder={
                  activeChat?.kind === "employee"
                    ? `Message ${employeeName(activeChat.employee_key)}…`
                    : "Ask the team… (Enter to send, Shift+Enter for a new line)"
                }
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                onClick={() => void send()}
                disabled={!input.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Send className="size-4" />
                Send
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
