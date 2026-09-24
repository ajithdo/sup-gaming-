-- Make your first admin.
-- 1. Sign up on the website with the email you want to use.
-- 2. Paste this into Supabase Dashboard → SQL Editor, change the email, and run it.
--    (The SQL editor runs as the `postgres` role, which is allowed to change roles.
--     Website users can never change their own role.)
-- After that, admins can promote other users from the Admin Dashboard → Users tab.

update public.profiles
   set role = 'admin'
 where email = lower('owner@example.com')
returning id, email, role;
