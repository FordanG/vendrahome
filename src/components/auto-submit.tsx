"use client";

import type { ComponentProps } from "react";
import { Select } from "./ui";

/** A filter dropdown that applies as soon as something is picked, with no Search button to press. */
export function AutoSubmitSelect(props: ComponentProps<"select">) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
