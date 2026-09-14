import { listClients } from "./actions";
import ClientsPage from "./client-list";

export const metadata = {
  title: "Clients — Agency OS",
};

// Session-scoped data (listClients reads the auth cookies) — this page must
// never be statically prerendered, where no cookies exist and the render
// 404s/fails. Same guard the dashboard and posts pages carry.
export const dynamic = "force-dynamic";

export default async function ClientsIndexPage() {
  const clients = await listClients();
  return <ClientsPage initialClients={clients} />;
}
