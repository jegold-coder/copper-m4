// Shared shapes for refunds. Plain types only, so client components can import them.

export type RefundStatus = "refunded" | "pending" | "rejected";

export type Refund = {
  id: string;
  orderId: string;
  email: string;
  item: string;
  amountUsd: number;
  /** What the customer said. */
  reason: string;
  status: RefundStatus;
  /** Who decided: the app's rule, or a person in the Refund Console. */
  decidedBy: "auto" | "human" | null;
  /** Plain-English reason the refund is waiting (or was decided), shown to the customer. */
  why: string;
  /** The person's note when they reject. */
  note?: string;
  createdAt: string;
  decidedAt: string | null;
};

export type OrderView = {
  id: string;
  email: string;
  item: string;
  amountUsd: number;
  orderedOn: string;
  daysAgo: number;
  refund: Refund | null;
};

export type ConsoleState = {
  limitUsd: number;
  refunds: Refund[];
  orders: OrderView[];
};
