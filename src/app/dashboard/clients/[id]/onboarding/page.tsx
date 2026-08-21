import { notFound } from "next/navigation";
import { getWizardData } from "./actions";
import OnboardingWizard from "./wizard";

export const metadata = {
  title: "Client Onboarding — Agency OS",
};

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let initial: Awaited<ReturnType<typeof getWizardData>>;
  try {
    initial = await getWizardData(id);
  } catch {
    notFound();
  }
  return <OnboardingWizard initial={initial} />;
}
