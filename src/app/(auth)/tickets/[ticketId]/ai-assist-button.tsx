"use client";

import { useState } from "react";

interface AIAssistButtonProps {
  ticketId: string;
  userId?: string;
}

export function AIAssistButton({ ticketId, userId }: AIAssistButtonProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    output_text: string;
    suggestion_type: string;
    model_name: string;
    confidence_level: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);

  async function requestSuggestion(type: string) {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket_id: ticketId,
          suggestion_type: type,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to get suggestion");
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get AI suggestion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={() => setShowPanel(!showPanel)}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors flex items-center gap-2"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
        </svg>
        Ask Ripple Assist
      </button>

      {showPanel && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-6">
          <h3 className="text-sm font-semibold text-blue-800 mb-4">
            🤖 Ripple Assist — AI Suggestions
          </h3>

          <div className="flex flex-wrap gap-2 mb-4">
            {[
              { type: "troubleshooting", label: "Troubleshooting" },
              { type: "summary", label: "Summary" },
              { type: "customer_reply_draft", label: "Customer Reply Draft" },
              { type: "closure_summary", label: "Closure Summary" },
            ].map((opt) => (
              <button
                key={opt.type}
                onClick={() => requestSuggestion(opt.type)}
                disabled={loading}
                className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                {opt.label}
              </button>
            ))}
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating suggestion...
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {result && (
            <div className="border border-blue-200 rounded-lg p-4 bg-white">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-blue-700">
                  {result.suggestion_type}
                </span>
                <span className="text-xs text-muted-foreground">
                  via {result.model_name}
                </span>
                {result.confidence_level && (
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${
                      result.confidence_level === "high"
                        ? "bg-green-100 text-green-700"
                        : result.confidence_level === "low"
                        ? "bg-red-100 text-red-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {result.confidence_level}
                  </span>
                )}
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {result.output_text}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
