// Orders, refunds and the auto-refund limit. THE RULE LIVES HERE, IN CODE:
// requestRefund() compares the order amount with the limit. The model can ask,
// but it cannot argue past this function.
//
// The data is kept in memory (seeded from data/orders.json), so it resets when
// the server restarts. This is the only file that knows where refunds are
// kept: swap it for a database later by changing only this file.
import data from "../data/orders.json";
import type { ConsoleState, OrderView, Refund } from "./types";

export const DEFAULT_LIMIT_USD = 50;
/** Devices can be returned for 30 days after the order (Product Bible, Returns Policy). */
export const RETURN_WINDOW_DAYS = 30;

type Store = { limitUsd: number; refunds: Refund[] };
const g = globalThis as unknown as { __copperRefunds?: Store };
const store = (): Store =>
  (g.__copperRefunds ??= { limitUsd: DEFAULT_LIMIT_USD, refunds: [] });

const usd = (n: number) => `$${n.toFixed(2)}`;
const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

function orderViews(): OrderView[] {
  const { refunds } = store();
  return data.orders.map((o) => ({
    ...o,
    orderedOn: isoDaysAgo(o.daysAgo),
    refund: refunds.find((r) => r.orderId === o.id) ?? null,
  }));
}

export function getLimit(): number {
  return store().limitUsd;
}

export function setLimit(limitUsd: number): number {
  const clean = Number.isFinite(limitUsd)
    ? Math.max(0, Math.min(10_000, limitUsd))
    : DEFAULT_LIMIT_USD;
  store().limitUsd = Math.round(clean * 100) / 100;
  return store().limitUsd;
}

export function consoleState(): ConsoleState {
  const { limitUsd, refunds } = store();
  return {
    limitUsd,
    // Newest first (the id breaks ties within the same millisecond).
    refunds: structuredClone(refunds).sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    ),
    orders: orderViews(),
  };
}

/** get_orders: a customer's orders, each with the state of any refund. */
export function getOrders(email: string) {
  const wanted = email.trim().toLowerCase();
  const orders = orderViews().filter((o) => o.email === wanted);
  return orders.length === 0
    ? { status: "no_orders" as const, email: wanted }
    : { status: "ok" as const, email: wanted, limitUsd: getLimit(), orders };
}

export type RefundResult =
  | { status: "not_found"; message: string }
  | {
      status: "already_refunded" | "already_pending" | "already_rejected";
      refund: Refund;
      message: string;
    }
  | {
      status: "refunded" | "pending_approval";
      refund: Refund;
      limitUsd: number;
      message: string;
    };

/** request_refund: records the request and applies the rule. */
export function requestRefund(orderId: string, reason: string): RefundResult {
  const order = orderViews().find(
    (o) => o.id.toLowerCase() === orderId.trim().toLowerCase(),
  );
  if (!order)
    return {
      status: "not_found",
      message: `There is no order ${orderId}. Check the order number with get_orders.`,
    };

  const existing = order.refund;
  if (existing) {
    const status =
      existing.status === "refunded"
        ? "already_refunded"
        : existing.status === "pending"
          ? "already_pending"
          : "already_rejected";
    const message =
      status === "already_refunded"
        ? `Order ${order.id} was already refunded (${usd(existing.amountUsd)}). It cannot be refunded twice.`
        : status === "already_pending"
          ? `A refund for order ${order.id} is already waiting for a person to review. Asking again does not speed it up and does not create a second refund.`
          : `A person reviewed the refund for order ${order.id} and declined it${existing.note ? `: "${existing.note}"` : ""}. It cannot be requested again here.`;
    return { status, refund: existing, message };
  }

  const limitUsd = getLimit();
  const waitingFor: string[] = [];
  if (order.amountUsd > limitUsd)
    waitingFor.push(
      `it is ${usd(order.amountUsd)}, which is over the ${usd(limitUsd)} limit for automatic refunds`,
    );
  if (order.daysAgo > RETURN_WINDOW_DAYS)
    waitingFor.push(
      `the order is ${order.daysAgo} days old, past the ${RETURN_WINDOW_DAYS}-day return window`,
    );

  const now = new Date().toISOString();
  const auto = waitingFor.length === 0;
  const refund: Refund = {
    id: `RF-${String(store().refunds.length + 1).padStart(4, "0")}`,
    orderId: order.id,
    email: order.email,
    item: order.item,
    amountUsd: order.amountUsd,
    reason: reason.trim() || "No reason given",
    status: auto ? "refunded" : "pending",
    decidedBy: auto ? "auto" : null,
    why: auto
      ? `${usd(order.amountUsd)} is within the ${usd(limitUsd)} automatic refund limit, so it was approved on the spot.`
      : `A person needs to approve this one because ${waitingFor.join(" and ")}.`,
    createdAt: now,
    decidedAt: auto ? now : null,
  };
  store().refunds.push(refund);
  return auto
    ? { status: "refunded", refund, limitUsd, message: refund.why }
    : { status: "pending_approval", refund, limitUsd, message: refund.why };
}

/** Approve or reject a waiting refund (the Refund Console buttons). */
export function decideRefund(
  refundId: string,
  decision: "approve" | "reject",
  note?: string,
): boolean {
  const refund = store().refunds.find((r) => r.id === refundId);
  if (!refund || refund.status !== "pending") return false;
  refund.decidedAt = new Date().toISOString();
  refund.decidedBy = "human";
  if (decision === "approve") {
    refund.status = "refunded";
    refund.why = `A Copper team member approved this ${usd(refund.amountUsd)} refund.`;
  } else {
    refund.status = "rejected";
    refund.note = note?.trim() || "Not eligible under our return policy.";
    refund.why = `A Copper team member declined this refund: ${refund.note}`;
  }
  return true;
}
