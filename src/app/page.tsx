import Link from "next/link";
import Image from "next/image";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Ripple"
              width={32}
              height={32}
              className="rounded-lg"
            />
            <span className="text-lg font-semibold text-foreground">Ripple</span>
            <span className="text-sm text-muted-foreground">by DropletAI</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/submit"
              className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Submit Ticket
            </Link>
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto max-w-7xl px-6 py-24">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
            Support Portal
          </h1>
          <p className="mt-6 text-lg leading-8 text-muted-foreground">
            Submit support requests, track issues, and communicate with our
            engineering team.
          </p>
          <div className="mt-10 flex items-center justify-center">
            <Link
              href="/submit"
              className="rounded-lg bg-primary px-8 py-3.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              Submit Support Request
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-24 grid grid-cols-1 gap-8 sm:grid-cols-3">
          <div className="rounded-xl border border-border p-6">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center mb-4">
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-foreground">Quick Issue Reporting</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Report issues with your AMR, AGV, conveyor, or sortation systems
              directly through Slack or this portal.
            </p>
          </div>

          <div className="rounded-xl border border-border p-6">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center mb-4">
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-foreground">Real-Time Status</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Track your support tickets in real-time. See who is working on
              your issue and get updates as they happen.
            </p>
          </div>

          <div className="rounded-xl border border-border p-6">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center mb-4">
              <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-foreground">Expert Engineering Support</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Our field engineers and solution architects provide direct support
              for all your automation equipment and systems.
            </p>
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-24 space-y-12">
          {/* What is Ripple */}
          <div className="rounded-2xl border border-border bg-muted/30 p-8 sm:p-10">
            <div className="flex items-start gap-5">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Image
                  src="/logo.png"
                  alt="Ripple"
                  width={28}
                  height={28}
                  className="rounded-lg"
                />
              </div>
              <div>
                <h2 className="text-xl font-bold text-foreground mb-3">
                  What is Ripple?
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  Ripple is DropletAI&apos;s dedicated service and dispatch tool. It
                  connects our clients with field operations, software and hardware
                  engineering teams to efficiently resolve faults, software bugs,
                  requests, and track routine maintenance for your automation
                  deployments.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            {/* Slack Channel */}
            <div className="rounded-2xl border border-border p-8">
              <div className="h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center mb-4">
                <svg className="h-5 w-5 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.521-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.521 2.521h-2.521V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.521 2.523h-6.315z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-3">
                Slack Connect Channel
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Create and manage tickets without leaving your workspace using the{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
                  /ticket
                </code>{" "}
                command. Get real-time updates, communicate with engineers, and
                resolve issues — all inside Slack.
              </p>
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-xs font-medium text-foreground mb-1">
                  How to join
                </p>
                <p className="text-xs text-muted-foreground">
                  Contact your DropletAI Account Manager to set up a dedicated
                  Slack Connect channel between our organizations.
                </p>
              </div>
            </div>

            {/* Site Code */}
            <div className="rounded-2xl border border-border p-8">
              <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center mb-4">
                <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-3">
                Finding Your Site Code
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Every automation deployment is assigned a unique Site Code (e.g.,{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
                  XYZ-ABC-001
                </code>
                ). This code is required to submit a ticket so our engineers know
                exactly which facility needs support.
              </p>
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-xs font-medium text-foreground mb-1">
                  Don&apos;t know your Site Code?
                </p>
                <p className="text-xs text-muted-foreground">
                  Ask your Account Manager or email{" "}
                  <a
                    href="mailto:support@dropletai.services"
                    className="text-primary hover:underline"
                  >
                    support@dropletai.services
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-8 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} DropletAI Services. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
