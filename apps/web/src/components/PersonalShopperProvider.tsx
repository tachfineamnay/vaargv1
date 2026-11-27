'use client';

import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  A2UiAgentToRendererMessage,
  A2UiRendererActionEnvelope,
  Conversation,
  ConversationMessage,
} from '@vaarg/shared';
import {
  cancelAgentRun,
  consumeAgUiRunStream,
  createConversation,
  dispatchControlledUiAction,
  fetchActiveConversation,
  fetchRunResult,
  publishRunComposition,
  startConversationRun,
} from '../lib/agent-client';
import {
  experienceServerSnapshot,
  experienceSnapshot,
  lastAppliedRevision,
  subscribeExperience,
} from '../lib/experience-client';
import { t } from '../lib/i18n';
import { useCompare } from './CompareProvider';
import { useOptionalSession } from './SessionProvider';

export interface ShopperProposalItem {
  runId: string;
  proposalId: string;
  proposalType: string;
  status: string;
  contextVersion: number;
}

export interface PersonalShopperContextValue {
  isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  conversation: Conversation | null;
  messages: ConversationMessage[];
  streamingText: string;
  activeSteps: string[];
  activeRunId: string | null;
  isStreaming: boolean;
  isReconnecting: boolean;
  resyncedNotice: boolean;
  runtimeUnavailable: boolean;
  errorBanner: string | null;
  actionNotice: string | null;
  a2uiMessages: A2UiAgentToRendererMessage[];
  proposals: ShopperProposalItem[];
  sendPrompt(prompt: string): Promise<void>;
  stopActiveRun(): Promise<void>;
  startNewConversation(): Promise<void>;
  publishProposal(runId: string, proposalId: string, contextVersion: number): Promise<void>;
  handleA2UiAction(envelope: A2UiRendererActionEnvelope): Promise<void>;
}

const PersonalShopperContext = createContext<PersonalShopperContextValue | null>(null);

export function usePersonalShopper(): PersonalShopperContextValue {
  const ctx = useContext(PersonalShopperContext);
  if (!ctx) {
    throw new Error('usePersonalShopper must be used within PersonalShopperProvider');
  }
  return ctx;
}

export function useOptionalPersonalShopper(): PersonalShopperContextValue | null {
  return useContext(PersonalShopperContext);
}

function makeClientKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PersonalShopperProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const router = useRouter();
  const sessionState = useOptionalSession();
  const compare = useCompare();
  const expSnap = useSyncExternalStore(
    subscribeExperience,
    experienceSnapshot,
    experienceServerSnapshot,
  );

  const [isOpen, setIsOpen] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [activeSteps, setActiveSteps] = useState<string[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [resyncedNotice, setResyncedNotice] = useState(false);
  const [runtimeUnavailable, setRuntimeUnavailable] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [a2uiMessages, setA2UiMessages] = useState<A2UiAgentToRendererMessage[]>([]);
  const [proposals, setProposals] = useState<ShopperProposalItem[]>([]);

  const streamAbortRef = useRef<AbortController | null>(null);
  const activeSessionId =
    sessionState?.view === 'active' ? (sessionState.session?.sessionId ?? null) : null;

  // Reset state cleanly if session changes or ends
  useEffect(() => {
    if (!activeSessionId) {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      setConversation(null);
      setMessages([]);
      setStreamingText('');
      setActiveSteps([]);
      setActiveRunId(null);
      setIsStreaming(false);
      setA2UiMessages([]);
      setProposals([]);
      return;
    }

    const controller = new AbortController();
    void (async () => {
      const res = await fetchActiveConversation(controller.signal);
      if (controller.signal.aborted || !res.ok) return;
      if (res.data.conversation) {
        setConversation(res.data.conversation);
        setMessages(res.data.messages);
        if (res.data.a2uiMessages.length > 0) {
          setA2UiMessages(res.data.a2uiMessages);
        }
      }
    })();

    return () => controller.abort();
  }, [activeSessionId]);

  // Mark unapplied proposals stale locally if visitor contextVersion advances in conventional browsing
  useEffect(() => {
    const rev = lastAppliedRevision();
    if (!rev) return;
    setProposals((prev) =>
      prev.map((item) =>
        item.status === 'proposed' && rev.contextVersion > item.contextVersion
          ? { ...item, status: 'stale' }
          : item,
      ),
    );
  }, [expSnap.update]);

  const attachRunStream = useCallback((runId: string) => {
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    setActiveRunId(runId);
    setIsStreaming(true);
    setIsReconnecting(false);
    setResyncedNotice(false);
    setStreamingText('');
    setActiveSteps([]);

    void (async () => {
      await consumeAgUiRunStream({
        runId,
        signal: controller.signal,
        handlers: {
          onTextDelta: (delta) => {
            setStreamingText((prev) => prev + delta);
          },
          onStepChange: (stepName, active) => {
            setActiveSteps((prev) =>
              active
                ? prev.includes(stepName)
                  ? prev
                  : [...prev, stepName]
                : prev.filter((s) => s !== stepName),
            );
          },
          onA2UiMessage: (msg) => {
            setA2UiMessages((prev) => [...prev, msg]);
          },
          onProposalReady: (prop) => {
            setProposals((prev) => {
              const filtered = prev.filter((p) => p.proposalId !== prop.proposalId);
              return [
                ...filtered,
                {
                  runId,
                  proposalId: prop.proposalId,
                  proposalType: prop.proposalType,
                  status: prop.status,
                  contextVersion: prop.contextVersion,
                },
              ];
            });
          },
          onResyncRequired: () => {
            setResyncedNotice(true);
            setA2UiMessages([]);
          },
          onReconnecting: () => {
            setIsReconnecting(true);
          },
          onTerminal: (outcome) => {
            setIsReconnecting(false);
            if (outcome.kind === 'error') {
              setErrorBanner(outcome.message);
            }
          },
        },
      });

      if (controller.signal.aborted) return;

      const finalRes = await fetchRunResult(runId);
      if (finalRes.ok) {
        const assistantMsg = finalRes.data.assistantMessage;
        if (assistantMsg) {
          setMessages((prev) => {
            const exists = prev.some((m) => m.messageId === assistantMsg.messageId);
            return exists ? prev : [...prev, assistantMsg];
          });
        }
        if (finalRes.data.a2uiMessages && finalRes.data.a2uiMessages.length > 0) {
          setA2UiMessages(finalRes.data.a2uiMessages);
        }
        if (finalRes.data.proposals.length > 0) {
          setProposals((prev) => {
            const byId = new Map(prev.map((p) => [p.proposalId, p]));
            for (const p of finalRes.data.proposals) {
              byId.set(p.proposalId, {
                runId,
                proposalId: p.proposalId,
                proposalType: p.proposalType,
                status: finalRes.data.stale && p.status === 'proposed' ? 'stale' : p.status,
                contextVersion: p.contextVersion,
              });
            }
            return Array.from(byId.values());
          });
        }
      }

      setStreamingText('');
      setActiveSteps([]);
      setIsStreaming(false);
      setActiveRunId(null);
    })();
  }, []);

  const sendPrompt = useCallback(
    async (rawPrompt: string) => {
      const trimmed = rawPrompt.trim();
      if (!trimmed || !activeSessionId) return;

      setErrorBanner(null);
      setActionNotice(null);
      setRuntimeUnavailable(false);

      let conv = conversation;
      if (!conv) {
        const created = await createConversation({ reuseActive: true });
        if (!created.ok) {
          setErrorBanner(created.error.message);
          return;
        }
        conv = created.data;
        setConversation(conv);
      }

      const idemKey = makeClientKey('turn');
      const optimisticUserMsg: ConversationMessage = {
        messageId: '00000000-0000-4000-8000-000000000000',
        storeId: conv.storeId,
        conversationId: conv.conversationId,
        sessionId: conv.sessionId,
        runId: null,
        sequence: messages.length + 1,
        role: 'user',
        status: 'accepted',
        content: trimmed,
        structuredPayload: {
          groundedProductRefs: [],
          groundedVariantRefs: [],
          proposalIds: [],
          clarificationPrompt: null,
          confirmationRequired: false,
          experienceRevision: null,
        },
        contextVersion: conv.lastContextVersion,
        correlationId: idemKey,
        idempotencyKey: idemKey,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUserMsg]);

      const started = await startConversationRun({
        conversationId: conv.conversationId,
        message: trimmed,
        idempotencyKey: idemKey,
      });

      if (!started.ok) {
        if (started.error.kind === 'unavailable' || started.error.kind === 'not_configured') {
          setRuntimeUnavailable(true);
        } else {
          setErrorBanner(started.error.message);
        }
        return;
      }

      // Refresh canonical message list so optimistic ID is replaced cleanly
      const activeBundle = await fetchActiveConversation();
      if (activeBundle.ok && activeBundle.data.conversation) {
        setMessages(activeBundle.data.messages);
      }

      attachRunStream(started.data.run.runId);
    },
    [activeSessionId, attachRunStream, conversation, messages.length],
  );

  const stopActiveRun = useCallback(async () => {
    const runId = activeRunId;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsStreaming(false);
    setActiveSteps([]);
    setStreamingText('');
    setActiveRunId(null);
    if (runId) {
      await cancelAgentRun(runId);
    }
  }, [activeRunId]);

  const startNewConversation = useCallback(async () => {
    if (!activeSessionId) return;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setIsStreaming(false);
    setStreamingText('');
    setActiveSteps([]);
    setActiveRunId(null);
    setErrorBanner(null);
    setActionNotice(null);
    setA2UiMessages([]);
    setProposals([]);

    const created = await createConversation({ reuseActive: false });
    if (created.ok) {
      setConversation(created.data);
      setMessages([]);
    }
  }, [activeSessionId]);

  const publishProposal = useCallback(
    async (runId: string, proposalId: string, contextVersion: number) => {
      setErrorBanner(null);
      const res = await publishRunComposition(runId, {
        proposalId,
        expectedContextVersion: contextVersion,
        idempotencyKey: makeClientKey(`pub-${proposalId}`),
      });
      if (!res.ok) {
        if (res.error.kind === 'conflict') {
          setProposals((prev) =>
            prev.map((p) => (p.proposalId === proposalId ? { ...p, status: 'stale' } : p)),
          );
          setActionNotice(t('shopper.staleProposal'));
        } else {
          setErrorBanner(res.error.message);
        }
        return;
      }
      setProposals((prev) =>
        prev.map((p) =>
          p.proposalId === proposalId
            ? { ...p, status: res.data.published ? 'applied' : 'stale' }
            : p,
        ),
      );
      if (!res.data.published) {
        setActionNotice(t('shopper.staleProposal'));
      }
    },
    [],
  );

  const handleA2UiAction = useCallback(
    async (envelope: A2UiRendererActionEnvelope) => {
      if (!activeSessionId) return;
      setActionNotice(null);
      setErrorBanner(null);

      // Attach active conversationId for guided question replies when omitted
      const enrichedEnvelope: A2UiRendererActionEnvelope =
        envelope.action.name === 'answer_guided_question' &&
        conversation &&
        !envelope.action.context.conversationId
          ? {
              ...envelope,
              action: {
                ...envelope.action,
                context: {
                  ...envelope.action.context,
                  conversationId: conversation.conversationId,
                },
              },
            }
          : envelope;

      const res = await dispatchControlledUiAction({
        sessionId: activeSessionId,
        envelope: enrichedEnvelope,
        idempotencyKey: makeClientKey(`act-${envelope.action.name}`),
      });

      if (!res.ok) {
        setErrorBanner(res.error.message);
        return;
      }

      if (res.data.status === 'UNAVAILABLE_IN_CURRENT_PHASE') {
        setActionNotice(res.data.message);
        return;
      }

      if (res.data.compareProductIds && res.data.compareProductIds.length >= 2) {
        compare.setIds(res.data.compareProductIds);
      }
      if (res.data.a2uiMessages && res.data.a2uiMessages.length > 0) {
        setA2UiMessages(res.data.a2uiMessages as unknown as A2UiAgentToRendererMessage[]);
      }
      if (res.data.navigationHref) {
        router.push(res.data.navigationHref);
      }
      if (res.data.submittedMessageId && conversation) {
        const activeBundle = await fetchActiveConversation();
        if (activeBundle.ok) {
          setMessages(activeBundle.data.messages);
        }
        const followUp = await startConversationRun({
          conversationId: conversation.conversationId,
          triggerMessageId: res.data.submittedMessageId,
          idempotencyKey: makeClientKey('guided-run'),
        });
        if (followUp.ok) {
          attachRunStream(followUp.data.run.runId);
        }
      }
    },
    [activeSessionId, attachRunStream, compare, conversation, router],
  );

  const value = useMemo<PersonalShopperContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((v) => !v),
      conversation,
      messages,
      streamingText,
      activeSteps,
      activeRunId,
      isStreaming,
      isReconnecting,
      resyncedNotice,
      runtimeUnavailable,
      errorBanner,
      actionNotice,
      a2uiMessages,
      proposals,
      sendPrompt,
      stopActiveRun,
      startNewConversation,
      publishProposal,
      handleA2UiAction,
    }),
    [
      a2uiMessages,
      actionNotice,
      activeRunId,
      activeSteps,
      conversation,
      errorBanner,
      handleA2UiAction,
      isOpen,
      isReconnecting,
      isStreaming,
      messages,
      proposals,
      publishProposal,
      resyncedNotice,
      runtimeUnavailable,
      sendPrompt,
      startNewConversation,
      stopActiveRun,
      streamingText,
    ],
  );

  return (
    <PersonalShopperContext.Provider value={value}>
      {children}
    </PersonalShopperContext.Provider>
  );
}
