import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createWorkspaceAgent, getWorkspaceAgent, listWorkspaceAgents, sendAgentMessage } from "./api";
import type { AgentSummary, WorkspaceAgent } from "./types";
import "./agents.css";

/** Create agents and select a private conversation in the Agents tab. */
export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
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
      setShowCreate(items.length === 0);
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
      setShowCreate(false);
      setName("");
      setInstructions("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  }

  return (
      <main className="main-content" id="agents">
        <div className="content-wrap">
          <h1>Agents</h1>
          {error && <p className="message message-error" role="alert">{error}</p>}
          <div className="agent-workspace">
            <section className="agent-workspace-card" aria-label="Manage agents">
              <div className="agent-list-heading">
                <h2>Your agents</h2>
                <button type="button" className="button button-dark" aria-expanded={showCreate} onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Cancel" : "+ New agent"}</button>
              </div>
              {showCreate && <form onSubmit={create} className="agent-workspace-form agent-create-form">
                <label>Name<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
                <label>Instructions (optional)<textarea rows={3} maxLength={4000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
                <button className="button button-dark" disabled={creating || loading}>{creating ? "Creating…" : "Create agent"}</button>
              </form>}
              {loading ? <p role="status">Loading agents…</p> : agents.length === 0 && <p>No agents yet.</p>}
              <div className="agent-picker">
                {agents.map((agent) => <button key={agent.id} type="button" aria-pressed={selected === agent.id} onClick={() => selectAgent(agent.id)}><span className="agent-avatar" aria-hidden="true">{agent.name.slice(0, 1).toUpperCase()}</span>{agent.name}</button>)}
              </div>
            </section>
            {selected ? <div className="agent-thread-slot">
              {opened.map((id) => <div key={id} hidden={id !== selected}><AgentConversation id={id} visible={id === selected} /></div>)}
            </div> : (
              <section className="agent-workspace-card"><p>Create an agent to start a conversation.</p></section>
            )}
          </div>
        </div>
      </main>
  );
}

/** Display and send messages in one agent's saved conversation. */
function AgentConversation({ id, visible }: { id: string; visible: boolean }) {
  const [agent, setAgent] = useState<WorkspaceAgent | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const thread = useRef<HTMLDivElement>(null);

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
  }, [agent, pending, visible]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || pending) return;
    setPending(text);
    setMessage("");
    setError("");
    try {
      setAgent(await sendAgentMessage(id, text));
    } catch (reason) {
      setError(errorMessage(reason));
      setMessage(text);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="agent-workspace-card agent-conversation" aria-label="Conversation">
      {agent ? <>
        <header className="agent-thread-header"><span className="agent-avatar" aria-hidden="true">{agent.name.slice(0, 1).toUpperCase()}</span><h2>{agent.name}</h2></header>
        <div className="agent-messages" ref={thread} role="log" aria-label={`Chat with ${agent.name}`}>
          {agent.messages.length === 0 && !pending && <p className="agent-empty-thread">Start a conversation with {agent.name}.</p>}
          {agent.messages.map((entry, index) => (
            <article key={index} className={`agent-message agent-message-${entry.role}`}>
              <strong>{entry.role === "user" ? "You" : agent.name}</strong>
              <p>{entry.content}</p>
            </article>
          ))}
          {pending && <>
            <article className="agent-message agent-message-user"><strong>You</strong><p>{pending}</p></article>
            <p className="agent-reply-status" role="status">{agent.name} is replying…</p>
          </>}
        </div>
        <form onSubmit={send} className="agent-composer">
          {error && <p className="message message-error" role="alert">{error}</p>}
          <textarea aria-label={`Message ${agent.name}`} placeholder={`Message ${agent.name}`} required rows={2} maxLength={8000} disabled={!!pending} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} />
          <button className="button button-dark" disabled={!!pending || !message.trim()}>Send</button>
        </form>
      </> : error ? <p className="message message-error" role="alert">{error}</p> : <p role="status">Loading conversation…</p>}
    </section>
  );
}

/** Format a failed request for display in the workspace. */
function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The request failed. Try again.";
}
