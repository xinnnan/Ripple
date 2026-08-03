"use client";

import { useState } from "react";
import { CreateTicketModal } from "./create-ticket-modal";

interface TicketsPageHeaderProps {
  filterQuery: string;
  isInternal?: boolean;
  canExport?: boolean;
}

export function TicketsPageHeader({
  filterQuery,
  isInternal = true,
  canExport = true,
}: TicketsPageHeaderProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Tickets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isInternal
            ? "All support tickets across customers and sites"
            : "Your support tickets"}
        </p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={() => setModalOpen(true)}
          className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:flex-none"
        >
          + Submit Ticket
        </button>
        {isInternal && canExport && (
          <a
            href={`/api/tickets/export${filterQuery}`}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-center text-sm font-medium text-foreground transition-colors hover:bg-accent sm:flex-none"
          >
            Export CSV
          </a>
        )}
      </div>

      <CreateTicketModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => window.location.reload()}
      />
    </div>
  );
}
