import { CAN, requireStaff } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "../actions";
import { ClientFields } from "../client-fields";

export default async function NewClientPage() {
  await requireStaff(CAN.manageContracts);
  return (
    <>
      <PageHeader back={{ href: "/clients", label: "Companies" }} title="Add company" />
      <Card className="max-w-2xl">
        <ActionForm action={createClient} submitLabel="Add company">
          <ClientFields />
        </ActionForm>
      </Card>
    </>
  );
}
