// The Refund agent's three tools. The agent can look up orders and ask for a
// refund, but the app's code (lib/copper/refunds/store.ts) decides the answer.
// There is no "approved" input anywhere: nothing a customer types can approve
// a refund.
import { tool } from "ai";
import { z } from "zod";
import { getOrders, requestRefund } from "@/lib/copper/refunds/store";

export const refundTools = {
  get_orders: tool({
    description:
      "Looks up a customer's orders by email. Each order has its id, item, amount, date and the state of any refund (refunded, pending a person's review, or declined with a note). Also use this to check on a refund's progress.",
    inputSchema: z.object({
      email: z.string().min(3).describe("The customer's email address."),
    }),
    execute: async ({ email }) => getOrders(email),
  }),
  request_refund: tool({
    description:
      "Asks for a refund on one order. The app applies the refund rules and returns one of: refunded, pending_approval (a person must approve), already_refunded, already_pending, already_rejected or not_found. The result's message says why, in plain words.",
    inputSchema: z.object({
      orderId: z.string().describe("The order id, like ORD-1002."),
      reason: z
        .string()
        .describe("Why the customer wants the refund, in their words."),
    }),
    execute: async ({ orderId, reason }) => requestRefund(orderId, reason),
  }),
  transfer_support: tool({
    description:
      "Hands the chat back to Copper, the general support assistant, for anything that is not a refund (products, prices, stock, setup, policies).",
    inputSchema: z.object({}),
    execute: async () => ({ transfer: "copper" as const }),
  }),
};
