-- ==============================================================================
-- BigBag Database Schema Migration: Turso / SQLite -> Supabase PostgreSQL
-- ==============================================================================

-- 1. builder_projects
CREATE TABLE IF NOT EXISTS public.builder_projects (
  project_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  record_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS builder_projects_tenant_updated
  ON public.builder_projects (tenant_id, updated_at DESC);

-- 2. builder_project_files
CREATE TABLE IF NOT EXISTS public.builder_project_files (
  project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('source', 'deployment')),
  path TEXT NOT NULL,
  content BYTEA NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, kind, path),
  FOREIGN KEY (project_id) REFERENCES public.builder_projects(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS builder_project_files_lookup
  ON public.builder_project_files (project_id, kind, path);

-- 3. builder_app_records
CREATE TABLE IF NOT EXISTS public.builder_app_records (
  project_id TEXT NOT NULL,
  collection_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, collection_name, record_id),
  FOREIGN KEY (project_id) REFERENCES public.builder_projects(project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS builder_app_records_collection
  ON public.builder_app_records (project_id, collection_name, updated_at DESC);

-- ==============================================================================
-- Row Level Security (RLS) & Policies
-- ==============================================================================

ALTER TABLE public.builder_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_project_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_app_records ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (service_role bypasses RLS by default, but explicit policies ensure clarity)
DROP POLICY IF EXISTS "Service role full access on builder_projects" ON public.builder_projects;
CREATE POLICY "Service role full access on builder_projects"
  ON public.builder_projects FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Tenant isolation for builder_projects" ON public.builder_projects;
CREATE POLICY "Tenant isolation for builder_projects"
  ON public.builder_projects FOR ALL
  TO authenticated
  USING (tenant_id = auth.uid()::text)
  WITH CHECK (tenant_id = auth.uid()::text);

DROP POLICY IF EXISTS "Service role full access on builder_project_files" ON public.builder_project_files;
CREATE POLICY "Service role full access on builder_project_files"
  ON public.builder_project_files FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Tenant isolation for builder_project_files" ON public.builder_project_files;
CREATE POLICY "Tenant isolation for builder_project_files"
  ON public.builder_project_files FOR ALL
  TO authenticated
  USING (tenant_id = auth.uid()::text)
  WITH CHECK (tenant_id = auth.uid()::text);

DROP POLICY IF EXISTS "Service role full access on builder_app_records" ON public.builder_app_records;
CREATE POLICY "Service role full access on builder_app_records"
  ON public.builder_app_records FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Tenant isolation for builder_app_records" ON public.builder_app_records;
CREATE POLICY "Tenant isolation for builder_app_records"
  ON public.builder_app_records FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.builder_projects
      WHERE public.builder_projects.project_id = public.builder_app_records.project_id
        AND public.builder_projects.tenant_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.builder_projects
      WHERE public.builder_projects.project_id = public.builder_app_records.project_id
        AND public.builder_projects.tenant_id = auth.uid()::text
    )
  );
