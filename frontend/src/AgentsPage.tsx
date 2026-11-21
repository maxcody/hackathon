import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createWorkspaceAgent, getWorkspaceAgent, listWorkspaceAgents, sendAgentMessage } from "./api";
import type { AgentSummary, WorkspaceAgent } from "./types";
import { EmailDraftCard, parseSendCommand, sameDraft, sendCommand, splitDrafts } from "./EmailDraft";
import type { Draft } from "./EmailDraft";
import "./agents.css";

/** Create agents and select a private conversation in the Agents tab. */
export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const createDialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listWorkspaceAgents().then((items) => {
      if (!active) return;
      setAgents(items);
      setSelected(items[0]?.id ?? null);
      setOpened(items[0] ? [items[0].id] : []);
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function selectAgent(id: string) {
    setSelected(id);
    setOpened((items) => items.includes(id) ? items : [...items, id]);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const agent = await createWorkspaceAgent(name, instructions);
      setAgents((items) => [...items, agent]);
      selectAgent(agent.id);
      createDialog.current?.close();
      setName("");
      setInstructions("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  }

  return (
      <main className="main-content agents-page" id="agents">
        <header className="agents-toolbar">
          <h1>Agents</h1>
          {agents.length > 0 && (
            <select aria-label="Switch agent" value={selected ?? ""} onChange={(event) => selectAgent(event.target.value)}>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          )}
          <button type="button" className="button button-dark" onClick={() => { setError(""); createDialog.current?.showModal(); }} disabled={loading}>+ New agent</button>
        </header>
        <div className="agents-canvas">
          {error && <p className="message message-error" role="alert">{error}</p>}
            {selected ? <div className="agent-thread-slot">
              {opened.map((id) => <div key={id} hidden={id !== selected}><AgentConversation id={id} visible={id === selected} /></div>)}
            </div> : <p className="agent-empty-thread" role="status">{loading ? "Loading agents…" : "Create an agent to start a conversation."}</p>}
        </div>
        <dialog ref={createDialog} className="agent-create-dialog" aria-labelledby="agent-create-heading" onCancel={(event) => { if (creating) event.preventDefault(); }}>
          <form onSubmit={create} className="agent-workspace-form">
            <h2 id="agent-create-heading">Create an agent</h2>
            {error && <p className="message message-error" role="alert">{error}</p>}
            <label>Name<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Instructions (optional)<textarea rows={4} maxLength={4000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
            <div className="agent-dialog-actions">
              <button type="button" className="button button-outline" disabled={creating} onClick={() => { setError(""); createDialog.current?.close(); }}>Cancel</button>
              <button className="button button-dark" disabled={creating}>{creating ? "Creating…" : "Create agent"}</button>
            </div>
          </form>
        </dialog>
      </main>
  );
}

/** Display and send messages in one agent's saved conversation. */
function AgentConversation({ id, visible }: { id: string; visible: boolean }) {
  const [agent, setAgent] = useState<WorkspaceAgent | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [partialReply, setPartialReply] = useState("");
  const [error, setError] = useState("");
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [worked, setWorked] = useState<{ index: number; seconds: number } | null>(null);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [pending, started]);

  useEffect(() => {
    let active = true;
    getWorkspaceAgent(id).then((item) => {
      if (active) setAgent(item);
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason));
    });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (visible && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [agent, pending, partialReply, visible]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || pending) return;
    setMessage("");
    const box = event.currentTarget.querySelector("textarea");
    if (box) box.style.height = "auto";
    if (!(await submit(text))) setMessage(text);
  }

  /** Post a message to the agent and stream its reply; returns whether it succeeded. */
  async function submit(text: string): Promise<boolean> {
    const start = Date.now();
    setPending(text);
    setStarted(start);
    setElapsed(0);
    setError("");
    try {
      const updated = await sendAgentMessage(id, text, (delta) => setPartialReply((reply) => reply + delta));
      setAgent(updated);
      setWorked({ index: updated.messages.length - 1, seconds: Math.max(1, Math.round((Date.now() - start) / 1000)) });
      return true;
    } catch (reason) {
      setError(errorMessage(reason));
      return false;
    } finally {
      setPending(null);
      setPartialReply("");
    }
  }

  return (
    <section className="agent-conversation" aria-label="Conversation">
      {agent ? <>
        <div className="agent-messages" ref={thread} role="log" aria-label={`Chat with ${agent.name}`}>
          <div className="agent-thread-content">
          {agent.messages.length === 0 && !pending && <div className="agent-empty-thread"><span className="agent-avatar" aria-hidden="true">{agent.name.slice(0, 1).toUpperCase()}</span><h2>{agent.name}</h2><p>Start a conversation</p></div>}
          {agent.messages.map((entry, index) => (
            <article key={index} className={`agent-message agent-message-${entry.role}`}>
              {worked?.index === index && <p className="agent-worked">Worked for {worked.seconds}s</p>}
              {entry.role === "assistant"
                ? <AgentReply text={entry.content} onSend={index === agent.messages.length - 1 && !pending ? (draft) => void submit(sendCommand(draft)) : undefined} sent={agent.messages.slice(index + 1).map((later) => later.role === "user" ? parseSendCommand(later.content) : null).filter((draft): draft is Draft => draft !== null)} />
                : <UserMessage text={entry.content} />}
            </article>
          ))}
          {pending && <>
            <article className="agent-message agent-message-user"><UserMessage text={pending} /></article>
            <p className="agent-reply-status" role="status">Working… {elapsed}s</p>
            {partialReply && <article className="agent-message agent-message-assistant"><AgentReply text={partialReply} sent={[]} /></article>}
          </>}
          </div>
        </div>
        <form onSubmit={send} className="agent-composer">
          {error && <p className="message message-error" role="alert">{error}</p>}
          <textarea aria-label={`Message ${agent.name}`} placeholder={`Message ${agent.name}`} required rows={1} onInput={(event) => { const box = event.currentTarget; box.style.height = "auto"; box.style.height = `${box.scrollHeight}px`; }} maxLength={8000} disabled={!!pending} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} />
          <button className="agent-send" aria-label="Send" disabled={!!pending || !message.trim()}><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
        </form>
      </> : error ? <p className="message message-error" role="alert">{error}</p> : <p role="status">Loading conversation…</p>}
    </section>
  );
}

/** Render an agent reply: Markdown, with email drafts shown as mail previews. */
function AgentReply({ text, onSend, sent }: { text: string; onSend?: (draft: Draft) => void; sent: Draft[] }) {
  return <>{splitDrafts(text).map((segment, index) => {
    if (segment.kind === "text") return <AgentMarkdown key={index} text={segment.text} />;
    if (segment.kind === "drafting") return <p key={index} className="agent-reply-status">Writing the email draft…</p>;
    const wasSent = sent.length > 0;
    return <EmailDraftCard key={index} draft={segment.draft} onSend={wasSent ? undefined : onSend} status={wasSent ? (sent.some((draft) => sameDraft(draft, segment.draft)) ? "Send requested" : "Send requested (edited)") : undefined} />;
  })}</>;
}

/** Show a user message; a Send click appears as a compact mail line instead of raw JSON. */
function UserMessage({ text }: { text: string }) {
  const draft = parseSendCommand(text);
  if (!draft) return <p>{text}</p>;
  return <p className="mail-send-line"><span aria-hidden="true">✉</span> Send “{draft.subject}” to {draft.to.join(", ")}</p>;
}

/** Render Markdown in both saved messages and streaming replies. */
function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="agent-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} components={{
        table: ({ children }) => <div className="agent-table-scroll"><table>{children}</table></div>,
      }}>{text}</ReactMarkdown>
    </div>
  );
}

/** Format a failed request for display in the workspace. */
function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The request failed. Try again.";
}
