export default function SettingsPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          System configuration and preferences
        </p>
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Slack Integration */}
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">Slack Integration</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Slack Bot Token
              </label>
              <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground bg-muted">
                •••••••••••••••• (configured in .env.local)
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Signing Secret
              </label>
              <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground bg-muted">
                •••••••••••••••• (configured in .env.local)
              </div>
            </div>
          </div>
        </div>

        {/* AI Configuration */}
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">
            Ripple Assist (AI)
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                AI Provider
              </label>
              <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground bg-muted">
                MiniMax AI
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Default Model
              </label>
              <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground bg-muted">
                M2.7-highspeed (configured in .env.local)
              </div>
            </div>
          </div>
        </div>

        {/* Email Configuration */}
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">Email Notifications</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Email Provider
              </label>
              <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground bg-muted">
                Resend
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                From Address
              </label>
              <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground bg-muted">
                support@dropletai.services
              </div>
            </div>
          </div>
        </div>

        {/* Database */}
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-base font-semibold text-foreground mb-4">Database</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Supabase URL
              </label>
              <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground bg-muted">
                (configured in .env.local)
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Database migrations are located in <code className="text-xs bg-muted px-1 py-0.5 rounded">supabase/migrations/</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
