import { AdminShell } from "@/components/admin/admin-shell";
import { requireSuperAdmin } from "@/lib/admin/permissions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireSuperAdmin();
  return (
    <AdminShell userName={admin.fullName}>
      {children}
    </AdminShell>
  );
}