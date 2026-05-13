-- Enable RLS on all tables
ALTER TABLE studios ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Helper function: get studio IDs for the current user
CREATE OR REPLACE FUNCTION get_my_studio_ids()
RETURNS uuid[] AS $$
  SELECT ARRAY(
    SELECT studio_id FROM studio_users WHERE user_id = auth.uid()
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if current user is super_admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM studio_users
    WHERE user_id = auth.uid() AND role = 'super_admin'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: check if current user is owner of a given studio
CREATE OR REPLACE FUNCTION is_studio_owner(sid uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM studio_users
    WHERE user_id = auth.uid()
      AND studio_id = sid
      AND role IN ('super_admin', 'studio_owner')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =====================
-- studios policies
-- =====================
-- Users can only see studios they belong to
CREATE POLICY "studio_users_can_select_their_studios"
  ON studios FOR SELECT
  USING (id = ANY(get_my_studio_ids()));

-- Only super admins can insert studios
CREATE POLICY "owners_can_insert_studios"
  ON studios FOR INSERT
  WITH CHECK (is_super_admin());

-- Only owners can update their studio
CREATE POLICY "owners_can_update_their_studio"
  ON studios FOR UPDATE
  USING (is_studio_owner(id));

-- Only super admin can delete studios
CREATE POLICY "super_admin_can_delete_studios"
  ON studios FOR DELETE
  USING (is_super_admin());

-- =====================
-- studio_users policies
-- =====================
-- Users can see memberships for their studios
CREATE POLICY "users_can_select_studio_users"
  ON studio_users FOR SELECT
  USING (studio_id = ANY(get_my_studio_ids()));

-- Owners can add staff to their studio
CREATE POLICY "owners_can_insert_studio_users"
  ON studio_users FOR INSERT
  WITH CHECK (is_studio_owner(studio_id));

-- Owners can update roles
CREATE POLICY "owners_can_update_studio_users"
  ON studio_users FOR UPDATE
  USING (is_studio_owner(studio_id));

-- Owners can remove staff
CREATE POLICY "owners_can_delete_studio_users"
  ON studio_users FOR DELETE
  USING (is_studio_owner(studio_id));

-- =====================
-- leads policies
-- =====================
-- Users can read leads for their studios
CREATE POLICY "users_can_select_leads"
  ON leads FOR SELECT
  USING (studio_id = ANY(get_my_studio_ids()));

-- Users (staff + owner) can insert leads
CREATE POLICY "users_can_insert_leads"
  ON leads FOR INSERT
  WITH CHECK (studio_id = ANY(get_my_studio_ids()));

-- Users (staff + owner) can update leads
CREATE POLICY "users_can_update_leads"
  ON leads FOR UPDATE
  USING (studio_id = ANY(get_my_studio_ids()));

-- Only owners can delete leads
CREATE POLICY "owners_can_delete_leads"
  ON leads FOR DELETE
  USING (is_studio_owner(studio_id));
