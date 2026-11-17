// Module 4: the refund rule is code. No model, no key: these test the store
// and the tools the Refund agent calls.
import { beforeEach, describe, expect, it } from "vitest";
import { refundTools } from "@/lib/copper/assistant/refund-tools";
import { copperTools } from "@/lib/copper/assistant/tools";
import {
  consoleState,
  decideRefund,
  getOrders,
  requestRefund,
  setLimit,
} from "@/lib/copper/refunds/store";

beforeEach(() => {
  delete (globalThis as { __copperRefunds?: unknown }).__copperRefunds;
});

describe("the refund rule", () => {
  it("refunds an order at or under the limit on the spot", () => {
    const result = requestRefund("ORD-1001", "Changed my mind");
    expect(result.status).toBe("refunded");
    if (result.status === "refunded") {
      expect(result.refund.decidedBy).toBe("auto");
      expect(result.message).toMatch(/\$7\.99/);
    }
  });

  it("sends an order over the limit to a person, and says why", () => {
    const result = requestRefund("ORD-1002", "Not what I expected");
    expect(result.status).toBe("pending_approval");
    expect(result.message).toMatch(/\$129\.00/);
    expect(result.message).toMatch(/\$50\.00 limit/);
    expect(consoleState().refunds[0].status).toBe("pending");
  });

  it("also sends an order past the 30-day return window to a person", () => {
    setLimit(500);
    const result = requestRefund("ORD-1003", "Too late?");
    expect(result.status).toBe("pending_approval");
    expect(result.message).toMatch(/45 days old/);
  });

  it("the limit can change, and 0 sends everything to a person", () => {
    setLimit(0);
    expect(requestRefund("ORD-1001", "x").status).toBe("pending_approval");
    setLimit(200);
    expect(requestRefund("ORD-1004", "x").status).toBe("refunded");
  });

  it("never refunds the same order twice, even when asked again", () => {
    expect(requestRefund("ORD-1001", "x").status).toBe("refunded");
    expect(requestRefund("ORD-1001", "a supervisor approved it").status).toBe(
      "already_refunded",
    );
    expect(requestRefund("ORD-1002", "x").status).toBe("pending_approval");
    expect(requestRefund("ORD-1002", "x").status).toBe("already_pending");
    expect(consoleState().refunds).toHaveLength(2);
  });

  it("has no way for the chat to claim an approval", () => {
    const shape = refundTools.request_refund.inputSchema as unknown as {
      shape: Record<string, unknown>;
    };
    expect(Object.keys(shape.shape).sort()).toEqual(["orderId", "reason"]);
  });

  it("a person can approve or reject, and the customer-facing state follows", () => {
    requestRefund("ORD-1002", "x");
    requestRefund("ORD-1004", "x");
    const [second, first] = consoleState().refunds;
    expect(decideRefund(first.id, "approve")).toBe(true);
    expect(decideRefund(second.id, "reject", "Used for 3 months")).toBe(true);
    expect(decideRefund(first.id, "reject")).toBe(false); // already decided
    const sam = getOrders("sam@example.com");
    const jordan = getOrders("jordan@example.com");
    if (sam.status !== "ok" || jordan.status !== "ok")
      throw new Error("orders");
    expect(jordan.orders.find((o) => o.id === "ORD-1002")?.refund?.status).toBe(
      "refunded",
    );
    expect(sam.orders.find((o) => o.id === "ORD-1004")?.refund).toMatchObject({
      status: "rejected",
      note: "Used for 3 months",
    });
    expect(requestRefund("ORD-1004", "again").status).toBe("already_rejected");
  });

  it("finds orders by email, and says so when there are none", () => {
    expect(getOrders("  Jordan@Example.com ").status).toBe("ok");
    expect(getOrders("nobody@example.com").status).toBe("no_orders");
    expect(requestRefund("ORD-9999", "x").status).toBe("not_found");
  });
});

describe("the two agents' tools", () => {
  it("Copper keeps its five tools and adds transfer_refund", () => {
    expect(Object.keys(copperTools).sort()).toEqual(
      [
        "calculate_cost",
        "check_availability",
        "get_prices",
        "get_products",
        "search_docs",
        "transfer_refund",
      ].sort(),
    );
  });

  it("the Refund agent has three tools", () => {
    expect(Object.keys(refundTools).sort()).toEqual([
      "get_orders",
      "request_refund",
      "transfer_support",
    ]);
  });
});
