import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSystemMessage,
} from "@astryxdesign/core/Chat";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Layout, LayoutContent, HStack, VStack, StackItem } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { LoadingButton } from "./LoadingButton";
import { Banner } from "@astryxdesign/core/Banner";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { createWorkspaceAgent, getWorkspaceAgent, listWorkspaceAgents, sendAgentMessage } from "./api";
import type { AgentSummary, WorkspaceAgent } from "./types";
import { EmailDraftCard, parseSendCommand, sendCommand, splitDrafts } from "./EmailDraft";
import type { Draft } from "./EmailDraft";

/** Create agents and select a private conversation in the Agents tab. */
export function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    listWorkspaceAgents()
      .then((items) => {
        if (!active) return;
        setAgents(items);
        setSelected(items[0]?.id ?? null);
        setOpened(items[0] ? [items[0].id] : []);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function selectAgent(id: string) {
    setSelected(id);
    setOpened((items) => (items.includes(id) ? items : [...items, id]));
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
      setCreateOpen(false);
      setName("");
      setInstructions("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Layout
      height="fill"
      content={
        <LayoutContent role="main" id="agents" padding={0}>
          <VStack gap={0} height="100%">
            <HStack gap={3} padding={4} vAlign="center" wrap="wrap">
              <Heading level={1}>Agents</Heading>
              <StackItem size="fill">
                {agents.length > 0 && selected && (
                  <Selector
                    label="Switch agent"
                    isLabelHidden
                    value={selected}
                    onChange={(value) => selectAgent(value)}
                    options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                    variant="secondary"
                  />
                )}
              </StackItem>
              <Button
                label="+ New agent"
                variant="primary"
                isDisabled={loading}
                onClick={() => {
                  setError("");
                  setCreateOpen(true);
                }}
              />
            </HStack>

            {error && !createOpen && <Banner status="error" title={error} />}

            <StackItem size="fill" isScrollable={false}>
              {selected ? (
                <VStack height="100%">
                  {opened.map((id) =>
                    id === selected ? (
                      <AgentConversation key={id} id={id} visible />
                    ) : (
                      <AgentConversation key={id} id={id} visible={false} />
                    ),
                  )}
                </VStack>
              ) : (
                <EmptyState
                  title={loading ? "Loading agents…" : "Create an agent to start a conversation."}
                />
              )}
            </StackItem>
          </VStack>

          <Dialog
            isOpen={createOpen}
            onOpenChange={(isOpen) => {
              if (!creating) setCreateOpen(isOpen);
            }}
            purpose="form"
            width={480}
          >
            <DialogHeader
              title="Create an agent"
              onOpenChange={(isOpen) => {
                if (!creating) setCreateOpen(isOpen);
              }}
            />
            <form onSubmit={create}>
              <VStack gap={4} padding={4}>
                {error && <Banner status="error" title={error} />}
                <TextInput label="Name" value={name} onChange={setName} isRequired />
                <TextArea
                  label="Instructions (optional)"
                  value={instructions}
                  onChange={setInstructions}
                  rows={4}
                  isOptional
                />
                <HStack gap={2} hAlign="end">
                  <Button
                    label="Cancel"
                    variant="secondary"
                    isDisabled={creating}
                    onClick={() => {
                      setError("");
                      setCreateOpen(false);
                    }}
                  />
                  <LoadingButton
                    label={creating ? "Creating…" : "Create agent"}
                    variant="primary"
                    type="submit"
                    isLoading={creating}
                  />
                </HStack>
              </VStack>
            </form>
          </Dialog>
        </LayoutContent>
      }
    />
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

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [pending, started]);

  useEffect(() => {
    let active = true;
    getWorkspaceAgent(id)
      .then((item) => {
        if (active) setAgent(item);
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [id]);

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

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setMessage("");
    if (!(await submit(trimmed))) setMessage(trimmed);
  }

  if (!visible) return null;

  if (!agent) {
    return error ? (
      <Banner status="error" title={error} />
    ) : (
      <EmptyState title="Loading conversation…" isCompact />
    );
  }

  return (
    <VStack gap={0} height="100%">
      <Section padding={3} variant="muted">
        <HStack gap={3} vAlign="center">
          <Avatar name={agent.name} size="md" />
          <StackItem size="fill">
            <VStack gap={0}>
              <Heading level={3}>{agent.name}</Heading>
              <Text type="supporting" color="secondary">Private workspace conversation · replies stream as they arrive</Text>
            </VStack>
          </StackItem>
          <StatusDot variant={pending ? "warning" : "accent"} label={pending ? "Working" : "Ready"} />
        </HStack>
      </Section>
      <StackItem size="fill" isScrollable={false}>
        <ChatLayout
          density="spacious"
          emptyState={
            agent.messages.length === 0 && !pending ? (
              <VStack gap={3} hAlign="center" padding={6}>
                <Avatar name={agent.name} size="lg" />
                <Heading level={2}>What should we investigate?</Heading>
                <Text color="secondary">Ask this agent to inspect your synced procurement data.</Text>
                <HStack gap={2} wrap="wrap" hAlign="center">
                  {[
                    "Check the data for launch risks",
                    "Which critical parts need attention?",
                    "Find recent supplier changes",
                  ].map((prompt) => (
                    <Button key={prompt} label={prompt} variant="secondary" size="sm" onClick={() => setMessage(prompt)} />
                  ))}
                </HStack>
              </VStack>
            ) : undefined
          }
          composer={
            <ChatComposer
              value={message}
              onChange={setMessage}
              onSubmit={(value) => void send(value)}
              placeholder={`Message ${agent.name}`}
              isDisabled={!!pending}
              status={error ? { type: "error", message: error } : undefined}
            />
          }
        >
          <ChatMessageList isStreaming={!!pending} density="spacious">
        {agent.messages.map((entry, index) => (
          <ChatMessage
            key={index}
            sender={entry.role === "assistant" ? "assistant" : "user"}
            avatar={<Avatar name={entry.role === "assistant" ? agent.name : "You"} size="sm" />}
            name={entry.role === "assistant" ? agent.name : "You"}
            metadata={worked?.index === index ? <Text type="supporting">Worked for {worked.seconds}s</Text> : undefined}
          >
            {entry.role === "assistant" ? (
              <AgentReply
                text={entry.content}
                onSend={
                  index === agent.messages.length - 1 && !pending
                    ? (draft) => void submit(sendCommand(draft))
                    : undefined
                }
                sent={sendState(agent.messages, index, pending)}
              />
            ) : (
              <ChatMessageBubble>
                <UserMessage text={entry.content} />
              </ChatMessageBubble>
            )}
          </ChatMessage>
        ))}
        {pending && (
          <>
            <ChatMessage sender="user" avatar={<Avatar name="You" size="sm" />} name="You">
              <ChatMessageBubble>
                <UserMessage text={pending} />
              </ChatMessageBubble>
            </ChatMessage>
            <ChatMessage
              sender="assistant"
              avatar={<Avatar name={agent.name} size="sm" />}
              name={agent.name}
              className="agent-reply-enter"
              metadata={partialReply ? <Text type="supporting" color="secondary">Working… {elapsed}s</Text> : undefined}
            >
              {partialReply ? (
                <AgentReply text={partialReply} sent={null} />
              ) : (
                <HStack gap={1} vAlign="center" className="agent-typing" role="status" aria-label="Agent is thinking">
                  <Text type="supporting" color="secondary">Working</Text>
                  {[0, 1, 2].map((dot) => (
                    <Text key={dot} type="supporting" color="accent" className="agent-typing-dot">·</Text>
                  ))}
                  <Text type="supporting" color="secondary">{elapsed}s</Text>
                </HStack>
              )}
            </ChatMessage>
          </>
        )}
          </ChatMessageList>
        </ChatLayout>
      </StackItem>
    </VStack>
  );
}

/** What happened to the draft in message `index`. */
function sendState(
  messages: WorkspaceAgent["messages"],
  index: number,
  pending: string | null,
): { draft: Draft; label: string } | null {
  const next = messages[index + 1];
  const command =
    next?.role === "user"
      ? parseSendCommand(next.content)
      : index === messages.length - 1 && pending
        ? parseSendCommand(pending)
        : null;
  if (!command) return null;
  const answer = next?.role === "user" ? messages[index + 2] : undefined;
  if (!answer) return { draft: command, label: "Sending…" };
  return {
    draft: command,
    label: /not (been )?sent|failed|error|could ?n.?t|unable|wasn.?t sent/i.test(answer.content)
      ? "Not sent"
      : "Sent",
  };
}

/** Render an agent reply: Markdown, with email drafts shown as mail previews. */
function AgentReply({
  text,
  onSend,
  sent,
}: {
  text: string;
  onSend?: (draft: Draft) => void;
  sent: { draft: Draft; label: string } | null;
}) {
  return (
    <VStack gap={2}>
      {splitDrafts(text).map((segment, index) => {
        if (segment.kind === "text") {
          return (
            <ChatMessageBubble key={index}>
              <Markdown>{segment.text}</Markdown>
            </ChatMessageBubble>
          );
        }
        if (segment.kind === "drafting") {
          return <ChatSystemMessage key={index}>Writing the email draft…</ChatSystemMessage>;
        }
        return sent ? (
          <EmailDraftCard key={`sent-${index}`} draft={sent.draft} status={sent.label} />
        ) : (
          <EmailDraftCard key={index} draft={segment.draft} onSend={onSend} />
        );
      })}
    </VStack>
  );
}

/** Show a user message; a Send click appears as a compact mail line instead of raw JSON. */
function UserMessage({ text }: { text: string }) {
  const draft = parseSendCommand(text);
  if (!draft) return <Text>{text}</Text>;
  return <Text>Send “{draft.subject}”</Text>;
}

/** Format a failed request for display in the workspace. */
function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "The request failed. Try again.";
}
