import { listClients } from "./actions";
import ClientsPage from "./client-list";

export const metadata = {
  title: "Clients — Agency OS",
};

export default async function ClientsIndexPage() {
  const clients = await listClients();
  return <ClientsPage initialClients={clients} />;
}
