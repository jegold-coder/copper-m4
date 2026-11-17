"use server";

// The server action the Ask Copper chat calls. It streams the conversation to
// the model through callStream (lib/ai/call.ts), with or without the tools,
// and sends back each step as it happens, so the panel can show the agent
// thinking and using its tools.
//
// Module 4: there are two agents, each with its own instructions and tools.
// Copper starts. When Copper calls transfer_refund, this action stops Copper
// and starts the Refund agent on the same conversation (and the Refund agent
// can hand back with transfer_support). The panel remembers which agent was
// talking last and sends it back as `agent`, so the chat stays with them.
import { hasToolCall, stepCountIs } from "ai";
import { callStream, THOUGHT_SUMMARIES } from "@/lib/ai/call";
import { createLive, type Live } from "@/lib/ai/live";
import { COPPER_INSTRUCTIONS } from "@/lib/copper/assistant/instructions";
import type {
  AgentId,
  Progress,
  ToolStep,
} from "@/lib/copper/assistant/progress";
import { REFUND_INSTRUCTIONS } from "@/lib/copper/assistant/refund-instructions";
import { refundTools } from "@/lib/copper/assistant/refund-tools";
import { copperTools } from "@/lib/copper/assistant/tools";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AskCopperRequest = {
  messages: ChatMessage[];
  useTools: boolean;
  /** Who the customer is talking to now. Copper when missing. */
  agent?: AgentId;
};

export type AskCopperResult = { progress: Live<Progress> };

/** At most this many model steps (tool calls plus the reply) per agent, per question. */
const MAX_STEPS = 5;
/** At most this many handoffs per question, so two agents can't pass the chat back and forth forever. */
const MAX_HANDOFFS = 2;

const SORRY = "Sorry, something went wrong on my end. Please try again.";

const AGENTS = {
  copper: {
    info: { module: 2, feature: "ask-copper" },
    instructions: COPPER_INSTRUCTIONS,
    tools: copperTools,
    handoffTool: "transfer_refund",
  },
  refund: {
    info: { module: 4, feature: "refund-agent" },
    instructions: REFUND_INSTRUCTIONS,
    tools: refundTools,
    handoffTool: "transfer_support",
  },
} as const;

export async function askCopper({
  messages,
  useTools,
  agent: startWith = "copper",
}: AskCopperRequest): Promise<AskCopperResult> {
  const { live, update, done } = createLive<Progress>();
  let agent: AgentId = startWith === "refund" ? "refund" : "copper";
  const progress: Progress = {
    steps: [],
    reply: "",
    status: "working",
    agent,
  };
  // A fresh copy each time, so earlier updates never change underneath the
  // panel.
  const snapshot = (): Progress => ({
    ...progress,
    steps: progress.steps.map((step) => ({ ...step })),
  });
  const toolStep = (id: string) =>
    progress.steps.find(
      (step): step is ToolStep => step.type === "tool" && step.id === id,
    );

  // Read the stream in the background, so the panel gets the first update now.
  void (async () => {
    try {
      for (let handoffs = 0; ; handoffs++) {
        const config = AGENTS[agent];
        // Without tools, send no instructions either: "always use your tools"
        // with no tools makes the model answer with nothing.
        const result = callStream(config.info, {
          messages,
          providerOptions: THOUGHT_SUMMARIES,
          ...(useTools && {
            instructions: config.instructions,
            tools: config.tools,
            // Stop when the agent hands the chat over; the next agent picks up.
            stopWhen: [stepCountIs(MAX_STEPS), hasToolCall(config.handoffTool)],
          }),
        });
        let handoffTo: AgentId | null = null;

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "reasoning-delta": {
              const last = progress.steps.at(-1);
              if (last?.type === "thinking") last.text += part.text;
              else progress.steps.push({ type: "thinking", text: part.text });
              break;
            }
            case "tool-input-start":
              progress.steps.push({
                type: "tool",
                id: part.id,
                name: part.toolName,
                state: "calling",
              });
              break;
            case "tool-call": {
              const step = toolStep(part.toolCallId);
              if (step) step.input = part.input;
              else
                progress.steps.push({
                  type: "tool",
                  id: part.toolCallId,
                  name: part.toolName,
                  state: "calling",
                  input: part.input,
                });
              break;
            }
            case "tool-result": {
              const step = toolStep(part.toolCallId);
              if (step)
                Object.assign(step, { output: part.output, state: "done" });
              if (part.toolName === config.handoffTool)
                handoffTo = agent === "copper" ? "refund" : "copper";
              break;
            }
            case "tool-error": {
              const step = toolStep(part.toolCallId);
              const message =
                part.error instanceof Error
                  ? part.error.message
                  : String(part.error);
              if (step)
                Object.assign(step, { output: message, state: "error" });
              break;
            }
            case "text-delta":
              progress.reply += part.text;
              break;
            case "error":
              throw part.error;
            default:
              continue;
          }
          update(snapshot());
        }

        if (!handoffTo || handoffs >= MAX_HANDOFFS) break;
        // The next agent writes the reply, so drop anything said before the handoff.
        progress.steps.push({ type: "handoff", from: agent, to: handoffTo });
        agent = handoffTo;
        progress.agent = agent;
        progress.reply = "";
        update(snapshot());
      }
      progress.status = "done";
      if (!progress.reply.trim()) progress.reply = SORRY;
    } catch {
      progress.status = "error";
      if (!progress.reply.trim()) progress.reply = SORRY;
    }
    done(snapshot());
  })();

  return { progress: live };
}
