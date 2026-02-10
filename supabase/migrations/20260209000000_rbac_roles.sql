CREATE TYPE account_role AS ENUM ('pebl', 'partner', 'pending', 'public');

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS account_role account_role DEFAULT 'pending';

UPDATE user_profiles SET account_role = 'pebl' WHERE is_admin = true;
UPDATE user_profiles SET account_role = 'pebl' WHERE email LIKE '%@pebl-cic.co.uk';
UPDATE user_profiles SET account_role = 'partner' WHERE is_admin = false AND account_role = 'pending';

CREATE INDEX IF NOT EXISTS idx_user_profiles_account_role ON user_profiles(account_role);

CREATE TABLE project_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'comment', 'edit')),
  shared_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, shared_with_user_id)
);

ALTER TABLE project_shares ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_project_shares_project_id ON project_shares(project_id);
CREATE INDEX IF NOT EXISTS idx_project_shares_shared_with ON project_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_project_shares_shared_by ON project_shares(shared_by);

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account_role::text FROM user_profiles WHERE id = auth.uid()
$$;

CREATE POLICY "Project owners and PEBL admins can manage shares"
  ON project_shares FOR ALL
  USING (
    shared_by = auth.uid()
    OR public.get_my_role() = 'pebl'
  );

CREATE POLICY "Shared users can view their shares"
  ON project_shares FOR SELECT
  USING (shared_with_user_id = auth.uid());

CREATE POLICY "PEBL admins can view all projects"
  ON projects FOR SELECT
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "Partners can view shared projects"
  ON projects FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_shares
    WHERE project_shares.project_id = projects.id
    AND project_shares.shared_with_user_id = auth.uid()
  ));

CREATE POLICY "Partners can view pins in shared projects"
  ON pins FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_shares
    WHERE project_shares.project_id::text = pins.project_id
    AND project_shares.shared_with_user_id = auth.uid()
  ));

CREATE POLICY "PEBL admins can view all pins"
  ON pins FOR SELECT
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "Partners can view lines in shared projects"
  ON lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_shares
    WHERE project_shares.project_id::text = lines.project_id
    AND project_shares.shared_with_user_id = auth.uid()
  ));

CREATE POLICY "PEBL admins can view all lines"
  ON lines FOR SELECT
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "Partners can view areas in shared projects"
  ON areas FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM project_shares
    WHERE project_shares.project_id::text = areas.project_id
    AND project_shares.shared_with_user_id = auth.uid()
  ));

CREATE POLICY "PEBL admins can view all areas"
  ON areas FOR SELECT
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "Partners can view files in shared projects"
  ON pin_files FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM pins
    JOIN project_shares ON project_shares.project_id::text = pins.project_id
    WHERE pins.id::text = pin_files.pin_id
    AND project_shares.shared_with_user_id = auth.uid()
  ));

CREATE POLICY "PEBL admins can view all pin files"
  ON pin_files FOR SELECT
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can view all user profiles"
  ON user_profiles FOR SELECT
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can update user profiles"
  ON user_profiles FOR UPDATE
  USING (public.get_my_role() = 'pebl');

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, display_name, account_role)
    VALUES (
      new.id,
      new.email,
      COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
      CASE WHEN new.email LIKE '%@pebl-cic.co.uk' THEN 'pebl'::account_role ELSE 'pending'::account_role END
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      account_role = CASE
        WHEN EXCLUDED.email LIKE '%@pebl-cic.co.uk' THEN 'pebl'::account_role
        ELSE user_profiles.account_role
      END;
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

NOTIFY pgrst, 'reload schema';
