CREATE POLICY "PEBL admins can insert projects"
  ON projects FOR INSERT
  WITH CHECK (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can update all projects"
  ON projects FOR UPDATE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can delete all projects"
  ON projects FOR DELETE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can insert pins"
  ON pins FOR INSERT
  WITH CHECK (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can update all pins"
  ON pins FOR UPDATE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can delete all pins"
  ON pins FOR DELETE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can insert lines"
  ON lines FOR INSERT
  WITH CHECK (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can update all lines"
  ON lines FOR UPDATE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can delete all lines"
  ON lines FOR DELETE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can insert areas"
  ON areas FOR INSERT
  WITH CHECK (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can update all areas"
  ON areas FOR UPDATE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can delete all areas"
  ON areas FOR DELETE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can insert pin files"
  ON pin_files FOR INSERT
  WITH CHECK (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can update all pin files"
  ON pin_files FOR UPDATE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can delete all pin files"
  ON pin_files FOR DELETE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can view all tags"
  ON tags FOR SELECT
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can insert tags"
  ON tags FOR INSERT
  WITH CHECK (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can update all tags"
  ON tags FOR UPDATE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can delete all tags"
  ON tags FOR DELETE
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can manage pin tags"
  ON pin_tags FOR ALL
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can manage line tags"
  ON line_tags FOR ALL
  USING (public.get_my_role() = 'pebl');

CREATE POLICY "PEBL admins can manage area tags"
  ON area_tags FOR ALL
  USING (public.get_my_role() = 'pebl');

NOTIFY pgrst, 'reload schema';
