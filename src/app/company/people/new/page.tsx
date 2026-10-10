import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { savePerson } from "../../actions";
import { PersonFields } from "../person-fields";

export default async function NewPersonPage() {
  const { client } = await requireCompany();
  if (!client.selfManagePeople) notFound();
  return (
    <>
      <PageHeader
        back={{ href: "/company/people", label: "People" }}
        title="Add a person"
        subtitle="Their details first. Then ask the front desk for a room on the next page."
      />
      <Card className="max-w-3xl">
        <ActionForm action={savePerson.bind(null, null)} submitLabel="Add person" pendingLabel="Adding…">
          <PersonFields />
        </ActionForm>
      </Card>
    </>
  );
}
