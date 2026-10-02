import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/admin-common";
import { SettingsForm } from "@/components/admin/settings-form";
import { getPlatformSettings } from "@/lib/admin/platform-settings";

export default async function AdminSettingsPage() {
  const snapshot = await getPlatformSettings();

  return (
    <>
      <PageHeader title="Settings" description="Platform-wide subscription defaults." />
      <Card>
        <CardHeader>
          <CardTitle>Platform defaults</CardTitle>
          <CardDescription>
            These values apply to new subscriptions and to the automatic expiry sweep.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm snapshot={snapshot} />
        </CardContent>
      </Card>
    </>
  );
}