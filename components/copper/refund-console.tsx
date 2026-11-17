"use client";

// The Refund Console: where a person works. Set the auto-refund limit, approve
// or reject refunds the Refund agent could not approve on its own, and see
// every order the demo customers can ask about. It checks for news every
// couple of seconds, so a refund the chat just sent shows up by itself.
import { CheckIcon, ClockIcon, ShieldCheckIcon, XIcon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatUsd } from "@/lib/copper/catalog";
import { decide, readConsole, saveLimit } from "@/lib/copper/refunds/actions";
import type { ConsoleState, Refund } from "@/lib/copper/refunds/types";

const POLL_MS = 2000;

export function RefundConsole() {
  const [state, setState] = useState<ConsoleState | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const next = await readConsole();
        if (alive) setState(next);
      } catch {
        // Keep showing what we had; the next check tries again.
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const run = (job: () => Promise<ConsoleState>) =>
    startTransition(async () => setState(await job()));

  if (!state)
    return (
      <p className="text-muted-foreground text-sm">Loading the console…</p>
    );

  const pending = state.refunds.filter((r) => r.status === "pending");
  const decided = state.refunds.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Refunds at or under the limit are approved automatically by the app.
        Anything over it waits here for you.
      </p>

      <LimitCard
        limitUsd={state.limitUsd}
        onSave={(value) => run(() => saveLimit(value))}
      />

      <section aria-labelledby="queue-title" className="space-y-3">
        <h2
          id="queue-title"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <ClockIcon className="size-5" /> Needs your approval
          <Badge variant={pending.length ? "default" : "secondary"}>
            {pending.length}
          </Badge>
        </h2>
        {pending.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-6 text-sm">
              Nothing is waiting. Ask for a refund over the limit in the chat
              and it shows up here.
            </CardContent>
          </Card>
        ) : (
          pending.map((refund) => (
            <PendingCard
              key={refund.id}
              refund={refund}
              onDecide={(decision, note) =>
                run(() => decide(refund.id, decision, note))
              }
            />
          ))
        )}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="done-title" className="space-y-3">
          <h2 id="done-title" className="text-lg font-semibold">
            Decided
          </h2>
          <Card>
            <CardContent className="divide-y py-0">
              {decided.map((refund) => (
                <div
                  key={refund.id}
                  data-testid="decided-refund"
                  className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {refund.orderId} · {refund.item}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {refund.email} · {refund.why}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">
                      {formatUsd(refund.amountUsd)}
                    </span>
                    <StatusBadge refund={refund} />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      <section aria-labelledby="orders-title" className="space-y-3">
        <h2 id="orders-title" className="text-lg font-semibold">
          Demo customers and orders
        </h2>
        <p className="text-muted-foreground text-sm">
          Give the chat one of these emails to test with.
        </p>
        <Card>
          <CardContent className="divide-y py-0">
            {state.orders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {order.id} · {order.item}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {order.email} · {order.daysAgo} days ago
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    {formatUsd(order.amountUsd)}
                  </span>
                  {order.refund ? (
                    <StatusBadge refund={order.refund} />
                  ) : (
                    <Badge variant="outline">No refund</Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function LimitCard({
  limitUsd,
  onSave,
}: {
  limitUsd: number;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(limitUsd));
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : String(limitUsd);
  const value = Number(draft);
  const valid = draft.trim() !== "" && Number.isFinite(value) && value >= 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheckIcon className="size-5" /> Auto-refund limit
        </CardTitle>
        <CardDescription>
          Right now: refunds of {formatUsd(limitUsd)} or less are approved
          without a person. Set it to $0 to send every refund to a person.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            onSave(value);
            setEditing(false);
          }}
        >
          <label className="flex items-center gap-1 text-sm font-medium">
            $
            <input
              aria-label="Auto-refund limit in dollars"
              inputMode="decimal"
              value={shown}
              onFocus={() => {
                setDraft(String(limitUsd));
                setEditing(true);
              }}
              onChange={(event) => {
                setDraft(event.target.value);
                setEditing(true);
              }}
              className="bg-background focus-visible:ring-ring h-9 w-24 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </label>
          <Button type="submit" size="sm" disabled={!valid}>
            Save limit
          </Button>
          {[0, 50, 200].map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(false);
                onSave(preset);
              }}
            >
              ${preset}
            </Button>
          ))}
        </form>
      </CardContent>
    </Card>
  );
}

function PendingCard({
  refund,
  onDecide,
}: {
  refund: Refund;
  onDecide: (decision: "approve" | "reject", note?: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Card data-testid="pending-refund" className="border-chart-4">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>
            {refund.orderId} · {refund.item}
          </span>
          <span className="font-mono">{formatUsd(refund.amountUsd)}</span>
        </CardTitle>
        <CardDescription>
          {refund.email} · request {refund.id}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          <span className="font-semibold">Customer said:</span> {refund.reason}
        </p>
        <p>
          <span className="font-semibold">Why it is waiting:</span> {refund.why}
        </p>
        {rejecting ? (
          <div className="space-y-2">
            <input
              aria-label="Reason for declining (the customer is told)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why? The customer will be told this."
              className="bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onDecide("reject", note)}
              >
                <XIcon /> Confirm reject
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRejecting(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onDecide("approve")}>
              <CheckIcon /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejecting(true)}
            >
              <XIcon /> Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ refund }: { refund: Refund }) {
  if (refund.status === "pending")
    return <Badge className="bg-chart-4 text-chart-5">Waiting</Badge>;
  if (refund.status === "rejected")
    return <Badge variant="destructive">Rejected</Badge>;
  return (
    <Badge className="bg-accent text-white">
      Refunded{refund.decidedBy === "auto" ? " (auto)" : " (approved)"}
    </Badge>
  );
}
