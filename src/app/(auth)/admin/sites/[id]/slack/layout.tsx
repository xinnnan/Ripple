import type { Metadata } from "next";

export const metadata: Metadata = { title: "Slack channel" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
