import type { Staff } from "@/db/schema";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { ProfilePhoto } from "./profile-photo";
import { ROLE_LABELS } from "@/lib/auth";
import { updateOwnProfile } from "@/app/profile-actions";
import { ActionForm } from "./action-form";
import { Badge, Card, Field, Input, SectionTitle } from "./ui";

export async function AccountProfile({ user }: { user: Pick<Staff, "id" | "name" | "username" | "role" | "email" | "phone"> }) {
  const photo = await (await getDb()).query.accountPhotos.findFirst({ where: eq(schema.accountPhotos.staffId, user.id), columns: { version: true } });
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
  return (
    <Card className="mb-4 max-w-md">
      <SectionTitle>Your profile</SectionTitle>
      <div className="mb-5 flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold">{user.name}</p>
          <p className="mb-1 break-all text-sm text-muted">@{user.username}</p>
          <Badge>{ROLE_LABELS[user.role]}</Badge>
        </div>
      </div>
      <ProfilePhoto version={photo?.version} initials={initials} />
      <ActionForm action={updateOwnProfile} submitLabel="Save profile" pendingLabel="Saving profile…">
        <Field label="Display name" hint="The name shown with your account in the app.">
          <Input name="name" autoComplete="name" required maxLength={100} defaultValue={user.name} />
        </Field>
        <Field label="Email" hint="Optional contact detail. You still sign in with your username.">
          <Input name="email" type="email" autoComplete="email" maxLength={254} defaultValue={user.email ?? ""} />
        </Field>
        <Field label="Mobile number" hint="Optional, e.g. +63 917 123 4567">
          <Input name="phone" type="tel" autoComplete="tel" maxLength={30} defaultValue={user.phone ?? ""} />
        </Field>
        {user.role === "tenant" && <p className="text-xs text-muted">These are your account details. Ask the front desk to update your official resident information or room assignment.</p>}
      </ActionForm>
    </Card>
  );
}
