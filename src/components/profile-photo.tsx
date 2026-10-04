"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { uploadOwnPhoto, removeOwnPhoto } from "@/app/profile-actions";
import type { ActionState } from "@/lib/action-state";
import { Button, Field, Input } from "./ui";

export function ProfilePhoto({ version, initials }: { version?: string; initials: string }) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [state, setState] = useState<ActionState>({});
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);
  function clearSelection() {
    setFile(undefined);
    setPreview(undefined);
    if (input.current) input.current.value = "";
  }
  const source = preview || (version ? `/api/profile/photo?v=${version}` : undefined);
  return <div className="mb-5 border-b border-border pb-5">
    <div className="mb-3 flex items-center gap-3">
      <div style={{ width: 80, height: 80, flex: "0 0 80px" }} className="flex items-center justify-center overflow-hidden rounded-full bg-accent/10 text-2xl font-semibold text-accent">
        {/* Private authenticated endpoint must bypass the public image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {source ? <img src={source} width={80} height={80} style={{ width: 80, height: 80, objectFit: "cover" }} alt={preview ? "New profile photo preview" : "Your profile photo"} /> : <span aria-label="Profile initials">{initials}</span>}
      </div>
      <p className="text-sm text-muted">{file ? "Preview — save to apply." : "Your account photo"}<br />Photos are cropped to a square.</p>
    </div>
    <form onSubmit={event => {
      event.preventDefault();
      const fd = new FormData(event.currentTarget);
      startTransition(async () => {
        try {
          const result = await uploadOwnPhoto({}, fd);
          setState(result);
          if (result.ok) clearSelection();
        } catch { setState({ error: "Photo could not be saved. Please try again." }); }
      });
    }} className="space-y-3">
      <Field label="Profile photo" hint="JPG, PNG, or WebP. Up to 2 MB and 20 megapixels.">
        <Input ref={input} name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} onChange={event => {
          const selected = event.target.files?.[0];
          setState({});
          setPreview(undefined);
          if (selected && selected.size > 2 * 1024 * 1024) {
            clearSelection();
            setState({ error: "Choose a photo smaller than 2 MB." });
          } else {
            setFile(selected);
            setPreview(selected ? URL.createObjectURL(selected) : undefined);
          }
        }} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!file || pending}>{pending ? "Updating…" : "Save photo"}</Button>
        {file && <Button type="button" variant="secondary" disabled={pending} onClick={clearSelection}>Cancel</Button>}
        {version && <Button type="button" variant="secondary" disabled={pending} onClick={() => startTransition(async () => {
          try {
            const result = await removeOwnPhoto();
            setState(result);
            if (result.ok) clearSelection();
          } catch { setState({ error: "Photo could not be removed. Please try again." }); }
        })}>Remove photo</Button>}
      </div>
      {state.error && <p role="alert" className="text-sm text-attention">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-muted">{state.ok}</p>}
    </form>
  </div>;
}
