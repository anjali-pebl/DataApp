-- Migration: Create methodology tables for tile-based data collection documentation
-- This allows project owners to document methodology per tile/datatype with rich text and PDF attachments

-- Table: tile_methodology
-- Stores the methodology documentation for each tile within a project
CREATE TABLE public.tile_methodology (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL,
    tile_name TEXT NOT NULL CHECK (tile_name IN ('SubCam', 'GrowProbe', 'FPOD', 'Water and Crop Samples', 'eDNA')),
    content_html TEXT,
    content_json JSONB,
    is_published BOOLEAN DEFAULT FALSE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, tile_name)
);

-- Table: methodology_attachments
-- Stores PDF attachments for methodology documentation
CREATE TABLE public.methodology_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    methodology_id UUID NOT NULL REFERENCES public.tile_methodology(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    file_size BIGINT NOT NULL,
    caption TEXT,
    display_order INTEGER DEFAULT 0,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_tile_methodology_project_id ON public.tile_methodology(project_id);
CREATE INDEX idx_tile_methodology_user_id ON public.tile_methodology(user_id);
CREATE INDEX idx_methodology_attachments_methodology_id ON public.methodology_attachments(methodology_id);

-- Enable RLS
ALTER TABLE public.tile_methodology ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.methodology_attachments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for tile_methodology

-- Policy: Users can view methodology if they own it OR if it's published and they have access to the project
CREATE POLICY "Users can view own methodology"
    ON public.tile_methodology
    FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can view published methodology"
    ON public.tile_methodology
    FOR SELECT
    USING (is_published = true);

-- Policy: Only owner can insert methodology
CREATE POLICY "Users can insert own methodology"
    ON public.tile_methodology
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Only owner can update methodology
CREATE POLICY "Users can update own methodology"
    ON public.tile_methodology
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Only owner can delete methodology
CREATE POLICY "Users can delete own methodology"
    ON public.tile_methodology
    FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for methodology_attachments

-- Policy: Users can view attachments if they can view the methodology
CREATE POLICY "Users can view attachments for own methodology"
    ON public.methodology_attachments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.tile_methodology tm
            WHERE tm.id = methodology_id AND tm.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view attachments for published methodology"
    ON public.methodology_attachments
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.tile_methodology tm
            WHERE tm.id = methodology_id AND tm.is_published = true
        )
    );

-- Policy: Only owner can insert attachments
CREATE POLICY "Users can insert attachments for own methodology"
    ON public.methodology_attachments
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tile_methodology tm
            WHERE tm.id = methodology_id AND tm.user_id = auth.uid()
        )
    );

-- Policy: Only owner can update attachments
CREATE POLICY "Users can update attachments for own methodology"
    ON public.methodology_attachments
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.tile_methodology tm
            WHERE tm.id = methodology_id AND tm.user_id = auth.uid()
        )
    );

-- Policy: Only owner can delete attachments
CREATE POLICY "Users can delete attachments for own methodology"
    ON public.methodology_attachments
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.tile_methodology tm
            WHERE tm.id = methodology_id AND tm.user_id = auth.uid()
        )
    );

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_methodology_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on methodology changes
CREATE TRIGGER trigger_update_methodology_updated_at
    BEFORE UPDATE ON public.tile_methodology
    FOR EACH ROW
    EXECUTE FUNCTION update_methodology_updated_at();

-- Storage bucket for methodology files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'methodology-files',
    'methodology-files',
    false,
    52428800,
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies

-- Policy: Users can upload to their own methodology folder
CREATE POLICY "Users can upload methodology files"
    ON storage.objects
    FOR INSERT
    WITH CHECK (
        bucket_id = 'methodology-files'
        AND auth.uid() IS NOT NULL
    );

-- Policy: Users can view files for methodology they can access
CREATE POLICY "Users can view methodology files"
    ON storage.objects
    FOR SELECT
    USING (
        bucket_id = 'methodology-files'
        AND auth.uid() IS NOT NULL
    );

-- Policy: Users can delete their own methodology files
CREATE POLICY "Users can delete own methodology files"
    ON storage.objects
    FOR DELETE
    USING (
        bucket_id = 'methodology-files'
        AND auth.uid() IS NOT NULL
    );
