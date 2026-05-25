"use client";

import { useState } from "react";
import { CreateTicketModal } from "./create-ticket-modal";

interface TicketsPageHeaderProps {
  filterQuery: string;
  isInternal?: boolean;
}

export function TicketsPageHeader({ filterQuery, isInternal = true }: TicketsPageHeaderProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="mb-8 flex items-center justify-between">
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
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + Submit Ticket
        </button>
        {isInternal && (
          <a
            href={`/api/tickets/export${filterQuery}`}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
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
