-- Migration: 009_create_ai_tables
-- Description: Create AI suggestion and knowledge base tables for Ripple Assist

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  suggestion_type TEXT NOT NULL CHECK (suggestion_type IN (
    'summary',
    'troubleshooting',
    'similar_tickets',
    'customer_reply_draft',
    'escalation_summary',
    'closure_summary',
    'log_analysis'
  )),
  input_context_hash TEXT,
  model_name TEXT NOT NULL DEFAULT 'gpt-4o',
  prompt_version TEXT,
  output_text TEXT NOT NULL,
  confidence_level TEXT CHECK (confidence_level IN ('high', 'medium', 'low')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  dismissed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ,
  feedback_rating INTEGER CHECK (feedback_rating BETWEEN 1 AND 5),
  feedback_note TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  asset_type TEXT,
  vendor TEXT,
  content TEXT NOT NULL,
  source_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ticket_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  embedding VECTOR(1536),
  embedding_source TEXT NOT NULL DEFAULT 'title_description' CHECK (embedding_source IN ('title_description', 'resolution', 'full_context')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_article_id UUID NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  embedding VECTOR(1536),
  chunk_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_suggestions_ticket_id ON ai_suggestions(ticket_id);
CREATE INDEX idx_ai_suggestions_type ON ai_suggestions(suggestion_type);
CREATE INDEX idx_ai_suggestions_created_at ON ai_suggestions(created_at DESC);
CREATE INDEX idx_knowledge_articles_category ON knowledge_articles(category);
CREATE INDEX idx_knowledge_articles_asset_type ON knowledge_articles(asset_type);
CREATE INDEX idx_ticket_embeddings_ticket_id ON ticket_embeddings(ticket_id);
CREATE INDEX idx_knowledge_embeddings_article_id ON knowledge_embeddings(knowledge_article_id);

COMMENT ON TABLE ai_suggestions IS 'AI-generated recommendations for support tickets (Ripple Assist)';
COMMENT ON TABLE knowledge_articles IS 'Internal knowledge base articles for troubleshooting and documentation';
COMMENT ON TABLE ticket_embeddings IS 'Vector embeddings of tickets for similarity search';
COMMENT ON TABLE knowledge_embeddings IS 'Vector embeddings of knowledge articles for RAG';
