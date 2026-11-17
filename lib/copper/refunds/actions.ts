"use server";

// What the Refund Console calls: read the state, change the limit, and the
// two human decisions. The customer chat never reaches these.
import { consoleState, decideRefund, setLimit } from "./store";
import type { ConsoleState } from "./types";

export async function readConsole(): Promise<ConsoleState> {
  return consoleState();
}

export async function saveLimit(limitUsd: number): Promise<ConsoleState> {
  setLimit(Number(limitUsd));
  return consoleState();
}

export async function decide(
  refundId: string,
  decision: "approve" | "reject",
  note?: string,
): Promise<ConsoleState> {
  decideRefund(
    String(refundId),
    decision === "approve" ? "approve" : "reject",
    note ? String(note).slice(0, 300) : undefined,
  );
  return consoleState();
}
