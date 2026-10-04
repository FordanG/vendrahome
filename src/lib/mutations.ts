import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withTransaction } from "@/db";
import type { ActionState } from "./action-state";

type Result = ActionState & { redirectTo?: string };
class RejectedMutation extends Error {
  constructor(readonly result: Result) { super(result.error); }
}

/** Return validation errors only after rollback; navigate only after commit. */
export async function mutate(work: () => Promise<Result>): Promise<ActionState> {
  let result: Result;
  try {
    result = await withTransaction(async () => {
      const value = await work();
      if (value.error) throw new RejectedMutation(value);
      return value;
    });
  } catch (error) {
    if (error instanceof RejectedMutation) return error.result;
    throw error;
  }
  revalidatePath("/", "layout");
  if (result.redirectTo) redirect(result.redirectTo);
  return result;
}
