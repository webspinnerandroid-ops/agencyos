"use client";

import {
  useCallback,
  useEffect,
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
} from "lucide-react";
import { EMPLOYEE_PERSONAS } from "@/lib/ai/employee-personas";
import {
  getChats,
  getMessages,
  getOrCreateEmployeeChat,
  getOrCreateTeamChat,
  moveChatToWorkspace,
  getTenantWorkspaces,
  createChatRoom,
  type TeamChat,
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
  const [chats, setChats] = useState<TeamChat[]>([]);
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

  const activeChat = chats.find((c) => c.id === activeChatId) ?? null;

  // Load chats on mount, create the Team Room, honor ?employee= deep link.
  useEffect(() => {
    (async () => {
      setError(null);
      try {
        let list: TeamChat[] = [];
        const existing = await getChats();
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
      const landed = new Set(
        msgs
          .map((m) => m.metadata?.taskId)
          .filter((t): t is string => typeof t === "string")
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

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, pendingTasks.length]);

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || !activeChatId) return;
    setInput("");
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
        setInput(content); // restore for retry
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
      setInput(content);
    }
  }, [input, activeChatId]);

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
  // Show all employees in the sidebar; existing DMs are marked.
  const dmKeys = new Set(dms.map((d) => d.employee_key));

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
                  {rooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setActiveChatId(room.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors ${
                        activeChat?.id === room.id ? "bg-muted/70 font-semibold" : ""
                      }`}
                    >
                      <MessagesSquare className="size-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{room.title}</span>
                    </button>
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
                <button
                  key={key}
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
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors ${
                    activeChat?.employee_key === key ? "bg-muted/70 font-semibold" : ""
                  }`}
                >
                  <span
                    className={`size-7 rounded-full ${colorFor(key)} text-white text-xs font-bold flex items-center justify-center shrink-0`}
                  >
                    {(persona?.name ?? key).charAt(0)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{persona?.name ?? key}</span>
                    <span className="block text-[11px] text-muted-foreground truncate">
                      {persona?.role ?? "AI Employee"}
                    </span>
                  </span>
                  {dmKeys.has(key) && (
                    <span className="ml-auto size-1.5 rounded-full bg-primary shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Thread */}
        <section className="rounded-lg border bg-card flex flex-col h-[65vh] md:h-[70vh]">
          <div className="px-4 py-3 border-b flex items-center gap-2">
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
                <span
                  className={`size-7 rounded-full ${colorFor(activeChat.employee_key ?? "")} text-white text-xs font-bold flex items-center justify-center`}
                >
                  {employeeName(activeChat.employee_key).charAt(0)}
                </span>
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
                    Team chat — Malory dispatches here too
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
                    Try: &ldquo;write a blog post about small business SEO&rdquo; to get a draft generated.
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
                return (
                  <div key={msg.id} className="flex justify-center py-0.5">
                    <div className="inline-flex items-center gap-2 rounded-full bg-muted/50 border px-3 py-1 text-[11px] text-muted-foreground">
                      {resolved ? (
                        <Check className="size-3 text-emerald-500" />
                      ) : (
                        <Loader2 className="size-3 animate-spin" />
                      )}
                      <span className="whitespace-pre-wrap break-words">
                        {msg.content}
                      </span>
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
                      <span
                        className={`size-7 rounded-full ${colorFor(msg.employee_key ?? "")} text-white text-xs font-bold flex items-center justify-center shrink-0 mt-1`}
                      >
                        {employeeName(msg.employee_key).charAt(0)}
                      </span>
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
                <span
                  className={`size-7 rounded-full ${colorFor(activeChat?.employee_key ?? "nina")} text-white text-xs font-bold flex items-center justify-center`}
                >
                  {employeeName(activeChat?.employee_key ?? "nina").charAt(0)}
                </span>
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
