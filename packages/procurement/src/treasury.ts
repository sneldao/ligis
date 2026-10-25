import type { Money } from "./types.js";

export interface Obligation {
  obligationId: string;
  orderId: string;
  amount: Money;
  dueAt: string;
  priority: "critical" | "normal" | "deferrable";
}

export interface AllocateInput {
  obligations: Obligation[];
  balance: number;
  reserveFloor: number;
  now: Date;
}

export interface Allocated {
  obligation: Obligation;
  reason: string;
}

export interface Allocation {
  fund: Allocated[];
  defer: Allocated[];
  review: Allocated[];
}

const PRIORITY_RANK = { critical: 0, normal: 1, deferrable: 2 } as const;

/**
 * Decide which obligations the available cash can fund. Available =
 * balance - reserveFloor. Critical first, then earliest due date. Deferrable
 * obligations that don't fit are deferred; anything else that doesn't fit goes
 * to review. Funded obligations still go through executor.pay.
 */
export function allocate(input: AllocateInput): Allocation {
  const available0 = input.balance - input.reserveFloor;
  let available = available0;
  const sorted = [...input.obligations].sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
  });
  const out: Allocation = { fund: [], defer: [], review: [] };
  for (const ob of sorted) {
    if (ob.amount.amount <= available) {
      available -= ob.amount.amount;
      out.fund.push({
        obligation: ob,
        reason: `${ob.priority} obligation due ${ob.dueAt} fits available balance (${available.toFixed(2)} remaining after)`,
      });
    } else if (ob.priority === "deferrable") {
      out.defer.push({
        obligation: ob,
        reason: `deferrable obligation does not fit available balance (${available.toFixed(2)} of ${available0.toFixed(2)} left)`,
      });
    } else {
      out.review.push({
        obligation: ob,
        reason: `${ob.priority} obligation does not fit available balance (${available.toFixed(2)} left); needs human review`,
      });
    }
  }
  return out;
}
